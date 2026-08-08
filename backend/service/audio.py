# -*- coding: utf-8 -*-
"""Audio capture: microphone (in-person class) or system audio loopback (online class).

The two paths use different libraries because no single one does both well:
  · microphone   —— sounddevice. Callback-based, low latency, mature and stable.
  · system audio —— soundcard. sounddevice 0.5.5's WasapiSettings has **no**
                loopback parameter (confirmed in testing), so it can't grab the
                system output; a different library is required.
                soundcard is pull-based, so we run its record() in its own thread.

Both paths output 16kHz mono float32 frames (512 samples) for the VAD.

Device ids use a string prefix for the source: "sd:9" = sounddevice input #9, "sc:0" = soundcard loopback #0.
"""
import queue
import re
import threading
from fractions import Fraction

import numpy as np
from scipy.signal import resample_poly

# sounddevice depends on PortAudio, which can't (and needn't) be installed on the server (headless Linux, no sound card)——
# on the server all audio comes from browser streaming (BrowserCapture). So it's optional:
# without it only local capture (Capture / loopback) is unavailable, which doesn't affect the whole mobile pipeline.
try:
    import sounddevice as sd
    HAS_LOCAL_AUDIO = True
except Exception:
    sd = None
    HAS_LOCAL_AUDIO = False

TARGET_SR = 16000
FRAME = 512  # frame length required by the VAD (= 32ms at 16k)

# the same physical mic gets listed once under each of the four host APIs. Reliability varies a lot; measured:
#   WASAPI      —— first choice, low latency, stable
#   MME         —— old API, works, slightly higher latency
#   DirectSound —— works
#   WDM-KS      —— lowest level, often just fails to open. Measured on this machine:
#                  Bluetooth headset hands-free → PaErrorCode -9999 'WdmSyncIoctl: DeviceIoControl GLE=0x490'
#                  Realtek mic array → -9996 Invalid device
# so we dedupe in this order and list only the best channel for each physical device.
HOST_RANK = {"Windows WASAPI": 0, "MME": 1, "Windows DirectSound": 2, "Windows WDM-KS": 3}
SHAKY_RANK = 3      # at this level, flag it as "might fail to open"


def _dev_key(name):
    """Normalize the name of the same device across different APIs. MME truncates
    names to 31 chars, so use only a short leading segment as the key."""
    return re.sub(r"\s+", "", name)[:22].lower()


class AGC:
    """Automatic gain. Raise a too-quiet input to a sensible level before sending it to the VAD and recognizer.

    Why it's needed: classroom audio recorded on this machine peaks at only 0.02~0.20,
    20~30dB below a normal recording. VAD and SenseVoice do handle noise well in testing
    (no dropped words at 0dB SNR or -36dB attenuation), but at such low levels the margin
    is tiny—a little farther away or a little quieter and words start dropping out.

    The approach is peak tracking + slow decay:
      · only raise the envelope when there's sound, and let it slide down slowly during
        silence—so we don't amplify the noise floor while nobody is speaking (that would
        make the VAD fire constantly).
      · gain only amplifies, never attenuates (floor 1.0); an already-loud input passes through unchanged.
      · smooth the changes to avoid sudden volume jumps mid-sentence.
      · finally soft-clip so peaks aren't clipped.
    """

    def __init__(self, target_rms=0.05, max_gain=15.0, floor=3e-4,
                 decay=0.9993, smooth=0.05):
        self.target = target_rms
        self.max_gain = max_gain
        self.floor = floor          # below this level, treat as silence and exclude from the envelope
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
        # soft clip: compress anything above 0.95 rather than hard-clipping it
        peak = float(np.abs(out).max()) if out.size else 0.0
        if peak > 0.95:
            out = np.tanh(out / peak * 1.5) * (0.95 / np.tanh(1.5))
        return out.astype(np.float32)


def _ensure_com():
    """soundcard goes through MediaFoundation/COM, and COM is initialized **per thread**.

    The loopback code in this module runs on three kinds of threads (main thread,
    aiohttp's executor thread, and our own capture thread); any one of them without
    CoInitializeEx fails outright with
    RuntimeError: Error 0x800401f0 (CO_E_NOTINITIALIZED).
    Returns True to mean "I did the init", so the caller knows to CoUninitialize before the thread exits.
    """
    import ctypes
    if not hasattr(ctypes, "windll"):
        return False           # non-Windows: local loopback isn't used, just skip
    hr = ctypes.windll.ole32.CoInitializeEx(None, 0)   # 0 = multithreaded apartment
    return hr == 0            # S_OK = newly initialized; S_FALSE(1) = this thread was already initialized


