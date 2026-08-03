# -*- coding: utf-8 -*-
"""音频采集：麦克风（线下课）或 系统声音回环（网课）。

两条路径用了不同的库，因为没有一个库能把两件事都干好：
  · 麦克风   —— sounddevice。回调式，延迟低，成熟稳定。
  · 系统声音 —— soundcard。sounddevice 0.5.5 的 WasapiSettings **没有**
                loopback 参数（实测确认），拿不到系统输出，只能换库。
                soundcard 是拉取式的，所以单开一个线程去 record。

统一输出 16kHz 单声道 float32 帧（512 点）交给 VAD。

设备 id 用字符串区分来源： "sd:9" = sounddevice 第 9 号输入， "sc:0" = soundcard 第 0 个回环。
"""
import queue
import re
import threading
from fractions import Fraction

import numpy as np
from scipy.signal import resample_poly

# sounddevice 依赖 PortAudio，服务器（无声卡的 Linux）上装不上也用不到——
# 服务器场景音频全来自浏览器推流（BrowserCapture）。所以做成可选，
# 缺了只是本机采集（Capture / 回环）不可用，不影响手机端整条链路。
try:
    import sounddevice as sd
    HAS_LOCAL_AUDIO = True
except Exception:
    sd = None
    HAS_LOCAL_AUDIO = False

TARGET_SR = 16000
FRAME = 512  # VAD 要求的帧长（16k 下 = 32ms）

# 同一个物理麦克风会在四套主机 API 下各列一遍。可靠性差很多，实测：
#   WASAPI      —— 首选，延迟低，稳
#   MME         —— 老接口，能用，延迟高一点
#   DirectSound —— 能用
#   WDM-KS      —— 最底层，经常直接开不起来。本机实测：
#                  蓝牙耳机免提 → PaErrorCode -9999 'WdmSyncIoctl: DeviceIoControl GLE=0x490'
#                  Realtek 麦克风阵列 → -9996 Invalid device
# 所以按这个顺序去重，只把每个物理设备最好的那条列出来。
HOST_RANK = {"Windows WASAPI": 0, "MME": 1, "Windows DirectSound": 2, "Windows WDM-KS": 3}
SHAKY_RANK = 3      # 到这一级就标记为「可能开不起来」


def _dev_key(name):
    """把同一个设备在不同 API 下的名字归一。MME 会把名字截断到 31 字符，
    所以只取前面一小段做键。"""
    return re.sub(r"\s+", "", name)[:22].lower()


class AGC:
    """自动增益。把偏小的输入拉到一个合适的电平再送去 VAD 和识别。

    为什么需要：这台机器实测录下来的课堂音频峰值只有 0.02~0.20，比正常录音低
    20~30dB。虽然实测 VAD 和 SenseVoice 抗噪很好（0dB 信噪比、-36dB 衰减都不丢字），
    但电平太低时余量很小，稍微远一点、小声一点就容易掉出来。

    做法是峰值跟踪 + 慢衰减：
      · 只在有声音时抬高包络，静音时让它慢慢往下滑——这样不会在没人说话的时候
        把底噪一路放大（那会让 VAD 疯狂误触发）。
      · 增益只放大不缩小（下限 1.0），本来就够响的输入原样通过。
      · 变化做平滑，避免一句话中间音量突然跳变。
      · 最后软限幅，别削顶。
    """

    def __init__(self, target_rms=0.05, max_gain=15.0, floor=3e-4,
                 decay=0.9993, smooth=0.05):
        self.target = target_rms
        self.max_gain = max_gain
        self.floor = floor          # 低于这个电平当作静音，不参与包络
        self.decay = decay
        self.smooth = smooth
        self.env = floor
        self.gain = 1.0

    def process(self, mono):
        r = float(np.sqrt(np.mean(mono * mono))) if mono.size else 0.0
        if r > self.floor:
            self.env = max(r, self.env * self.decay)
        else:
            self.env *= self.decay
        want = self.target / max(self.env, self.floor)
        want = min(max(want, 1.0), self.max_gain)
        self.gain += (want - self.gain) * self.smooth
        out = mono * self.gain
        # 软限幅：超过 0.95 的部分压缩进去，不硬削
        peak = float(np.abs(out).max()) if out.size else 0.0
        if peak > 0.95:
            out = np.tanh(out / peak * 1.5) * (0.95 / np.tanh(1.5))
        return out.astype(np.float32)


