# -*- coding: utf-8 -*-
"""可选的识别后端。

统一接口：`load() -> 加载耗时`、`transcribe(audio_float32_16k) -> 文本`。
VAD 已经把话切好了，后端只管把一段音频转成一句话。

本机实测（i7-1255U 纯 CPU，同一段 90 秒课堂录音，同样的 VAD 切句）：

    后端                 RTF     最差单句   标点   备注
    whisper small       0.47      4.0s     有    需要提示词调教，会复读提示词
    sensevoice (int8)   0.047     0.37s    有    快 10 倍，中文错字明显更少
    funasr SenseVoice   —         —        有    同一个模型，走 PyTorch，启动慢
    zipformer 流式      0.144     —        无    真流式，首字 0.6s；标点靠 punct 模型补

选哪个：默认 `sensevoice`。要「边说边出字」用 `zipformer`（见 stream_asr.py）。
`whisper` 保留着做对照，`funasr` 给需要 FunASR 生态其它能力（情感/事件标签）时用。
"""
import os
import re
import time

HERE = os.path.dirname(os.path.abspath(__file__))


def _p(path):
    """配置里的相对路径按本文件所在目录解析。"""
    return path if os.path.isabs(path) else os.path.normpath(os.path.join(HERE, path))


class Backend:
    name = "base"
    supports_prompt = False      # 只有 whisper 需要 initial_prompt 那一套

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
        # 中文正常语速约 5-6 token/秒。给到 14 token/秒已是两倍余量，
        # 超过就必然是解码陷入重复循环了——不设上限时实测出现过单句卡 91 秒。
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
    """阿里 SenseVoice-Small，走 sherpa-onnx（纯 ONNX，不碰 PyTorch，启动 1.6 秒）。

    `use_itn=True` 时模型自带标点和数字规整，不需要额外的标点模型。
    输出里可能带 <|zh|><|NEUTRAL|> 之类的标签，统一剥掉。
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
    """上海话(吴语)识别：sherpa-onnx WeNet-CTC 离线模型(WenetSpeech-Wu)。
    走纯 ONNX(和 SenseVoice 同一条路，不碰 PyTorch)。输出的是吴语用字
    (如 搭子/侪/辰光/侬/阿拉/拨/物事)，再由 server 侧自动翻成普通话字幕。"""
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
    """FunASR 官方运行时。比 sherpa-onnx 那条路慢、启动久（import 就要 19 秒），
    但能用 FunASR 生态里的其它模型和能力（情感/事件标签、说话人、时间戳）。
    模型缓存在 ~/.cache/modelscope。"""
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
    """流式 zipformer 当离线用（喂一整句、取最终结果）。

    注意：这样用**拿不到流式的低延迟好处**，只是让它能在现有流水线里跑对照。
    要真正边说边出字，用 stream_asr.py 那条路。
    模型本身不输出标点，这里接 ct-transformer 标点模型补（每句约 0.02 秒）。
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
            decoder=os.path.join(d, "decoder-epoch-99-avg-1.onnx"),  # decoder 用 int8 收益极小
            joiner=os.path.join(d, "joiner-epoch-99-avg-1" + sfx),
            num_threads=self.cfg.get("cpu_threads", 6),
            sample_rate=16000, feature_dim=80, decoding_method="greedy_search")
        self.punct = make_punct(self.cfg)
        return time.time() - t0

    def transcribe(self, audio, with_prompt=True):
        s = self.rec.create_stream()
        s.accept_waveform(16000, audio)
        # 补一段静音把尾部特征冲出来，否则最后几个字出不来
        s.accept_waveform(16000, __import__("numpy").zeros(int(0.4 * 16000), dtype="float32"))
        s.input_finished()
        while self.rec.is_ready(s):
            self.rec.decode_stream(s)
        txt = self.rec.get_result(s).strip()
        return self.punct(txt) if self.punct else txt


class ParaformerBackend(Backend):
    """阿里 Paraformer-zh(非自回归,走 sherpa-onnx)。中文识别快,但模型本身不带标点,
    这里接 ct-transformer 标点模型补。做为 SenseVoice 的对照后端,供界面切换对比。
    (实测本机 SenseVoice 中文错字更少、自带标点更省事;Paraformer 仅供参考对比。)"""
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
        self.punct = make_punct(self.cfg)   # paraformer 不输出标点,补一个
        return time.time() - t0

    def transcribe(self, audio, with_prompt=True):
        s = self.rec.create_stream()
        s.accept_waveform(16000, audio)
        self.rec.decode_stream(s)
        txt = re.sub(r"<\|[^|]*\|>", "", s.result.text).strip()
        return self.punct(txt) if self.punct else txt


# ---------------------------------------------------------------- 阿里云
class AliyunASRBackend(Backend):
    """阿里云百炼(DashScope)实时语音识别，云端整句识别。

    和本机后端一样是「离线整句」接口：VAD 切好一段音频后整段送云端。
    DashScope 的 Recognition.call() 收的是 WAV 文件路径，所以这里把 numpy
    音频先写成临时 16bit PCM WAV（16000Hz 单声道），调用完再删掉。

    两个模型（在 BACKENDS 里注册成两个后端）：
      · paraformer-realtime-v2 —— 便宜的普通话模型
      · fun-asr-realtime       —— 识别方言(含上海话)并**直接输出普通话**，
        所以上海话云端选项不需要额外翻译步骤。

    API key 只从环境变量 DASHSCOPE_API_KEY 读，绝不写进配置/代码。
    dashscope 只在 load()/transcribe() 里懒加载，py_compile / import 不需要装 SDK。
    """
    name = "aliyun"
    model = "paraformer-realtime-v2"
    _warned = False

    def load(self):
        import dashscope  # 懒加载，模块顶层不 import
        key = os.environ.get("DASHSCOPE_API_KEY")
        if not key:
            raise RuntimeError("没配 DASHSCOPE_API_KEY，在 start-server.sh 里设")
        dashscope.api_key = key
        c = self.cfg.get("aliyun") or {}
        # 允许用配置覆盖模型；否则用子类默认
        self.model = c.get("model") or self.model
        return 0.0

    def transcribe(self, audio, with_prompt=True):
        import wave
        import tempfile
        import numpy as np
        from dashscope.audio.asr import Recognition

        # numpy float32 [-1,1] @16k → 临时 16bit PCM WAV(单声道,16000Hz)
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
        except Exception as e:  # 云端/网络异常都不该弄崩录音
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
    """阿里云·普通话（paraformer-realtime-v2，便宜的普通话模型）。"""
    name = "aliyun_paraformer"
    model = "paraformer-realtime-v2"


class AliyunFunASRBackend(AliyunASRBackend):
    """阿里云·上海话（fun-asr-realtime，识别方言并直接输出普通话，无需再翻译）。"""
    name = "aliyun_funasr"
    model = "fun-asr-realtime"


def make_punct(asr_cfg):
    """给没有标点的后端补标点。拿不到模型就返回 None，调用方按无标点处理。"""
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
}


def make_backend(cfg):
    a = cfg["asr"] if "asr" in cfg else cfg
    name = (a.get("backend") or "whisper").lower()
    if name not in BACKENDS:
        raise ValueError(f"未知的识别后端 {name!r}，可选：{', '.join(BACKENDS)}")
    return BACKENDS[name](a)
