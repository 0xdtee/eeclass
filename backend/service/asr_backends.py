# -*- coding: utf-8 -*-
"""Optional recognition backends.

Common interface: `load() -> load time`, `transcribe(audio_float32_16k) -> text`.
The VAD has already segmented the speech, so a backend only turns one audio segment into one sentence.

Measured on this machine (i7-1255U, pure CPU, same 90-second classroom recording, same VAD segmentation):

    backend               RTF     worst sentence   punct   notes
    whisper small        0.47      4.0s            yes     needs prompt tuning, echoes the prompt
    sensevoice (int8)    0.047     0.37s           yes     10x faster, clearly fewer Chinese errors
    funasr SenseVoice    —         —               yes     same model, via PyTorch, slow to start
    zipformer streaming  0.144     —               no      truly streaming, first word 0.6s; punct added by a punct model

Which to pick: default is `sensevoice`. For "words as you speak" use `zipformer` (see stream_asr.py).
`whisper` is kept for comparison; `funasr` is for when you need other FunASR-ecosystem features (emotion/event tags).
"""
import os
import re
import time

HERE = os.path.dirname(os.path.abspath(__file__))


def _p(path):
    """Resolve config relative paths against this file's directory."""
    return path if os.path.isabs(path) else os.path.normpath(os.path.join(HERE, path))


class Backend:
    name = "base"
    supports_prompt = False      # only whisper needs the whole initial_prompt machinery

    def __init__(self, cfg):
        self.cfg = cfg           # cfg["asr"]

    def load(self):
        raise NotImplementedError

    def transcribe(self, audio, with_prompt=True):
        raise NotImplementedError


# --------------------------------------------------------------- whisper
class WhisperBackend(Backend):
    name = "whisper"
    supports_prompt = True

    def load(self):
        from faster_whisper import WhisperModel
        t0 = time.time()
        self.model = WhisperModel(
            self.cfg["model"], device="cpu",
            compute_type=self.cfg["compute_type"],
            cpu_threads=self.cfg["cpu_threads"],
        )
        return time.time() - t0

    def transcribe(self, audio, with_prompt=True):
        # normal Chinese speech is about 5-6 tokens/sec. 14 tokens/sec is already double the headroom,
        # so exceeding it must mean decoding fell into a repeat loop—without a cap, a single sentence stuck for 91 seconds in testing.
        dur = len(audio) / 16000.0
        kw = {
            "hotwords": self.cfg.get("hotwords") or None,
            "max_new_tokens": int(dur * self.cfg.get("max_tokens_per_second", 14)) + 16,
            "without_timestamps": True,
        }
        if with_prompt:
            kw["initial_prompt"] = self.cfg["prompt"]
        segs, _ = self.model.transcribe(
            audio, language=self.cfg["language"], beam_size=self.cfg["beam_size"],
            condition_on_previous_text=False, vad_filter=False, **kw)
        return "".join(s.text for s in segs)


# ------------------------------------------------------------ sensevoice
class SenseVoiceBackend(Backend):
    """Alibaba SenseVoice-Small, via sherpa-onnx (pure ONNX, no PyTorch, 1.6s to start).

    With `use_itn=True` the model brings its own punctuation and number normalization, so no separate punct model is needed.
    The output may carry tags like <|zh|><|NEUTRAL|>, which are stripped uniformly.
    """
    name = "sensevoice"

    def load(self):
        import sherpa_onnx
        c = self.cfg.get("sensevoice") or {}
        d = _p(c.get("model_dir", "models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"))
        model = os.path.join(d, "model.int8.onnx" if c.get("int8", True) else "model.onnx")
        if not os.path.exists(model):
            raise FileNotFoundError(f"找不到 SenseVoice 模型：{model}（先跑 install.ps1 下载）")
        t0 = time.time()
        self.rec = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=model, tokens=os.path.join(d, "tokens.txt"),
            num_threads=self.cfg.get("cpu_threads", 6),
            use_itn=c.get("use_itn", True),
            language=c.get("language", "zh"),
            debug=False)
        return time.time() - t0

    def transcribe(self, audio, with_prompt=True):
        s = self.rec.create_stream()
        s.accept_waveform(16000, audio)
        self.rec.decode_stream(s)
        return re.sub(r"<\|[^|]*\|>", "", s.result.text).strip()


