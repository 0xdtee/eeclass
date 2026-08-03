# -*- coding: utf-8 -*-
"""流式 VAD（语音活动检测）+ 分句。

复用 faster-whisper 自带的 silero_vad_v6.onnx（1.2MB，无需另外下载）。
faster_whisper.vad.SileroVADModel 是批处理用的，每次调用都重置 LSTM 状态；
这里自己写一个保持状态的流式版本。

两种切句方式：
  · 自然切 —— 检测到足够长的停顿，一句话说完了。gap 会如实记录，
    Word 那边据此决定要不要换段落。
  · 软切   —— 老师一口气讲太久（超过 max_utterance_ms）。这时不能干等，
    否则字幕迟迟不出。做法是在最近 1.5 秒里找语音概率最低的那一帧下刀，
    尽量落在字与字的缝隙上，而不是把词劈成两半；剩下的音频留给下一句接着用。
    软切出来的句子 gap 记为 0，Word 里不换段，读起来还是连贯的一段话。

输出的每个 Utterance 带：音频、起止秒数、以及距上一句的静音时长。
"""
import os
from dataclasses import dataclass

import numpy as np
import onnxruntime

FRAME = 512
CTX = 64
SR = 16000


def default_model_path():
    """找 silero_vad_v6.onnx（1.2MB）。

    这个文件本来是从 faster-whisper 的安装目录里拿的，但 `import faster_whisper`
    要 3~7 秒——默认后端是 SenseVoice 时根本用不到它，只为了求一个文件路径就把
    服务启动拖慢好几秒，不值。所以首次找到后把文件复制到 service\\models\\，
    以后直接用本地那份，彻底不碰 faster_whisper。
    """
    local = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         "models", "silero_vad_v6.onnx")
    if os.path.exists(local):
        return local
    from faster_whisper.vad import get_assets_path
    src = os.path.join(get_assets_path(), "silero_vad_v6.onnx")
    try:
        import shutil
        os.makedirs(os.path.dirname(local), exist_ok=True)
        shutil.copyfile(src, local)
        return local
    except Exception:
        return src   # 复制不了就照旧用原位置，只是下次启动还是慢


@dataclass
class Utterance:
    audio: np.ndarray      # 16k float32
    start: float           # 相对开课时刻的秒数
    end: float
    gap_before: float      # 与上一句之间的静音秒数（软切为 0）
    forced: bool = False   # 是否是软切出来的


class StreamVAD:
    def __init__(self, path=None):
        path = path or default_model_path()
        opts = onnxruntime.SessionOptions()
        opts.inter_op_num_threads = 1
        opts.intra_op_num_threads = 1
        opts.log_severity_level = 4
        self.sess = onnxruntime.InferenceSession(
            path, providers=["CPUExecutionProvider"], sess_options=opts)
        self._in_names = [i.name for i in self.sess.get_inputs()]
        self.reset()

    def reset(self):
        self.h = np.zeros((1, 1, 128), dtype=np.float32)
        self.c = np.zeros((1, 1, 128), dtype=np.float32)
        self.ctx = np.zeros((1, CTX), dtype=np.float32)

    def prob(self, frame):
        """单帧(512点)语音概率。"""
        x = np.concatenate([self.ctx, frame.reshape(1, -1)], axis=1).astype(np.float32)
        feeds = {"input": x}
        if "h" in self._in_names:
            feeds["h"] = self.h
            feeds["c"] = self.c
        out = self.sess.run(None, feeds)
        if "h" in self._in_names and len(out) >= 3:
            self.h, self.c = out[1], out[2]
        self.ctx = frame.reshape(1, -1)[:, -CTX:]
        return float(np.ravel(out[0])[0])


