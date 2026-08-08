# -*- coding: utf-8 -*-
"""Streaming recognition: text appears as you speak (sherpa-onnx streaming zipformer).

How it differs from the default path:
  - Default path (sensevoice/whisper) -- VAD cuts a whole sentence -> the whole
    sentence is handed to the model -> text comes out. Latency = waiting for the
    sentence to finish (up to 8 seconds) + decoding. Accurate, but the text
    arrives late.
  - This path -- audio is fed continuously to the model, which emits the current
    result every 0.2 seconds, so text appears mid-sentence (measured first
    character at 0.6 seconds). Sentence breaks rely on the model's built-in
    endpoint detection.

The trade-offs (know them before choosing):
  - The model itself **outputs no punctuation**; a ct-transformer punctuation
    model fills it in at sentence breaks. That is: the live text you see mid-way
    has no punctuation, only the finalized sentence does.
  - Partial results **change as you speak** (characters shown earlier may get
    corrected later), so only finalized sentences are written into Word and the
    record file; the mid-way ones only scroll by in the console.
  - When there's no pause for a long time, endpoint detection cuts very long
    sentences (a 43-second segment was observed), so we add one more gate here:
    "force a sentence break past max_utterance_s".

The external interface is the same as vad.Segmenter: push(frame) returns an
Utterance or None, except the returned Utterance additionally carries the
recognized .text, so downstream doesn't need to run ASR again.
"""
import os
import time
from dataclasses import dataclass

import numpy as np

from vad import Utterance

SR = 16000
HERE = os.path.dirname(os.path.abspath(__file__))


def _p(path):
    return path if os.path.isabs(path) else os.path.normpath(os.path.join(HERE, path))


@dataclass
class StreamUtterance(Utterance):
    text: str = ""
    proc_s: float = 0.0