def _ensure_com():
    """soundcard 走 MediaFoundation/COM，而 COM 是**按线程**初始化的。

    本模块的回环代码会在三种线程上跑（主线程、aiohttp 的 executor 线程、
    自己开的采集线程），任何一个没 CoInitializeEx 就直接
    RuntimeError: Error 0x800401f0 (CO_E_NOTINITIALIZED)。
    返回 True 表示"是我初始化的"，调用方负责在线程退出前 CoUninitialize。
    """
    import ctypes
    if not hasattr(ctypes, "windll"):
        return False           # 非 Windows：本机回环用不到，直接跳过
    hr = ctypes.windll.ole32.CoInitializeEx(None, 0)   # 0 = 多线程套间
    return hr == 0            # S_OK=新初始化；S_FALSE(1)=本线程早就初始化过


def _loopback_mics():
    try:
        import soundcard as sc
        _ensure_com()   # 枚举本身也过 COM；这里在池线程上跑，不配对 uninit
        return [m for m in sc.all_microphones(include_loopback=True) if m.isloopback]
    except Exception:
        return []


def _all_mics():
    """所有输入设备的原始清单（含各 API 下的重复项），内部用。"""
    apis = sd.query_hostapis()
    try:
        default_in = sd.default.device[0]
    except Exception:
        default_in = -1
    out = []
    for i, d in enumerate(sd.query_devices()):
        if d["max_input_channels"] <= 0:
            continue
        api = apis[d["hostapi"]]["name"]
        out.append({
            "id": f"sd:{i}", "index": i, "name": d["name"].strip(), "api": api, "kind": "mic",
            "sr": int(d["default_samplerate"]), "ch": d["max_input_channels"],
            "default": (i == default_in),
            "rank": HOST_RANK.get(api, 9),
            "key": _dev_key(d["name"]),
        })
    return out


def list_devices():
    """列出可用音源：麦克风（每个物理设备只留最可靠的那条）+ 系统声音回环。
    服务器上没有本机声卡，返回空——手机端会自动用「本设备的麦克风」，不受影响。"""
    if not HAS_LOCAL_AUDIO:
        return []
    best = {}
    for d in _all_mics():
        cur = best.get(d["key"])
        if cur is None or d["rank"] < cur["rank"]:
            if cur is not None:
                d["default"] = d["default"] or cur["default"]
            best[d["key"]] = d
        elif d["default"]:
            cur["default"] = True     # 系统默认设备的标记别在去重时丢了

    out = sorted(best.values(), key=lambda x: (x["rank"], x["index"]))
    for d in out:
        d["shaky"] = d["rank"] >= SHAKY_RANK

    for i, m in enumerate(_loopback_mics()):
        out.append({
            "id": f"sc:{i}", "name": m.name.strip(), "api": "WASAPI Loopback",
            "kind": "loopback", "sr": TARGET_SR, "ch": m.channels, "default": False,
            "shaky": False,
        })
    return out


def pick_default_device():
    devs = list_devices()
    for d in devs:
        if d["kind"] == "mic" and d["api"] == "Windows WASAPI":
            return d["id"]
    for d in devs:
        if d["kind"] == "mic" and not d.get("shaky"):
            return d["id"]
    for d in devs:
        if d["kind"] == "mic":
            return d["id"]
    return None


def _alternates(index):
    """给定一个输入设备序号，返回「同一个物理设备」在其它主机 API 下的序号，
    按可靠性排序。WDM-KS 开不起来时用它换一条路，而不是直接让用户上不了课。"""
    mics = _all_mics()
    me = next((d for d in mics if d["index"] == index), None)
    if me is None:
        return []
    same = [d for d in mics if d["key"] == me["key"] and d["index"] != index]
    return [d["index"] for d in sorted(same, key=lambda x: (x["rank"], x["index"]))]


