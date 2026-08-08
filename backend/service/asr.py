# -*- coding: utf-8 -*-
"""Speech recognition worker thread.

Which model is used is decided in asr_backends.py (whisper / sensevoice / funasr / zipformer),
selected via `asr.backend` in config.json. This layer only handles queuing, cleanup, and stats——
swapping backends doesn't affect it.

The VAD has already segmented the speech, so we don't let the model do its own VAD here.
Each sentence is decoded independently, without prior context: in class, once the context bleeds
over, whisper easily keeps making things up following its own earlier mistake.

Backlog monitoring: if the CPU can't keep up, the queue grows, and the service reports the
backlog count to the UI, so you know right away that captions are slowing down, rather than
discovering after class that half of it was missed.
"""
import queue
import re
import threading
import time

from asr_backends import make_backend


class ASRWorker:
    def __init__(self, cfg, on_result, on_status=None):
        a = cfg["asr"]
        self.cfg = a
        self.on_result = on_result
        self.on_status = on_status
        self.q = queue.Queue()
        self.backend = None
        self.thread = None
        self.running = False
        self.ready = False
        self.busy = False
        self.total_audio = 0.0
        self.total_proc = 0.0
        self._pg = None
        self.drops = []     # discarded sentences, for tracking down dropped words
        self.retries = 0    # sentences saved by retrying without a prompt

    def _decode(self, audio, with_prompt):
        return self.backend.transcribe(audio, with_prompt=with_prompt)

    def _prompt_grams(self):
        """Four-character tuple of the prompt, used to detect echoing."""
        if self._pg is None:
            p = re.sub(r"[，。、：；\s]", "", self.cfg["prompt"] or "")
            self._pg = {p[i:i + 4] for i in range(len(p) - 3)}
        return self._pg

    def _echoes_prompt(self, text):
        g = self._prompt_grams()
        if not g or len(text) < 6:
            return False
        t = re.sub(r"[，。、：；\s]", "", text)
        if len(t) > len(re.sub(r"[，。、：；\s]", "", self.cfg["prompt"] or "")) * 1.3:
            return False   # noticeably longer than the prompt means there's real content, not an echo
        grams = [t[i:i + 4] for i in range(len(t) - 3)]
        if not grams:
            return False
        hit = sum(1 for x in grams if x in g) / len(grams)
        return hit > 0.85   # only a near-verbatim overlap counts as an echo

    def load(self):
        self.backend = make_backend(self.cfg)
        el = self.backend.load()
        self.ready = True
        return el

    @property
    def backend_name(self):
        return self.backend.name if self.backend else (self.cfg.get("backend") or "whisper")

    def start(self):
        self.running = True
        self.thread = threading.Thread(target=self._loop, daemon=True, name="asr")
        self.thread.start()

    def stop(self):
        self.running = False
        self.q.put(None)

    def submit(self, utt, meta):
        self.q.put((utt, meta))

    @property
    def backlog(self):
        return self.q.qsize()

    @property
    def rtf(self):
        return (self.total_proc / self.total_audio) if self.total_audio > 0.5 else 0.0

    def _clean(self, text, check_echo=True):
        """Return (text, discard_reason). The discard reason is counted in stats, to help track down dropped words."""
        text = (text or "").strip()
        if not text:
            return "", "识别为空"
        for bad in self.cfg["drop_texts"]:
            if bad in text:
                return "", f"幻觉字幕({bad})"   # on silence/noise whisper loves to spit out "thanks for watching"
        if len(text) < self.cfg["min_chars"]:
            return "", "太短"
        # prompt echo: at low SNR whisper spits initial_prompt back out verbatim.
        # the prompt is now an ordinary classroom sentence, which the teacher might actually say, so the check is very strict,
        # and even when judged an echo it only triggers one prompt-free retry, never discards content outright.
        # only backends that use a prompt can echo it
        if check_echo and self.backend and self.backend.supports_prompt and self._echoes_prompt(text):
            return "", "提示词复读"
        # the same character repeated a dozen-plus times across a whole sentence is a classic decoding blowup
        if len(set(text)) <= 2 and len(text) > 6:
            return "", "解码崩溃(重复字)"
        return text, None

    def _loop(self):
        while self.running:
            item = self.q.get()
            if item is None:
                break
            utt, meta = item
            self.busy = True
            t0 = time.time()
            try:
                raw = self._decode(utt.audio, with_prompt=True)
                text, why = self._clean(raw)
                if not text and self.backend.supports_prompt:
                    # don't silently drop content: strip the prompt and try once more, worth the extra second or two.
                    # retrying makes no sense for prompt-free backends—it just recomputes the same thing—so skip it.
                    raw2 = self._decode(utt.audio, with_prompt=False)
                    text2, why2 = self._clean(raw2)
                    if text2:
                        text, why, raw = text2, None, raw2
                        self.retries += 1
            except Exception as e:
                text, why, raw = "", f"异常({type(e).__name__})", ""
                if self.on_status:
                    self.on_status(f"识别失败: {e}")

            el = time.time() - t0
            self.total_audio += (utt.end - utt.start)
            self.total_proc += el
            self.busy = False

            if text:
                self.on_result(utt, meta, text, el)
            else:
                self.drops.append({
                    "start": round(utt.start, 1), "dur": round(utt.end - utt.start, 1),
                    "reason": why, "raw": raw.strip()[:60],
                })
                if self.on_status and why not in ("识别为空", "太短"):
                    self.on_status(f"丢弃 {utt.start:.0f}s 处一句（{why}）")