class Segmenter:
    """把连续帧切成一句一句的话。带迟滞阈值，避免在气口上频繁开合。"""

    SOFT_LOOKBACK_MS = 1500   # 软切时往回找多远的静音点

    def __init__(self, cfg, vad=None):
        v = cfg["vad"]
        self.vad = vad or StreamVAD()
        self.th_on = v["threshold"]
        self.th_off = v["exit_threshold"]
        self.min_speech = int(v["min_speech_ms"] * SR / 1000)
        self.min_silence = int(v["min_silence_ms"] * SR / 1000)
        self.max_utt = int(v["max_utterance_ms"] * SR / 1000)
        self.pad = int(v["pad_ms"] * SR / 1000)
        self.lookback = int(self.SOFT_LOOKBACK_MS * SR / 1000 / FRAME)

        self.pos = 0                 # 已消费的总样本数
        self.speaking = False
        self.buf = []                # 当前句的帧
        self.probs = []              # 与 buf 对齐的语音概率，软切时用来找下刀点
        self.utt_start = 0
        self.silence_run = 0
        self.last_end = 0            # 上一句结束位置（算 gap 用）
        self.prebuf = []             # 说话前的一点点缓冲，避免吃字
        self.prebuf_max = max(1, self.pad // FRAME)
        self.speech_prob = 0.0

    def push(self, frame):
        """喂一帧，返回一个完成的 Utterance 或 None。"""
        p = self.vad.prob(frame)
        self.speech_prob = p
        self.pos += FRAME

        if not self.speaking:
            self.prebuf.append(frame)
            if len(self.prebuf) > self.prebuf_max:
                self.prebuf.pop(0)
            if p >= self.th_on:
                self.speaking = True
                self.buf = list(self.prebuf)
                self.probs = [1.0] * len(self.buf)
                self.utt_start = self.pos - len(self.buf) * FRAME
                self.prebuf = []
                self.silence_run = 0
            return None

        self.buf.append(frame)
        self.probs.append(p)

        if p < self.th_off:
            self.silence_run += FRAME
            if self.silence_run >= self.min_silence:
                return self._close_natural()
        else:
            self.silence_run = 0

        if len(self.buf) * FRAME >= self.max_utt:
            return self._cut_soft()
        return None

    # ---------- 自然切：说完一句，有停顿 ----------
    def _close_natural(self):
        audio = np.concatenate(self.buf) if self.buf else np.zeros(0, dtype=np.float32)
        # 去掉尾部静音，但保留一点 pad，免得听起来被掐掉
        if self.silence_run > self.pad:
            cut = self.silence_run - self.pad
            if 0 < cut < audio.size:
                audio = audio[:audio.size - cut]

        start = self.utt_start
        end = start + audio.size
        self.speaking = False
        self.buf = []
        self.probs = []
        self.silence_run = 0
        self.prebuf = []

        if audio.size < self.min_speech:
            self.last_end = end
            return None  # 太短，多半是咳嗽、桌椅声、翻书声

        gap = max(0.0, (start - self.last_end) / SR)
        self.last_end = end
        return Utterance(audio, start / SR, end / SR, gap, forced=False)

    # ---------- 软切：讲太久了，在最安静的地方下刀 ----------
    def _cut_soft(self):
        n = len(self.buf)
        min_frames = max(1, self.min_speech // FRAME)
        lo = max(min_frames, n - self.lookback)
        if lo >= n:
            k = n
        else:
            k = lo + int(np.argmin(self.probs[lo:n]))
            k = max(min_frames, min(k + 1, n))   # 下刀点算在静音帧之后

        audio = np.concatenate(self.buf[:k])
        start = self.utt_start
        end = start + audio.size

        # 剩下的继续攒，属于同一段话
        self.buf = self.buf[k:]
        self.probs = self.probs[k:]
        self.utt_start = end
        self.last_end = end
        # silence_run 是针对当前尾部的，切完还没到句尾，重新计
        self.silence_run = 0

        return Utterance(audio, start / SR, end / SR, 0.0, forced=True)

    def flush(self):
        """停止录制时，把还没说完的那句吐出来。"""
        if not (self.speaking and self.buf):
            return None
        audio = np.concatenate(self.buf)
        start = self.utt_start
        end = start + audio.size
        self.speaking = False
        self.buf = []
        self.probs = []
        if audio.size < self.min_speech:
            return None
        gap = max(0.0, (start - self.last_end) / SR)
        self.last_end = end
        return Utterance(audio, start / SR, end / SR, gap, forced=False)