def _loopback_mics():
    try:
        import soundcard as sc
        _ensure_com()   # enumeration itself also goes through COM; this runs on a pool thread, no paired uninit
        return [m for m in sc.all_microphones(include_loopback=True) if m.isloopback]
    except Exception:
        return []


def _all_mics():
    """Raw list of all input devices (including duplicates per API), for internal use."""
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
    """List available audio sources: microphones (only the most reliable channel per physical device) + system audio loopback.
    The server has no local sound card and returns empty—the mobile side automatically uses "this device's microphone", so it's unaffected."""
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
            cur["default"] = True     # don't lose the system-default marker during dedup

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
    """Given an input device index, return the indexes of "the same physical device"
    under other host APIs, sorted by reliability. When WDM-KS fails to open, use this
    to take another route instead of just leaving the user unable to start class."""
    mics = _all_mics()
    me = next((d for d in mics if d["index"] == index), None)
    if me is None:
        return []
    same = [d for d in mics if d["key"] == me["key"] and d["index"] != index]
    return [d["index"] for d in sorted(same, key=lambda x: (x["rank"], x["index"]))]


class BrowserCapture:
    """Audio comes from a browser (phone/tablet/another computer), not the local sound card.

    Exposes the same interface as Capture (frames queue + start/stop + level),
    so Session doesn't have to care whether audio was captured locally or pushed from a web page.

    The web page uses getUserMedia for the mic, downsamples to 16k mono Int16, and
    pushes it over WebSocket as binary frames. Note the browser only grants mic access
    **over HTTPS**, so the service is HTTPS and the page is served same-origin by this service.
    """

    def __init__(self, on_error=None):
        self.on_error = on_error
        self.frames = queue.Queue(maxsize=4000)   # network jitter is larger than local capture, so give the buffer plenty of room
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
        """Receive the 16k mono Int16 little-endian byte stream pushed from the web page."""
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
    """Background capture: push 16k mono 512-sample frames into the self.frames queue."""

    def __init__(self, device=None, loopback=False, gain=1.0, on_error=None, agc=None):
        self.device = device if device else pick_default_device()
        self.loopback = bool(loopback) or str(self.device or "").startswith("sc:")
        self.gain = float(gain)
        a = agc or {}
        self.agc = AGC(target_rms=a.get("target_rms", 0.05),
                       max_gain=a.get("max_gain", 15.0)) if a.get("enabled", True) else None
        self.on_error = on_error
        self.frames = queue.Queue(maxsize=2000)   # ~64 seconds of buffer, far more than normally needed
        self._stream = None
        self._thread = None
        self._running = False
        self._tail = np.zeros(0, dtype=np.float32)
        self._lock = threading.Lock()
        self.overflow_count = 0
        self.level = 0.0   # most recent volume (0~1), used to draw the level bar in the UI

    # ---------- shared: slice mono data of any sample rate into 512-sample frames ----------
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
                    pass   # if processing can't keep up, drop frames—better to drop than to stall capture

    def start(self):
        if self.loopback:
            return self._start_loopback()
        return self._start_mic()

    # ---------- microphone ----------
    def _start_mic(self):
        idx = int(str(self.device).split(":")[1]) if self.device else None
        if idx is None:
            info = sd.query_devices(kind="input")
            idx = info["index"] if isinstance(info, dict) and "index" in info else None
        try:
            return self._open_mic(idx)
        except Exception as first:
            # the WDM-KS path often just fails to open (-9999 WdmSyncIoctl / -9996 Invalid device).
            # the same physical mic usually works fine under WASAPI/MME, so switch to it automatically,
            # rather than let a class fail to record just because the wrong driver channel was picked.
            for alt in _alternates(idx):
                try:
                    info = self._open_mic(alt)
                    if self.on_error:
                        self.on_error(f"这个麦克风原来那条驱动通道打不开，"
                                      f"已自动改走 {info['api']}，内容照录。")
                    return info
                except Exception:
                    continue

            # not a single usable channel (e.g. the Bluetooth headset isn't connected, the sound-card array is disabled).
            # rather than leave someone staring at an error and wasting a whole class, fall back to the default mic and say so clearly.
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
            except Exception as e:   # never raise inside the callback, or the stream dies silently
                if self.on_error:
                    self.on_error(f"采集回调异常: {e}")

        stream = sd.InputStream(
            device=idx, channels=channels, samplerate=src_sr, dtype="float32",
            blocksize=int(src_sr * 0.032), callback=callback)
        stream.start()   # it's start() that raises when opening fails, not the constructor, so both lines must be in the try
        self._stream = stream
        self._running = True
        return {"src_sr": src_sr, "channels": channels, "api": api,
                "name": info["name"].strip(), "loopback": False}

    # ---------- system audio loopback ----------
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
