# -*- coding: utf-8 -*-
"""课堂实时字幕服务。

一个进程干三件事：
  1. HTTPS 托管 Word 加载项的网页（任务窗格）
  2. WebSocket 把识别结果实时推给 Word
  3. 采集 → VAD 分句 → 说话人 → 识别 → 划重点 → 落盘

即使 Word 那边没连上，录音和转写也照常进行、照常存盘 ——
不会出现"插件挂了整节课白上"的情况。

启动：  ..\scripts\start.ps1
"""
import asyncio
import json
import os
import re
import secrets
import ssl
import sys
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from aiohttp import web, WSMsgType

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audio as audio_mod
from vad import Segmenter
from asr import ASRWorker
from speaker import SpeakerID
from highlight import Highlighter
from recorder import Recorder
try:
    from word_com import WordWriter          # 只有 Windows + Word 才有
except Exception:                             # Linux 服务器上没有，写 Word 的路直接关掉
    WordWriter = None
# word_com 在 Mac/Linux 上「能 import」（Windows 专用代码只在方法里，靠 ctypes.windll），
# 所以光靠上面的 try 关不掉。非 Windows 一律禁用，否则勾了「写入 Word」会崩线程、卡住开始。
if sys.platform != "win32":
    WordWriter = None
from summarize import DeepSeek
from library import Library
from accounts import Accounts
import netcert

HERE = os.path.dirname(os.path.abspath(__file__))
ADDIN_DIR = os.path.normpath(os.path.join(HERE, "..", "addin"))
WEBAPP_DIR = os.path.normpath(os.path.join(HERE, "..", "..", "frontend", "out"))
TOKEN_FILE = os.path.join(HERE, "token.txt")


def load_config():
    with open(os.path.join(HERE, "config.json"), encoding="utf-8") as f:
        return json.load(f)


# ---------- 个性化反哺:把用户一键纠对的术语持续攒进 records/learned_terms.json ----------
def _learned_terms_file(cfg):
    root = os.path.normpath(os.path.join(HERE, cfg["server"]["records_dir"]))
    return os.path.join(root, "learned_terms.json")


def load_learned_terms(cfg):
    p = _learned_terms_file(cfg)
    if not os.path.exists(p):
        return []
    try:
        with open(p, encoding="utf-8") as f:
            return list(json.load(f).get("terms") or [])
    except Exception:
        return []


