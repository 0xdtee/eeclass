# -*- coding: utf-8 -*-
"""Streaming VAD (voice activity detection) + sentence splitting.

Reuses faster-whisper's bundled silero_vad_v6.onnx (1.2MB, no separate download).
faster_whisper.vad.SileroVADModel is meant for batch use and resets its LSTM
state on every call; here we write our own stateful streaming version.

Two ways to split a sentence:
  - Natural split -- a long-enough pause is detected, the sentence is done.
    The gap is recorded faithfully so Word can decide whether to start a new
    paragraph.
  - Soft split   -- the teacher talks too long in one breath (over
    max_utterance_ms). We can't just wait, or the caption never shows up.
    Instead we look through the last 1.5 seconds for the frame with the lowest
    speech probability and cut there, trying to land in the gap between
    characters rather than slicing a word in half; the leftover audio is
    carried into the next sentence. A soft-split sentence records gap 0, Word
    doesn't break the paragraph, and it still reads as one continuous stretch.

Each emitted Utterance carries: audio, start/end seconds, and the silence
duration since the previous sentence.
"""
import os
from dataclasses import dataclass

import numpy as np
import onnxruntime

FRAME = 512
CTX = 64
SR = 16000


def default_model_path():
    """Locate silero_vad_v6.onnx (1.2MB).

    This file originally comes from faster-whisper's install directory, but
    `import faster_whisper` takes 3-7 seconds -- when the default backend is
    SenseVoice it isn't needed at all, and importing it just to resolve a file
    path drags out startup by several seconds, which isn't worth it. So after
    finding it the first time we copy the file to service\\models\\ and use the
    local copy from then on, never touching faster_whisper again.
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
        return src   # if the copy fails, fall back to the original location; just slow to start next time


@dataclass
class Utterance:
    audio: np.ndarray      # 16k float32
    start: float           # seconds relative to the start of the class
    end: float
    gap_before: float      # silence seconds since the previous sentence (0 for a soft split)
    forced: bool = False   # whether this came from a soft split


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
        """Speech probability of a single frame (512 samples)."""
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
    """Split a stream of frames into sentences. Uses hysteresis thresholds to avoid opening/closing repeatedly on breath pauses."""

    SOFT_LOOKBACK_MS = 1500   # how far back to look for a silence point when soft-splitting

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

        self.pos = 0                 # total samples consumed so far
        self.speaking = False
        self.buf = []                # frames of the current sentence
        self.probs = []              # speech probabilities aligned with buf, used to find the cut point when soft-splitting
        self.utt_start = 0
        self.silence_run = 0
        self.last_end = 0            # end position of the previous sentence (for computing gap)
        self.prebuf = []             # a little buffer before speech starts, to avoid clipping the first character
        self.prebuf_max = max(1, self.pad // FRAME)
        self.speech_prob = 0.0

    def push(self, frame):
        """Feed one frame; return a completed Utterance or None."""
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

    # ---------- natural split: sentence finished, there's a pause ----------
    def _close_natural(self):
        audio = np.concatenate(self.buf) if self.buf else np.zeros(0, dtype=np.float32)
        # trim trailing silence, but keep a little pad so it doesn't sound cut off
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
            return None  # too short, most likely a cough, a chair, or a page turning

        gap = max(0.0, (start - self.last_end) / SR)
        self.last_end = end
        return Utterance(audio, start / SR, end / SR, gap, forced=False)

    # ---------- soft split: talked too long, cut at the quietest spot ----------
    def _cut_soft(self):
        n = len(self.buf)
        min_frames = max(1, self.min_speech // FRAME)
        lo = max(min_frames, n - self.lookback)
        if lo >= n:
            k = n
        else:
            k = lo + int(np.argmin(self.probs[lo:n]))
            k = max(min_frames, min(k + 1, n))   # the cut point goes after the silence frame

        audio = np.concatenate(self.buf[:k])
        start = self.utt_start
        end = start + audio.size

        # keep accumulating the rest, it belongs to the same stretch
        self.buf = self.buf[k:]
        self.probs = self.probs[k:]
        self.utt_start = end
        self.last_end = end
        # silence_run was measured against the old tail; after the cut we're not at the sentence end yet, so reset it
        self.silence_run = 0

        return Utterance(audio, start / SR, end / SR, 0.0, forced=True)

    def flush(self):
        """When recording stops, flush the sentence that hasn't finished yet."""
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