# ------------------------------------------------------------ wenet_ctc
class WenetCtcBackend(Backend):
    """Shanghainese (Wu) recognition: sherpa-onnx WeNet-CTC offline model (WenetSpeech-Wu).
    Pure ONNX (same path as SenseVoice, no PyTorch). It outputs Wu-dialect-specific
    characters (words peculiar to Wu Chinese), which the server side then auto-translates into Mandarin captions."""
    name = "wenet_ctc"

    def load(self):
        import sherpa_onnx
        c = self.cfg.get("wenet_ctc") or {}
        d = _p(c.get("model_dir", "models/sherpa-onnx-wenetspeech-wu-u2pp-conformer-ctc-zh-2026-02-03"))
        model = os.path.join(d, "model.onnx")
        if not os.path.exists(model):
            raise FileNotFoundError(f"找不到 WeNet-CTC(上海话)模型：{model}")
        t0 = time.time()
        self.rec = sherpa_onnx.OfflineRecognizer.from_wenet_ctc(
            model=model, tokens=os.path.join(d, "tokens.txt"),
            num_threads=self.cfg.get("cpu_threads", 6), debug=False)
        return time.time() - t0

    def transcribe(self, audio, with_prompt=True):
        s = self.rec.create_stream()
        s.accept_waveform(16000, audio)
        self.rec.decode_stream(s)
        return (s.result.text or "").strip()


# ---------------------------------------------------------------- funasr
class FunASRBackend(Backend):
    """Official FunASR runtime. Slower than the sherpa-onnx path and slow to start (the import alone takes 19s),
    but it can use other models and features in the FunASR ecosystem (emotion/event tags, speakers, timestamps).
    Models are cached in ~/.cache/modelscope."""
    name = "funasr"

    def load(self):
        from funasr import AutoModel
        c = self.cfg.get("funasr") or {}
        t0 = time.time()
        self.model = AutoModel(
            model=c.get("model", "iic/SenseVoiceSmall"),
            device="cpu", disable_update=True, disable_pbar=True, disable_log=True)
        self.kw = {"language": c.get("language", "zh"), "use_itn": c.get("use_itn", True),
                   "batch_size_s": 60}
        return time.time() - t0

    def transcribe(self, audio, with_prompt=True):
        res = self.model.generate(input=audio, cache={}, **self.kw)
        if not res:
            return ""
        txt = res[0].get("text", "")
        return re.sub(r"<\|[^|]*\|>", "", txt).strip()


# ------------------------------------------------------------- zipformer
class ZipformerBackend(Backend):
    """Use the streaming zipformer as offline (feed a whole sentence, take the final result).

    Note: used this way it **gets none of the streaming low-latency benefit**; it just lets zipformer run for comparison in the existing pipeline.
    For true words-as-you-speak, use the stream_asr.py path.
    The model itself outputs no punctuation, so a ct-transformer punct model is chained here (about 0.02s per sentence).
    """
    name = "zipformer"

    def load(self):
        import sherpa_onnx
        c = self.cfg.get("zipformer") or {}
        d = _p(c.get("model_dir", "models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20"))
        sfx = ".int8.onnx" if c.get("int8", True) else ".onnx"
        t0 = time.time()
        self.rec = sherpa_onnx.OnlineRecognizer.from_transducer(
            tokens=os.path.join(d, "tokens.txt"),
            encoder=os.path.join(d, "encoder-epoch-99-avg-1" + sfx),
            decoder=os.path.join(d, "decoder-epoch-99-avg-1.onnx"),  # int8 gives almost no benefit for the decoder
            joiner=os.path.join(d, "joiner-epoch-99-avg-1" + sfx),
            num_threads=self.cfg.get("cpu_threads", 6),
            sample_rate=16000, feature_dim=80, decoding_method="greedy_search")
        self.punct = make_punct(self.cfg)
        return time.time() - t0

    def transcribe(self, audio, with_prompt=True):
        s = self.rec.create_stream()
        s.accept_waveform(16000, audio)
        # append a bit of silence to flush out the tail features, otherwise the last few words don't come out
        s.accept_waveform(16000, __import__("numpy").zeros(int(0.4 * 16000), dtype="float32"))
        s.input_finished()
        while self.rec.is_ready(s):
            self.rec.decode_stream(s)
        txt = self.rec.get_result(s).strip()
        return self.punct(txt) if self.punct else txt