def add_learned_term(cfg, term):
    """把一个用户纠对的术语记下来(>=2字、去重),让之后开的课自动纠这个同音错。"""
    term = (term or "").strip()
    if len(term) < 2:
        return False
    p = _learned_terms_file(cfg)
    data = {"terms": []}
    if os.path.exists(p):
        try:
            with open(p, encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            pass
    terms = data.get("terms") or []
    if term in terms:
        return False
    terms.append(term)
    data["terms"] = terms
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return True


def course_base_name(title):
    """去掉「第N课/第N讲/第N节/(N)」编号,得到课程基名。和前端一致。"""
    t = (title or "").strip()
    t = re.sub(r"\s*第\s*\d+\s*[课讲节]\s*$", "", t)
    t = re.sub(r"\s*[（(]\s*\d+\s*[）)]\s*$", "", t)
    return t.strip()


def speaker_name(idx):
    if idx == 0:
        return "老师"          # 一节课里第一个开口、且说得最多的，基本必是老师
    return "同学" + "ABCDEFG"[(idx - 1) % 7]


def ts(sec):
    s = int(sec)
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


class Session:
    """一节课。"""

    def __init__(self, cfg, loop, emit, title=None, device=None, loopback=False,
                 to_word=False, word_doc="active", append_sid=None):
        self.cfg = cfg
        self.loop = loop
        self.emit = emit           # 线程安全的广播函数
        self.title = title
        self.device = device
        self.loopback = loopback
        # to_word: 由服务端通过 COM 直接写 Word（浏览器控制台走这条路）。
        # Office 加载项那条路是任务窗格自己用 Office.js 写，不能同时开，否则写两遍。
        self.to_word = bool(to_word)
        self.word_doc = word_doc
        self.only_key = False      # 只把重点句写进 Word（记录文件里始终是全量）
        self.word = None
        self.corrections = []      # 这门课的固定错字纠正，识别完立刻替换
        self.course_id = None
        self.course_name = None    # 绑定课程时的课名,给 AI 纠错当学科上下文(比手输标题靠谱)
        self.subjects = []         # 勾选的学科标签(高等数学/大学物理…),给 AI 纠错/翻译当上下文
        self.user_key = None       # 本次录音属于哪个账号 —— 决定用/写哪个私有声纹库
        self.ai_correct = False    # DeepSeek 实时纠错(改同音错字),开关在前端
        self.corrector = None
        self.correct_pool = None
        # 英文字幕:识别到英文(或英语课)时,异步翻成中文挂在该句下面
        self.translate_en = False
        self.translator = None
        self.translate_pool = None
        # DeepSeek 智能分句:按语意把 VAD 碎片合并成完整句子(开关在前端,仅整句模式)
        self.smart_seg = False
        self.segmenter_ds = None
        self.seg_pool = None
        self._seg_frags = []       # 缓冲:还没成句的碎片 [{text,start,end,sid,gap,conf}]
        self._seg_lock = threading.Lock()
        self._seg_busy = False
        self._seg_stopping = False   # 停止中:在飞的分句 worker 别再出行(避免结束卡住/写已关文件)
        self._emit_lock = threading.Lock()   # 出行串行化(worker 线程 vs 停止线程)
        self._trans_lock = threading.Lock()  # translations.json 读改写串行化(翻译池并发)

        # 同音术语纠正:把「映射→影射」「值域→职域」这类同音错按术语表本地纠回。
        # 术语来自 asr.terms + asr.hotwords,任何后端(SenseVoice/Paraformer/whisper)都生效。
        self.tfix = None
        try:
            from term_fix import TermFixer
            a = cfg["asr"]
            terms = list(a.get("terms") or [])
            hw = a.get("hotwords")
            terms += hw.split() if isinstance(hw, str) else list(hw or [])
            # 个性化反哺:用户以往一键纠错学到的术语,喂回来让后续识别自动纠对
            terms += load_learned_terms(cfg)
            if terms:
                self.tfix = TermFixer(terms)
        except Exception as e:
            print(f"⚠️ 同音术语纠正未启用: {e}")

        # 两条互斥的路：流式（模型自己边听边断句）或 VAD 切句 + 整句识别
        self.streaming = bool(cfg["asr"].get("streaming")) and \
            cfg["asr"].get("backend") == "zipformer"
        self.seg = None if self.streaming else Segmenter(cfg)
        self.sasr = None
        self.spk = SpeakerID(cfg)
        self.hl = Highlighter(cfg)
        self.asr = ASRWorker(cfg, self._on_text, self._on_status)
        records_root = os.path.normpath(os.path.join(HERE, cfg["server"]["records_dir"]))
        # 续录:接着已有的这节课往下录(音频/转写接上,行号与时间戳连续)
        self.t_offset = 0.0
        existing_dir = None
        start_line_id = 0
        if append_sid:
            d = os.path.join(records_root, os.path.basename(append_sid))
            if os.path.isdir(d):
                existing_dir = d
                self._rehydrate_for_append(d, records_root)   # 旧文件若已下沉 OSS,先回灌本地
                start_line_id, last_end = self._scan_transcript(d)
                self.t_offset = self._audio_duration(d) or last_end
        self.rec = Recorder(records_root, title=title,
                            save_wav=cfg["server"]["save_wav"], existing_dir=existing_dir)
        self.cap = None
        self.names = {}            # {speaker_id: 自定义名字}
        self.running = False
        # t0 往前挪 t_offset,让 elapsed / 总时长 在续录后仍连续(板书按秒对齐也不错位)
        self.t0 = time.time() - self.t_offset
        self.line_id = start_line_id
        self.last_speaker = None
        self.para_chars = 0        # 当前段落已写多少字
        self.para_start = None     # 当前段落起始秒
        self.pending_key = 0       # 手动标重点：给下一句/上一句打标记
        self.last_line_id = None   # 最近出的一句 id，手动「标记重点」标它(刚说过的那句)
        self.paused = False
        self.dev_info = {}

    # ---------- 续录辅助 ----------
    @staticmethod
    def _rehydrate_for_append(session_dir, records_root):
        """续录前,若旧 transcript/audio 已下沉 OSS、本地没有,先从 OSS 拉回来。"""
        try:
            import oss_store
            if not oss_store.enabled():
                return
        except Exception:
            return
        for fn in ("transcript.jsonl", "audio.wav"):
            local = os.path.join(session_dir, fn)
            if os.path.exists(local):
                continue
            rel = os.path.relpath(local, records_root).replace(os.sep, "/")
            try:
                oss_store.download_to(rel, local)
            except Exception:
                pass

    @staticmethod
    def _scan_transcript(session_dir):
        """读旧 transcript,返回(最大行号, 最后一句的结束秒),用于续录接号/接时间。"""
        maxid, last_end = 0, 0.0
        p = os.path.join(session_dir, "transcript.jsonl")
        if os.path.exists(p):
            try:
                with open(p, encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        r = json.loads(line)
                        maxid = max(maxid, int(r.get("id", 0)))
                        last_end = max(last_end, float(r.get("end", 0) or 0))
            except Exception:
                pass
        return maxid, last_end

    @staticmethod
    def _audio_duration(session_dir):
        p = os.path.join(session_dir, "audio.wav")
        if os.path.exists(p):
            try:
                import soundfile as sf
                return float(sf.info(p).duration)
            except Exception:
                return 0.0
        return 0.0

    def _owner_id(self):
        """本次录音归属账号的稳定标识(登录用户=邮箱哈希,全局令牌=owner)。
        用哈希而非邮箱明文,这样落进 meta/owner.json、同步到 OSS 也不泄露账号邮箱。"""
        from voiceprint import _key_id
        k = self.user_key
        return "owner" if k in (None, "", "owner") else _key_id(k)

    # ---------- 生命周期 ----------
    def start(self):
        # 归属标记:录制一开始就写 owner.json —— 这节课 meta 要到停止才落盘,
        # 期间前端会拉这节课的笔记/板书,没有归属标记就会被数据隔离误挡成 403(进而被登出)。
        try:
            with open(os.path.join(self.rec.dir, "owner.json"), "w", encoding="utf-8") as f:
                json.dump({"owner": self._owner_id()}, f)
        except Exception:
            pass
        # 加载跨会话声纹库:识别到已标记的声音就自动用其身份
        try:
            import voiceprint
            root = os.path.normpath(os.path.join(HERE, self.cfg["server"]["records_dir"]))
            self.spk.set_library(voiceprint.load_library(root, self.user_key),
                                 self.cfg["speaker"].get("voiceprint_threshold", self.cfg["speaker"]["threshold"]))
        except Exception:
            pass
        if self.ai_correct:
            self.corrector = DeepSeek(self.cfg)
            self.correct_pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="aicorrect")
        if self.translate_en:
            ds = DeepSeek(self.cfg)
            if ds.ready:
                self.translator = ds
                self.translate_pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="translate")
        # 智能分句只在整句(VAD)模式下开;流式已自带断句。DeepSeek 没配就自动退回逐碎片成行。
        if self.smart_seg and not self.streaming:
            ds = DeepSeek(self.cfg)
            if ds.ready:
                self.segmenter_ds = ds
                self.seg_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="smartseg")
        if self.streaming:
            from stream_asr import StreamingASR
            self.sasr = StreamingASR(
                self.cfg, on_partial=lambda t: self.emit({"type": "partial", "text": t}))
            load_s = self.sasr.load_s
        else:
            load_s = self.asr.load()
            self.asr.start()
        word_info = None
        if self.to_word and WordWriter is None:
            self._on_status("这台机器上没有 Word（服务器部署），已跳过写入 Word，转写照常落盘。")
        elif self.to_word:
            self.word = WordWriter(target=self.word_doc)
            word_info = self.word.start(title=self.title)
            if not word_info["ok"]:
                self._on_status(word_info["error"] or "连不上 Word")
        if self.device and str(self.device).startswith("browser"):
            # 音频由网页推过来（手机/平板麦克风,或网页采的“系统声音”），本机不开麦
            self.cap = audio_mod.BrowserCapture(self._on_status)
        else:
            self.cap = audio_mod.Capture(self.device, self.loopback,
                                         self.cfg["audio"]["gain"], self._on_status,
                                         agc=self.cfg["audio"].get("agc"))
        self.dev_info = self.cap.start()
        self.running = True
        # 续录:t0 往前挪 t_offset,让 elapsed/总时长连续、板书按秒对齐(别用裸 time.time() 覆盖)
        self.t0 = time.time() - self.t_offset
        threading.Thread(target=self._pump, daemon=True, name="segment").start()
        return {"model_load_s": round(load_s, 1), **self.dev_info,
                "speaker_error": self.spk.err, "word": word_info}

    def stop(self):
        self.running = False
        self._seg_stopping = True    # 在飞的分句 worker 从此不再出行,避免结束被它拖住
        if self.cap:
            self.cap.stop()
        tail = (self.sasr or self.seg).flush()
        if tail is not None:
            self._dispatch(tail)
        time.sleep(0.3)
        self.asr.stop()
        # 智能分句:不等在飞的 DeepSeek 调用(否则结束要卡十几秒);_seg_stopping 已置位,
        # 那次 worker 回来也不会再出行。直接把缓冲里没成句的碎片逐个落盘,别丢最后半句。
        if self.seg_pool is not None:
            self.seg_pool.shutdown(wait=False)
            self._seg_flush_all()
        if self.correct_pool is not None:
            self.correct_pool.shutdown(wait=False)   # 未完成的纠错就算了,别拖住停止
        if self.translate_pool is not None:
            self.translate_pool.shutdown(wait=False)  # 未完成的翻译就算了
        if self.word is not None:
            self.word.close()
        meta = {
            "title": self.title,
            "owner": self._owner_id(),       # 这节课归属账号(哈希,不含邮箱明文)—— 数据隔离按它过滤
            "duration_s": round(time.time() - self.t0, 1),
            "lines": self.line_id,   # 续录后是累计总行数
            "device": self.dev_info,
            "backend": self.cfg["asr"].get("backend", "whisper"),
            "streaming": self.streaming,
            "model": self.cfg["asr"]["model"],
            "rtf": round((self.sasr.rtf if self.streaming else self.asr.rtf), 2),
            "speakers": [{**s, "name": self.name_of(s["id"])} for s in self.spk.stats()],
        }
        # 这次采到的每个说话人声纹,登记进全局去重库:同一个人(不管哪节课/哪个账号)只存一份。
        try:
            import voiceprint
            root = os.path.normpath(os.path.join(HERE, self.cfg["server"]["records_dir"]))
            reg = voiceprint.load_registry(root)
            for s in self.spk.stats():
                emb = self.spk.centroid_of(s["id"])
                if emb is not None:
                    voiceprint.register(root, emb, seconds=s.get("seconds", 0), reg=reg)
            voiceprint.save_registry(root, reg)
        except Exception:
            traceback.print_exc()
        return self.rec.finish(meta), meta

    # ---------- 采集 → 分句 ----------
    def _pump(self):
        while self.running:
            try:
                frame = self.cap.frames.get(timeout=0.5)
            except Exception:
                continue
            if self.paused:
                continue
            self.rec.write_audio(frame)
            try:
                utt = (self.sasr or self.seg).push(frame)
            except Exception as e:
                self._on_status(f"{'流式识别' if self.streaming else 'VAD'} 异常: {e}")
                continue
            if utt is not None:
                self._dispatch(utt)

    def _dispatch(self, utt):
        sid, conf = self.spk.identify(utt.audio)
        self._apply_merges()
        meta = {"speaker_id": sid, "speaker_conf": round(conf, 3)}
        if self.streaming:
            # 流式路径识别已经在 push 里做完了，直接进出文逻辑
            self._on_text(utt, meta, utt.text, utt.proc_s)
        else:
            self.asr.submit(utt, meta)

    # ---------- 识别结果 → Word ----------
    def _on_text(self, utt, meta, text, proc_s):
        # 先做同音术语纠正(映射/值域/导数…),再做本课固定纠错。
        # 两条路(整句 ASRWorker 回调、流式直接调)都经过这里,一处生效全覆盖。
        if self.tfix is not None:
            text, _ = self.tfix.fix(text)
        # 「格林公式」老被听成「格林公司」这类固定错误，在这里一次性纠掉，
        # 后面写文档、落盘、划重点看到的都是纠正后的文本。
        if self.corrections:
            text = Library.apply_corrections(text, self.corrections)
        text = (text or "").strip()
        if not text:
            return
        sid = meta["speaker_id"]
        conf = round(meta.get("speaker_conf", 0), 3)
        # 智能分句开着(且录制中)→ 先缓冲、让 DeepSeek 按语意合并成整句再出行;
        # 否则每个 VAD 碎片直接成一行(老行为)。
        if self.smart_seg and self.seg_pool and self.segmenter_ds and self.running:
            self._seg_feed(text, utt.start, utt.end, sid, utt.gap_before, conf)
        else:
            self._emit_line(text, utt.start, utt.end, sid, utt.gap_before, conf, proc_s)

    def _emit_line(self, text, start, end, sid, gap, conf, proc_s=0.0):
        """把一句(可能由多个碎片合成)写盘并推给前端。line_id/段落状态在这里维护。
        用锁串行化:智能分句的 worker 线程和停止收尾线程可能同时调它。"""
        with self._emit_lock:
            self._emit_line_locked(text, start, end, sid, gap, conf, proc_s)

    def _emit_line_locked(self, text, start, end, sid, gap, conf, proc_s=0.0):
        p = self.cfg["paragraph"]
        speaker_changed = (self.last_speaker is not None and sid != self.last_speaker)
        # 有的老师能连讲十几分钟不停顿，光靠停顿判断会写成一个巨型段落，
        # 所以再加两道闸：段落字数上限、段落时长上限。
        too_long = (self.para_chars >= p["max_para_chars"]
                    or (self.para_start is not None
                        and end - self.para_start >= p["max_para_seconds"]))
        new_para = (
            self.last_speaker is None
            or gap >= p["new_para_gap_ms"] / 1000.0
            or (p["break_on_speaker_change"] and speaker_changed)
            or too_long
        )
        if new_para:
            self.para_chars = len(text)
            self.para_start = start
        else:
            self.para_chars += len(text)

        kind, score, reasons = self.hl.judge(text, start)
        if self.pending_key > 0:
            kind, self.pending_key = "key", 0
            reasons = reasons + ["手动标记"]

        self.line_id += 1
        off = self.t_offset          # 续录:接着旧时间轴往后排(新一节从 0 开始时 off=0)
        rec = {
            "id": self.line_id,
            "start": round(start + off, 2),
            "end": round(end + off, 2),
            "ts": ts(start + off),
            "gap": round(gap, 2),
            "speaker_id": sid,
            "speaker": self.name_of(sid),
            "speaker_conf": conf,
            "text": text,
            "kind": kind,
            "score": score,
            "reasons": reasons,
            "new_para": bool(new_para),
            "proc_s": round(proc_s, 2),
        }
        self.last_speaker = sid
        self.last_line_id = self.line_id
        try:
            self.rec.write(rec)
        except Exception as e:
            self._on_status(f"写记录失败: {e}")
        if self.word is not None and not (self.only_key and not kind):
            self.word.push(rec)
        self.emit({"type": "line", **rec})
        # AI 实时纠错:先秒出原文,再异步让 DeepSeek 改同音错字,改好了推 line_update
        if self.ai_correct and self.correct_pool and self.corrector and self.corrector.ready:
            self.correct_pool.submit(self._ai_correct, rec["id"], rec["ts"], text)
        # 英文句 → 异步翻中文,挂在这句下面当字幕
        if self.translate_en:
            ok = bool(self.translate_pool) and self._should_translate(text)
            if ok:
                self.translate_pool.submit(self._translate_line, rec["id"], text)
            else:
                print(f"[translate] skip id={rec['id']} pool={self.translate_pool is not None} "
                      f"should={self._should_translate(text)} text={text[:24]!r}", flush=True)

    # ---------- DeepSeek 智能分句 ----------
    _SEG_NORM = re.compile(r"[^一-鿿A-Za-z0-9]+")
    SEG_FORCE_FRAGS = 12       # 缓冲碎片太多还没成句 → 强制逐碎片出行(安全阀)
    SEG_FORCE_CHARS = 140

    @classmethod
    def _norm_seg(cls, s):
        return cls._SEG_NORM.sub("", s or "")

    def _seg_feed(self, text, start, end, sid, gap, conf):
        with self._seg_lock:
            # 说话人换了:一定是句边界,先把已缓冲的强制成行,别把两个人的话并一句
            force = bool(self._seg_frags and sid != self._seg_frags[-1]["sid"])
            if force:
                pending = self._seg_frags
                self._seg_frags = []
            else:
                pending = None
            self._seg_frags.append({"text": text, "start": start, "end": end,
                                    "sid": sid, "gap": gap, "conf": conf})
            buf = "".join(f["text"] for f in self._seg_frags)
        if pending:
            for f in pending:
                self._emit_line(f["text"], f["start"], f["end"], f["sid"], f["gap"], f["conf"])
        self.emit({"type": "partial", "text": buf})   # 实时预览这句正在攒的内容
        self._seg_flush_maybe()

    def _seg_flush_maybe(self):
        if not self.running:
            return   # 停止流程里由 _seg_flush_all 收尾,别再往(即将关闭的)线程池投任务
        with self._seg_lock:
            if self._seg_busy or not self._seg_frags:
                return
            n = len(self._seg_frags)
            chars = sum(len(f["text"]) for f in self._seg_frags)
            # 攒太多还没成句 → 安全阀:逐碎片成行,别无限拖
            if n >= self.SEG_FORCE_FRAGS or chars >= self.SEG_FORCE_CHARS:
                frags = self._seg_frags
                self._seg_frags = []
                snapshot = None
            else:
                self._seg_busy = True
                snapshot = list(self._seg_frags)
                frags = None
        if frags:
            for f in frags:
                self._emit_line(f["text"], f["start"], f["end"], f["sid"], f["gap"], f["conf"])
            self.emit({"type": "partial", "text": ""})
            return
        self.seg_pool.submit(self._seg_worker, snapshot)

    def _seg_worker(self, snapshot):
        try:
            out = self.segmenter_ds.segment([f["text"] for f in snapshot], topic=self.title or "")
            self._seg_apply(snapshot, out)
        except Exception:
            pass
        finally:
            with self._seg_lock:
                self._seg_busy = False
            self._seg_flush_maybe()   # 处理期间可能又攒了新碎片

    def _seg_apply(self, snapshot, out):
        commit_texts = []
        if isinstance(out, dict) and isinstance(out.get("commit"), list):
            commit_texts = [(c.get("text") or "").strip()
                            for c in out["commit"] if (c.get("text") or "").strip()]
        if not commit_texts:
            return
        # 不信 DeepSeek 报的 n(它会数错),而是把每个合成句去标点后 贪心对回开头的碎片,
        # 求出每句真正吃掉几个碎片。对不齐就整批放弃(宁可这轮不提交,也不错位/丢字/重复)。
        norm = [self._norm_seg(f["text"]) for f in snapshot]
        groups = []
        i = 0
        for s in commit_texts:
            target = self._norm_seg(s)
            if not target:
                continue
            acc, j = "", i
            while j < len(snapshot) and len(acc) < len(target):
                acc += norm[j]
                j += 1
            if abs(len(acc) - len(target)) > 2 or j == i:
                return
            groups.append((i, j))
            i = j
        if not groups:
            return
        consumed = i
        with self._seg_lock:
            if self._seg_stopping:
                return   # 正在结束录音,交给 _seg_flush_all 收尾,worker 别再出行
            # 并发校验:缓冲最前面的 consumed 个碎片必须还是 snapshot 的那几个(按 start 对齐)
            if len(self._seg_frags) < consumed:
                return
            if any(self._seg_frags[k]["start"] != snapshot[k]["start"] for k in range(consumed)):
                return
            taken = self._seg_frags[:consumed]
            self._seg_frags = self._seg_frags[consumed:]
            remain = "".join(f["text"] for f in self._seg_frags)
        for (a, b), s in zip(groups, commit_texts):
            grp = taken[a:b]
            self._emit_line(s, grp[0]["start"], grp[-1]["end"], grp[0]["sid"],
                            grp[0]["gap"], min(g["conf"] for g in grp))
        self.emit({"type": "partial", "text": remain})

    def _seg_flush_all(self):
        """停止时把没成句的碎片逐个出行,别丢内容。"""
        with self._seg_lock:
            frags = self._seg_frags
            self._seg_frags = []
        for f in frags:
            self._emit_line(f["text"], f["start"], f["end"], f["sid"], f["gap"], f["conf"])
        if frags:
            self.emit({"type": "partial", "text": ""})

    # 通用默认课名形如「课程 08-01 21:30」,不含学科信息,别拿它误导纠错
    _GENERIC_TITLE = re.compile(r"^课程\s*\d{1,2}-\d{1,2}\s*\d{1,2}:\d{2}$")

    def _correction_topic(self):
        """给 AI 纠错/翻译的学科上下文:优先勾选的学科标签,其次绑定课程名,再其次非通用手输标题。"""
        if self.subjects:
            return "、".join(self.subjects[:3])
        if self.course_name and self.course_name.strip():
            return self.course_name.strip()
        t = (self.title or "").strip()
        if t and not self._GENERIC_TITLE.match(t):
            return t
        return ""

    def _course_is_english(self):
        s = ((self.course_name or "") + " " + (self.title or "") + " " + " ".join(self.subjects)).lower()
        return ("英语" in s) or ("english" in s) or ("英文" in s)

    def _should_translate(self, text):
        """这句要不要翻中文:英语课里只要有像样的英文就翻;普通课要整句以英文为主才翻。"""
        en = sum(1 for c in text if "a" <= c.lower() <= "z")
        if en < 6:
            return False
        if self._course_is_english():
            return True
        zh = sum(1 for c in text if "一" <= c <= "鿿")
        return en >= zh

    def _translations_path(self):
        return os.path.join(self.rec.dir, "translations.json")

    def _translate_line(self, line_id, text):
        try:
            zh = self.translator.translate(text, topic=self._correction_topic())
        except Exception as e:
            print(f"[translate] line {line_id} 出错: {e}", flush=True)
            return
        print(f"[translate] line {line_id}: {text[:30]!r} -> {zh[:30]!r}", flush=True)
        if not zh:
            return
        self.emit({"type": "line_translation", "id": line_id, "text": zh})
        # 落盘:{行号: 中文译文},重载转写时挂回去。翻译池并发,加锁+临时文件原子替换,防丢/损坏。
        with self._trans_lock:
            try:
                p = self._translations_path()
                data = {}
                if os.path.exists(p):
                    with open(p, encoding="utf-8") as f:
                        data = json.load(f)
                data[str(line_id)] = zh
                tmp = p + ".part"
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False)
                os.replace(tmp, p)
            except Exception:
                pass

    def _ai_correct(self, line_id, ts, text):
        try:
            fixed = self.corrector.correct(text, topic=self._correction_topic())
        except Exception:
            return
        if not fixed or fixed == text:
            return
        # 推给前端替换那一句
        self.emit({"type": "line_update", "id": line_id, "text": fixed})
        # 落盘:记一条 edit(by=AI纠错),重载转写就是纠正后的
        try:
            rec = {"at": time.strftime("%Y-%m-%d %H:%M:%S"), "line_id": line_id,
                   "before": text, "after": fixed, "by": "AI纠错", "ts": ts}
            with open(os.path.join(self.rec.dir, "edits.jsonl"), "a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        except Exception:
            pass

    def _on_status(self, msg):
        self.emit({"type": "notice", "msg": str(msg)})

    def _apply_merges(self):
        """声纹判定「这两个其实是同一个人」时，把文档里已经写过的名字也改过来。

        合并会让后面的编号整体前移，所以自定义名字的映射表要跟着搬，否则改过名的
        说话人会在合并后指向别人。
        """
        for frm, to in self.spk.take_merges():
            old, new = self.name_of(frm), self.name_of(to)
            names = {}
            for k, v in self.names.items():
                if k == frm:
                    continue          # 被并掉的那个的自定义名字丢弃，跟随并入方
                names[k - 1 if k > frm else k] = v
            self.names = names
            if self.last_speaker == frm:
                self.last_speaker = to
            elif self.last_speaker is not None and self.last_speaker > frm:
                self.last_speaker -= 1
            if self.word is not None and old != new:
                self.word.rename(old, new)
            self.emit({"type": "notice",
                       "msg": f"「{old}」和「{new}」声纹一致，判定为同一个人，已合并。"})
            self.emit({"type": "renamed", "id": to, "old": old, "name": new})

    # ---------- 杂项 ----------
    def name_of(self, sid):
        # 手动改名 > 声纹库命中的身份 > 默认「老师/同学N」
        return self.names.get(sid) or self.spk.match_name(sid) or speaker_name(sid)

    def rename(self, sid, name):
        old = self.name_of(sid)
        self.names[int(sid)] = name
        if self.word is not None:
            self.word.rename(old, name)   # 把文档里已经写过的名字一起替换掉
        self._persist_speaker_name(int(sid), name)   # 落盘,录制结束后回看也是新名字
        self._remember_voice(int(sid), name)   # 存进本账号声纹库,之后录到同一个人自动认
        return old

    def _persist_speaker_name(self, sid, name):
        """把录制中改的名字写进 speaker_names.json,让停止后按 speaker_id 统一生效(和 REST 改名同一份文件)。"""
        try:
            p = os.path.join(self.rec.dir, "speaker_names.json")
            names = {}
            if os.path.exists(p):
                with open(p, encoding="utf-8") as f:
                    names = json.load(f)
            name = (name or "").strip()
            if name:
                names[str(sid)] = name
            else:
                names.pop(str(sid), None)
            tmp = p + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(names, f, ensure_ascii=False, indent=2)
            os.replace(tmp, p)
        except Exception:
            traceback.print_exc()

    def _remember_voice(self, sid, name):
        """录音中给某说话人改了名 → 把他这次的声纹中心 + 名字写进本账号私有声纹库,
        以后这个账号再录到同声纹的人,会自动用这个名字。默认名(老师/同学N)不入库。"""
        name = (name or "").strip()
        if not name or name == speaker_name(sid):
            return
        try:
            emb = self.spk.centroid_of(sid)
            if emb is None:
                return
            import voiceprint
            root = os.path.normpath(os.path.join(HERE, self.cfg["server"]["records_dir"]))
            voiceprint.upsert_voice(root, name, emb, key=self.user_key)
            # 刷新到本会话的匹配库,后面新出现的同声纹说话人也能立刻自动认
            self.spk.set_library(voiceprint.load_library(root, self.user_key), self.spk.vp_threshold)
        except Exception:
            traceback.print_exc()

    def status(self):
        src = self.sasr or self.seg
        return {
            "type": "status",
            "running": self.running,
            "paused": self.paused,
            "elapsed": round(time.time() - self.t0, 1),
            "level": round(getattr(self.cap, "level", 0.0), 3),
            "speech": round(src.speech_prob, 2),
            "speaking": src.speaking,
            "backlog": src.backlog if self.streaming else self.asr.backlog,
            "rtf": round(src.rtf if self.streaming else self.asr.rtf, 2),
            "streaming": self.streaming,
            "lines": self.rec.n,
            "overflow": getattr(self.cap, "overflow_count", 0),
            "word": self.word.status() if self.word is not None else None,
            "speakers": [{"id": s["id"], "name": self.name_of(s["id"]),
                          "seconds": s["seconds"], "utterances": s["utterances"]}
                         for s in self.spk.stats()],
            "dir": self.rec.dir,
        }


class App:
    def __init__(self):
        self.cfg = load_config()
        # 每个客户端(cid)一路独立会话，互不干扰。按 cid 存(而不是 ws)是为了
        # 断线重连能恢复：WS 断了先不结束，进宽限期；同 cid 重连就接着录，不丢转写。
        #   self.sessions[cid] = {"s": Session, "ws": ws 或 None, "detached_at": float 或 None}
        self.sessions = {}
        self.cid_user = {}        # {cid: 声纹库账号标识} —— 连接时按令牌算好,开录/改名时用
        self.max_sessions = int(self.cfg["server"].get("max_sessions", 8))
        self.detach_grace = int(self.cfg["server"].get("detach_grace_s", 90))
        self.loop = None
        self.token = self._load_token()
        records_dir = os.path.normpath(
            os.path.join(HERE, self.cfg["server"]["records_dir"]))
        self.lib = Library(records_dir)
        self.accounts = Accounts(records_dir)
        self._fails = {}          # {来源IP: {n, until, first}} 令牌爆破防护
        self.access_log_path = os.path.join(
            os.path.normpath(os.path.join(HERE, self.cfg["server"]["records_dir"])), "access.log")
        # 放到公网时把所有东西都关在令牌后面（连页面本身都不给），
        # 扫描器扫过来只会看到 401，看不出这里跑着什么
        self.public_mode = bool(self.cfg["server"].get("public", False))

    def _load_token(self):
        """服务要监听在局域网上，必须有个门禁。第一次启动自动生成，之后固定。"""
        if not self.cfg["server"].get("require_token", True):
            return ""
        if os.path.exists(TOKEN_FILE):
            with open(TOKEN_FILE, encoding="utf-8") as f:
                t = f.read().strip()
            if t:
                return t
        import secrets
        t = secrets.token_urlsafe(9)
        with open(TOKEN_FILE, "w", encoding="utf-8") as f:
            f.write(t)
        return t

    async def _safe_send(self, ws, data):
        try:
            await ws.send_str(data)
        except Exception:
            pass

    def _send_soon(self, ws, msg):
        """从任意线程给某个连接发消息（线程安全）。识别在工作线程里跑，靠这个回主循环。"""
        if self.loop is None or ws is None or ws.closed:
            return
        data = json.dumps(msg, ensure_ascii=False)
        self.loop.call_soon_threadsafe(
            lambda: asyncio.ensure_future(self._safe_send(ws, data)))

    def _emit_to_cid(self, cid):
        """按 cid 生成 emit —— 动态取该会话当前绑定的 ws（重连后会换成新 ws）。
        断线宽限期内 ws 为 None，消息直接丢弃（转写照常落盘，重连后接着来）。"""
        def emit(msg):
            ent = self.sessions.get(cid)
            if ent and ent.get("ws") is not None:
                self._send_soon(ent["ws"], msg)
        return emit

    # ---------- WebSocket ----------
    async def ws_handler(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        # cid：客户端标识（前端存 localStorage）。用来断线重连时找回自己那路会话。
        cid = request.query.get("cid") or secrets.token_urlsafe(6)
        # 这条连接是哪个账号 → 决定用/写哪个私有声纹库(开录、录音中改名都要)
        self.cid_user[cid] = self._user_key_for_token(self._req_token(request))
        ws = web.WebSocketResponse(heartbeat=20, max_msg_size=8 * 1024 * 1024)
        await ws.prepare(request)

        # 同 cid 还有一路在录（宽限期内断线的）→ 恢复：把会话接到这个新连接上
        resumed = False
        ent = self.sessions.get(cid)
        if ent and ent["s"].running:
            ent["ws"] = ws
            ent["detached_at"] = None
            resumed = True

        await ws.send_str(json.dumps({
            "type": "hello",
            "devices": audio_mod.list_devices(),
            "default_device": audio_mod.pick_default_device(),
            "config": self.cfg,
            "running": resumed,
            "resumed": resumed,
            "sid": os.path.basename(ent["s"].rec.dir) if resumed else None,
        }, ensure_ascii=False))

        try:
            async for msg in ws:
                if msg.type == WSMsgType.BINARY:
                    # 网页推来的麦克风音频（16k 单声道 Int16）→ 送进这个 cid 的会话
                    ent = self.sessions.get(cid)
                    cap = getattr(ent["s"], "cap", None) if ent else None
                    if isinstance(cap, audio_mod.BrowserCapture):
                        cap.push_pcm(msg.data)
                    continue
                if msg.type != WSMsgType.TEXT:
                    continue
                try:
                    await self.handle_cmd(json.loads(msg.data), ws, cid)
                except Exception as e:
                    traceback.print_exc()
                    await ws.send_str(json.dumps(
                        {"type": "error", "msg": f"{type(e).__name__}: {e}"}, ensure_ascii=False))
        finally:
            # 连接断开：**不立即结束**。在录的话进宽限期（detach），同 cid 重连就恢复；
            # 宽限期到了由 ticker 收尾落盘。没在录的直接清掉。
            ent = self.sessions.get(cid)
            if ent and ent["ws"] is ws:
                if ent["s"].running:
                    ent["ws"] = None
                    ent["detached_at"] = time.time()
                else:
                    self.sessions.pop(cid, None)
        return ws

    async def handle_cmd(self, m, ws, cid):
        cmd = m.get("cmd")
        emit = self._emit_to_cid(cid)            # 只发给这个 cid 当前的连接
        ent = self.sessions.get(cid)
        sess = ent["s"] if ent else None         # 这个客户端自己的会话

        if cmd == "devices":
            await ws.send_str(json.dumps(
                {"type": "devices", "devices": audio_mod.list_devices()}, ensure_ascii=False))

        elif cmd == "start":
            if sess and sess.running:
                return
            # 保护服务器：同时进行的会话数封顶（每路会话占一份识别模型内存 + CPU）
            running = sum(1 for e in self.sessions.values() if e["s"].running)
            if running >= self.max_sessions:
                emit({"type": "error",
                      "msg": f"服务器繁忙（已有 {running} 路转写在跑），稍后再试"})
                return
            # 每路会话读一份独立配置，避免并发开课时互相覆盖参数
            cfg = load_config()
            for k in ("backend", "streaming", "model", "cpu_threads", "beam_size"):
                if m.get(k) is not None:
                    cfg["asr"][k] = m[k]
            if m.get("new_para_gap_ms") is not None:
                cfg["paragraph"]["new_para_gap_ms"] = int(m["new_para_gap_ms"])
            # 拾音灵敏度：环境、坐得远近不同，这个值得现场调
            for k in ("threshold", "exit_threshold", "min_speech_ms"):
                if (m.get("vad") or {}).get(k) is not None:
                    cfg["vad"][k] = m["vad"][k]

            emit({"type": "notice", "msg": "正在加载识别模型…"})
            # 续录只能接自己名下的课:别人的 append_sid 一律无视,退回新建一节。
            user_key = self.cid_user.get(cid)
            append_sid = m.get("append_sid")
            if append_sid:
                owner = self._session_owner(append_sid)
                if owner is not None and user_key != "owner" and owner != self._to_owner_id(user_key):
                    emit({"type": "notice", "msg": "这节课不属于当前账号,已新建一节录制。"})
                    append_sid = None
            s = Session(cfg, self.loop, emit,
                        title=m.get("title"), device=m.get("device"),
                        loopback=bool(m.get("loopback")),
                        to_word=bool(m.get("to_word")),
                        word_doc=m.get("word_doc") or "active",
                        append_sid=append_sid)
            s.user_key = user_key                       # 本次录音归属账号 → 私有声纹库 + 数据隔离
            s.only_key = bool(m.get("only_key"))
            s.ai_correct = bool(m.get("ai_correct"))    # AI 实时纠错开关
            s.smart_seg = bool(m.get("smart_seg"))      # AI 智能分句开关
            s.translate_en = bool(m.get("translate_en"))  # 英文自动翻中文字幕
            s.subjects = [x.strip() for x in (m.get("subjects") or [])
                          if isinstance(x, str) and x.strip()]   # 勾选的学科标签
            print(f"[start] ai_correct={s.ai_correct} smart_seg={s.smart_seg} "
                  f"translate_en={s.translate_en}(raw={m.get('translate_en')!r})", flush=True)
            # 选了课程就用这门课的术语表和纠错表
            course_id = m.get("course_id")
            if course_id:
                course = next((c for c in self.lib.courses() if c["id"] == course_id), None)
                # 只认自己名下的课程(别人的 course_id 无视);owner 存的是哈希 id
                if course and user_key != "owner" and course.get("owner") not in (None, s._owner_id()):
                    course = None
                if course:
                    s.course_id = course_id
                    s.course_name = course.get("name")
                    s.corrections = [r for r in (course.get("corrections") or [])
                                     if r.get("enabled", True) and r.get("from")]
                    hw = (course.get("hotwords") or "").strip()
                    if hw:
                        base = (cfg["asr"].get("hotwords") or "").strip()
                        s.cfg["asr"]["hotwords"] = (base + " " + hw).strip()
            info = await asyncio.get_running_loop().run_in_executor(None, s.start)
            self.sessions[cid] = {"s": s, "ws": ws, "detached_at": None}
            # sid 要在开始时就给出去：录制过程中拍板书需要它来定位存哪
            emit({"type": "started", **info, "dir": s.rec.dir,
                  "sid": os.path.basename(s.rec.dir)})

        elif cmd == "stop":
            if sess:
                self.sessions.pop(cid, None)
                path, meta = await asyncio.get_running_loop().run_in_executor(None, sess.stop)
                if sess.course_id:
                    self.lib.assign(os.path.basename(path), sess.course_id)
                # 会话已从表里移除，_emit_to_cid 已找不到它 → 直接发给当前这个连接
                self._send_soon(ws, {"type": "stopped", "dir": path, "meta": meta,
                                     "sid": os.path.basename(path)})

        elif cmd == "pause":
            if sess:
                sess.paused = bool(m.get("value", True))
                emit({"type": "notice",
                      "msg": "已暂停" if sess.paused else "已继续"})

        elif cmd == "rename":
            if sess:
                sidx = int(m["id"])
                name = m["name"]
                old = sess.rename(sidx, name)
                emit({"type": "renamed", "id": sidx, "old": old, "name": name})
                # 回溯:把这个名字也贴到过去所有课里声纹一致的同一个人身上(后台跑,不卡录制)
                try:
                    emb = sess.spk.centroid_of(sidx)
                    owner_id = self._to_owner_id(sess.user_key)
                    if emb is not None and (name or "").strip():
                        async def _bp():
                            n = await asyncio.get_running_loop().run_in_executor(
                                None, self._propagate_name, owner_id, name.strip(), emb)
                            if n:
                                emit({"type": "notice", "msg": f"已把「{name}」同步到过去 {n} 节课的同一个人"})
                        asyncio.ensure_future(_bp())
                except Exception:
                    traceback.print_exc()

        elif cmd == "mark":
            if sess:
                if sess.last_line_id is not None:
                    # 标"刚说过的那句"(更符合直觉),落盘 marks.json 并让前端把它变黄
                    sid = os.path.basename(sess.rec.dir)
                    self._save_mark(sid, sess.last_line_id, "key")
                    emit({"type": "line_update", "id": sess.last_line_id, "kind": "key"})
                    emit({"type": "notice", "msg": "已把刚才那句标为重点"})
                else:
                    sess.pending_key = 1        # 还没出字 → 退回标下一句
                    emit({"type": "notice", "msg": "下一句标为重点"})

        elif cmd == "status":
            await ws.send_str(json.dumps(
                sess.status() if sess else {"type": "status", "running": False},
                ensure_ascii=False))

    # ---------- 心跳 ----------
    async def ticker(self):
        while True:
            await asyncio.sleep(1.0)
            now = time.time()
            for cid, ent in list(self.sessions.items()):
                s = ent["s"]
                if ent["ws"] is not None and s.running:
                    self._send_soon(ent["ws"], s.status())   # 有连接:推状态
                elif ent["detached_at"] and now - ent["detached_at"] > self.detach_grace:
                    # 断线超过宽限期还没重连 → 收尾落盘、释放资源
                    self.sessions.pop(cid, None)
                    try:
                        await asyncio.get_running_loop().run_in_executor(None, s.stop)
                    except Exception:
                        traceback.print_exc()

    # ---------- 令牌 ----------
    def check_token(self, request):
        """服务监听在局域网（甚至公网）上，任何能连到的设备都能发请求。
        不加这道令牌，别人就能用你的电脑开麦录音、翻你所有的课堂记录。"""
        if not self.token:
            return True
        got = (request.query.get("token")
               or request.headers.get("X-Token")
               or "")
        ok = secrets.compare_digest(got, self.token) if got else False
        # 登录用户的会话令牌也放行——注册登录即鉴权，不用再抄全局令牌
        if not ok and got and self.accounts.session_user(got):
            ok = True
        if not ok:
            self._note_fail(request)
        return ok

    def is_admin(self, request):
        """管理员鉴权:全局令牌(拥有者)或 role=admin 的登录用户。声纹库管理仅管理员可用。"""
        got = self._req_token(request)
        if not got:
            return False
        if self.token and secrets.compare_digest(got, self.token):
            return True
        u = self.accounts.session_user(got)
        return bool(u and u.get("role") == "admin")

    def _req_token(self, request):
        return request.query.get("token") or request.headers.get("X-Token") or ""

    def _user_key_for_token(self, token):
        """令牌 -> 该账号的声纹库标识。全局令牌(拥有者)=owner(沿用老的全局库);
        登录用户=各自邮箱(每个账号一个私有库);其它情况 None。"""
        if not token:
            return None
        if self.token and secrets.compare_digest(token, self.token):
            return "owner"
        u = self.accounts.session_user(token)
        return (u.get("email") or u.get("name")) if u else None

    def _req_user_key(self, request):
        return self._user_key_for_token(self._req_token(request))

    # ---------- 数据隔离:一个账号只能看/改自己的课、课程、课表 ----------
    def _owner_key(self, request):
        """请求归属哪个账号:登录用户=邮箱,全局令牌(拥有者)=owner。数据归属/隔离都以此为准。"""
        return self._req_user_key(request)

    @staticmethod
    def _to_owner_id(key):
        """账号标识 -> 落盘用的稳定归属 id(邮箱哈希,不泄露明文)。全局令牌=owner。"""
        from voiceprint import _key_id
        return "owner" if key in (None, "", "owner") else _key_id(key)

    def _owner_id(self, request):
        return self._to_owner_id(self._owner_key(request))

    def _is_super(self, request):
        """全局令牌拥有者:机器主人,可跨账号访问全部数据(普通登录用户拿不到这个令牌)。"""
        return self._owner_key(request) == "owner"

    def _token_ok(self, request):
        """无副作用地判断令牌是否有效(中间件里用,别触发爆破计数)。"""
        got = self._req_token(request)
        if not got:
            return False
        if self.token and secrets.compare_digest(got, self.token):
            return True
        return bool(self.accounts.session_user(got))

    def _session_owner(self, sid):
        """读某节课归属账号 id:先看 meta.json(停止后落盘),没有再看 owner.json
        (录制一开始就写)。都没有(老数据)返回 None。"""
        d = self._session_dir(sid)
        try:
            with open(os.path.join(d, "meta.json"), encoding="utf-8") as f:
                o = json.load(f).get("owner")
                if o:
                    return o
        except Exception:
            pass
        try:
            with open(os.path.join(d, "owner.json"), encoding="utf-8") as f:
                return json.load(f).get("owner")
        except Exception:
            return None

    def _owns_session(self, request, sid):
        """能否访问这节课:全局令牌看全部;登录用户只能看自己名下的课。"""
        if self._is_super(request):
            return True
        if not sid or not os.path.isdir(self._session_dir(sid)):
            return False
        return self._session_owner(sid) == self._owner_id(request)

    # ---------- 暴露到公网之后必须有的三件事 ----------
    def _client_ip(self, request):
        # 经端口转发进来时 remote 就是真实来源；套了反代才需要看 X-Forwarded-For
        fwd = request.headers.get("X-Forwarded-For", "")
        return (fwd.split(",")[0].strip() if fwd else None) or (request.remote or "?")

    def _note_fail(self, request):
        """记一次令牌错误。暴力猜令牌的会被锁出去。"""
        ip = self._client_ip(request)
        now = time.time()
        rec = self._fails.get(ip, {"n": 0, "until": 0.0, "first": now})
        if now - rec["first"] > 600:            # 10 分钟没错过就重新计数
            rec = {"n": 0, "until": 0.0, "first": now}
        rec["n"] += 1
        if rec["n"] >= 8:
            # 连错 8 次锁 15 分钟，之后每多错一次翻倍，最多锁 6 小时
            lock = min(900 * (2 ** (rec["n"] - 8)), 6 * 3600)
            rec["until"] = now + lock
            print(f"[安全] {ip} 令牌连错 {rec['n']} 次，锁定 {int(lock/60)} 分钟")
        self._fails[ip] = rec

    def _locked(self, request):
        rec = self._fails.get(self._client_ip(request))
        return bool(rec and rec["until"] > time.time())

    def _access_log(self, request, status):
        """留一份访问日志。放到公网之后，谁在什么时候敲过你的服务，得有据可查。"""
        try:
            line = (f"{time.strftime('%Y-%m-%d %H:%M:%S')}\t{self._client_ip(request)}\t"
                    f"{request.method}\t{request.path}\t{status}\n")
            with open(self.access_log_path, "a", encoding="utf-8") as f:
                f.write(line)
        except Exception:
            pass    # 日志写不了也不能影响服务

    # ---------- 账号 ----------
    def _bearer(self, request):
        return (request.query.get("token") or request.headers.get("X-Token") or "")

    async def api_register(self, request):
        try:
            m = await request.json()
            # 邀请码:config.json 里 server.invite_code 非空则注册必须带对的码
            # (实时读,改码不用重启)。空 = 开放注册。
            code = (load_config()["server"].get("invite_code") or "").strip()
            if code and (m.get("invite") or "").strip() != code:
                return web.json_response({"error": "邀请码不对，注册需要邀请码"}, status=403)
            # 角色一律强制 user——绝不能让注册者自己指定 role,否则塞 role=admin 就自封管理员。
            # 管理员只能由拥有者手动在 users.json 里设(见 tomtest)。
            token, user = self.accounts.register(
                m.get("email"), m.get("name"), m.get("password"))
            return web.json_response({"token": token, "user": user})
        except ValueError as e:
            return web.json_response({"error": str(e)}, status=400)
        except Exception:
            return web.json_response({"error": "注册失败"}, status=500)

    async def api_login(self, request):
        if self._locked(request):
            return web.json_response({"error": "尝试次数过多，稍后再试"}, status=429)
        try:
            m = await request.json()
            token, user = self.accounts.login(m.get("email"), m.get("password"))
            return web.json_response({"token": token, "user": user})
        except ValueError as e:
            self._note_fail(request)          # 密码猜错也算一次失败，防爆破
            return web.json_response({"error": str(e)}, status=401)
        except Exception:
            return web.json_response({"error": "登录失败"}, status=500)

    async def api_me(self, request):
        user = self.accounts.session_user(self._bearer(request))
        if not user:
            return web.json_response({"error": "未登录"}, status=401)
        return web.json_response({"user": user})

    async def api_logout(self, request):
        self.accounts.logout(self._bearer(request))
        return web.json_response({"ok": True})

    # ---------- HTTP 接口 ----------
    async def api_summarize(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "请求不是合法 JSON"}, status=400)

        # 从服务端按 sid/dir 读别人的课属越权 —— 隔离。前端自带 lines 的情形不受影响。
        ref_sid = body.get("sid") or (os.path.basename(body["dir"]) if body.get("dir") else None)
        if ref_sid and not self._owns_session(request, ref_sid):
            return web.json_response({"error": "无权访问这节课"}, status=403)
        lines = body.get("lines") or []
        if not lines:
            # 没给转写内容就读服务端存的那份
            d = body.get("dir")
            if d and os.path.isdir(d):
                p = os.path.join(d, "transcript.jsonl")
                raw = self._read_bytes(p)
                if raw:
                    lines = [json.loads(x) for x in raw.decode("utf-8").splitlines() if x.strip()]
        if not lines:
            return web.json_response({"error": "没有可整理的转写内容"}, status=400)

        ds = DeepSeek(self.cfg)
        if not ds.ready:
            return web.json_response(
                {"error": "还没配 DeepSeek API key。填到 service/config.json 的 "
                          "deepseek.api_key，或设环境变量 DEEPSEEK_API_KEY，然后重启服务。"},
                status=503)
        # 识别这节课的板书,一并纳入总结
        board = ""
        sid = body.get("sid")
        sdir = self._session_dir(sid) if sid else body.get("dir")
        if sdir and os.path.isdir(sdir):
            try:
                from board import board_content
                board = await asyncio.get_running_loop().run_in_executor(
                    None, board_content, sdir, self.cfg)
            except Exception:
                board = ""
        try:
            out = await asyncio.get_running_loop().run_in_executor(
                None, ds.summarize, lines, body.get("title"), board)
        except Exception as e:
            return web.json_response({"error": f"DeepSeek 调用失败：{e}"}, status=502)
        return web.json_response(out)

    async def api_sessions(self, request):
        """列出本机存过的课堂记录，供网页的历史页用。"""
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        root = os.path.normpath(os.path.join(HERE, self.cfg["server"]["records_dir"]))
        me = self._owner_id(request)
        su = self._is_super(request)         # 全局令牌拥有者看全部
        out = []
        if os.path.isdir(root):
            for name in sorted(os.listdir(root), reverse=True):
                d = os.path.join(root, name)
                meta_p = os.path.join(d, "meta.json")
                if not os.path.isfile(meta_p):
                    continue
                try:
                    with open(meta_p, encoding="utf-8") as f:
                        meta = json.load(f)
                except Exception:
                    continue
                # 数据隔离:只列自己名下的课(全局令牌除外)。老数据 owner 缺失=已回填,不会漏。
                if not su and meta.get("owner") != me:
                    continue
                entry = {"id": name, "dir": d, **meta}
                s = self._load_summary(name)
                if s:
                    entry["summary"] = s.get("summary", "")
                    entry["key_points"] = s.get("key_points", [])
                    entry["has_summary"] = bool(s.get("summary"))
                out.append(entry)
        return web.json_response({"sessions": out})

    # ---------- 记录：读 / 改 / 改动历史 ----------
    def _records_root(self):
        return os.path.normpath(os.path.join(HERE, self.cfg["server"]["records_dir"]))

    def _session_dir(self, sid):
        return os.path.join(self._records_root(), os.path.basename(sid))

    def _oss_url(self, local_path, disposition=None, inline=False, content_type=None):
        """本地文件在 OSS 上有对应对象则返回其签名直链(用于 302 跳转),否则 None。
        inline=True + content_type 用于 PDF 预览:强制内嵌显示、别让浏览器当附件下载。"""
        try:
            import oss_store
            if not oss_store.enabled():
                return None
            rel = os.path.relpath(local_path, self._records_root()).replace(os.sep, "/")
            if rel.startswith(".."):
                return None
            return oss_store.signed_url(rel, disposition=disposition, inline=inline, content_type=content_type)
        except Exception:
            return None

    def _read_bytes(self, local_path):
        """读 records 下的文件:本地有读本地;本地没有(内容已下沉到 OSS、本地删了)就从 OSS 取。"""
        try:
            if os.path.exists(local_path):
                with open(local_path, "rb") as f:
                    return f.read()
        except Exception:
            return None
        try:
            import oss_store
            rel = os.path.relpath(local_path, self._records_root()).replace(os.sep, "/")
            if rel.startswith(".."):
                return None
            return oss_store.read_bytes(rel)
        except Exception:
            return None

    def _load_lines(self, sid):
        """读转写，并把历次编辑覆盖上去（原始文件不动，改动单独存）。"""
        d = self._session_dir(sid)
        p = os.path.join(d, "transcript.jsonl")
        raw = self._read_bytes(p)
        if raw is None:
            return None, None
        lines = [json.loads(x) for x in raw.decode("utf-8").splitlines() if x.strip()]
        edits = self._load_edits(sid)
        latest = {}
        for e in edits:
            latest[e["line_id"]] = e
        for l in lines:
            e = latest.get(l.get("id"))
            if e:
                l["text"] = e["after"]
                l["edited"] = True
        # 手动标记(重点/定义/取消)覆盖 kind——存 marks.json,原始转写不动
        marks = self._load_marks(sid)
        for l in lines:
            key = str(l.get("id"))
            if key in marks:
                l["kind"] = marks[key]      # 可能是 "key"/"define"/None
        # 说话人改名(按 speaker_id 覆盖名字)——存 speaker_names.json,原始转写不动。
        # 录制中改、录制后改都写这里,这样这个说话人的每一句都统一改过来。
        names = self._load_speaker_names(sid)
        if names:
            for l in lines:
                nm = names.get(str(l.get("speaker_id")))
                if nm:
                    l["speaker"] = nm
        # 英文字幕:把 translations.json 里的中文译文挂回对应行
        try:
            tp = os.path.join(d, "translations.json")
            if os.path.exists(tp):
                with open(tp, encoding="utf-8") as f:
                    trans = json.load(f)
                for l in lines:
                    zh = trans.get(str(l.get("id")))
                    if zh:
                        l["translation"] = zh
        except Exception:
            pass
        return d, lines

    # ---------- 手动标记重点/定义(marks.json,直播和历史都能标) ----------
    def _marks_path(self, sid):
        return os.path.join(self._session_dir(sid), "marks.json")

    def _load_marks(self, sid):
        p = self._marks_path(sid)
        if not os.path.exists(p):
            return {}
        try:
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def _save_mark(self, sid, line_id, kind):
        """kind ∈ {'key','define',None}。None 表示取消标记(强制无高亮)。"""
        p = self._marks_path(sid)
        marks = self._load_marks(sid)
        marks[str(line_id)] = kind
        with open(p, "w", encoding="utf-8") as f:
            json.dump(marks, f, ensure_ascii=False, indent=2)

    # ---------- 说话人改名(speaker_names.json,录制中/录制后都能改) ----------
    def _speaker_names_path(self, sid):
        return os.path.join(self._session_dir(sid), "speaker_names.json")

    def _load_speaker_names(self, sid):
        p = self._speaker_names_path(sid)
        if not os.path.exists(p):
            return {}
        try:
            with open(p, encoding="utf-8") as f:
                d = json.load(f)
            return d if isinstance(d, dict) else {}
        except Exception:
            return {}

    def _save_speaker_name(self, sid, speaker_id, name):
        p = self._speaker_names_path(sid)
        names = self._load_speaker_names(sid)
        name = (name or "").strip()
        if name:
            names[str(speaker_id)] = name
        else:
            names.pop(str(speaker_id), None)   # 传空=清掉自定义名,恢复默认
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(names, f, ensure_ascii=False, indent=2)
        os.replace(tmp, p)

    def _propagate_name(self, owner_id, name, embedding, exclude_sid=None):
        """改名回溯:把 name 贴到该账号**过去所有课**里声纹匹配到这个人的说话人身上,
        这样"改了一个名字、过去同一个人也跟着改"。用各课缓存的 speakers.json 现比,返回改了几节课。"""
        import numpy as np
        import voiceprint
        if not name:
            return 0
        e = np.asarray(embedding, dtype=np.float32)
        n = float(np.linalg.norm(e))
        if e.size == 0 or n == 0:
            return 0
        e = e / n
        root = self._records_root()
        th = self.cfg["speaker"].get("voiceprint_threshold", self.cfg["speaker"]["threshold"])
        spk = self._voice_embedder()
        skip = {os.path.basename(ent["s"].rec.dir) for ent in self.sessions.values()
                if ent.get("s") is not None}       # 正在录的那节跳过(由实时改名负责)
        if exclude_sid:
            skip.add(os.path.basename(exclude_sid))   # 本次改名的那节不算进"回溯"计数
        changed = 0
        for sname in os.listdir(root):
            d = os.path.join(root, sname)
            if not os.path.isdir(d) or sname in skip:
                continue
            if self._session_owner(sname) != owner_id:    # 只回溯自己名下的课
                continue
            data = voiceprint.extract_session_voices(d, spk.embed)
            if not data:
                continue
            hit = False
            for sp in data.get("speakers", []):
                emb = sp.get("embedding") or []
                ee = np.asarray(emb, dtype=np.float32)
                nn = float(np.linalg.norm(ee))
                if ee.size and nn and float(np.dot(e, ee / nn)) >= th:
                    self._save_speaker_name(sname, sp.get("idx"), name)
                    hit = True
            if hit:
                changed += 1
        return changed

    async def api_rename_speaker(self, request):
        """改某节课里某个说话人的名字(录制后用;录制中走 WS 的 rename)。按 speaker_id 覆盖,
        这个人的每一句都统一改过来;把声纹+名字记进本账号声纹库;并**回溯过去所有课**里同一个人。"""
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        sid = request.match_info["sid"]
        if not os.path.isdir(self._session_dir(sid)):
            return web.json_response({"error": "没有这份记录"}, status=404)
        try:
            body = await request.json()
            speaker_id = int(body["speaker_id"])
            name = str(body.get("name") or "").strip()
        except Exception:
            return web.json_response({"error": "参数不对,需要 speaker_id 和 name"}, status=400)
        self._save_speaker_name(sid, speaker_id, name)
        # 学声纹 + 回溯历史(都在线程池里跑,别卡住请求)
        learned, propagated = False, 0
        if name:
            def work():
                import voiceprint
                spk = self._voice_embedder()
                data = voiceprint.extract_session_voices(self._session_dir(sid), spk.embed)
                sp = next((x for x in (data or {}).get("speakers", [])
                           if x.get("idx") == speaker_id), None)
                if not (sp and sp.get("embedding")):
                    return False, 0
                voiceprint.upsert_voice(self._records_root(), name, sp["embedding"],
                                        key=self._owner_key(request))
                # 回溯范围 = 这节课的归属账号(通常就是请求者;全局令牌代管时也回溯到该账号名下)
                n = self._propagate_name(self._session_owner(sid), name, sp["embedding"],
                                         exclude_sid=sid)
                return True, n
            try:
                learned, propagated = await asyncio.get_running_loop().run_in_executor(None, work)
            except Exception:
                traceback.print_exc()
        return web.json_response({"ok": True, "speaker_id": speaker_id, "name": name,
                                  "learned_voiceprint": learned, "propagated_sessions": propagated})

    # ---------- 课堂笔记(每节课一份 note.txt) ----------
    async def api_get_note(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        p = os.path.join(self._session_dir(request.match_info["sid"]), "note.txt")
        raw = self._read_bytes(p)
        text = raw.decode("utf-8") if raw else ""
        return web.json_response({"note": text})

    async def api_save_note(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        sid = request.match_info["sid"]
        if not os.path.isdir(self._session_dir(sid)):
            return web.json_response({"error": "没有这份记录"}, status=404)
        try:
            m = await request.json()
        except Exception:
            return web.json_response({"error": "参数不对"}, status=400)
        with open(os.path.join(self._session_dir(sid), "note.txt"), "w", encoding="utf-8") as f:
            f.write(str(m.get("note") or ""))
        return web.json_response({"ok": True})

    async def api_mark_line(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        sid = request.match_info["sid"]
        if not os.path.isdir(self._session_dir(sid)):
            return web.json_response({"error": "没有这份记录"}, status=404)
        try:
            body = await request.json()
            line_id = int(body["line_id"])
            kind = body.get("kind")
            if kind not in ("key", "define", None):
                raise ValueError
        except Exception:
            return web.json_response({"error": "参数不对,需要 line_id 和 kind(key/define/null)"}, status=400)
        self._save_mark(sid, line_id, kind)
        return web.json_response({"ok": True, "line_id": line_id, "kind": kind})

    def _load_edits(self, sid):
        p = os.path.join(self._session_dir(sid), "edits.jsonl")
        if not os.path.exists(p):
            return []
        with open(p, encoding="utf-8") as f:
            return [json.loads(x) for x in f if x.strip()]

    async def api_transcript(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        d, lines = self._load_lines(request.match_info["sid"])
        if lines is None:
            return web.json_response({"error": "没有这份记录"}, status=404)
        return web.json_response({"dir": d, "lines": lines})

    async def api_edit_line(self, request):
        """改一句转写。原文件永远不动，改动只往 edits.jsonl 追加——
        这样「编辑历史」是真实的、可回溯的，而不是一个假面板。"""
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        sid = request.match_info["sid"]
        d, lines = self._load_lines(sid)
        if lines is None:
            return web.json_response({"error": "没有这份记录"}, status=404)
        try:
            body = await request.json()
            line_id = int(body["line_id"])
            after = str(body["text"])
        except Exception:
            return web.json_response({"error": "参数不对，需要 line_id 和 text"}, status=400)

        cur = next((l for l in lines if l.get("id") == line_id), None)
        if cur is None:
            return web.json_response({"error": "没有这一句"}, status=404)
        if cur["text"] == after:
            return web.json_response({"ok": True, "unchanged": True})

        rec = {"at": time.strftime("%Y-%m-%d %H:%M:%S"), "line_id": line_id,
               "before": cur["text"], "after": after,
               "by": body.get("by") or "我", "ts": cur.get("ts", "")}
        with open(os.path.join(d, "edits.jsonl"), "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            f.flush()
        return web.json_response({"ok": True, "edit": rec})

    async def api_edits(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        return web.json_response({"edits": list(reversed(self._load_edits(request.match_info["sid"])))})

    # ---------- AI 摘要:保存 / 读取(落盘 summary.json，刷新/列表都能看到) ----------
    def _summary_path(self, sid):
        return os.path.join(self._session_dir(sid), "summary.json")

    def _load_summary(self, sid):
        p = self._summary_path(sid)
        raw = self._read_bytes(p)
        if raw is None:
            return None
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return None

    async def api_save_summary(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        sid = request.match_info["sid"]
        d = self._session_dir(sid)
        if not os.path.isdir(d):
            return web.json_response({"error": "没有这份记录"}, status=404)
        try:
            m = await request.json()
        except Exception:
            return web.json_response({"error": "参数不对"}, status=400)
        data = {
            "summary": str(m.get("summary") or ""),
            "key_points": list(m.get("key_points") or []),
            "corrections": list(m.get("corrections") or []),
            "applied": list(m.get("applied") or []),   # 已一键替换掉的错误,前端据此隐藏该条
            "at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        with open(self._summary_path(sid), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
        return web.json_response({"ok": True, **data})

    async def api_get_summary(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        return web.json_response(self._load_summary(request.match_info["sid"]) or {})

    async def api_learn_term(self, request):
        """个性化反哺:用户一键把某个同音错纠对后,把「正确术语」学下来,
        之后开的课 term_fix 会自动纠这个错。返回是否新学到 + 当前已学词数。"""
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        try:
            m = await request.json()
        except Exception:
            return web.json_response({"error": "参数不对"}, status=400)
        added = add_learned_term(self.cfg, m.get("term"))
        return web.json_response({"ok": True, "added": added,
                                  "count": len(load_learned_terms(self.cfg))})

    async def api_import_timetable(self, request):
        """课表截图 → 本地 OCR → DeepSeek 结构化成课程列表。图片不出服务器。"""
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        ds = DeepSeek(self.cfg)
        if not ds.ready:
            return web.json_response({"error": "没配 DeepSeek key,无法识别课表"}, status=400)
        try:
            import base64
            m = await request.json()
            img = m.get("image") or ""
            if "," in img and img.strip().startswith("data:"):
                img = img.split(",", 1)[1]
            raw = base64.b64decode(img)
        except Exception:
            return web.json_response({"error": "图片参数不对"}, status=400)
        try:
            from timetable import extract_timetable
            result = await asyncio.get_running_loop().run_in_executor(
                None, extract_timetable, raw, ds, self.cfg)
        except Exception as e:
            return web.json_response({"error": f"识别失败: {e}"}, status=500)
        return web.json_response(result)

    # ---------- 参考资料:课程教学大纲 ----------
    async def api_syllabus_list(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        from syllabus import syllabus_dir
        d = syllabus_dir(self._records_root())
        items = []
        for f in sorted(fn for fn in os.listdir(d) if fn.endswith(".json")):
            src = "standard"
            try:
                with open(os.path.join(d, f), encoding="utf-8") as fh:
                    src = json.load(fh).get("source", "standard")
            except Exception:
                pass
            items.append({"name": f[:-5], "official": src == "official"})
        return web.json_response({"courses": items})

    async def api_syllabus_get(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        from syllabus import load_syllabus
        data = load_syllabus(self._records_root(), request.match_info["name"])
        if not data:
            return web.json_response({"error": "没有这门课的大纲"}, status=404)
        return web.json_response(data)

    async def api_syllabus_schools(self, request):
        """按学校返回官方大纲目录(只给课名/标题,PDF 走代理接口)。"""
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        from syllabus_official import load_catalog
        cat = load_catalog(self._records_root())
        schools = []
        for sc in cat.get("schools", []):
            items = []
            for it in sc.get("items", []):
                if not it.get("course"):
                    continue
                if it.get("pdf_url"):
                    kind = "pdf"
                elif it.get("page_url"):
                    kind = "page"
                else:
                    continue
                items.append({"course": it.get("course"), "title": it.get("title") or it.get("course"),
                              "source_page": it.get("source_page", ""), "note": it.get("note", ""),
                              "kind": kind})
            if items:
                schools.append({"id": sc.get("id"), "name": sc.get("name"), "items": items})
        return web.json_response({"schools": schools})

    async def api_syllabus_official_pdf(self, request):
        """把某校某课的官方 PDF 拉取缓存后内联回传。"""
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        from syllabus_official import cache_pdf
        school = request.match_info["school"]
        course = request.match_info["course"]
        local = await asyncio.get_running_loop().run_in_executor(
            None, cache_pdf, self._records_root(), school, course)
        if not local or not os.path.exists(local):
            return web.json_response({"error": "拿不到这门课的官方 PDF"}, status=404)
        # 大纲 PDF 直接从本地内嵌回传(体积小、是参考资料、永不下沉 OSS)。
        # 不走 OSS:该桶对私有对象强制 Content-Disposition: attachment、且忽略 inline 覆盖,
        # 会导致浏览器把预览变成下载。本地 FileResponse 能完全控制 inline 头。
        return web.FileResponse(local, headers={"Content-Type": "application/pdf",
                                                 "Content-Disposition": "inline"})

    async def api_syllabus_official_page(self, request):
        """网页版官方大纲:抓远端 HTML、注入 <base> 后内联回传(供 iframe 预览)。"""
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        from syllabus_official import cache_page
        school = request.match_info["school"]
        course = request.match_info["course"]
        local = await asyncio.get_running_loop().run_in_executor(
            None, cache_page, self._records_root(), school, course)
        if not local or not os.path.exists(local):
            return web.json_response({"error": "拿不到这门课的网页大纲"}, status=404)
        with open(local, "rb") as f:
            data = f.read()
        # 不带 charset,让页面自身的 <meta charset> 决定编码(有些是 GBK)
        return web.Response(body=data, content_type="text/html")

    # ---------- 声纹:过去的声音 / 声纹库 ----------
    def _voice_embedder(self):
        """给声纹提取用的 SpeakerID(懒加载复用,不参与实时会话)。"""
        if getattr(self, "_vp_spk", None) is None:
            from speaker import SpeakerID
            self._vp_spk = SpeakerID(self.cfg)
        return self._vp_spk

    async def api_voices(self, request):
        """列出过去录音里的声音:能判定是同一个人的**聚成一条**(不逐节列)。会现算并缓存 speakers.json。"""
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        if not self.is_admin(request):
            return web.json_response({"error": "仅管理员可管理声纹库"}, status=403)
        import voiceprint
        root = self._records_root()
        key = self._req_user_key(request)
        spk = self._voice_embedder()
        lib = voiceprint.load_library(root, key)
        cluster_th = self.cfg["speaker"].get("cluster_threshold", 0.35)

        def build():
            raw, recognized = [], {}
            for name in sorted(os.listdir(root), reverse=True):
                d = os.path.join(root, name)
                if not os.path.isdir(d) or not os.path.exists(os.path.join(d, "audio.wav")):
                    continue
                data = voiceprint.extract_session_voices(d, spk.embed)
                for sp in (data or {}).get("speakers", []):
                    matched, _ = voiceprint.best_match(sp.get("embedding") or [], lib, spk.vp_threshold)
                    if matched:   # 已在库里 → 归到"已识别",不再列进待标记
                        recognized[matched["name"]] = recognized.get(matched["name"], 0) + 1
                    else:
                        raw.append({"sid": name, "idx": sp["idx"], "seconds": sp.get("seconds", 0),
                                    "name": sp.get("name", ""), "sample_start": sp.get("sample_start", 0),
                                    "embedding": sp.get("embedding") or []})
            clusters = []
            for cl in voiceprint.cluster_voices(raw, cluster_th):
                rep = max(cl["members"], key=lambda m: m.get("seconds", 0))   # 最长的那段当代表(试听/名字)
                clusters.append({
                    "sid": rep["sid"], "idx": rep["idx"], "sample_start": rep.get("sample_start", 0),
                    "name": rep.get("name", ""), "seconds": cl["seconds"],
                    "count": len(cl["members"]),
                    "sessions": len({m["sid"] for m in cl["members"]}),
                    "embedding": cl["centroid"],
                })
            return clusters, recognized

        clusters, recognized = await asyncio.get_running_loop().run_in_executor(None, build)
        return web.json_response({
            "clusters": clusters,
            "recognized": [{"name": k, "count": v} for k, v in recognized.items()],
            "library": [{"id": v["id"], "name": v["name"]} for v in lib],
        })

    async def api_voiceprints(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        if not self.is_admin(request):
            return web.json_response({"error": "仅管理员可管理声纹库"}, status=403)
        import voiceprint
        lib = voiceprint.load_library(self._records_root(), self._req_user_key(request))
        return web.json_response({"voiceprints": [{"id": v["id"], "name": v["name"]} for v in lib]})

    async def api_voiceprint_add(self, request):
        """把一个声音存进库并命名。body: {name, embedding}(聚类合并后的中心,优先) 或 {name, sid, idx}。"""
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        if not self.is_admin(request):
            return web.json_response({"error": "仅管理员可管理声纹库"}, status=403)
        import voiceprint
        try:
            m = await request.json()
            name = str(m.get("name") or "").strip()
        except Exception:
            return web.json_response({"error": "参数不对"}, status=400)
        if not name:
            return web.json_response({"error": "请填名字"}, status=400)
        root = self._records_root()
        key = self._req_user_key(request)
        emb = m.get("embedding")
        if isinstance(emb, list) and len(emb) >= 8:
            vid = voiceprint.upsert_voice(root, name, emb, key=key)
            return web.json_response({"ok": True, "id": vid, "name": name})
        # 退路:按 sid/idx 现取
        try:
            sid = os.path.basename(str(m["sid"])); idx = int(m["idx"])
        except Exception:
            return web.json_response({"error": "参数不对,需要 embedding 或 sid/idx"}, status=400)
        data = voiceprint.extract_session_voices(os.path.join(root, sid), self._voice_embedder().embed)
        sp = next((x for x in (data or {}).get("speakers", []) if x.get("idx") == idx), None)
        if not sp:
            return web.json_response({"error": "找不到这个声音"}, status=404)
        vid = voiceprint.upsert_voice(root, name, sp["embedding"], key=key)
        return web.json_response({"ok": True, "id": vid, "name": name})

    async def api_voiceprint_delete(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        if not self.is_admin(request):
            return web.json_response({"error": "仅管理员可管理声纹库"}, status=403)
        import voiceprint
        voiceprint.remove_voice(self._records_root(), request.match_info["id"],
                                key=self._req_user_key(request))
        return web.json_response({"ok": True})

    async def api_import_shu(self, request):
        """上大教务系统自动登录 + 抓课表(Playwright)。密码只用于登录、不落盘。"""
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        try:
            m = await request.json()
            u = (m.get("username") or "").strip()
            pwd = m.get("password") or ""
        except Exception:
            return web.json_response({"error": "参数不对"}, status=400)
        if not u or not pwd:
            return web.json_response({"error": "请输入学/工号和密码"}, status=400)
        debug_dir = os.path.join(self._records_root(), "shu_probe")
        try:
            from shu_jwxt import sync_timetable
            result = await asyncio.get_running_loop().run_in_executor(
                None, sync_timetable, u, pwd, debug_dir)
        except Exception as e:
            return web.json_response({"error": f"抓取失败: {e}"}, status=500)
        return web.json_response(result)

    # ---------- 课表(周重复课程,存 schedule.json,导入日历用) ----------
    def _schedule_file(self, request):
        """课表按账号隔离:各账号一份 schedule_<账号>.json;全局令牌沿用老的 schedule.json。"""
        key = self._owner_key(request)
        if key in (None, "", "owner"):
            return os.path.join(self._records_root(), "schedule.json")
        import voiceprint
        return os.path.join(self._records_root(), f"schedule_{voiceprint._key_id(key)}.json")

    async def api_get_schedule(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        p = self._schedule_file(request)
        if not os.path.exists(p):
            return web.json_response({"events": []})
        try:
            with open(p, encoding="utf-8") as f:
                data = json.load(f)
            return web.json_response({"events": list(data.get("events") or [])})
        except Exception:
            return web.json_response({"events": []})

    async def api_save_schedule(self, request):
        """存带具体日期的课程事件(不按周重复)。前端已把这一周的课算好日期传来,
        整表覆盖保存——累加/去重由前端合并后一次性传全量。"""
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        try:
            m = await request.json()
            events = list(m.get("events") or [])
        except Exception:
            return web.json_response({"error": "参数不对"}, status=400)
        with open(self._schedule_file(request), "w", encoding="utf-8") as f:
            json.dump({"events": events, "at": time.strftime("%Y-%m-%d %H:%M:%S")},
                      f, ensure_ascii=False, indent=2)
        return web.json_response({"ok": True, "count": len(events)})

    # ---------- 课程(同名多节课合集)AI 分析:总结 / 考点 / 模拟卷 ----------
    def _course_session_ids(self, name, request=None):
        root = self._records_root()
        me = self._owner_id(request) if request is not None else None
        su = self._is_super(request) if request is not None else True
        out = []
        if not os.path.isdir(root):
            return out
        for d in sorted(os.listdir(root), reverse=True):
            mp = os.path.join(root, d, "meta.json")
            if not os.path.isfile(mp):
                continue
            try:
                meta = json.load(open(mp, encoding="utf-8"))
            except Exception:
                continue
            if not su and meta.get("owner") != me:   # 隔离:课程分析只汇总自己名下的课
                continue
            title = meta.get("title")
            if not title:
                m = re.match(r"^\d{4}-\d{2}-\d{2}_\d{4}_(.+)$", d)
                title = m.group(1) if m else d
            if course_base_name(title) == name:
                out.append(d)
        return out

    def _course_text(self, name, request=None, cap=45000):
        sids = self._course_session_ids(name, request)
        parts, boards = [], []
        for sid in sids:
            _, ls = self._load_lines(sid)
            if ls:
                parts.append("\n".join(l.get("text", "") for l in ls))
            try:
                from board import board_content
                bc = board_content(self._session_dir(sid), self.cfg)
                if bc and bc.strip():
                    boards.append(bc)
            except Exception:
                pass
        text = "\n\n".join(parts)[:cap]
        if boards:
            text += ("\n\n【以下是这门课各节的板书/PPT 识别内容(老师写在板书上的往往是重点)】\n"
                     + "\n".join(boards)[:12000])
        return text, len(sids)

    def _attach_exam_refs(self, name, result, request=None):
        """给每个考点找出这门课录音里相关的句子(哪节课/时间戳/秒),供前端点击跳播。"""
        stop = set("的与和及或了是在也就这那个之其所对把被让从向到")
        def cands(pt):
            s = "".join(c for c in (pt or "") if "一" <= c <= "鿿")
            gs = set()
            for n in (3, 2):
                for i in range(len(s) - n + 1):
                    g = s[i:i + n]
                    if not (set(g) & stop):
                        gs.add(g)
            return gs
        # 按节收集有序句子(要向后拼句)
        sess = {}
        for sid in self._course_session_ids(name, request):
            _, ls = self._load_lines(sid)
            sess[sid] = ls or []
        ENDERS = "。！？!?…"
        for p in result.get("points", []):
            cs = cands(p.get("name", ""))
            scored = []
            for sid, ls in sess.items():
                for idx, l in enumerate(ls):
                    txt = l.get("text", "")
                    sc = sum(len(g) for g in cs if g in txt)
                    if sc > 0:
                        sc += min(len(txt), 40) * 0.05   # 略偏好信息量大的句子,别老挑碎片
                        scored.append((sc, sid, idx))
            scored.sort(key=lambda x: -x[0])
            refs, seen = [], set()
            for sc, sid, idx in scored:
                ls = sess[sid]
                # 从命中句向后拼,直到句末标点 / 4 句 / 70 字
                parts, j = [], idx
                while j < len(ls) and j < idx + 4:
                    t = ls[j].get("text", "")
                    parts.append(t)
                    if (t and t[-1] in ENDERS) or sum(len(x) for x in parts) > 70:
                        break
                    j += 1
                start = ls[idx].get("start", 0)
                key = (sid, round(start, 1))
                if key in seen:
                    continue
                seen.add(key)
                refs.append({"sid": sid, "ts": ls[idx].get("ts", ""),
                             "start": round(start, 2), "text": "".join(parts)})
                if len(refs) >= 3:
                    break
            p["refs"] = refs
        return result

    def _course_cache_path(self, name, kind, request=None):
        d = os.path.join(self._records_root(), "course_cache")
        os.makedirs(d, exist_ok=True)
        safe = re.sub(r"[\\/:*?\"<>|]", "_", name)
        # 缓存也按账号分,别让一个账号的课程分析结果被另一个账号读到
        key = self._owner_key(request) if request is not None else "owner"
        import voiceprint
        who = "owner" if key in (None, "", "owner") else voiceprint._key_id(key)
        return os.path.join(d, f"{who}__{safe}.{kind}.json")

    async def _course_ai(self, request, kind, fn):
        """kind: summary/exam/mock;fn: course.py 里对应的生成函数。带文件缓存。"""
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        ds = DeepSeek(self.cfg)
        if not ds.ready:
            return web.json_response({"error": "没配 DeepSeek key"}, status=400)
        try:
            m = await request.json()
            name = (m.get("name") or "").strip()
            refresh = bool(m.get("refresh"))
            ai_only = bool(m.get("ai_only"))   # 没录音时,仅凭课名让 AI 生成
        except Exception:
            return web.json_response({"error": "参数不对"}, status=400)
        if not name:
            return web.json_response({"error": "缺少课程名"}, status=400)
        cache = self._course_cache_path(name, kind, request)
        if not refresh and os.path.exists(cache):
            try:
                return web.json_response(json.load(open(cache, encoding="utf-8")))
            except Exception:
                pass
        text, n = await asyncio.get_running_loop().run_in_executor(
            None, self._course_text, name, request)
        if not text.strip():
            if not ai_only:
                # 没转写内容:告诉前端可以走"纯AI一键生成",而不是直接报错
                return web.json_response({"no_transcript": True})
            content = (f"《{name}》这门大学课程暂无课堂录音。请仅根据你对这门课"
                       "常见教学大纲、重点概念、典型考点与题型的了解来完成任务。")
            n = 0
        else:
            content = text
        try:
            result = await asyncio.get_running_loop().run_in_executor(None, fn, content, name, ds)
        except Exception as e:
            return web.json_response({"error": f"AI 生成失败: {e}"}, status=500)
        if kind == "exam" and n > 0:
            result = self._attach_exam_refs(name, result, request)
        result["sessions"] = n
        result["ai_only"] = (n == 0)
        result["at"] = time.strftime("%Y-%m-%d %H:%M:%S")
        try:
            json.dump(result, open(cache, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        except Exception:
            pass
        return web.json_response(result)

    async def api_course_summary(self, request):
        from course import aggregate_summary
        return await self._course_ai(request, "summary", aggregate_summary)

    async def api_course_exam(self, request):
        from course import predict_exam
        return await self._course_ai(request, "exam", predict_exam)

    async def api_course_mock(self, request):
        from course import mock_exam
        return await self._course_ai(request, "mock", mock_exam)

    # ---------- 音频回放 ----------
    async def api_audio(self, request):
        """按 Range 分段返回 audio.wav——不支持 Range 的话进度条拖不动、
        手机上还会把整个几十兆先下完才开始播。"""
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        p = os.path.join(self._session_dir(request.match_info["sid"]), "audio.wav")
        dl = request.query.get("download")
        # 优先让浏览器直接从 OSS 拉(OSS 支持 Range,音频多半已下沉到 OSS、本地已删);
        # OSS 没有再回退本地;都没有才 404。
        url = self._oss_url(p, disposition=(dl or None))
        if url:
            return web.HTTPFound(url)
        if not os.path.exists(p):
            return web.json_response({"error": "这节课没有录音文件"}, status=404)
        headers = {"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600"}
        if dl:
            headers["Content-Disposition"] = "attachment"
        return web.FileResponse(p, headers=headers)

    # ---------- 全文搜索 ----------
    def _reindex_all(self):
        root = self._records_root()
        if not os.path.isdir(root):
            return 0
        def gen():
            for name in os.listdir(root):
                p = os.path.join(root, name, "transcript.jsonl")
                if not os.path.isfile(p):
                    continue
                # 编辑过的句子也要能搜到，所以索引的是叠加编辑后的结果
                d, lines = self._load_lines(name)
                if not lines:
                    continue
                ep = os.path.join(root, name, "edits.jsonl")
                mtime = os.path.getmtime(p) + (os.path.getmtime(ep) if os.path.exists(ep) else 0)
                yield name, mtime, lines
        return self.lib.reindex(gen())

    async def api_search(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        q = request.query.get("q", "")
        limit = min(int(request.query.get("limit", 50)), 200)
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self._reindex_all)
        results, total = await loop.run_in_executor(None, self.lib.search, q, limit)
        # 数据隔离:只留自己名下课的命中(索引是全局的,查询后按归属过滤)
        if not self._is_super(request):
            me = self._owner_id(request)
            results = [r for r in results if self._session_owner(r["sid"]) == me]
            total = len(results)
        # 补上课程名和日期，前端要按课分组
        meta_cache = {}
        for r in results:
            if r["sid"] not in meta_cache:
                mp = os.path.join(self._session_dir(r["sid"]), "meta.json")
                m = {}
                if os.path.exists(mp):
                    try:
                        with open(mp, encoding="utf-8") as f:
                            m = json.load(f)
                    except Exception:
                        m = {}
                meta_cache[r["sid"]] = m
            m = meta_cache[r["sid"]]
            r["title"] = m.get("title") or re.sub(r"^\d{4}-\d{2}-\d{2}_\d{4}_?", "", r["sid"]) or r["sid"]
            r["date"] = r["sid"][:10]
        return web.json_response({"results": results, "total": total, "q": q})

    # ---------- 复习：闪卡 / 自测 / 追问 ----------
    async def _lines_for(self, body):
        lines = body.get("lines")
        if lines:
            return lines
        sid = body.get("sid")
        if sid:
            _, lines = self._load_lines(sid)
            return lines or []
        return []

    async def api_study(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "请求不是合法 JSON"}, status=400)
        mode = body.get("mode", "flashcards")
        if mode not in ("flashcards", "quiz"):
            return web.json_response({"error": "mode 只能是 flashcards 或 quiz"}, status=400)
        if body.get("sid") and not self._owns_session(request, body["sid"]):
            return web.json_response({"error": "无权访问这节课"}, status=403)
        lines = await self._lines_for(body)
        if not lines:
            return web.json_response({"error": "这节课没有转写内容"}, status=400)
        ds = DeepSeek(self.cfg)
        if not ds.ready:
            return web.json_response({"error": "还没配 DeepSeek API key"}, status=503)
        try:
            out = await asyncio.get_running_loop().run_in_executor(
                None, ds.study, lines, mode, body.get("title"))
        except Exception as e:
            return web.json_response({"error": f"DeepSeek 调用失败：{e}"}, status=502)
        return web.json_response(out)

    async def api_ask(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        try:
            body = await request.json()
            question = str(body["question"]).strip()
        except Exception:
            return web.json_response({"error": "要有 question"}, status=400)
        if not question:
            return web.json_response({"error": "问题是空的"}, status=400)
        if body.get("sid") and not self._owns_session(request, body["sid"]):
            return web.json_response({"error": "无权访问这节课"}, status=403)
        lines = await self._lines_for(body)
        if not lines:
            return web.json_response({"error": "这节课没有转写内容"}, status=400)
        ds = DeepSeek(self.cfg)
        if not ds.ready:
            return web.json_response({"error": "还没配 DeepSeek API key"}, status=503)
        try:
            out = await asyncio.get_running_loop().run_in_executor(
                None, ds.ask, lines, question, body.get("history"), body.get("title"))
        except Exception as e:
            return web.json_response({"error": f"DeepSeek 调用失败：{e}"}, status=502)
        return web.json_response(out)

    # ---------- 板书截图 ----------
    async def api_shot_add(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        sid = request.match_info["sid"]
        if not os.path.isdir(self._session_dir(sid)):
            return web.json_response({"error": "没有这份记录"}, status=404)
        try:
            body = await request.json()
            data_url = body["image"]
            at = float(body.get("at", 0))
        except Exception:
            return web.json_response({"error": "要有 image（data URL）和 at（秒）"}, status=400)
        m = re.match(r"^data:image/(\w+);base64,(.+)$", data_url, re.S)
        if not m:
            return web.json_response({"error": "image 必须是 data:image/...;base64, 开头"}, status=400)
        import base64
        ext = "jpg" if m.group(1).lower() in ("jpeg", "jpg") else m.group(1).lower()
        try:
            raw = base64.b64decode(m.group(2))
        except Exception:
            return web.json_response({"error": "图片解码失败"}, status=400)
        item = self.lib.add_shot(sid, at, raw, ext, body.get("note", ""))
        item["url"] = f"/api/shot/{sid}/{item['file']}"
        return web.json_response(item)

    async def api_shots(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        sid = request.match_info["sid"]
        shots = [{**s, "url": f"/api/shot/{sid}/{s['file']}"} for s in self.lib.shots(sid)]
        return web.json_response({"shots": shots})

    async def api_shot_file(self, request):
        # 图片本身不校验令牌：<img src> 带不了自定义头，而路径本身不可猜
        sid = os.path.basename(request.match_info["sid"])
        name = os.path.basename(request.match_info["file"])
        p = os.path.join(self.lib.shots_dir(sid), name)
        if not os.path.isfile(p):
            return web.json_response({"error": "没有这张图"}, status=404)
        url = self._oss_url(p)
        if url:
            return web.HTTPFound(url)
        # 板书图片内容不变(文件名即内容),用强缓存 + immutable:
        # 重新挂载(比如结束录制切回转写页)时浏览器直接用缓存,不再重下 → 不闪。
        return web.FileResponse(p, headers={
            "Cache-Control": "public, max-age=31536000, immutable"})

    async def api_shot_delete(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        ok = self.lib.delete_shot(request.match_info["sid"], request.match_info["shot"])
        return web.json_response({"ok": ok})

    async def api_shot_note(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        body = await request.json()
        s = self.lib.update_shot(request.match_info["sid"], request.match_info["shot"],
                                 body.get("note", ""))
        return web.json_response(s or {"error": "没有这张图"}, status=200 if s else 404)

    # ---------- 课程分组 / 术语表 / 纠错表 ----------
    async def api_courses(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        me, su = self._owner_id(request), self._is_super(request)
        courses = [c for c in self.lib.courses() if su or c.get("owner") == me]
        my_cids = {c["id"] for c in courses}
        assign = {sid: cid for sid, cid in self.lib.load()["assign"].items() if cid in my_cids}
        return web.json_response({"courses": courses, "assign": assign})

    async def api_course_create(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        body = await request.json()
        return web.json_response(self.lib.add_course(body.get("name"), owner=self._owner_id(request)))

    def _owns_course(self, request, cid):
        if self._is_super(request):
            return True
        return self.lib.course_owner(cid) == self._owner_id(request)

    async def api_course_update(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        if not self._owns_course(request, request.match_info["cid"]):
            return web.json_response({"error": "无权修改这门课"}, status=403)
        body = await request.json()
        c = self.lib.update_course(request.match_info["cid"], body)
        return web.json_response(c or {"error": "没有这门课"}, status=200 if c else 404)

    async def api_course_delete(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        if not self._owns_course(request, request.match_info["cid"]):
            return web.json_response({"error": "无权删除这门课"}, status=403)
        self.lib.delete_course(request.match_info["cid"])
        return web.json_response({"ok": True})

    async def api_assign_course(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        # 只能把自己的课归到自己的课程下(sid 归属由 isolate 中间件已挡,这里再挡 course_id)
        body = await request.json()
        cid = body.get("course_id")
        if cid and not self._owns_course(request, cid):
            return web.json_response({"error": "无权使用这门课程"}, status=403)
        self.lib.assign(request.match_info["sid"], cid)
        return web.json_response({"ok": True})

    # ---------- 共享：生成只读链接 ----------
    def _shares_path(self):
        return os.path.join(self._records_root(), "shares.json")

    def _load_shares(self):
        p = self._shares_path()
        if not os.path.exists(p):
            return {}
        try:
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def _save_shares(self, data):
        os.makedirs(self._records_root(), exist_ok=True)
        with open(self._shares_path(), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    async def api_share(self, request):
        """给一节课生成只读分享链接。拿到链接的人不需要令牌，
        但**只能看这一节课的文字**，不能录音、不能看别的课、不能改。"""
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        try:
            body = await request.json()
        except Exception:
            body = {}
        sid = body.get("sid")
        if not sid or not os.path.isdir(self._session_dir(sid)):
            return web.json_response({"error": "没有这份记录"}, status=404)
        if not self._owns_session(request, sid):        # 只能分享自己的课
            return web.json_response({"error": "无权分享这节课"}, status=403)

        shares = self._load_shares()
        # 同一节课已经分享过就复用，别每点一次生成一个新链接
        for k, v in shares.items():
            if v.get("sid") == sid and not v.get("revoked"):
                return web.json_response({"id": k, **v})
        import secrets
        key = secrets.token_urlsafe(8)
        shares[key] = {"sid": sid, "created": time.strftime("%Y-%m-%d %H:%M:%S"),
                       "allow_download": bool(body.get("allow_download", True)),
                       "revoked": False}
        self._save_shares(shares)
        return web.json_response({"id": key, **shares[key]})

    async def api_share_list(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        return web.json_response({"shares": self._load_shares()})

    async def api_share_revoke(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        shares = self._load_shares()
        k = request.match_info["key"]
        if k in shares:
            shares[k]["revoked"] = True
            self._save_shares(shares)
        return web.json_response({"ok": True})

    async def api_shared(self, request):
        """只读访问，不校验令牌——这就是分享链接的意义。"""
        shares = self._load_shares()
        s = shares.get(request.match_info["key"])
        if not s or s.get("revoked"):
            return web.json_response({"error": "链接已失效"}, status=404)
        d, lines = self._load_lines(s["sid"])
        if lines is None:
            return web.json_response({"error": "记录已被删除"}, status=404)
        meta = {}
        mp = os.path.join(d, "meta.json")
        if os.path.exists(mp):
            with open(mp, encoding="utf-8") as f:
                meta = json.load(f)
        return web.json_response({"sid": s["sid"], "meta": meta, "lines": lines,
                                  "allow_download": s.get("allow_download", True)})

    # ---------- 启动 ----------
    def build(self):
        @web.middleware
        async def cors(request, handler):
            # 网页由本服务同源托管，正常不需要 CORS；留着是为了开发时
            # 前端跑在 Vite（localhost:3000）也能连。只放行本机来源。
            if request.method == "OPTIONS":
                resp = web.Response(status=204)
            else:
                resp = await handler(request)
            origin = request.headers.get("Origin", "")
            if any(origin.startswith(p) for p in
                   ("http://localhost", "https://localhost", "http://127.0.0.1", "https://127.0.0.1")):
                resp.headers["Access-Control-Allow-Origin"] = origin
                resp.headers["Access-Control-Allow-Headers"] = "content-type, x-token"
                resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            return resp

        @web.middleware
        async def guard(request, handler):
            # 被锁的 IP 一律挡掉，连页面都不给
            if self._locked(request):
                self._access_log(request, 429)
                return web.json_response({"error": "尝试次数过多，稍后再试"}, status=429)
            # 公网模式下，静态页面也要令牌——不然扫描器一眼就知道这跑的是什么
            # 公网模式下静态页也要令牌；但登录/注册/查身份、只读分享得留个门，
            # 否则新用户连登录页都打不开、没法拿到会话令牌
            _open = ("/api/shared/", "/api/login", "/api/register", "/api/me", "/health")
            if self.public_mode and self.token and not request.path.startswith(_open):
                if not self.check_token(request):
                    self._access_log(request, 401)
                    return web.json_response({"error": "需要访问令牌"}, status=401)
            resp = await handler(request)
            self._access_log(request, getattr(resp, "status", 0))
            return resp

        @web.middleware
        async def isolate(request, handler):
            # 数据隔离:凡是带 {sid} 的接口(转写/音频/板书/笔记/摘要/分课程…),
            # 登录用户只能碰自己名下的课;别人的课一律 403。令牌无效则交给下游返回 401。
            mi = request.match_info
            sid = mi.get("sid") if mi else None
            if sid and self._token_ok(request) and not self._owns_session(request, sid):
                self._access_log(request, 403)
                return web.json_response(
                    {"error": "无权访问这节课(数据按账号隔离)"}, status=403)
            return await handler(request)

        app = web.Application(middlewares=[guard, cors, isolate],
                              client_max_size=32 * 1024 * 1024)
        app.router.add_get("/ws", self.ws_handler)
        # /health 不校验令牌：设备要靠它判断服务在不在，泄露不了什么
        app.router.add_get("/health", lambda r: web.json_response(
            {"ok": True, "needs_token": bool(self.token),
             "deepseek": DeepSeek(self.cfg).ready}))
        # 账号：注册/登录/查身份/登出。前三个不需要令牌就能访问
        app.router.add_post("/api/register", self.api_register)
        app.router.add_post("/api/login", self.api_login)
        app.router.add_get("/api/me", self.api_me)
        app.router.add_post("/api/logout", self.api_logout)
        app.router.add_post("/api/summarize", self.api_summarize)
        app.router.add_get("/api/sessions", self.api_sessions)
        app.router.add_get("/api/transcript/{sid}", self.api_transcript)
        app.router.add_post("/api/transcript/{sid}/edit", self.api_edit_line)
        app.router.add_get("/api/transcript/{sid}/edits", self.api_edits)
        app.router.add_post("/api/transcript/{sid}/mark", self.api_mark_line)
        app.router.add_post("/api/transcript/{sid}/speaker", self.api_rename_speaker)
        app.router.add_get("/api/transcript/{sid}/note", self.api_get_note)
        app.router.add_post("/api/transcript/{sid}/note", self.api_save_note)
        app.router.add_post("/api/transcript/{sid}/summary", self.api_save_summary)
        app.router.add_get("/api/transcript/{sid}/summary", self.api_get_summary)
        app.router.add_post("/api/terms/learn", self.api_learn_term)
        app.router.add_post("/api/import/timetable", self.api_import_timetable)
        app.router.add_post("/api/import/shu", self.api_import_shu)
        app.router.add_get("/api/syllabus", self.api_syllabus_list)
        # 官方大纲(按学校)——静态段要在 {name} 之前注册,否则会被当成课程名
        app.router.add_get("/api/syllabus/schools", self.api_syllabus_schools)
        app.router.add_get("/api/syllabus/official/{school}/{course}", self.api_syllabus_official_pdf)
        app.router.add_get("/api/syllabus/page/{school}/{course}", self.api_syllabus_official_page)
        app.router.add_get("/api/syllabus/{name}", self.api_syllabus_get)
        app.router.add_get("/api/voices", self.api_voices)
        app.router.add_get("/api/voiceprints", self.api_voiceprints)
        app.router.add_post("/api/voiceprints", self.api_voiceprint_add)
        app.router.add_delete("/api/voiceprints/{id}", self.api_voiceprint_delete)
        app.router.add_get("/api/schedule", self.api_get_schedule)
        app.router.add_post("/api/schedule", self.api_save_schedule)
        app.router.add_post("/api/course/summary", self.api_course_summary)
        app.router.add_post("/api/course/exam", self.api_course_exam)
        app.router.add_post("/api/course/mock", self.api_course_mock)
        app.router.add_post("/api/share", self.api_share)
        app.router.add_get("/api/shares", self.api_share_list)
        app.router.add_post("/api/share/{key}/revoke", self.api_share_revoke)
        app.router.add_get("/api/shared/{key}", self.api_shared)   # 只读，无需令牌
        app.router.add_get("/api/audio/{sid}", self.api_audio)
        app.router.add_get("/api/search", self.api_search)
        app.router.add_post("/api/study", self.api_study)
        app.router.add_post("/api/ask", self.api_ask)
        app.router.add_post("/api/shot/{sid}", self.api_shot_add)
        app.router.add_get("/api/shots/{sid}", self.api_shots)
        app.router.add_get("/api/shot/{sid}/{file}", self.api_shot_file)
        app.router.add_delete("/api/shot/{sid}/{shot}", self.api_shot_delete)
        app.router.add_post("/api/shot/{sid}/{shot}/note", self.api_shot_note)
        app.router.add_get("/api/courses", self.api_courses)
        app.router.add_post("/api/courses", self.api_course_create)
        app.router.add_patch("/api/courses/{cid}", self.api_course_update)
        app.router.add_delete("/api/courses/{cid}", self.api_course_delete)
        app.router.add_post("/api/sessions/{sid}/course", self.api_assign_course)

        # 打包好的网页（手机/平板从这里打开）。没打包过就跳过，不影响本机使用。
        if os.path.isdir(WEBAPP_DIR):
            async def spa(request):
                rel = request.match_info.get("tail", "")
                p = os.path.normpath(os.path.join(WEBAPP_DIR, rel))
                if os.path.isfile(p) and p.startswith(WEBAPP_DIR):
                    # assets/* 文件名自带内容哈希,可永久强缓存;其它(尤其 index.html)必须每次
                    # 回源校验(no-cache),否则发了新版浏览器还卡在旧 bundle —— 之前"改名回溯
                    # 更新了但 Windows 上没生效"就是这个原因:旧 index.html 指着旧 JS。
                    if "/assets/" in ("/" + rel.replace(os.sep, "/")):
                        return web.FileResponse(p, headers={
                            "Cache-Control": "public, max-age=31536000, immutable"})
                    return web.FileResponse(p, headers={"Cache-Control": "no-cache"})
                return web.FileResponse(os.path.join(WEBAPP_DIR, "index.html"),
                                        headers={"Cache-Control": "no-cache"})
            app.router.add_get("/app", spa)
            app.router.add_get("/app/{tail:.*}", spa)

        # Word 加载项的静态文件（只有装了 Office 加载项才用）。服务器部署
        # （headless，没有 addin 目录）时跳过，不影响网页端 /app 使用。
        if os.path.isdir(ADDIN_DIR):
            app.router.add_static("/", ADDIN_DIR, show_index=True)
        return app


def main():
    app_obj = App()
    # 环境变量可覆盖 host/port（放 nginx 反代后面时用 LC_HOST=127.0.0.1 LC_PORT=5900
    # 退到内部端口，不用改 config.json，rsync 也不会冲掉）
    port = int(os.environ.get("LC_PORT") or app_obj.cfg["server"]["port"])
    host = os.environ.get("LC_HOST") or app_obj.cfg["server"].get("host", "0.0.0.0")
    # 优先用正规证书(acme.sh 装到 certs/live.crt+live.key，公网域名用，浏览器不报警）；
    # 没有就回落到 netcert 自签（局域网/IP 直连用）。
    real_crt = os.path.join(HERE, "certs", "live.crt")
    real_key = os.path.join(HERE, "certs", "live.key")
    if os.path.exists(real_crt) and os.path.exists(real_key):
        crt, key, ips = real_crt, real_key, []
        print(f"  证书:        正规证书 {real_crt}")
    else:
        crt, key, ips = netcert.ensure_cert()
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(crt, key)
    app = app_obj.build()

    async def on_start(_):
        app_obj.loop = asyncio.get_running_loop()
        asyncio.create_task(app_obj.ticker())
        tk = ("?token=" + app_obj.token) if app_obj.token else ""
        print("\n课堂字幕服务已启动")
        print(f"  本机控制台:  https://localhost:{port}/panel.html")
        if os.path.isdir(WEBAPP_DIR):
            print(f"  网页(本机):  https://localhost:{port}/app/course{tk}")
            for ip in ips:
                print(f"  网页(手机):  https://{ip}:{port}/app/course{tk}")
            if not ips:
                print("  （没检测到内网 IP，可能没连 WiFi）")
        else:
            print("  网页还没打包：在 frontend 目录里跑一次打包")
            print("      BASE_PATH=/app/ npm run build")
        if app_obj.token:
            print(f"  访问令牌:    {app_obj.token}   （手机第一次打开要填，之后记住）")
        print(f"  记录目录:    {os.path.normpath(os.path.join(HERE, app_obj.cfg['server']['records_dir']))}")
        print(f"  监听:        {host}:{port}"
              + ("（局域网可访问）" if host == "0.0.0.0" else "（仅本机）"))
        print("  手机第一次打开会提示证书不受信任——这是本机自签的证书，选「继续访问」。")
        print("  关掉这个窗口就停止服务。\n")

    app.on_startup.append(on_start)
    try:
        web.run_app(app, host=host, port=port, ssl_context=ctx,
                    print=None, access_log=None)
    except OSError as e:
        # 10048 = WSAEADDRINUSE。最常见的原因是上一次的服务还开着（那个黑窗口没关，
        # 或者之前是隐藏启动的）。别甩一屏 traceback，说人话。
        if getattr(e, "errno", None) not in (10048, 98):
            raise
        print(f"\n端口 {port} 已经被占用了。")
        print("多半是**这个服务已经在运行**——上一个黑窗口可能还开着，或者在后台跑着。")
        print(f"  · 想用已经在跑的那个：直接打开 https://localhost:{port}/panel.html")
        print("  · 想重来一遍：先把占用它的进程关掉，命令是")
        print(f"      Get-Process python | Stop-Process -Force")
        print(f"  · 确认是谁占着： netstat -ano | findstr :{port}")
        print(f"  · 或者改 service\\config.json 里的 server.port 换个端口。\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
