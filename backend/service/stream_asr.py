# -*- coding: utf-8 -*-
"""流式识别：边说边出字（sherpa-onnx 流式 zipformer）。

和默认那条路的区别：
  · 默认路（sensevoice/whisper）——VAD 切完整句 → 整句丢给模型 → 出字。
    延迟 = 等这句话说完（最多 8 秒）+ 解码。字准，但字来得晚。
  · 这条路——音频持续喂给模型，模型每 0.2 秒吐一次当前结果，
    说到一半就能看到字（实测首字 0.6 秒）。断句靠模型自带的端点检测。

代价（选之前先知道）：
  · 模型本身**不输出标点**，靠 ct-transformer 标点模型在断句时补。
    也就是说：中途看到的实时文本没有标点，断句定稿后才有。
  · 部分结果会**边说边改**（前面出的字后面可能被修正），所以只有定稿的句子
    才写进 Word 和记录文件，中途的只在控制台上滚动显示。
  · 长时间不停顿时端点检测会切出很长的句子（实测有 43 秒一段的），
    所以这里额外加了一条「超过 max_utterance_s 就强制断句」的闸。

对外接口和 vad.Segmenter 一样：push(frame) 返回 Utterance 或 None，
只是返回的 Utterance 上多带了识别好的 .text，下游不用再送 ASR。
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
        # zipformer 的端点检测会在犹豫处切出「我。」「那么。」这种一两秒的碎片。
        # 碎片单独成句有两个害处：声纹在这么短的音频上不可靠（实测把一个人拆成了
        # 三个说话人，还把真老师挤成了「同学A」），而且文档里全是断句。
        # 所以碎片不单独出句，攒起来并进下一句。
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
        self.buf = []              # 当前句的音频（说话人识别要用）
        self.samples = 0           # 已喂入的总样本数 = 时间轴
        self.seg_start = 0.0
        self.last_end = None        # 上一次断句的位置
        self.last_gap_end = None    # 上一句**真正出稿**的结束时间，用来算段落间隔
        self.partial = ""
        self.proc_s = 0.0          # 当前句累计解码耗时
        self.speaking = False
        self.speech_prob = 0.0     # 界面画的那个条，流式没有 VAD 概率，用有没有出字近似
        self.total_proc = 0.0      # 累计解码耗时，用来算 RTF

    @property
    def rtf(self):
        t = self.samples / SR
        return (self.total_proc / t) if t > 0.5 else 0.0

    @property
    def backlog(self):
        return 0                   # 流式是同步解码，不存在排队积压

    # ---- 和 Segmenter 一样的入口 ----
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
            # 长时间没出字（纯静音/噪声），把缓冲丢掉，别让内存一直涨
            self._reset(now)
        return None

    def flush(self):
        """停止录制时把手上的东西全吐出来，包括还没并出去的碎片。"""
        u = self._finish(forced=True, final=True) if self.partial.strip() else None
        if u is not None or not self._carry_text:
            return u
        txt, audio, start = self._carry_text, np.concatenate(self._carry_audio), self._carry_start
        self._clear_carry()
        if self.punct:
            txt = self.punct(txt)
        return StreamUtterance(audio=audio, start=start, end=self.samples / SR,
                               gap_before=0.0, forced=True, text=txt)

    # ---- 内部 ----
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

        # 先把之前攒下的碎片接到前面
        if self._carry_text:
            txt = self._carry_text + txt
            audio = np.concatenate([np.concatenate(self._carry_audio), audio])
            start = self._carry_start
            self._clear_carry()

        # 这句本身还是碎片 → 继续攒（除非是收尾，收尾必须吐出来）
        short = (end - start) < self.merge_below_s and len(txt) < self.merge_below_chars
        if short and not final:
            if (end - start) < self.carry_max_s:   # 攒太多就别攒了，宁可出个短句
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