class ParaformerBackend(Backend):
    """Alibaba Paraformer-zh (non-autoregressive, via sherpa-onnx). Fast Chinese recognition, but the model itself has no punctuation,
    so a ct-transformer punct model is chained here. Kept as a comparison backend to SenseVoice, switchable in the UI.
    (In testing SenseVoice on this machine has fewer Chinese errors and its built-in punctuation is more convenient; Paraformer is for reference comparison only.)"""
    name = "paraformer"

    def load(self):
        import sherpa_onnx
        c = self.cfg.get("paraformer") or {}
        d = _p(c.get("model_dir", "models/sherpa-onnx-paraformer-zh-2023-09-14"))
        model = os.path.join(d, "model.int8.onnx" if c.get("int8", True) else "model.onnx")
        if not os.path.exists(model):
            raise FileNotFoundError(f"找不到 Paraformer 模型：{model}")
        t0 = time.time()
        self.rec = sherpa_onnx.OfflineRecognizer.from_paraformer(
            paraformer=model, tokens=os.path.join(d, "tokens.txt"),
            num_threads=self.cfg.get("cpu_threads", 6))
        self.punct = make_punct(self.cfg)   # paraformer outputs no punctuation, so add some
        return time.time() - t0

    def transcribe(self, audio, with_prompt=True):
        s = self.rec.create_stream()
        s.accept_waveform(16000, audio)
        self.rec.decode_stream(s)
        txt = re.sub(r"<\|[^|]*\|>", "", s.result.text).strip()
        return self.punct(txt) if self.punct else txt