class StreamingASR:
    def __init__(self, cfg, on_partial=None):
        a = cfg["asr"]
        c = a.get("zipformer") or {}
        self.on_partial = on_partial
        self.max_utt_s = cfg["vad"].get("max_utterance_ms", 8000) / 1000.0 * 2.5
        self.min_speech_s = cfg["vad"].get("min_speech_ms", 250) / 1000.0
        # zipformer's endpoint detection cuts one- or two-second fragments like "I." or "So." at hesitations.
        # fragments as standalone sentences have two downsides: voiceprints are unreliable on audio this short (measured: split one person into
        # three speakers, and squeezed the real teacher into "classmate A"), and the document ends up all choppy.
        # so fragments don't form their own sentence; they're accumulated and merged into the next one.
        c2 = c.get("merge", {})
        self.merge_below_s = c2.get("below_seconds", 2.0)
        self.merge_below_chars = c2.get("below_chars", 8)
        self.carry_max_s = c2.get("carry_max_seconds", 6.0)
        self._carry_text = ""
        self._carry_audio = []
        self._carry_start = None

        import sherpa_onnx
        d = _p(c.get("model_dir",
                     "models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20"))
        sfx = ".int8.onnx" if c.get("int8", True) else ".onnx"
        t0 = time.time()
        self.rec = sherpa_onnx.OnlineRecognizer.from_transducer(
            tokens=os.path.join(d, "tokens.txt"),
            encoder=os.path.join(d, "encoder-epoch-99-avg-1" + sfx),
            decoder=os.path.join(d, "decoder-epoch-99-avg-1.onnx"),
            joiner=os.path.join(d, "joiner-epoch-99-avg-1" + sfx),
            num_threads=a.get("cpu_threads", 6),
            sample_rate=SR, feature_dim=80, decoding_method="greedy_search",
            enable_endpoint_detection=True,
            rule1_min_trailing_silence=c.get("rule1_min_trailing_silence", 2.4),
            rule2_min_trailing_silence=c.get("rule2_min_trailing_silence", 0.8),
            rule3_min_utterance_length=c.get("rule3_min_utterance_length", 300),
        )
        from asr_backends import make_punct
        self.punct = make_punct(a)
        self.load_s = time.time() - t0

        self.stream = self.rec.create_stream()
        self.buf = []              # audio of the current sentence (needed for speaker identification)
        self.samples = 0           # total samples fed in = the time axis
        self.seg_start = 0.0
        self.last_end = None        # position of the last sentence break
        self.last_gap_end = None    # end time of the previous sentence that was **actually finalized**, used to compute the paragraph gap
        self.partial = ""
        self.proc_s = 0.0          # cumulative decode time of the current sentence
        self.speaking = False
        self.speech_prob = 0.0     # the bar drawn in the UI; streaming has no VAD probability, so approximate with whether text is coming out
        self.total_proc = 0.0      # cumulative decode time, used to compute RTF

    @property
    def rtf(self):
        t = self.samples / SR
        return (self.total_proc / t) if t > 0.5 else 0.0

    @property
    def backlog(self):
        return 0                   # streaming decodes synchronously, so there's no queue backlog

    # ---- same entry point as Segmenter ----
    def push(self, frame):
        t0 = time.time()
        self.buf.append(frame)
        self.samples += len(frame)
        self.stream.accept_waveform(SR, frame)
        while self.rec.is_ready(self.stream):
            self.rec.decode_stream(self.stream)
        txt = self.rec.get_result(self.stream)
        el = time.time() - t0
        self.proc_s += el
        self.total_proc += el

        if txt != self.partial:
            self.partial = txt
            self.speaking = bool(txt)
            self.speech_prob = 1.0 if txt else 0.0
            if self.on_partial:
                self.on_partial(txt)

        now = self.samples / SR
        too_long = (now - self.seg_start) >= self.max_utt_s
        if self.rec.is_endpoint(self.stream) or (too_long and txt):
            return self._finish(forced=too_long and not self.rec.is_endpoint(self.stream))
        if too_long:
            # no text for a long time (pure silence/noise), drop the buffer so memory doesn't keep growing
            self._reset(now)
        return None

    def flush(self):
        """When recording stops, flush everything on hand, including the fragment not yet merged out."""
        u = self._finish(forced=True, final=True) if self.partial.strip() else None
        if u is not None or not self._carry_text:
            return u
        txt, audio, start = self._carry_text, np.concatenate(self._carry_audio), self._carry_start
        self._clear_carry()
        if self.punct:
            txt = self.punct(txt)
        return StreamUtterance(audio=audio, start=start, end=self.samples / SR,
                               gap_before=0.0, forced=True, text=txt)

    # ---- internal ----
    def _finish(self, forced=False, final=False):
        txt = self.partial.strip()
        end = self.samples / SR
        audio = np.concatenate(self.buf) if self.buf else np.zeros(0, dtype=np.float32)
        start, proc = self.seg_start, self.proc_s

        self.rec.reset(self.stream)
        self._reset(end)
        self.last_end = end

        if not txt or (end - start) < self.min_speech_s:
            return None

        # first prepend the fragments accumulated earlier
        if self._carry_text:
            txt = self._carry_text + txt
            audio = np.concatenate([np.concatenate(self._carry_audio), audio])
            start = self._carry_start
            self._clear_carry()

        # this sentence is still a fragment -> keep accumulating (unless finishing up, which must be flushed)
        short = (end - start) < self.merge_below_s and len(txt) < self.merge_below_chars
        if short and not final:
            if (end - start) < self.carry_max_s:   # if too much has accumulated, stop accumulating, better to emit a short sentence
                self._carry_text = txt
                self._carry_audio = [audio]
                self._carry_start = start
                return None

        gap = 0.0 if self.last_gap_end is None else max(0.0, start - self.last_gap_end)
        self.last_gap_end = end
        if self.punct:
            txt = self.punct(txt)
        return StreamUtterance(audio=audio, start=start, end=end, gap_before=gap,
                               forced=forced, text=txt, proc_s=proc)

    def _clear_carry(self):
        self._carry_text = ""
        self._carry_audio = []
        self._carry_start = None

    def _reset(self, now):
        self.buf = []
        self.seg_start = now
        self.partial = ""
        self.proc_s = 0.0
        self.speaking = False
        self.speech_prob = 0.0