class BrowserCapture:
    """音频来自浏览器（手机/平板/别的电脑），不是本机声卡。

    和 Capture 对外接口一致（frames 队列 + start/stop + level），
    这样 Session 那边不用关心音频到底是本机采的还是网页推来的。

    网页那边用 getUserMedia 拿麦克风，降采样到 16k 单声道 Int16 后
    通过 WebSocket 二进制帧推过来。注意浏览器**必须在 HTTPS 下**才给麦克风权限，
    所以服务是 HTTPS 的，网页也由本服务同源托管。
    """

    def __init__(self, on_error=None):
        self.on_error = on_error
        self.frames = queue.Queue(maxsize=4000)   # 网络抖动比本机采集大，缓冲给足
        self.level = 0.0
        self.overflow_count = 0
        self._tail = np.zeros(0, dtype=np.float32)
        self._lock = threading.Lock()
        self._running = False

    def start(self):
        self._running = True
        return {"src_sr": TARGET_SR, "channels": 1, "api": "浏览器麦克风",
                "name": "浏览器麦克风", "loopback": False}

    def push_pcm(self, data):
        """收网页推来的 16k 单声道 Int16 小端字节流。"""
        if not self._running or not data:
            return
        mono = np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768.0
        with self._lock:
            buf = np.concatenate([self._tail, mono]) if self._tail.size else mono
            n = (buf.size // FRAME) * FRAME
            self._tail = buf[n:].copy()
            chunk = buf[:n]
        if n:
            self.level = float(np.abs(chunk).max())
            for i in range(0, n, FRAME):
                try:
                    self.frames.put_nowait(chunk[i:i + FRAME])
                except queue.Full:
                    self.overflow_count += 1

    def stop(self):
        self._running = False


class Capture:
    """后台采集，把 16k 单声道 512 点帧推进 self.frames 队列。"""

    def __init__(self, device=None, loopback=False, gain=1.0, on_error=None, agc=None):
        self.device = device if device else pick_default_device()
        self.loopback = bool(loopback) or str(self.device or "").startswith("sc:")
        self.gain = float(gain)
        a = agc or {}
        self.agc = AGC(target_rms=a.get("target_rms", 0.05),
                       max_gain=a.get("max_gain", 15.0)) if a.get("enabled", True) else None
        self.on_error = on_error
        self.frames = queue.Queue(maxsize=2000)   # ~64 秒缓冲，正常远用不到
        self._stream = None
        self._thread = None
        self._running = False
        self._tail = np.zeros(0, dtype=np.float32)
        self._lock = threading.Lock()
        self.overflow_count = 0
        self.level = 0.0   # 最近音量（0~1），界面画电平条用

    # ---------- 公共：把任意采样率的单声道数据切成 512 点帧 ----------
    def _feed(self, mono, up, down):
        if self.gain != 1.0:
            mono = mono * self.gain
        if up != down:
            mono = resample_poly(mono, up, down).astype(np.float32)
        if self.agc is not None:
            mono = self.agc.process(mono)
        with self._lock:
            buf = np.concatenate([self._tail, mono]) if self._tail.size else mono
            n = (buf.size // FRAME) * FRAME
            self._tail = buf[n:].copy()
            chunk = buf[:n]
        if n:
            self.level = float(np.abs(chunk).max())
            for i in range(0, n, FRAME):
                try:
                    self.frames.put_nowait(chunk[i:i + FRAME])
                except queue.Full:
                    pass   # 处理跟不上就丢帧，宁可丢也不能卡住采集

    def start(self):
        if self.loopback:
            return self._start_loopback()
        return self._start_mic()

    # ---------- 麦克风 ----------
    def _start_mic(self):
        idx = int(str(self.device).split(":")[1]) if self.device else None
        if idx is None:
            info = sd.query_devices(kind="input")
            idx = info["index"] if isinstance(info, dict) and "index" in info else None
        try:
            return self._open_mic(idx)
        except Exception as first:
            # WDM-KS 那套经常直接开不起来（-9999 WdmSyncIoctl / -9996 Invalid device）。
            # 同一个物理麦克风在 WASAPI/MME 下通常好好的，自动换过去，
            # 别让一堂课因为选错了一条驱动通道就录不成。
            for alt in _alternates(idx):
                try:
                    info = self._open_mic(alt)
                    if self.on_error:
                        self.on_error(f"这个麦克风原来那条驱动通道打不开，"
                                      f"已自动改走 {info['api']}，内容照录。")
                    return info
                except Exception:
                    continue

            # 连一条能用的通道都没有（比如蓝牙耳机没连上、声卡阵列被禁用）。
            # 与其让人对着报错发呆、整节课白上，不如退回默认麦克风并说清楚。
            fb = pick_default_device()
            fb_idx = int(fb.split(":")[1]) if fb and fb.startswith("sd:") else None
            if fb_idx is not None and fb_idx != idx:
                try:
                    info = self._open_mic(fb_idx)
                    if self.on_error:
                        self.on_error(f"你选的那个音源打不开（设备可能没连上或被禁用），"
                                      f"已改用「{info['name'][:24]}」。想换回去请先在 Windows "
                                      f"声音设置里确认它可用，再重新开始听课。")
                    return info
                except Exception:
                    pass
            raise RuntimeError(
                f"这个音源打不开：{first}。多半是设备没连上/被禁用，"
                f"或者它只有 WDM-KS 这一条驱动通道（这条路在 Windows 上经常开不起来）。"
                f"换列表里不带 ⚠ 的音源试试。")

    def _open_mic(self, idx):
        info = sd.query_devices(idx)
        api = sd.query_hostapis(info["hostapi"])["name"]
        src_sr = int(info["default_samplerate"])
        channels = min(2, int(info["max_input_channels"]) or 1)
        f = Fraction(TARGET_SR, src_sr).limit_denominator(1000)
        up, down = f.numerator, f.denominator

        def callback(indata, nframes, time_info, status):
            if status and status.input_overflow:
                self.overflow_count += 1
            try:
                x = indata if indata.ndim == 1 else indata.mean(axis=1)
                self._feed(np.ascontiguousarray(x, dtype=np.float32), up, down)
            except Exception as e:   # 回调里绝不能抛，否则流会静默死掉
                if self.on_error:
                    self.on_error(f"采集回调异常: {e}")

        stream = sd.InputStream(
            device=idx, channels=channels, samplerate=src_sr, dtype="float32",
            blocksize=int(src_sr * 0.032), callback=callback)
        stream.start()   # 打不开时是 start() 抛，不是构造时抛，所以两句都要在 try 里
        self._stream = stream
        self._running = True
        return {"src_sr": src_sr, "channels": channels, "api": api,
                "name": info["name"].strip(), "loopback": False}

    # ---------- 系统声音回环 ----------
    def _start_loopback(self):
        mics = _loopback_mics()
        if not mics:
            raise RuntimeError("找不到系统声音回环设备（soundcard 没装或没有可用的输出设备）")
        i = int(str(self.device).split(":")[1]) if str(self.device).startswith("sc:") else 0
        mic = mics[min(i, len(mics) - 1)]

        self._running = True
        started = threading.Event()
        err = {}

        def loop():
            import ctypes
            co_ok = _ensure_com()
            try:
                with mic.recorder(samplerate=TARGET_SR, channels=mic.channels,
                                  blocksize=FRAME * 4) as rec:
                    started.set()
                    while self._running:
                        d = rec.record(numframes=FRAME * 2)
                        if d is None or len(d) == 0:
                            continue
                        mono = d.mean(axis=1) if d.ndim > 1 else d
                        self._feed(np.asarray(mono, dtype=np.float32), 1, 1)
            except Exception as e:
                err["e"] = e
                started.set()
                if self.on_error:
                    self.on_error(f"系统声音采集失败: {e}")
            finally:
                if co_ok:
                    ctypes.windll.ole32.CoUninitialize()

        self._thread = threading.Thread(target=loop, daemon=True, name="loopback")
        self._thread.start()
        if not started.wait(5.0):
            raise RuntimeError("系统声音采集启动超时")
        if "e" in err:
            raise err["e"]
        return {"src_sr": TARGET_SR, "channels": mic.channels,
                "name": mic.name.strip(), "loopback": True}

    def stop(self):
        self._running = False
        if self._stream is not None:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception:
                pass
            self._stream = None
        if self._thread is not None:
            self._thread.join(timeout=2.0)
            self._thread = None
