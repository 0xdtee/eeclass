# -*- coding: utf-8 -*-
"""语音识别工作线程。

具体用哪个模型见 asr_backends.py（whisper / sensevoice / funasr / zipformer），
在 config.json 的 `asr.backend` 里选。这里只管排队、清洗、统计——
换后端不影响这一层。

VAD 已经把话切好了，这里不再让模型自己做 VAD。每句独立解码，不带上文：
课堂上一旦串了上下文，whisper 很容易顺着自己上一句的错误一路编下去。

积压监控：如果 CPU 跟不上，队列会变长，服务会把积压句数报给界面，
让你当场就知道字幕在变慢，而不是下课才发现漏了半节课。
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
        self.drops = []     # 被丢弃的句子，排查漏字用
        self.retries = 0    # 靠无提示词重试救回来的句数

    def _decode(self, audio, with_prompt):
        return self.backend.transcribe(audio, with_prompt=with_prompt)

    def _prompt_grams(self):
        """提示词的字符四元组，用来识别复读。"""
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
            return False   # 比提示词长出一截，说明有真内容，不算复读
        grams = [t[i:i + 4] for i in range(len(t) - 3)]
        if not grams:
            return False
        hit = sum(1 for x in grams if x in g) / len(grams)
        return hit > 0.85   # 几乎逐字重合才算复读

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
        """返回 (文本, 丢弃原因)。丢弃原因会计入统计，方便排查漏字。"""
        text = (text or "").strip()
        if not text:
            return "", "识别为空"
        for bad in self.cfg["drop_texts"]:
            if bad in text:
                return "", f"幻觉字幕({bad})"   # 静音/噪声上 whisper 爱吐「谢谢观看」
        if len(text) < self.cfg["min_chars"]:
            return "", "太短"
        # 提示词复读：信噪比低的时候 whisper 会把 initial_prompt 原样吐出来。
        # 现在提示词是一句普通课堂话，老师真说出类似的话也有可能，所以判定收得很紧，
        # 而且判成复读也只是触发一次无提示词重试，不会直接丢内容。
        # 只有用提示词的后端才可能复读提示词
        if check_echo and self.backend and self.backend.supports_prompt and self._echoes_prompt(text):
            return "", "提示词复读"
        # 整句同一个字重复十几次，是典型的解码崩溃
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
                    # 别静默丢内容：去掉提示词再来一次，多花一两秒也值。
                    # 不用提示词的后端重试就是原样再算一遍，没意义，跳过。
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
