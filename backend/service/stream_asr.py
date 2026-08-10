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


class GummyStreamingASR:
    """Streaming recognition via Alibaba Cloud Gummy (gummy-realtime-v1), used for the multilingual model.

    Same push()/flush() interface as StreamingASR, so the server's streaming path drives it identically. Instead
    of running a local model, it keeps ONE Gummy realtime stream open for the whole session and feeds audio
    continuously; Gummy emits interim results (shown as live partials) and marks sentence ends itself, so sentence
    breaks are consistent and low-latency -- unlike the earlier per-VAD-segment approach that reopened a stream
    per sentence (high latency) and fought the local VAD's boundaries (erratic segmentation).

    Recognition only; translation goes through DeepSeek downstream. The callback runs on the SDK's socket thread,
    so finalized sentences are handed to the push() thread through a Queue; emit() is thread-safe (call_soon_threadsafe)
    so live partials are pushed straight from the callback.
    """

    MAX_BUF_S = 90        # rolling audio kept for slicing each sentence's window (speaker id)

    def __init__(self, cfg, on_partial=None):
        import os
        import queue
        a = cfg["asr"]
        g = a.get("gummy") or {}
        self.source = g.get("source") or "zh"
        self.on_partial = on_partial
        self._q = queue.Queue()       # (text, begin_ms, end_ms) finalized sentences, from the callback thread
        self._sendbuf = []            # frames waiting to be sent (batched to ~100ms)
        self._sendlen = 0
        # rolling audio buffer, indexed by absolute sample position, so each sentence's exact [begin,end]
        # window can be sliced out for speaker identification (Gummy gives per-sentence timestamps).
        self._frames = []
        self._frames_len = 0
        self._frames_base = 0         # absolute sample index of _frames[0]
        self.samples = 0              # total samples fed (absolute session time axis)
        self._stream_base = 0         # samples fed when the current stream opened (Gummy times are relative to it)
        self.last_gap_end = None
        self.partial = ""
        self._last_partial = ""
        self.speaking = False
        self.speech_prob = 0.0
        self.total_proc = 0.0
        self._r = None
        self._closed = True
        import dashscope
        key = os.environ.get("DASHSCOPE_API_KEY")
        if not key:
            raise RuntimeError("没配 DASHSCOPE_API_KEY，在 start-server.sh 里设")
        dashscope.api_key = key
        t0 = time.time()
        try:
            self._open()
        except Exception:
            self._closed = True   # a transient cloud hiccup must not fail the whole start; push() reopens lazily
        self.load_s = time.time() - t0

    def _open(self):
        from dashscope.audio.asr import (TranslationRecognizerRealtime,
                                         TranslationRecognizerCallback)
        outer = self

        class _CB(TranslationRecognizerCallback):
            def on_event(self, request_id, transcription_result, translation_result, usage):
                tr = transcription_result
                if tr is None or not getattr(tr, "text", ""):
                    return
                if getattr(tr, "is_sentence_end", False):
                    txt = (tr.text or "").strip()
                    if txt:
                        outer._q.put((txt, getattr(tr, "begin_time", None), getattr(tr, "end_time", None)))
                else:
                    # interim result -> live preview (emit() is thread-safe)
                    if outer.on_partial and tr.text != outer._last_partial:
                        outer._last_partial = tr.text
                        outer.partial = tr.text
                        outer.on_partial(tr.text)

            def on_error(self, message):
                outer._closed = True

            def on_close(self):
                outer._closed = True

        self._r = TranslationRecognizerRealtime(
            model="gummy-realtime-v1", callback=_CB(), format="pcm", sample_rate=SR,
            transcription_enabled=True, source_language=self.source, translation_enabled=False)
        self._r.start()
        self._stream_base = self.samples   # this stream's timestamps are relative to the audio sent from here on
        self._closed = False

    @property
    def rtf(self):
        return 0.0            # cloud streaming: no local decode time to measure

    @property
    def backlog(self):
        return self._q.qsize()

    def _send(self, frame, force=False):
        self._sendbuf.append(frame)
        self._sendlen += len(frame)
        if not force and self._sendlen < 1600:   # batch to ~100ms before sending
            return
        chunk = np.concatenate(self._sendbuf)
        self._sendbuf = []
        self._sendlen = 0
        pcm = (np.clip(chunk, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
        try:
            self._r.send_audio_frame(pcm)
        except Exception:
            self._closed = True

    def push(self, frame):
        if self._closed:
            try:
                self._open()
            except Exception:
                return None
        self._frames.append(frame)
        self._frames_len += len(frame)
        maxlen = self.MAX_BUF_S * SR
        while self._frames_len > maxlen and len(self._frames) > 1:
            d = self._frames.pop(0)
            self._frames_len -= len(d)
            self._frames_base += len(d)
        self.samples += len(frame)
        self._send(frame)
        self.speaking = bool(self.partial)
        self.speech_prob = 1.0 if self.partial else 0.0
        try:
            item = self._q.get_nowait()
        except Exception:
            return None
        return self._finish(*item)

    def _slice(self, begin_ms, end_ms):
        """Slice the audio for [begin_ms, end_ms] (relative to the current stream) from the rolling buffer,
        so speaker identification runs on exactly this sentence's audio."""
        rel_begin = int((begin_ms or 0) / 1000.0 * SR)
        rel_end = int((end_ms if end_ms is not None else (self.samples - self._stream_base) * 1000.0 / SR)
                      / 1000.0 * SR)
        abs_begin = self._stream_base + rel_begin
        abs_end = self._stream_base + rel_end
        buf = np.concatenate(self._frames) if self._frames else np.zeros(0, dtype=np.float32)
        lo = max(0, abs_begin - self._frames_base)
        hi = min(len(buf), abs_end - self._frames_base)
        audio = buf[lo:hi] if hi > lo else np.zeros(0, dtype=np.float32)
        return audio, abs_begin / SR, abs_end / SR

    def _finish(self, text, begin_ms=None, end_ms=None):
        audio, start, end = self._slice(begin_ms, end_ms)
        self.partial = ""
        self._last_partial = ""
        gap = 0.0 if self.last_gap_end is None else max(0.0, start - self.last_gap_end)
        self.last_gap_end = end
        if self.on_partial:
            self.on_partial("")
        return StreamUtterance(audio=audio, start=start, end=end, gap_before=gap,
                               forced=False, text=text)

    def flush(self):
        """Recording stopped: send whatever's buffered, stop the stream, and emit any last finalized sentence."""
        try:
            if self._r is not None and not self._closed:
                if self._sendbuf:
                    self._send(np.zeros(0, dtype=np.float32), force=True)
                self._r.stop()
        except Exception:
            pass
        self._closed = True
        items = []
        while True:
            try:
                items.append(self._q.get_nowait())
            except Exception:
                break
        if not items:
            return None
        text = " ".join(i[0] for i in items)
        return self._finish(text, items[0][1], items[-1][2])