# ---------------------------------------------------------------- Alibaba Cloud
class AliyunASRBackend(Backend):
    """Alibaba Cloud Bailian (DashScope) real-time speech recognition, cloud-side whole-sentence recognition.

    Like the local backends, it's an "offline whole-sentence" interface: once the VAD has cut a segment, the whole segment is sent to the cloud.
    DashScope's Recognition.call() takes a WAV file path, so here the numpy audio is first written to a
    temporary 16-bit PCM WAV (16000Hz mono), then deleted after the call.

    Two models (registered as two backends in BACKENDS):
      · paraformer-realtime-v2 —— the cheap Mandarin model
      · fun-asr-realtime       —— recognizes dialects (including Shanghainese) and **outputs Mandarin directly**,
        so the Shanghainese cloud option needs no extra translation step.

    The API key is read only from the DASHSCOPE_API_KEY environment variable, never written into config/code.
    dashscope is lazy-loaded only inside load()/transcribe(), so py_compile / import don't need the SDK installed.
    """
    name = "aliyun"
    model = "paraformer-realtime-v2"
    _warned = False

    def load(self):
        import dashscope  # lazy load, don't import at module top level
        key = os.environ.get("DASHSCOPE_API_KEY")
        if not key:
            raise RuntimeError("没配 DASHSCOPE_API_KEY，在 start-server.sh 里设")
        dashscope.api_key = key
        c = self.cfg.get("aliyun") or {}
        # allow config to override the model; otherwise use the subclass default
        self.model = c.get("model") or self.model
        return 0.0

    def transcribe(self, audio, with_prompt=True):
        import wave
        import tempfile
        import numpy as np
        from dashscope.audio.asr import Recognition

        # numpy float32 [-1,1] @16k → temporary 16-bit PCM WAV (mono, 16000Hz)
        pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2")
        fd, tmp_path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        try:
            with wave.open(tmp_path, "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(16000)
                w.writeframes(pcm.tobytes())
            res = Recognition(
                model=self.model, format="wav",
                sample_rate=16000, callback=None).call(tmp_path)
            if getattr(res, "status_code", None) != 200:
                if not AliyunASRBackend._warned:
                    AliyunASRBackend._warned = True
                    print(f"[aliyun] 识别失败 status={getattr(res, 'status_code', '?')} "
                          f"msg={getattr(res, 'message', '')}")
                return ""
            sents = (res.output or {}).get("sentence") or []
            return "".join(s.get("text", "") for s in sents).strip()
        except Exception as e:  # cloud/network errors should never crash recording
            if not AliyunASRBackend._warned:
                AliyunASRBackend._warned = True
                print(f"[aliyun] 识别异常：{e}")
            return ""
        finally:
            try:
                os.remove(tmp_path)
            except OSError:
                pass


class AliyunParaformerBackend(AliyunASRBackend):
    """Alibaba Cloud · Mandarin (paraformer-realtime-v2, the cheap Mandarin model)."""
    name = "aliyun_paraformer"
    model = "paraformer-realtime-v2"


class AliyunFunASRBackend(AliyunASRBackend):
    """Alibaba Cloud · Shanghainese (fun-asr-realtime, recognizes the dialect and outputs Mandarin directly, no further translation needed)."""
    name = "aliyun_funasr"
    model = "fun-asr-realtime"


class AliyunGummyBackend(Backend):
    """Alibaba Cloud · Gummy (gummy-realtime-v1): multilingual recognition + speech translation in one call.

    Recognizes cfg['gummy']['source'] (zh/en/fr/de/it/ja/ko) and, when a different target is set, translates to
    cfg['gummy']['target'] in the same pass. transcribe() returns the recognized ORIGINAL text and stashes the
    translation on self.last_translation; the Session reads that and attaches it as the caption's translation
    line, so no separate DeepSeek translation call is needed for this backend.

    The VAD has already cut the audio into one sentence, so each call opens a short realtime stream, pushes that
    one segment, and waits for the final result. The API key is read only from DASHSCOPE_API_KEY.
    """
    name = "aliyun_gummy"
    model = "gummy-realtime-v1"
    _warned = False

    def load(self):
        import dashscope  # lazy load, don't import at module top level
        key = os.environ.get("DASHSCOPE_API_KEY")
        if not key:
            raise RuntimeError("没配 DASHSCOPE_API_KEY，在 start-server.sh 里设")
        dashscope.api_key = key
        g = self.cfg.get("gummy") or {}
        self.source = g.get("source") or "zh"
        self.target = g.get("target") or ""
        self.last_translation = ""
        return 0.0

    def transcribe(self, audio, with_prompt=True):
        import threading
        import numpy as np
        from dashscope.audio.asr import (TranslationRecognizerRealtime,
                                         TranslationRecognizerCallback)

        self.last_translation = ""
        translate = bool(self.target) and self.target != self.source
        target = self.target
        got = {"orig": [], "trans": [], "orig_last": "", "trans_last": ""}
        done = threading.Event()

        class _CB(TranslationRecognizerCallback):
            def on_event(self, request_id, transcription_result, translation_result, usage):
                if transcription_result is not None and transcription_result.text:
                    got["orig_last"] = transcription_result.text
                    if getattr(transcription_result, "is_sentence_end", False):
                        got["orig"].append(transcription_result.text)
                if translate and translation_result is not None:
                    tr = translation_result.get_translation(target)
                    if tr is not None and tr.text:
                        got["trans_last"] = tr.text
                        if getattr(tr, "is_sentence_end", False):
                            got["trans"].append(tr.text)

            def on_complete(self):
                done.set()

            def on_error(self, message):
                done.set()

            def on_close(self):
                done.set()

        # numpy float32 [-1,1] @16k → 16-bit PCM bytes, streamed in 100ms frames
        pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
        try:
            r = TranslationRecognizerRealtime(
                model=self.model, callback=_CB(), format="pcm", sample_rate=16000,
                transcription_enabled=True, source_language=self.source,
                translation_enabled=translate,
                translation_target_languages=[target] if translate else None)
            r.start()
            step = 3200   # 100 ms of 16 kHz mono 16-bit PCM
            for i in range(0, len(pcm), step):
                r.send_audio_frame(pcm[i:i + step])
            r.stop()
            done.wait(timeout=10)
        except Exception as e:  # cloud/network errors should never crash recording
            if not AliyunGummyBackend._warned:
                AliyunGummyBackend._warned = True
                print(f"[gummy] 识别异常：{e}")
            return ""
        orig = ("".join(got["orig"]) or got["orig_last"]).strip()
        trans = ("".join(got["trans"]) or got["trans_last"]).strip()
        self.last_translation = trans if translate else ""
        return orig


def make_punct(asr_cfg):
    """Add punctuation for backends that have none. Returns None if the model can't be loaded, and the caller treats it as unpunctuated."""
    c = (asr_cfg.get("zipformer") or {})
    d = _p(c.get("punct_dir", "models/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12"))
    model = os.path.join(d, "model.onnx")
    if not os.path.exists(model):
        return None
    import sherpa_onnx
    p = sherpa_onnx.OfflinePunctuation(
        sherpa_onnx.OfflinePunctuationConfig(
            model=sherpa_onnx.OfflinePunctuationModelConfig(ct_transformer=model, num_threads=2)))
    return lambda t: p.add_punctuation(t) if t else t


BACKENDS = {
    "whisper": WhisperBackend,
    "sensevoice": SenseVoiceBackend,
    "wenet_ctc": WenetCtcBackend,
    "paraformer": ParaformerBackend,
    "funasr": FunASRBackend,
    "zipformer": ZipformerBackend,
    "aliyun_paraformer": AliyunParaformerBackend,
    "aliyun_funasr": AliyunFunASRBackend,
    "aliyun_gummy": AliyunGummyBackend,
}


def make_backend(cfg):
    a = cfg["asr"] if "asr" in cfg else cfg
    name = (a.get("backend") or "whisper").lower()
    if name not in BACKENDS:
        raise ValueError(f"未知的识别后端 {name!r}，可选：{', '.join(BACKENDS)}")
    return BACKENDS[name](a)
