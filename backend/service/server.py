# -*- coding: utf-8 -*-
r"""Real-time classroom subtitle service.

One process does three things:
  1. HTTPS-hosts the Word add-in web page (task pane)
  2. WebSockets recognition results to Word in real time
  3. Capture -> VAD segmentation -> speaker -> recognition -> highlighting -> disk

Even if Word isn't connected, recording and transcription keep running and
keep saving to disk -- no more "the plugin died and the whole class was wasted".

Start:  ..\scripts\start.ps1
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
    from word_com import WordWriter          # only present on Windows + Word
except Exception:                             # absent on Linux servers, so disable the write-to-Word path
    WordWriter = None
# word_com is importable on Mac/Linux (the Windows-only code lives inside methods, via ctypes.windll),
# so the try above can't disable it. Always disable on non-Windows, or enabling "write to Word" crashes the thread and hangs startup.
if sys.platform != "win32":
    WordWriter = None
from summarize import DeepSeek
from library import Library
from accounts import Accounts
import recordings_db
import netcert

HERE = os.path.dirname(os.path.abspath(__file__))
ADDIN_DIR = os.path.normpath(os.path.join(HERE, "..", "addin"))
WEBAPP_DIR = os.path.normpath(os.path.join(HERE, "..", "..", "frontend", "out"))
TOKEN_FILE = os.path.join(HERE, "token.txt")


def load_config():
    with open(os.path.join(HERE, "config.json"), encoding="utf-8") as f:
        return json.load(f)


# ---------- Personalization feedback: keep accumulating user-corrected terms into records/learned_terms.json ----------
def _learned_terms_file(cfg, key=None):
    # Per-account file (learned_terms_<keyid>.json) so one user's homophone corrections don't get applied
    # to everyone. The owner / global token keeps the original shared path.
    root = os.path.normpath(os.path.join(HERE, cfg["server"]["records_dir"]))
    if key in (None, "", "owner"):
        return os.path.join(root, "learned_terms.json")
    import voiceprint
    return os.path.join(root, f"learned_terms_{voiceprint._key_id(key)}.json")


def load_learned_terms(cfg, key=None):
    p = _learned_terms_file(cfg, key)
    if not os.path.exists(p):
        return []
    try:
        with open(p, encoding="utf-8") as f:
            return list(json.load(f).get("terms") or [])
    except Exception:
        return []


def add_learned_term(cfg, term, key=None):
    """Record a term this account corrected (>=2 chars, deduped) so its later sessions auto-fix the homophone."""
    term = (term or "").strip()
    if len(term) < 2:
        return False
    p = _learned_terms_file(cfg, key)
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
    tmp = p + ".part"                       # write atomically so a concurrent read never sees a truncated file
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, p)
    return True


def course_base_name(title):
    """Strip numbering like "Lesson N/Lecture N/Section N/(N)" to get the base course name. Matches the frontend."""
    t = (title or "").strip()
    t = re.sub(r"\s*第\s*\d+\s*[课讲节]\s*$", "", t)
    t = re.sub(r"\s*[（(]\s*\d+\s*[）)]\s*$", "", t)
    return t.strip()


def speaker_name(idx):
    if idx == 0:
        return "老师"          # whoever speaks first and speaks the most in a class is almost certainly the teacher
    return "同学" + "ABCDEFG"[(idx - 1) % 7]


def ts(sec):
    s = int(sec)
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


class Session:
    """One class session."""

    def __init__(self, cfg, loop, emit, title=None, device=None, loopback=False,
                 to_word=False, word_doc="active", append_sid=None, user_key=None):
        self.cfg = cfg
        self.user_key = user_key   # owning account -> per-account learned terms / voiceprint library
        self.loop = loop
        self.emit = emit           # thread-safe broadcast function
        self.title = title
        self.device = device
        self.loopback = loopback
        # to_word: the server writes to Word directly via COM (the browser console uses this path).
        # the Office add-in path has the task pane write via Office.js itself; don't enable both, or it writes twice.
        self.to_word = bool(to_word)
        self.word_doc = word_doc
        self.only_key = False      # only write key lines into Word (the record file always keeps everything)
        self.word = None
        self.corrections = []      # this course's fixed typo corrections, applied right after recognition
        self.course_id = None
        self.course_name = None    # course name when bound, used as subject context for AI correction (more reliable than a hand-typed title)
        self.subjects = []         # selected subject tags (Advanced Mathematics/College Physics...), used as context for AI correction/translation
        self.user_key = None       # which account this recording belongs to -- decides which private voiceprint library to use/write
        self.ai_correct = False    # DeepSeek real-time correction (fixes homophone typos), toggled from the frontend
        self.corrector = None
        self.correct_pool = None
        # English subtitles: when English is recognized (or in an English class), asynchronously translate to Chinese and attach under the line
        self.translate_from = 'zh'   # live translation source language (原文); off when from == to
        self.translate_to = 'zh'     # live translation target language (译文)
        self.translate_wu = False   # Shanghainese (Wu) backend: auto-translate each line to Mandarin subtitles
        self.translator = None
        self.translate_pool = None
        # DeepSeek smart segmentation: merge VAD fragments into complete sentences by meaning (toggled from the frontend, whole-sentence mode only)
        self.smart_seg = False
        self.segmenter_ds = None
        self.seg_pool = None
        self._seg_frags = []       # buffer: fragments not yet formed into sentences [{text,start,end,sid,gap,conf}]
        self._seg_lock = threading.Lock()
        self._seg_busy = False
        self._seg_stopping = False   # stopping: in-flight segmentation workers must not emit anymore (avoids hanging on stop / writing to a closed file)
        self._emit_lock = threading.Lock()   # serialize emission (worker thread vs stop thread)
        self._trans_lock = threading.Lock()  # serialize read-modify-write of translations.json (concurrent translation pool)

        # homophone term correction: locally fix homophone errors (a correct term transcribed as a same-sounding wrong one) using the term list.
        # terms come from asr.terms + asr.hotwords; effective on any backend (SenseVoice/Paraformer/whisper).
        self.tfix = None
        try:
            from term_fix import TermFixer
            a = cfg["asr"]
            terms = list(a.get("terms") or [])
            hw = a.get("hotwords")
            terms += hw.split() if isinstance(hw, str) else list(hw or [])
            # personalization feedback: terms this account learned from past one-click corrections (per-account,
            # so one user's corrections never leak into everyone else's recognition)
            terms += load_learned_terms(cfg, self.user_key)
            if terms:
                self.tfix = TermFixer(terms)
        except Exception as e:
            print(f"⚠️ 同音术语纠正未启用: {e}")

        # two mutually exclusive paths: streaming (the model segments as it listens) or VAD segmentation + whole-sentence recognition
        self.streaming = bool(cfg["asr"].get("streaming")) and \
            cfg["asr"].get("backend") == "zipformer"
        # Shanghainese backend: output is in Wu characters; auto-translate each line to Mandarin and attach below as subtitles
        self.translate_wu = cfg["asr"].get("backend") == "wenet_ctc"
        self.seg = None if self.streaming else Segmenter(cfg)
        self.sasr = None
        self.spk = SpeakerID(cfg)
        self.hl = Highlighter(cfg)
        self.asr = ASRWorker(cfg, self._on_text, self._on_status)
        records_root = os.path.normpath(os.path.join(HERE, cfg["server"]["records_dir"]))
        # resume recording: append to an existing session (audio/transcript continue, line numbers and timestamps stay continuous)
        self.t_offset = 0.0
        existing_dir = None
        start_line_id = 0
        if append_sid:
            d = os.path.join(records_root, os.path.basename(append_sid))
            if os.path.isdir(d):
                existing_dir = d
                self._rehydrate_for_append(d, records_root)   # if old files were offloaded to OSS, pull them back locally first
                start_line_id, last_end = self._scan_transcript(d)
                self.t_offset = self._audio_duration(d) or last_end
        self.rec = Recorder(records_root, title=title,
                            save_wav=cfg["server"]["save_wav"], existing_dir=existing_dir)
        self.cap = None
        self.names = {}            # {speaker_id: custom name}
        self.running = False
        # shift t0 back by t_offset so elapsed / total duration stay continuous after resuming (blackboard shots aligned by second stay in place)
        self.t0 = time.time() - self.t_offset
        self.line_id = start_line_id
        self.last_speaker = None
        self.para_chars = 0        # how many characters the current paragraph has written
        self.para_start = None     # start second of the current paragraph
        self.pending_key = 0       # manual highlighting: mark the next/previous line
        self.last_line_id = None   # id of the most recently emitted line; manual "mark key" tags it (the line just spoken)
        self.paused = False
        self.dev_info = {}

    # ---------- resume helpers ----------
    @staticmethod
    def _rehydrate_for_append(session_dir, records_root):
        """Before resuming, if the old transcript/audio was offloaded to OSS and isn't local, pull it back from OSS first."""
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
        """Read the old transcript and return (max line number, last line's end second), for continuing numbering/time on resume."""
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
        """Stable id of the account this recording belongs to (logged-in user = email hash, global token = owner).
        Uses a hash rather than plaintext email, so writing to meta/owner.json and syncing to OSS doesn't leak the account email."""
        from voiceprint import _key_id
        k = self.user_key
        return "owner" if k in (None, "", "owner") else _key_id(k)

    # ---------- lifecycle ----------
    def start(self):
        # ownership marker: write owner.json as soon as recording starts -- this session's meta isn't persisted until stop,
        # meanwhile the frontend fetches this session's notes/blackboard shots; without the marker, data isolation would wrongly block it with 403 (and log the user out).
        try:
            with open(os.path.join(self.rec.dir, "owner.json"), "w", encoding="utf-8") as f:
                json.dump({"owner": self._owner_id()}, f)
        except Exception:
            pass
        # sync metadata into PG (for indexing; files remain the source of truth). Failure doesn't affect recording.
        try:
            recordings_db.upsert_recording(
                os.path.basename(self.rec.dir),
                owner=self._owner_id(),
                created=time.strftime("%Y-%m-%d %H:%M:%S"))
        except Exception:
            traceback.print_exc()
        # load the cross-session voiceprint library: when a labeled voice is recognized, use its identity automatically
        try:
            import voiceprint
            root = os.path.normpath(os.path.join(HERE, self.cfg["server"]["records_dir"]))
            self.spk.set_library(voiceprint.load_library(root, self.user_key),
                                 self.cfg["speaker"].get("voiceprint_threshold", self.cfg["speaker"]["threshold"]))
        except Exception:
            pass
        if self.ai_correct:
            self.corrector = DeepSeek(self.cfg)
            self.correct_pool = ThreadPoolExecutor(max_workers=6, thread_name_prefix="aicorrect")
        if self.translate_from != self.translate_to or self.translate_wu:
            ds = DeepSeek(self.cfg)
            if ds.ready:
                self.translator = ds
                self.translate_pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="translate")
        # smart segmentation runs only in whole-sentence (VAD) mode; streaming already segments itself. Without DeepSeek configured, it falls back to one line per fragment.
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
            # audio is pushed from the web page (phone/tablet mic, or the page's captured "system audio"); no local mic
            self.cap = audio_mod.BrowserCapture(self._on_status)
        else:
            self.cap = audio_mod.Capture(self.device, self.loopback,
                                         self.cfg["audio"]["gain"], self._on_status,
                                         agc=self.cfg["audio"].get("agc"))
        self.dev_info = self.cap.start()
        self.running = True
        # resume: shift t0 back by t_offset so elapsed/total duration stay continuous and blackboard shots align by second (don't overwrite with a bare time.time())
        self.t0 = time.time() - self.t_offset
        threading.Thread(target=self._pump, daemon=True, name="segment").start()
        return {"model_load_s": round(load_s, 1), **self.dev_info,
                "speaker_error": self.spk.err, "word": word_info}

    def stop(self):
        self.running = False
        self._seg_stopping = True    # in-flight segmentation workers stop emitting from now on, so shutdown isn't held up by them
        if self.cap:
            self.cap.stop()
        tail = (self.sasr or self.seg).flush()
        if tail is not None:
            self._dispatch(tail)
        time.sleep(0.3)
        self.asr.stop()
        # smart segmentation: don't wait on in-flight DeepSeek calls (or stop would hang for a dozen seconds); _seg_stopping is already set,
        # so when that worker returns it won't emit either. Just flush the not-yet-formed fragments in the buffer one by one, don't lose the last half-sentence.
        if self.seg_pool is not None:
            self.seg_pool.shutdown(wait=False)
            self._seg_flush_all()
        if self.correct_pool is not None:
            self.correct_pool.shutdown(wait=False)   # drop unfinished corrections; don't hold up stopping
        if self.translate_pool is not None:
            self.translate_pool.shutdown(wait=False)  # drop unfinished translations
        if self.word is not None:
            self.word.close()
        meta = {
            "title": self.title,
            "owner": self._owner_id(),       # this session's owning account (a hash, no plaintext email) -- data isolation filters by it
            # persist the selected subject tags (Advanced Mathematics/College Physics...), used for tag-based aggregation; on stop, meta is written to both meta.json and PG
            "tags": [t for t in (self.subjects or []) if isinstance(t, str) and t.strip()],
            "duration_s": round(time.time() - self.t0, 1),
            "lines": self.line_id,   # after resuming, this is the cumulative total line count
            "device": self.dev_info,
            "backend": self.cfg["asr"].get("backend", "whisper"),
            "streaming": self.streaming,
            "model": self.cfg["asr"]["model"],
            "rtf": round((self.sasr.rtf if self.streaming else self.asr.rtf), 2),
            "speakers": [{**s, "name": self.name_of(s["id"])} for s in self.spk.stats()],
        }
        # register each speaker voiceprint captured this time into the global dedup library: the same person (regardless of session/account) is stored only once.
        try:
            import voiceprint
            root = os.path.normpath(os.path.join(HERE, self.cfg["server"]["records_dir"]))
            # Hold the registry lock across the whole load -> register-batch -> save. Many sessions end at
            # once (a class period finishing); without this each thread loads its own snapshot and the last
            # save wins, silently discarding the other sessions' newly-registered voiceprints.
            with voiceprint._REG_LOCK:
                reg = voiceprint.load_registry(root)
                for s in self.spk.stats():
                    emb = self.spk.centroid_of(s["id"])
                    if emb is not None:
                        voiceprint.register(root, emb, seconds=s.get("seconds", 0), reg=reg)
                voiceprint.save_registry(root, reg)
        except Exception:
            traceback.print_exc()
        return self.rec.finish(meta), meta

    # ---------- capture -> segmentation ----------
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
            # the streaming path already finished recognition inside push, so go straight to the emit logic
            self._on_text(utt, meta, utt.text, utt.proc_s)
        else:
            self.asr.submit(utt, meta)

    # ---------- recognition result -> Word ----------
    def _on_text(self, utt, meta, text, proc_s):
        # first apply homophone term correction (mapping/range/derivative...), then this course's fixed corrections.
        # both paths (the whole-sentence ASRWorker callback and the direct streaming call) go through here, so one place covers all.
        if self.tfix is not None:
            text, _ = self.tfix.fix(text)
        # fixed errors like "Green's formula" being misheard as "Green Company" are corrected here in one pass,
        # so what's written to the doc, saved to disk, and highlighted afterward is all the corrected text.
        if self.corrections:
            text = Library.apply_corrections(text, self.corrections)
        text = (text or "").strip()
        if not text:
            return
        sid = meta["speaker_id"]
        conf = round(meta.get("speaker_conf", 0), 3)
        # smart segmentation on (and recording) -> buffer first, let DeepSeek merge into whole sentences by meaning before emitting;
        # otherwise each VAD fragment becomes a line directly (the old behavior).
        if self.smart_seg and self.seg_pool and self.segmenter_ds and self.running:
            self._seg_feed(text, utt.start, utt.end, sid, utt.gap_before, conf)
        else:
            self._emit_line(text, utt.start, utt.end, sid, utt.gap_before, conf, proc_s)

    def _emit_line(self, text, start, end, sid, gap, conf, proc_s=0.0):
        """Write a line (possibly merged from multiple fragments) to disk and push it to the frontend. line_id/paragraph state are maintained here.
        Serialized with a lock: the smart-segmentation worker thread and the stop wrap-up thread may call it concurrently.
        If a paragraph contains multiple sentences (already carrying sentence-ending punctuation), split it line by line at each sentence end -- the content is unchanged.
        (Split only on full-width sentence-ending marks and half-width !?, not on the half-width period ., to avoid breaking things like 3.14.)"""
        sents = [s.strip() for s in re.findall(r"[^。！？!?]*[。！？!?]|[^。！？!?]+", text or "")]
        sents = [s for s in sents if s]
        with self._emit_lock:
            if len(sents) <= 1:
                self._emit_line_locked(text, start, end, sid, gap, conf, proc_s)
            else:
                for i, s in enumerate(sents):
                    self._emit_line_locked(s, start, end, sid,
                                           gap if i == 0 else 0.0, conf,
                                           proc_s if i == 0 else 0.0)

    def _emit_line_locked(self, text, start, end, sid, gap, conf, proc_s=0.0):
        p = self.cfg["paragraph"]
        speaker_changed = (self.last_speaker is not None and sid != self.last_speaker)
        # some teachers talk for over ten minutes without pausing, and relying on pauses alone would produce one giant paragraph,
        # so add two more gates: a max character count and a max duration per paragraph.
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
        off = self.t_offset          # resume: append to the old timeline (off=0 when a new session starts from 0)
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
        # AI real-time correction: emit the original instantly, then asynchronously let DeepSeek fix homophone typos and push line_update when done
        if self.ai_correct and self.correct_pool and self.corrector and self.corrector.ready:
            self.correct_pool.submit(self._ai_correct, rec["id"], rec["ts"], text)
        # Translation subtitle line, attached below the original. Wu backend always translates to Mandarin;
        # otherwise translate from translate_from into translate_to (skipped when the two are equal).
        if self.translate_wu:
            if self.translate_pool and text.strip():
                self.translate_pool.submit(self._translate_line, rec["id"], text, 'wu', 'zh')
        elif self.translate_from != self.translate_to:
            if self.translate_pool and self._should_translate_lang(text, self.translate_from):
                self.translate_pool.submit(self._translate_line, rec["id"], text, self.translate_from, self.translate_to)

    # ---------- DeepSeek smart segmentation ----------
    _SEG_NORM = re.compile(r"[^一-鿿A-Za-z0-9]+")
    SEG_FORCE_FRAGS = 12       # too many buffered fragments and still no sentence -> force emit fragment by fragment (safety valve)
    SEG_FORCE_CHARS = 140

    @classmethod
    def _norm_seg(cls, s):
        return cls._SEG_NORM.sub("", s or "")

    def _seg_feed(self, text, start, end, sid, gap, conf):
        with self._seg_lock:
            # speaker changed: definitely a sentence boundary; force-emit what's buffered first, don't merge two people's words into one sentence
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
        self.emit({"type": "partial", "text": buf})   # live preview of the content being accumulated for this line
        self._seg_flush_maybe()

    def _seg_flush_maybe(self):
        if not self.running:
            return   # during shutdown, _seg_flush_all handles the wrap-up; don't submit tasks to the (soon-to-close) thread pool
        with self._seg_lock:
            if self._seg_busy or not self._seg_frags:
                return
            n = len(self._seg_frags)
            chars = sum(len(f["text"]) for f in self._seg_frags)
            # once sentence-ending punctuation appears in the buffer -> emit immediately (_emit_line splits on punctuation), no more waiting for DeepSeek;
            # only hand off to smart segmentation while there's no sentence-ending punctuation yet (a half-sentence). The character/count safety valves still backstop.
            buf_has_end = bool(re.search(r"[。！？!?]", "".join(f["text"] for f in self._seg_frags)))
            if buf_has_end or n >= self.SEG_FORCE_FRAGS or chars >= self.SEG_FORCE_CHARS:
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
            self._seg_flush_maybe()   # new fragments may have accumulated during processing

    def _seg_apply(self, snapshot, out):
        commit_texts = []
        if isinstance(out, dict) and isinstance(out.get("commit"), list):
            commit_texts = [(c.get("text") or "").strip()
                            for c in out["commit"] if (c.get("text") or "").strip()]
        if not commit_texts:
            return
        # don't trust the n DeepSeek reports (it miscounts); instead, strip punctuation from each merged sentence and greedily match it back against the leading fragments,
        # to determine how many fragments each sentence actually consumed. If it doesn't line up, drop the whole batch (better to skip this round than misalign/lose/duplicate text).
        norm = [self._norm_seg(f["text"]).lower() for f in snapshot]
        groups = []
        i = 0
        for s in commit_texts:
            target = self._norm_seg(s).lower()
            if not target:
                continue
            acc, j = "", i
            while j < len(snapshot) and len(acc) < len(target):
                acc += norm[j]
                j += 1
            # exact content match: the merged sentence with punctuation stripped must be character-for-character identical to the consumed fragments (DeepSeek may only add punctuation).
            # if DeepSeek drops/changes characters or breaks mid-fragment causing misalignment, drop the whole batch ->
            # fall back to one line per fragment; rather not merge than lose content (fixes "the first half of the sentence was dropped").
            if j == i or acc != target:
                return
            groups.append((i, j))
            i = j
        if not groups:
            return
        consumed = i
        with self._seg_lock:
            if self._seg_stopping:
                return   # recording is ending; _seg_flush_all handles the wrap-up, workers must not emit anymore
            # concurrency check: the leading `consumed` fragments in the buffer must still be the ones from the snapshot (aligned by start)
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
        """On stop, emit the not-yet-formed fragments one by one; don't lose content."""
        with self._seg_lock:
            frags = self._seg_frags
            self._seg_frags = []
        for f in frags:
            self._emit_line(f["text"], f["start"], f["end"], f["sid"], f["gap"], f["conf"])
        if frags:
            self.emit({"type": "partial", "text": ""})

    # a generic default course name like "Class 08-01 21:30" carries no subject info; don't let it mislead correction
    _GENERIC_TITLE = re.compile(r"^课程\s*\d{1,2}-\d{1,2}\s*\d{1,2}:\d{2}$")

    def _correction_topic(self):
        """Subject context for AI correction/translation: prefer the selected subject tags, then the bound course name, then a non-generic hand-typed title."""
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

    def _should_translate_lang(self, text, from_lang):
        """Whether this line carries enough content in the source language to be worth translating.
        Kept lenient — a session is normally spoken in one language — while filtering empty/mismatched lines."""
        t = (text or "").strip()
        if len(t) < 1:
            return False
        if from_lang == 'zh':
            zh = sum(1 for c in t if "一" <= c <= "鿿")
            return zh >= 2
        if from_lang in ('en', 'fr', 'de', 'it'):
            # Latin letters, incl. accented ones (Latin-1/Latin Extended)
            latin = sum(1 for c in t if c.isalpha() and (c.isascii() or ord(c) < 0x250))
            if latin < 6:
                return False
            # In a non-English class, only translate lines that are mostly Latin (avoid translating stray words)
            if from_lang == 'en' and not self._course_is_english():
                zh = sum(1 for c in t if "一" <= c <= "鿿")
                return latin >= zh
            return True
        if from_lang == 'ja':
            ja = sum(1 for c in t if "぀" <= c <= "ヿ" or "一" <= c <= "鿿")
            return ja >= 1
        if from_lang == 'ko':
            ko = sum(1 for c in t if "가" <= c <= "힣")
            return ko >= 1
        return len(t) >= 2

    def _translations_path(self):
        return os.path.join(self.rec.dir, "translations.json")

    def _translate_line(self, line_id, text, from_lang='en', to_lang='zh'):
        try:
            if from_lang == 'wu':
                out = self.translator.translate_wu_to_mandarin(text, topic=self._correction_topic())
            else:
                out = self.translator.translate_general(text, from_lang, to_lang, topic=self._correction_topic())
        except Exception as e:
            print(f"[translate] line {line_id} 出错: {e}", flush=True)
            return
        print(f"[translate] line {line_id}: {text[:30]!r} -> {out[:30]!r}", flush=True)
        if not out:
            return
        self.emit({"type": "line_translation", "id": line_id, "text": out})
        # persist: {line number: Chinese translation}, reattached when reloading the transcript. Concurrent translation pool, guarded with a lock + atomic temp-file replace to prevent loss/corruption.
        with self._trans_lock:
            try:
                p = self._translations_path()
                data = {}
                if os.path.exists(p):
                    with open(p, encoding="utf-8") as f:
                        data = json.load(f)
                data[str(line_id)] = out
                tmp = p + ".part"
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False)
                os.replace(tmp, p)
            except Exception:
                pass

    def _ai_correct(self, line_id, ts, text):
        # Cloud dialect model (fun-asr-realtime, backend aliyun_funasr) already outputs Mandarin but it can read
        # rough, so polish it into standard Mandarin; for every other backend, fix homophone typos as before.
        dialect = self.cfg["asr"].get("backend") == "aliyun_funasr"
        try:
            if dialect:
                fixed = self.corrector.polish_dialect(text, topic=self._correction_topic())
            else:
                fixed = self.corrector.correct(text, topic=self._correction_topic())
        except Exception:
            return
        if not fixed or fixed == text:
            return
        # push to the frontend to replace that line
        self.emit({"type": "line_update", "id": line_id, "text": fixed})
        # persist: record an edit so reloading the transcript shows the corrected/polished text
        try:
            rec = {"at": time.strftime("%Y-%m-%d %H:%M:%S"), "line_id": line_id,
                   "before": text, "after": fixed, "by": ("方言润色" if dialect else "AI纠错"), "ts": ts}
            with open(os.path.join(self.rec.dir, "edits.jsonl"), "a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        except Exception:
            pass

    def _on_status(self, msg):
        self.emit({"type": "notice", "msg": str(msg)})

    def _apply_merges(self):
        """When voiceprints determine "these two are actually the same person", also update the names already written in the document.

        Merging shifts all later ids down, so the custom-name mapping must move with them, or a renamed
        speaker would point at someone else after the merge.
        """
        for frm, to in self.spk.take_merges():
            old, new = self.name_of(frm), self.name_of(to)
            names = {}
            for k, v in self.names.items():
                if k == frm:
                    continue          # the merged-away one's custom name is discarded, following the one it merged into
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

    # ---------- miscellaneous ----------
    def name_of(self, sid):
        # manual rename > identity matched from the voiceprint library > default "Teacher/Student N"
        return self.names.get(sid) or self.spk.match_name(sid) or speaker_name(sid)

    def rename(self, sid, name):
        old = self.name_of(sid)
        self.names[int(sid)] = name
        if self.word is not None:
            self.word.rename(old, name)   # also replace the names already written in the document
        self._persist_speaker_name(int(sid), name)   # persist, so reviewing after recording ends also shows the new name
        self._remember_voice(int(sid), name)   # save into this account's voiceprint library so the same person is recognized automatically next time
        return old

    def _persist_speaker_name(self, sid, name):
        """Write names changed during recording into speaker_names.json so they take effect uniformly by speaker_id after stop (the same file as REST rename)."""
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
        """When a speaker is renamed during recording -> write their voiceprint center + name for this session into this account's private voiceprint library,
        so this account auto-uses this name next time it records the same voiceprint. Default names (Teacher/Student N) aren't stored."""
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
            # refresh this session's matching library so newly appearing speakers with the same voiceprint are recognized instantly too
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
        # each client (cid) gets its own independent session, isolated from others. Keyed by cid (not ws) so that
        # reconnection can recover: when the WS drops, don't end immediately, enter a grace period; a reconnect with the same cid keeps recording, losing no transcript.
        #   self.sessions[cid] = {"s": Session, "ws": ws or None, "detached_at": float or None}
        self.sessions = {}
        self.cid_user = {}        # {cid: voiceprint-library account id} -- computed from the token at connect time, used when recording starts / renaming
        self.cid_admin = {}       # {cid: bool} -- whether this connection's account is an admin; computed at connect (handle_cmd has no request in scope)
        self.max_sessions = int(self.cfg["server"].get("max_sessions", 8))
        self.detach_grace = int(self.cfg["server"].get("detach_grace_s", 90))
        self.loop = None
        self.token = self._load_token()
        records_dir = os.path.normpath(
            os.path.join(HERE, self.cfg["server"]["records_dir"]))
        self.lib = Library(records_dir)
        self.accounts = Accounts(records_dir)
        self._fails = {}          # {source IP: {n, until, first}} token brute-force protection
        self._reg_codes = {}      # {email: {code, exp, tries, sent}} registration email verification codes
        self._reg_ip = {}         # {ip: [send timestamps]} per-IP throttle for the code-send endpoint (anti mail-bomb)
        self.access_log_path = os.path.join(
            os.path.normpath(os.path.join(HERE, self.cfg["server"]["records_dir"])), "access.log")
        # when exposed to the public internet, keep everything behind the token (not even the page itself is served),
        # a scanner only sees 401 and can't tell what's running here
        self.public_mode = bool(self.cfg["server"].get("public", False))

    def _load_token(self):
        """The service listens on the LAN, so it needs a gatekeeper. Auto-generated on first startup, fixed thereafter."""
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
        """Send a message to a connection from any thread (thread-safe). Recognition runs in worker threads and uses this to get back to the main loop."""
        if self.loop is None or ws is None or ws.closed:
            return
        data = json.dumps(msg, ensure_ascii=False)
        self.loop.call_soon_threadsafe(
            lambda: asyncio.ensure_future(self._safe_send(ws, data)))

    def _emit_to_cid(self, cid):
        """Build an emit for a cid -- dynamically fetch the ws currently bound to that session (swapped to a new ws after reconnect).
        During the disconnect grace period ws is None and messages are dropped (the transcript still persists, resuming on reconnect)."""
        def emit(msg):
            ent = self.sessions.get(cid)
            if ent and ent.get("ws") is not None:
                self._send_soon(ent["ws"], msg)
        return emit

    # ---------- WebSocket ----------
    async def ws_handler(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        # cid: client id (the frontend stores it in localStorage). Used to recover one's own session on reconnect.
        cid = request.query.get("cid") or secrets.token_urlsafe(6)
        # which account this connection belongs to -> decides which private voiceprint library to use/write (needed for starting recording and renaming mid-recording)
        self.cid_user[cid] = self._user_key_for_token(self._req_token(request))
        self.cid_admin[cid] = self.is_admin(request)   # remember admin status here; handle_cmd has no request
        ws = web.WebSocketResponse(heartbeat=20, max_msg_size=8 * 1024 * 1024)
        await ws.prepare(request)

        # another connection with the same cid is still recording (dropped within the grace period) -> recover: attach the session to this new connection
        resumed = False
        ent = self.sessions.get(cid)
        if ent and ent.get("s") is not None and ent["s"].running:
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
                    # mic audio pushed from the web page (16k mono Int16) -> fed into this cid's session
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
            # connection dropped: **don't end immediately**. If recording, enter a grace period (detach); a reconnect with the same cid recovers it;
            # when the grace period expires, the ticker wraps up and persists. If not recording, just clean it up.
            ent = self.sessions.get(cid)
            if ent and ent["ws"] is ws:
                if ent.get("s") is not None and ent["s"].running:
                    ent["ws"] = None
                    ent["detached_at"] = time.time()
                else:
                    # not recording (or still just a reserved slot) -> free it
                    self.sessions.pop(cid, None)
        return ws

    async def handle_cmd(self, m, ws, cid):
        cmd = m.get("cmd")
        emit = self._emit_to_cid(cid)            # send only to this cid's current connection
        ent = self.sessions.get(cid)
        sess = ent["s"] if ent else None         # this client's own session

        if cmd == "devices":
            await ws.send_str(json.dumps(
                {"type": "devices", "devices": audio_mod.list_devices()}, ensure_ascii=False))

        elif cmd == "start":
            if sess and sess.running:
                return
            # protect the server: cap concurrent sessions. Count both running sessions AND ones still
            # loading ("starting"), then reserve THIS slot synchronously below. Without the reservation,
            # many concurrent starts all read below the cap during the awaited model load (s.start) and
            # blow past max_sessions -- the guard would fail exactly when it matters most.
            running = sum(1 for e in self.sessions.values()
                          if e.get("starting") or (e.get("s") is not None and e["s"].running))
            if running >= self.max_sessions:
                emit({"type": "error",
                      "msg": f"服务器繁忙（已有 {running} 路转写在跑），稍后再试"})
                return
            # reserve the slot now (synchronously, before any await) so the count above already includes us
            self.sessions[cid] = {"s": None, "ws": ws, "detached_at": None, "starting": True}
            # each session reads its own config copy, avoiding parameter clobbering when classes start concurrently
            cfg = load_config()
            for k in ("backend", "streaming", "model", "cpu_threads", "beam_size"):
                if m.get(k) is not None:
                    cfg["asr"][k] = m[k]
            # Regular users may only use the cloud models; force any local backend to cloud Mandarin.
            # Admins keep full choice. This is the server-side guard behind the UI restriction.
            if not self.cid_admin.get(cid, False) and cfg["asr"].get("backend") not in ("aliyun_paraformer", "aliyun_funasr"):
                cfg["asr"]["backend"] = "aliyun_paraformer"
                cfg["asr"]["streaming"] = False
            if m.get("new_para_gap_ms") is not None:
                cfg["paragraph"]["new_para_gap_ms"] = int(m["new_para_gap_ms"])
            # pickup sensitivity: varies with environment and distance, so tune this on site
            for k in ("threshold", "exit_threshold", "min_speech_ms"):
                if (m.get("vad") or {}).get(k) is not None:
                    cfg["vad"][k] = m["vad"][k]

            emit({"type": "notice", "msg": "正在加载识别模型…"})
            # resume can only append to your own sessions: someone else's append_sid is ignored, falling back to a new session.
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
                        append_sid=append_sid, user_key=user_key)
            s.user_key = user_key                       # this recording's owning account -> private voiceprint library + data isolation
            s.only_key = bool(m.get("only_key"))
            s.ai_correct = bool(m.get("ai_correct"))    # AI real-time correction toggle
            s.smart_seg = bool(m.get("smart_seg"))      # AI smart segmentation toggle
            # live translation subtitles: source/target language codes; off when equal.
            _valid_langs = ('zh', 'en', 'fr', 'de', 'it', 'ja', 'ko')
            tf = m.get("translate_from")
            tt = m.get("translate_to")
            if not tf and not tt:   # back-compat with the old translate_mode / translate_en boolean
                _old = m.get("translate_mode") or ('en2zh' if m.get("translate_en") else 'off')
                tf, tt = {'en2zh': ('en', 'zh'), 'zh2en': ('zh', 'en')}.get(_old, ('zh', 'zh'))
            s.translate_from = tf if tf in _valid_langs else 'zh'
            s.translate_to = tt if tt in _valid_langs else 'zh'
            s.subjects = [x.strip() for x in (m.get("subjects") or [])
                          if isinstance(x, str) and x.strip()]   # selected subject tags
            print(f"[start] ai_correct={s.ai_correct} smart_seg={s.smart_seg} "
                  f"translate={s.translate_from}->{s.translate_to}", flush=True)
            # if a course is selected, use that course's term list and correction list
            course_id = m.get("course_id")
            if course_id:
                course = next((c for c in self.lib.courses() if c["id"] == course_id), None)
                # only recognize your own courses (someone else's course_id is ignored); owner stores a hash id
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
            self.sessions[cid]["s"] = s                  # fill the slot we reserved above
            try:
                info = await asyncio.get_running_loop().run_in_executor(None, s.start)
            except Exception:
                self.sessions.pop(cid, None)             # start failed -> free the reserved slot
                raise
            self.sessions[cid].update({"detached_at": None, "starting": False})
            # hand out the sid at start: capturing blackboard shots during recording needs it to know where to store them
            emit({"type": "started", **info, "dir": s.rec.dir,
                  "sid": os.path.basename(s.rec.dir)})

        elif cmd == "stop":
            if sess:
                self.sessions.pop(cid, None)
                path, meta = await asyncio.get_running_loop().run_in_executor(None, sess.stop)
                if sess.course_id:
                    self.lib.assign(os.path.basename(path), sess.course_id)
                # after meta.json is persisted, sync into PG (title/duration_s/owner/course_id)
                try:
                    recordings_db.upsert_recording(
                        os.path.basename(path),
                        title=meta.get("title"),
                        owner=meta.get("owner"),
                        duration_s=meta.get("duration_s"),
                        course_id=sess.course_id or None,
                        meta=meta)
                except Exception:
                    traceback.print_exc()
                # the session is already removed from the table and _emit_to_cid can't find it -> send directly to this connection
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
                # backfill: apply this name to the same person (matched by voiceprint) across all past sessions too (runs in the background, doesn't block recording)
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
                    # mark "the line just spoken" (more intuitive), persist to marks.json and have the frontend turn it yellow
                    sid = os.path.basename(sess.rec.dir)
                    self._save_mark(sid, sess.last_line_id, "key")
                    emit({"type": "line_update", "id": sess.last_line_id, "kind": "key"})
                    emit({"type": "notice", "msg": "已把刚才那句标为重点"})
                else:
                    sess.pending_key = 1        # nothing emitted yet -> fall back to marking the next line
                    emit({"type": "notice", "msg": "下一句标为重点"})

        elif cmd == "status":
            await ws.send_str(json.dumps(
                sess.status() if sess else {"type": "status", "running": False},
                ensure_ascii=False))

    # ---------- heartbeat ----------
    async def ticker(self):
        while True:
            await asyncio.sleep(1.0)
            now = time.time()
            for cid, ent in list(self.sessions.items()):
                s = ent.get("s")
                if s is None:
                    continue                       # a reserved-but-not-yet-started slot; nothing to tick yet
                if ent["ws"] is not None and s.running:
                    self._send_soon(ent["ws"], s.status())   # has a connection: push status
                elif ent["detached_at"] and now - ent["detached_at"] > self.detach_grace:
                    # disconnected past the grace period with no reconnect -> wrap up, persist, and free resources
                    self.sessions.pop(cid, None)
                    try:
                        await asyncio.get_running_loop().run_in_executor(None, s.stop)
                    except Exception:
                        traceback.print_exc()

    # ---------- tokens ----------
    def check_token(self, request):
        """The service listens on the LAN (or even the public internet), and any device that can reach it can send requests.
        Without this token, anyone could use your computer to record from the mic and browse all your class records."""
        if not self.token:
            return True
        got = (request.query.get("token")
               or request.headers.get("X-Token")
               or "")
        ok = secrets.compare_digest(got, self.token) if got else False
        # also accept logged-in users' session tokens -- registering/logging in is authentication, no need to copy the global token
        if not ok and got and self.accounts.session_user(got):
            ok = True
        if not ok:
            self._note_fail(request)
        return ok

    def is_admin(self, request):
        """Admin authorization: the global token (owner) or a logged-in user with role=admin. Voiceprint-library management is admin-only."""
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
        """Token -> that account's voiceprint-library id. Global token (owner) = owner (reusing the old global library);
        logged-in user = their own email (one private library per account); otherwise None."""
        if not token:
            return None
        if self.token and secrets.compare_digest(token, self.token):
            return "owner"
        u = self.accounts.session_user(token)
        return (u.get("email") or u.get("name")) if u else None

    def _req_user_key(self, request):
        return self._user_key_for_token(self._req_token(request))

    # ---------- data isolation: an account can only view/edit its own sessions, courses, and timetable ----------
    def _owner_key(self, request):
        """Which account a request belongs to: logged-in user = email, global token (owner) = owner. Data ownership/isolation is based on this."""
        return self._req_user_key(request)

    @staticmethod
    def _to_owner_id(key):
        """Account id -> the stable ownership id used on disk (email hash, no plaintext leak). Global token = owner."""
        from voiceprint import _key_id
        return "owner" if key in (None, "", "owner") else _key_id(key)

    def _owner_id(self, request):
        return self._to_owner_id(self._owner_key(request))

    def _is_super(self, request):
        """Global-token owner: the machine's owner, who can access all data across accounts (ordinary logged-in users don't get this token)."""
        return self._owner_key(request) == "owner"

    def _token_ok(self, request):
        """Check whether a token is valid without side effects (used in middleware, so it doesn't trigger the brute-force counter)."""
        got = self._req_token(request)
        if not got:
            return False
        if self.token and secrets.compare_digest(got, self.token):
            return True
        return bool(self.accounts.session_user(got))

    def _session_owner(self, sid):
        """Read a session's owning account id: check meta.json first (persisted after stop), then owner.json
        (written at the start of recording). If neither exists (old data), return None."""
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
        """Whether a session can be accessed: the global token sees everything; a logged-in user only sees their own sessions."""
        if self._is_super(request):
            return True
        if not sid or not os.path.isdir(self._session_dir(sid)):
            return False
        return self._session_owner(sid) == self._owner_id(request)

    # ---------- three things required once exposed to the public internet ----------
    def _client_ip(self, request):
        # with port forwarding, remote is the real source; only behind a reverse proxy do you need X-Forwarded-For
        fwd = request.headers.get("X-Forwarded-For", "")
        return (fwd.split(",")[0].strip() if fwd else None) or (request.remote or "?")

    def _note_fail(self, request):
        """Record a token error. Anyone brute-forcing tokens gets locked out."""
        ip = self._client_ip(request)
        now = time.time()
        rec = self._fails.get(ip, {"n": 0, "until": 0.0, "first": now})
        if now - rec["first"] > 600:            # reset the count after 10 minutes with no errors
            rec = {"n": 0, "until": 0.0, "first": now}
        rec["n"] += 1
        if rec["n"] >= 8:
            # 8 wrong tries in a row locks for 15 minutes, doubling with each further error, up to 6 hours
            lock = min(900 * (2 ** (rec["n"] - 8)), 6 * 3600)
            rec["until"] = now + lock
            print(f"[安全] {ip} 令牌连错 {rec['n']} 次，锁定 {int(lock/60)} 分钟")
        self._fails[ip] = rec

    def _locked(self, request):
        rec = self._fails.get(self._client_ip(request))
        return bool(rec and rec["until"] > time.time())

    def _access_log(self, request, status):
        """Keep an access log. Once exposed to the public internet, there must be a record of who hit your service and when."""
        try:
            line = (f"{time.strftime('%Y-%m-%d %H:%M:%S')}\t{self._client_ip(request)}\t"
                    f"{request.method}\t{request.path}\t{status}\n")
            with open(self.access_log_path, "a", encoding="utf-8") as f:
                f.write(line)
        except Exception:
            pass    # a failed log write must not affect the service

    # ---------- accounts ----------
    def _bearer(self, request):
        return (request.query.get("token") or request.headers.get("X-Token") or "")

    async def api_register_code(self, request):
        """Registration step one: send a 6-digit code to the given email. Already-registered emails are blocked outright."""
        import mailer
        try:
            m = await request.json()
            email = (m.get("email") or "").strip().lower()
        except Exception:
            return web.json_response({"error": "参数不对"}, status=400)
        if not email or "@" not in email or "." not in email.split("@")[-1]:
            return web.json_response({"error": "邮箱格式不对"}, status=400)
        try:
            if self.accounts.exists(email):
                return web.json_response({"error": "这个邮箱已经注册过了,直接登录即可"}, status=409)
        except Exception:
            pass
        if not mailer.ready():
            return web.json_response({"error": "服务端还没配置邮件服务,暂时无法发送验证码"}, status=503)
        now = time.time()
        # Evict expired codes so the dict can't grow without bound (each never-completed signup left one forever).
        self._reg_codes = {e: r for e, r in self._reg_codes.items() if now < r.get("exp", 0)}
        # Per-IP throttle so this token-less endpoint can't be used to mail-bomb arbitrary addresses
        # or burn the sender's reputation: at most 8 sends per hour from one IP.
        ip = self._client_ip(request)
        hits = [t for t in self._reg_ip.get(ip, []) if now - t < 3600]
        if len(hits) >= 8:
            return web.json_response({"error": "发送太频繁了,请稍后再试"}, status=429)
        rec = self._reg_codes.get(email)
        if rec and now - rec.get("sent", 0) < 60:
            return web.json_response({"error": "验证码刚发过,请 1 分钟后再试"}, status=429)
        code = f"{secrets.randbelow(1000000):06d}"
        self._reg_codes[email] = {"code": code, "exp": now + 600, "tries": 0, "sent": now}
        try:
            await asyncio.get_running_loop().run_in_executor(None, mailer.send_code, email, code)
        except Exception as e:
            self._reg_codes.pop(email, None)   # send failed: drop the code so the user can retry immediately
            return web.json_response({"error": f"验证码发送失败:{e}"}, status=502)
        hits.append(now)
        self._reg_ip[ip] = hits
        return web.json_response({"ok": True})

    async def api_register(self, request):
        """Registration step two: create the account after verifying the email code. The role is always forced to user, never letting a registrant self-declare as admin."""
        try:
            m = await request.json()
            email = (m.get("email") or "").strip().lower()
            code = (m.get("code") or "").strip()
            rec = self._reg_codes.get(email)
            now = time.time()
            if not rec or now > rec.get("exp", 0):
                return web.json_response({"error": "验证码已过期,请重新获取"}, status=400)
            if rec.get("tries", 0) >= 5:
                return web.json_response({"error": "验证码错误次数过多,请重新获取"}, status=429)
            if not code or code != rec.get("code"):
                rec["tries"] = rec.get("tries", 0) + 1
                return web.json_response({"error": "验证码不对"}, status=400)
            # force role to user -- admins can only be set manually in the database by the owner.
            # run in a thread: pbkdf2 hashing (600k iters) + blocking psycopg would otherwise stall the loop.
            loop = asyncio.get_running_loop()
            token, user = await loop.run_in_executor(
                None, self.accounts.register, m.get("email"), m.get("name"), m.get("password"))
            self._reg_codes.pop(email, None)   # burn after use
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
            # run in a thread: pbkdf2 verification is CPU-heavy (600k iters) and psycopg is blocking;
            # doing it inline would stall the event loop (and every live WS) when many log in at once.
            loop = asyncio.get_running_loop()
            token, user = await loop.run_in_executor(
                None, self.accounts.login, m.get("email"), m.get("password"))
            return web.json_response({"token": token, "user": user})
        except ValueError as e:
            self._note_fail(request)          # a wrong password also counts as a failure, to prevent brute-forcing
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

    # ---------- HTTP endpoints ----------
    async def api_summarize(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "请求不是合法 JSON"}, status=400)

        # reading someone else's session from the server by sid/dir would be a privilege escalation -- isolate it. The case where the frontend supplies its own lines is unaffected.
        ref_sid = body.get("sid") or (os.path.basename(body["dir"]) if body.get("dir") else None)
        if ref_sid and not self._owns_session(request, ref_sid):
            return web.json_response({"error": "无权访问这节课"}, status=403)
        lines = body.get("lines") or []
        if not lines:
            # if no transcript is provided, read the one stored on the server
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
        # recognize this session's blackboard shots and fold them into the summary
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
                None, ds.summarize, lines, body.get("title"), board, body.get("lang") or "zh-Hans")
        except Exception as e:
            return web.json_response({"error": f"DeepSeek 调用失败：{e}"}, status=502)
        return web.json_response(out)

    async def api_sessions(self, request):
        """List the class records stored on this machine, for the web history page."""
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        root = os.path.normpath(os.path.join(HERE, self.cfg["server"]["records_dir"]))
        me = self._owner_id(request)
        su = self._is_super(request)         # the global-token owner sees everything
        # the list now reads from the recordings table (index) instead of scanning meta.json per directory; data isolation filters by the table's owner.
        # reconstruct the old response from the stored full meta: entry = {"id": name, "dir": d, **meta}, then layer the summary on top.
        out = []
        for r in recordings_db.list_recordings(owner=me, superuser=su):
            sid = r["sid"]
            entry = {"id": sid, "dir": os.path.join(root, sid), **(r.get("meta") or {})}
            if r.get("has_summary") or r.get("summary"):
                entry["summary"] = r.get("summary", "")
                entry["key_points"] = r.get("key_points", [])
                entry["has_summary"] = bool(r.get("summary"))
            out.append(entry)
        return web.json_response({"sessions": out})

    # ---------- records: read / edit / edit history ----------
    def _records_root(self):
        return os.path.normpath(os.path.join(HERE, self.cfg["server"]["records_dir"]))

    def _session_dir(self, sid):
        return os.path.join(self._records_root(), os.path.basename(sid))

    def _oss_url(self, local_path, disposition=None, inline=False, content_type=None):
        """If a local file has a matching object on OSS, return its signed direct link (for a 302 redirect), else None.
        inline=True + content_type is for PDF preview: force inline display so the browser doesn't download it as an attachment."""
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
        """Read a file under records: read local if present; if not (content offloaded to OSS and deleted locally), fetch from OSS."""
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
        """Read the transcript and layer all past edits over it (the original file stays untouched, edits stored separately)."""
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
        # manual marks (key/define/clear) override kind -- stored in marks.json, the original transcript untouched
        marks = self._load_marks(sid)
        for l in lines:
            key = str(l.get("id"))
            if key in marks:
                l["kind"] = marks[key]      # may be "key"/"define"/None
        # speaker rename (override the name by speaker_id) -- stored in speaker_names.json, the original transcript untouched.
        # renames during and after recording both write here, so every line from this speaker is changed consistently.
        names = self._load_speaker_names(sid)
        if names:
            for l in lines:
                nm = names.get(str(l.get("speaker_id")))
                if nm:
                    l["speaker"] = nm
        # English subtitles: reattach the Chinese translations from translations.json to their lines
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

    # ---------- manual key/define marks (marks.json, works live and in history) ----------
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
        """kind in {'key','define',None}. None means clearing the mark (force no highlight)."""
        p = self._marks_path(sid)
        marks = self._load_marks(sid)
        marks[str(line_id)] = kind
        with open(p, "w", encoding="utf-8") as f:
            json.dump(marks, f, ensure_ascii=False, indent=2)

    # ---------- speaker rename (speaker_names.json, editable during and after recording) ----------
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
            names.pop(str(speaker_id), None)   # empty value = clear the custom name and restore the default
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(names, f, ensure_ascii=False, indent=2)
        os.replace(tmp, p)

    def _propagate_name(self, owner_id, name, embedding, exclude_sid=None):
        """Rename backfill: apply name to speakers matching this person's voiceprint across **all past sessions** of the account,
        so that "renaming once also renames the same person in the past". Compares on the fly using each session's cached speakers.json, and returns how many sessions were changed."""
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
        # snapshot to a list first: this runs in a worker thread while the event loop mutates self.sessions,
        # so iterating .values() directly can raise "dictionary changed size during iteration".
        skip = {os.path.basename(ent["s"].rec.dir) for ent in list(self.sessions.values())
                if ent.get("s") is not None}       # skip the session currently recording (handled by live rename)
        if exclude_sid:
            skip.add(os.path.basename(exclude_sid))   # the session being renamed here isn't counted in the "backfill" total
        changed = 0
        for sname in os.listdir(root):
            d = os.path.join(root, sname)
            if not os.path.isdir(d) or sname in skip:
                continue
            if self._session_owner(sname) != owner_id:    # only backfill your own sessions
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
        """Rename a speaker in a session (used after recording; during recording use the WS rename). Overrides by speaker_id,
        so every line from this person is changed consistently; records the voiceprint+name into this account's voiceprint library; and **backfills the same person across all past sessions**."""
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
        # learn the voiceprint + backfill history (both run in the thread pool, so the request isn't blocked)
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
                # backfill scope = this session's owning account (usually the requester; when the global token acts on their behalf, it still backfills under that account)
                n = self._propagate_name(self._session_owner(sid), name, sp["embedding"],
                                         exclude_sid=sid)
                return True, n
            try:
                learned, propagated = await asyncio.get_running_loop().run_in_executor(None, work)
            except Exception:
                traceback.print_exc()
        return web.json_response({"ok": True, "speaker_id": speaker_id, "name": name,
                                  "learned_voiceprint": learned, "propagated_sessions": propagated})

    # ---------- class notes (one note.txt per session) ----------
    async def api_get_note(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        if not self._owns_session(request, request.match_info["sid"]):
            return web.json_response({"error": "无权访问这节课"}, status=403)
        p = os.path.join(self._session_dir(request.match_info["sid"]), "note.txt")
        raw = self._read_bytes(p)
        text = raw.decode("utf-8") if raw else ""
        return web.json_response({"note": text})

    async def api_save_note(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        sid = request.match_info["sid"]
        if not self._owns_session(request, sid):
            return web.json_response({"error": "无权访问这节课"}, status=403)
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
        if not self._owns_session(request, sid):
            return web.json_response({"error": "无权访问这节课"}, status=403)
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
        sid = request.match_info["sid"]
        if not self._owns_session(request, sid):
            return web.json_response({"error": "无权访问这节课"}, status=403)
        d, lines = self._load_lines(sid)
        if lines is None:
            return web.json_response({"error": "没有这份记录"}, status=404)
        return web.json_response({"dir": d, "lines": lines})

    async def api_edit_line(self, request):
        """Edit one transcript line. The original file is never touched; edits are only appended to edits.jsonl --
        so the "edit history" is real and traceable, not a fake panel."""
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        sid = request.match_info["sid"]
        if not self._owns_session(request, sid):
            return web.json_response({"error": "无权访问这节课"}, status=403)
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
        if not self._owns_session(request, request.match_info["sid"]):
            return web.json_response({"error": "无权访问这节课"}, status=403)
        return web.json_response({"edits": list(reversed(self._load_edits(request.match_info["sid"])))})

    # ---------- AI summary: save / read (persisted to summary.json, visible on refresh and in the list) ----------
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
        if not self._owns_session(request, sid):
            return web.json_response({"error": "无权访问这节课"}, status=403)
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
            "applied": list(m.get("applied") or []),   # errors already fixed with one click; the frontend uses this to hide the entry
            "at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        with open(self._summary_path(sid), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
        # sync the summary into PG (summary/key_points/has_summary); files remain the source of truth
        try:
            recordings_db.upsert_recording(
                os.path.basename(sid),
                summary=data["summary"],
                key_points=data["key_points"],
                has_summary=bool(data["summary"]))
        except Exception:
            traceback.print_exc()
        return web.json_response({"ok": True, **data})

    async def api_get_summary(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        if not self._owns_session(request, request.match_info["sid"]):
            return web.json_response({"error": "无权访问这节课"}, status=403)
        return web.json_response(self._load_summary(request.match_info["sid"]) or {})

    async def api_learn_term(self, request):
        """Personalization feedback: after the user one-click-fixes a homophone error, learn the "correct term",
        so later sessions' term_fix auto-corrects this error. Returns whether something new was learned + the current learned-term count."""
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        try:
            m = await request.json()
        except Exception:
            return web.json_response({"error": "参数不对"}, status=400)
        key = self._req_user_key(request)   # learn per-account, not globally
        added = add_learned_term(self.cfg, m.get("term"), key)
        return web.json_response({"ok": True, "added": added,
                                  "count": len(load_learned_terms(self.cfg, key))})

    async def api_import_timetable(self, request):
        """Timetable screenshot -> local OCR -> DeepSeek structures it into a course list. The image never leaves the server."""
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

    # ---------- reference material: course syllabus ----------
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
        """Return the official syllabus catalog for a school (course names/titles only; PDFs go through the proxy endpoint)."""
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
        """Fetch and cache a school-course's official PDF, then return it inline."""
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        from syllabus_official import cache_pdf
        school = request.match_info["school"]
        course = request.match_info["course"]
        local = await asyncio.get_running_loop().run_in_executor(
            None, cache_pdf, self._records_root(), school, course)
        if not local or not os.path.exists(local):
            return web.json_response({"error": "拿不到这门课的官方 PDF"}, status=404)
        # syllabus PDFs are served inline straight from local (small, reference material, never offloaded to OSS).
        # not via OSS: the bucket forces Content-Disposition: attachment on private objects and ignores inline overrides,
        # which turns the browser preview into a download. A local FileResponse fully controls the inline header.
        return web.FileResponse(local, headers={"Content-Type": "application/pdf",
                                                 "Content-Disposition": "inline"})

    async def api_syllabus_official_page(self, request):
        """Web official syllabus: fetch the remote HTML, inject <base>, and return it inline (for iframe preview)."""
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
        # no charset, so the page's own <meta charset> decides the encoding (some are GBK)
        return web.Response(body=data, content_type="text/html")

    # ---------- voiceprints: past voices / voiceprint library ----------
    def _voice_embedder(self):
        """A SpeakerID for voiceprint extraction (lazily loaded and reused, not part of live sessions)."""
        if getattr(self, "_vp_spk", None) is None:
            from speaker import SpeakerID
            self._vp_spk = SpeakerID(self.cfg)
        return self._vp_spk

    async def api_voices(self, request):
        """List voices from past recordings: those judged to be the same person are **grouped into one entry** (not listed per session). Computed on the fly and cached to speakers.json."""
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
                    if matched:   # already in the library -> put under "recognized", no longer listed as pending labeling
                        recognized[matched["name"]] = recognized.get(matched["name"], 0) + 1
                    else:
                        raw.append({"sid": name, "idx": sp["idx"], "seconds": sp.get("seconds", 0),
                                    "name": sp.get("name", ""), "sample_start": sp.get("sample_start", 0),
                                    "embedding": sp.get("embedding") or []})
            clusters = []
            for cl in voiceprint.cluster_voices(raw, cluster_th):
                rep = max(cl["members"], key=lambda m: m.get("seconds", 0))   # use the longest segment as the representative (for preview/name)
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
        """Save a voice into the library and name it. body: {name, embedding} (the merged cluster center, preferred) or {name, sid, idx}."""
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
        # fallback: fetch on the fly by sid/idx
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
        """Auto-login to SHU's academic system + scrape the timetable (Playwright). The password is only used to log in and never persisted."""
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

    # ---------- timetable (weekly recurring classes, stored in schedule.json, for calendar import) ----------
    def _schedule_file(self, request):
        """Timetables are isolated per account: one schedule_<account>.json per account; the global token reuses the old schedule.json."""
        key = self._owner_key(request)
        if key in (None, "", "owner"):
            return os.path.join(self._records_root(), "schedule.json")
        import voiceprint
        return os.path.join(self._records_root(), f"schedule_{voiceprint._key_id(key)}.json")

    # ---------- per-account small storage: tags, settings (all follow the account, stored on the server) ----------
    def _account_file(self, request, base):
        key = self._owner_key(request)
        if key in (None, "", "owner"):
            return os.path.join(self._records_root(), f"{base}.json")
        import voiceprint
        return os.path.join(self._records_root(), f"{base}_{voiceprint._key_id(key)}.json")

    def _read_account_json(self, request, base, default):
        p = self._account_file(request, base)
        if not os.path.exists(p):
            return default
        try:
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return default

    def _write_account_json(self, request, base, data):
        with open(self._account_file(request, base), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    async def api_get_tags(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        return web.json_response({"tags": self._read_account_json(request, "tags", None)})

    async def api_save_tags(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        try:
            tags = list((await request.json()).get("tags") or [])
        except Exception:
            return web.json_response({"error": "参数不对"}, status=400)
        self._write_account_json(request, "tags", tags)
        return web.json_response({"ok": True, "count": len(tags)})

    async def api_get_settings(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        return web.json_response({"settings": self._read_account_json(request, "settings", None)})

    async def api_save_settings(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        try:
            settings = dict((await request.json()).get("settings") or {})
        except Exception:
            return web.json_response({"error": "参数不对"}, status=400)
        self._write_account_json(request, "settings", settings)
        return web.json_response({"ok": True})

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
        """Store dated course events (not weekly-recurring). The frontend has already computed this week's dates and sends them,
        saving by overwriting the whole table -- accumulation/dedup is merged by the frontend and sent as one full payload."""
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

    # ---------- course (a collection of same-named sessions) AI analysis: summary / exam points / mock paper ----------
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
            if not su and meta.get("owner") != me:   # isolation: course analysis only aggregates your own sessions
                continue
            title = meta.get("title")
            if not title:
                m = re.match(r"^\d{4}-\d{2}-\d{2}_\d{4}_(.+)$", d)
                title = m.group(1) if m else d
            if course_base_name(title) == name:
                out.append(d)
        return out

    def _session_ids_by_tag(self, tag, request=None):
        """Aggregate by subject tag: select sessions whose meta.tags (a list) contain the tag; isolation same as _course_session_ids."""
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
            if not su and meta.get("owner") != me:   # isolation: only aggregate your own sessions
                continue
            tags = meta.get("tags")
            if isinstance(tags, list) and tag in tags:
                out.append(d)
        return out

    def _course_text(self, name, request=None, cap=45000, tag=None):
        sids = (self._session_ids_by_tag(tag, request) if tag
                else self._course_session_ids(name, request))
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

    def _attach_exam_refs(self, name, result, request=None, tag=None):
        """For each exam point, find related sentences in this course's recordings (which session/timestamp/second), so the frontend can click to jump-play.
        In tag mode, take sessions under the tag; otherwise take same-named sessions."""
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
        # collect ordered sentences per session (for forward-joining sentences)
        sess = {}
        sids = (self._session_ids_by_tag(tag, request) if tag
                else self._course_session_ids(name, request))
        for sid in sids:
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
                        sc += min(len(txt), 40) * 0.05   # slightly prefer information-rich sentences, don't always pick fragments
                        scored.append((sc, sid, idx))
            scored.sort(key=lambda x: -x[0])
            refs, seen = [], set()
            for sc, sid, idx in scored:
                ls = sess[sid]
                # join forward from the matched sentence until sentence-ending punctuation / 4 sentences / 70 characters
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

    def _course_cache_path(self, name, kind, request=None, tag=None):
        d = os.path.join(self._records_root(), "course_cache")
        os.makedirs(d, exist_ok=True)
        # tag-based aggregation uses a separate cache key (tag_ prefix) to avoid colliding with the same-named course cache
        base = f"tag_{tag}" if tag else name
        safe = re.sub(r"[\\/:*?\"<>|]", "_", base)
        # the cache is also partitioned by account, so one account's course-analysis results aren't read by another
        key = self._owner_key(request) if request is not None else "owner"
        import voiceprint
        who = "owner" if key in (None, "", "owner") else voiceprint._key_id(key)
        return os.path.join(d, f"{who}__{safe}.{kind}.json")

    async def _course_ai(self, request, kind, fn):
        """kind: summary/exam/mock; fn: the corresponding generator function in course.py. With file caching."""
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        ds = DeepSeek(self.cfg)
        if not ds.ready:
            return web.json_response({"error": "没配 DeepSeek key"}, status=400)
        try:
            m = await request.json()
            name = (m.get("name") or "").strip()
            tag = (m.get("tag") or "").strip()   # if tag is given, aggregate by subject tag; otherwise by same-named course
            refresh = bool(m.get("refresh"))
            ai_only = bool(m.get("ai_only"))   # with no recordings, let the AI generate from just the course name/tag
            lang = m.get("lang") or "zh-Hans"   # UI language for the generated text
        except Exception:
            return web.json_response({"error": "参数不对"}, status=400)
        if not name and not tag:
            return web.json_response({"error": "缺少课程名或标签"}, status=400)
        label = tag or name   # used as the subject name for the AI / the title in the cache and prompt
        cache = self._course_cache_path(name, f"{kind}_{lang}", request, tag=tag or None)   # cache per language
        if not refresh and os.path.exists(cache):
            try:
                return web.json_response(json.load(open(cache, encoding="utf-8")))
            except Exception:
                pass
        text, n = await asyncio.get_running_loop().run_in_executor(
            None, self._course_text, name, request, 45000, tag or None)
        if not text.strip():
            if not ai_only:
                # no transcript: tell the frontend it can use "pure-AI one-click generation" instead of just erroring
                return web.json_response({"no_transcript": True})
            if tag:
                content = (f"《{tag}》这个标签下暂无课堂录音。请仅根据你对该学科"
                           "常见教学大纲、重点概念、典型考点与题型的了解来完成任务。")
            else:
                content = (f"《{name}》这门大学课程暂无课堂录音。请仅根据你对这门课"
                           "常见教学大纲、重点概念、典型考点与题型的了解来完成任务。")
            n = 0
        else:
            content = text
        try:
            result = await asyncio.get_running_loop().run_in_executor(None, fn, content, label, ds, lang)
        except Exception as e:
            return web.json_response({"error": f"AI 生成失败: {e}"}, status=500)
        if kind == "exam" and n > 0:
            result = self._attach_exam_refs(name, result, request, tag=tag or None)
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

    # ---------- audio playback ----------
    @staticmethod
    def _ensure_wav_seekable(p):
        """For streamed/abnormally-interrupted WAVs, the header's data size is often 0, so the browser can't read the duration and the seek bar won't move.
        Backfill the RIFF and data size fields in the standard 44-byte header from the actual file size (only when they clearly don't match)."""
        try:
            import struct
            size = os.path.getsize(p)
            if size < 44:
                return
            with open(p, "r+b") as f:
                h = f.read(44)
                if h[:4] != b"RIFF" or h[8:12] != b"WAVE" or h[36:40] != b"data":
                    return  # non-standard 44-byte header, leave it alone
                riff = struct.unpack("<I", h[4:8])[0]
                data = struct.unpack("<I", h[40:44])[0]
                real_riff, real_data = size - 8, size - 44
                if data == real_data and riff == real_riff:
                    return  # the header is fine
                f.seek(4);  f.write(struct.pack("<I", real_riff))
                f.seek(40); f.write(struct.pack("<I", real_data))
        except Exception:
            pass

    async def api_audio(self, request):
        """Serve audio.wav in Range segments -- without Range support the seek bar won't move,
        and on phones the whole tens of megabytes downloads before playback even starts."""
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        if not self._owns_session(request, request.match_info["sid"]):
            return web.json_response({"error": "无权访问这节课"}, status=403)
        p = os.path.join(self._session_dir(request.match_info["sid"]), "audio.wav")
        dl = request.query.get("download")
        # prefer letting the browser pull directly from OSS (OSS supports Range, and audio is usually offloaded to OSS with the local copy deleted);
        # fall back to local if not on OSS; only 404 if neither has it.
        url = self._oss_url(p, disposition=(dl or None))
        if url:
            return web.HTTPFound(url)
        if not os.path.exists(p):
            return web.json_response({"error": "这节课没有录音文件"}, status=404)
        self._ensure_wav_seekable(p)   # fix a broken header (data size=0) first, or the browser can't read the duration
        headers = {"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600"}
        if dl:
            headers["Content-Disposition"] = "attachment"
        return web.FileResponse(p, headers=headers)

    # ---------- full-text search ----------
    def _reindex_all(self):
        root = self._records_root()
        if not os.path.isdir(root):
            return 0
        def gen():
            for name in os.listdir(root):
                p = os.path.join(root, name, "transcript.jsonl")
                if not os.path.isfile(p):
                    continue
                # edited lines must be searchable too, so the index holds the result after edits are applied
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
        # data isolation: keep only hits from your own sessions (the index is global, filtered by ownership after querying)
        if not self._is_super(request):
            me = self._owner_id(request)
            results = [r for r in results if self._session_owner(r["sid"]) == me]
            total = len(results)
        # fill in the course name and date; the frontend groups by session
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

    # ---------- review: flashcards / self-quiz / follow-up questions ----------
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

    # ---------- blackboard screenshots ----------
    async def api_shot_add(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        sid = request.match_info["sid"]
        if not self._owns_session(request, sid):
            return web.json_response({"error": "无权访问这节课"}, status=403)
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
        # <img> can't send an X-Token header, so carry the caller's token in the image URL (see api_shot_file)
        item["url"] = f"/api/shot/{sid}/{item['file']}?token={self._req_token(request)}"
        return web.json_response(item)

    async def api_shots(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        sid = request.match_info["sid"]
        tok = self._req_token(request)   # carry the token in each image URL (<img> can't send a header)
        shots = [{**s, "url": f"/api/shot/{sid}/{s['file']}?token={tok}"} for s in self.lib.shots(sid)]
        return web.json_response({"shots": shots})

    async def api_shot_file(self, request):
        # Board screenshots are private data. An <img> tag can't send an X-Token header, so the token
        # rides in the query string (see api_shots); we still require a valid token AND session ownership
        # here -- the filename (shot_001.jpg) and the sid are guessable, so path secrecy is NOT a guard.
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        sid = os.path.basename(request.match_info["sid"])
        if not self._owns_session(request, sid):
            return web.json_response({"error": "无权访问这张图"}, status=403)
        name = os.path.basename(request.match_info["file"])
        p = os.path.join(self.lib.shots_dir(sid), name)
        if not os.path.isfile(p):
            return web.json_response({"error": "没有这张图"}, status=404)
        url = self._oss_url(p)
        if url:
            return web.HTTPFound(url)
        # blackboard image content never changes (the filename is the content), so cache hard -- but
        # PRIVATE (the URL carries a per-user token; never let a shared proxy serve it to someone else).
        return web.FileResponse(p, headers={
            "Cache-Control": "private, max-age=31536000, immutable"})

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

    # ---------- course grouping / term list / correction list ----------
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
        # you can only assign your own sessions to your own courses (sid ownership is already blocked by the isolate middleware; this also blocks course_id)
        body = await request.json()
        cid = body.get("course_id")
        if cid and not self._owns_course(request, cid):
            return web.json_response({"error": "无权使用这门课程"}, status=403)
        self.lib.assign(request.match_info["sid"], cid)
        # sync the course assignment into PG (course_id; unassigning writes an empty string to clear it)
        try:
            recordings_db.upsert_recording(
                os.path.basename(request.match_info["sid"]),
                course_id=cid if cid else "")
        except Exception:
            traceback.print_exc()
        return web.json_response({"ok": True})

    async def api_set_tags(self, request):
        """Set/replace a session's subject tags (manual tagging + backfilling tags on old recordings).
        Only the session owner (or the global token) can change them; tags are written into meta.json and PG's meta jsonb,
        so /api/sessions picks them up automatically and tag-based aggregation sources from them too."""
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        sid = request.match_info["sid"]
        d = self._session_dir(sid)
        if not os.path.isdir(d):
            return web.json_response({"error": "没有这份记录"}, status=404)
        if not self._owns_session(request, sid):        # you can only tag your own sessions
            return web.json_response({"error": "无权修改这节课"}, status=403)
        try:
            body = await request.json()
            raw = body.get("tags") or []
        except Exception:
            return web.json_response({"error": "参数不对"}, status=400)
        cleaned, seen = [], set()
        for t in raw:
            if isinstance(t, str) and t.strip():
                t = t.strip()
                if t not in seen:
                    seen.add(t)
                    cleaned.append(t)
        mp = os.path.join(d, "meta.json")
        try:
            with open(mp, encoding="utf-8") as f:
                meta = json.load(f)
        except Exception:
            meta = {}
        meta["tags"] = cleaned
        tmp = mp + ".part"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
        os.replace(tmp, mp)
        # sync into PG: the meta jsonb is the read source for /api/sessions, so write back the whole meta
        try:
            recordings_db.upsert_recording(os.path.basename(sid), meta=meta)
        except Exception:
            traceback.print_exc()
        return web.json_response({"ok": True, "tags": cleaned})

    # ---------- sharing: generate a read-only link ----------
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
        """Generate a read-only share link for a session. Whoever has the link needs no token,
        but **can only view this one session's text** -- no recording, no other sessions, no editing."""
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        try:
            body = await request.json()
        except Exception:
            body = {}
        sid = body.get("sid")
        if not sid or not os.path.isdir(self._session_dir(sid)):
            return web.json_response({"error": "没有这份记录"}, status=404)
        if not self._owns_session(request, sid):        # you can only share your own sessions
            return web.json_response({"error": "无权分享这节课"}, status=403)

        shares = self._load_shares()
        # reuse an existing share for the same session, don't mint a new link on every click
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
        # Only your own shares: keep those whose underlying session you own. _owns_session returns
        # True for the global-token owner, so the machine owner still sees everything.
        shares = self._load_shares()
        mine = {k: v for k, v in shares.items() if self._owns_session(request, v.get("sid"))}
        return web.json_response({"shares": mine})

    async def api_share_revoke(self, request):
        if not self.check_token(request):
            return web.json_response({"error": "令牌不对"}, status=401)
        shares = self._load_shares()
        k = request.match_info["key"]
        if k in shares:
            if not self._owns_session(request, shares[k].get("sid")):   # can only revoke your own share
                return web.json_response({"error": "无权撤销这个分享"}, status=403)
            shares[k]["revoked"] = True
            self._save_shares(shares)
        return web.json_response({"ok": True})

    async def api_shared(self, request):
        """Read-only access, no token check -- that's the whole point of a share link."""
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

    # ---------- startup ----------
    def build(self):
        @web.middleware
        async def cors(request, handler):
            # the web page is served same-origin by this service, so CORS normally isn't needed; kept for development
            # so the frontend running on Vite (localhost:3000) can connect too. Only local origins are allowed.
            if request.method == "OPTIONS":
                resp = web.Response(status=204)
            else:
                resp = await handler(request)
            origin = request.headers.get("Origin", "")
            # allow: local development (localhost) and the native App (capacitor:// / ionic://). The web app is
            # served same-origin from this backend, so it needs no CORS allowance. Every endpoint still requires
            # a session token, so allowing an origin never exposes data on its own.
            allowed = bool(origin) and (
                origin.startswith(("http://localhost", "https://localhost",
                                   "http://127.0.0.1", "https://127.0.0.1"))
                or origin.startswith(("capacitor://", "ionic://")))  # origins bundled into the native App
            if allowed:
                resp.headers["Access-Control-Allow-Origin"] = origin
                resp.headers["Vary"] = "Origin"
                resp.headers["Access-Control-Allow-Headers"] = "content-type, x-token"
                resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
                resp.headers["Access-Control-Max-Age"] = "600"
            return resp

        @web.middleware
        async def guard(request, handler):
            # block locked-out IPs entirely, not even the page
            if self._locked(request):
                self._access_log(request, 429)
                return web.json_response({"error": "尝试次数过多，稍后再试"}, status=429)
            # in public mode, even static pages require a token -- otherwise a scanner immediately knows what's running here
            # in public mode static pages require a token too; but login/register/identity-check and read-only sharing must keep a door open,
            # otherwise a new user can't even open the login page to obtain a session token
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
            # data isolation: for any endpoint with {sid} (transcript/audio/blackboard/notes/summary/per-course...),
            # logged-in users can only touch their own sessions; others' sessions get 403. An invalid token is left to downstream to return 401.
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
        # /health isn't token-checked: devices rely on it to tell whether the service is up, and it leaks nothing
        app.router.add_get("/health", lambda r: web.json_response(
            {"ok": True, "needs_token": bool(self.token),
             "deepseek": DeepSeek(self.cfg).ready}))
        # accounts: register/login/identity-check/logout. The first three are accessible without a token
        app.router.add_post("/api/register/code", self.api_register_code)
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
        # official syllabus (by school) -- the static segment must be registered before {name}, or it gets treated as a course name
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
        app.router.add_get("/api/tags", self.api_get_tags)
        app.router.add_post("/api/tags", self.api_save_tags)
        app.router.add_get("/api/settings", self.api_get_settings)
        app.router.add_post("/api/settings", self.api_save_settings)
        app.router.add_post("/api/course/summary", self.api_course_summary)
        app.router.add_post("/api/course/exam", self.api_course_exam)
        app.router.add_post("/api/course/mock", self.api_course_mock)
        app.router.add_post("/api/share", self.api_share)
        app.router.add_get("/api/shares", self.api_share_list)
        app.router.add_post("/api/share/{key}/revoke", self.api_share_revoke)
        app.router.add_get("/api/shared/{key}", self.api_shared)   # read-only, no token needed
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
        app.router.add_post("/api/sessions/{sid}/tags", self.api_set_tags)

        # the built web page (phones/tablets open it from here). If not built, skip it, without affecting local use.
        if os.path.isdir(WEBAPP_DIR):
            async def spa(request):
                rel = request.match_info.get("tail", "")
                p = os.path.normpath(os.path.join(WEBAPP_DIR, rel))
                if os.path.isfile(p) and p.startswith(WEBAPP_DIR):
                    # assets/* filenames carry a content hash, so they can be strongly cached forever; everything else (especially index.html) must revalidate
                    # against the origin every time (no-cache), or after shipping a new version the browser stays stuck on the old bundle -- the earlier "rename backfill
                    # updated but didn't take effect on Windows" was exactly this: an old index.html pointing at old JS.
                    if "/assets/" in ("/" + rel.replace(os.sep, "/")):
                        return web.FileResponse(p, headers={
                            "Cache-Control": "public, max-age=31536000, immutable"})
                    return web.FileResponse(p, headers={"Cache-Control": "no-cache"})
                return web.FileResponse(os.path.join(WEBAPP_DIR, "index.html"),
                                        headers={"Cache-Control": "no-cache"})
            app.router.add_get("/app", spa)
            app.router.add_get("/app/{tail:.*}", spa)

        # phone/tablet version (Readdy design, with sidebar/bottom nav): deployed under mobile/out, mounted at /m.
        mobile_dir = os.path.normpath(os.path.join(HERE, "..", "..", "mobile", "out"))
        if os.path.isdir(mobile_dir):
            async def spa_m(request):
                rel = request.match_info.get("tail", "")
                p = os.path.normpath(os.path.join(mobile_dir, rel))
                if os.path.isfile(p) and p.startswith(mobile_dir):
                    if "/assets/" in ("/" + rel.replace(os.sep, "/")):
                        return web.FileResponse(p, headers={
                            "Cache-Control": "public, max-age=31536000, immutable"})
                    return web.FileResponse(p, headers={"Cache-Control": "no-cache"})
                return web.FileResponse(os.path.join(mobile_dir, "index.html"),
                                        headers={"Cache-Control": "no-cache"})
            app.router.add_get("/m", spa_m)
            app.router.add_get("/m/{tail:.*}", spa_m)

        # the Word add-in's static files (used only when the Office add-in is installed). On server deployments
        # (headless, with no addin directory) it's skipped, without affecting the web /app.
        if os.path.isdir(ADDIN_DIR):
            app.router.add_static("/", ADDIN_DIR, show_index=True)
        return app


def main():
    app_obj = App()
    # environment variables can override host/port (behind an nginx reverse proxy use LC_HOST=127.0.0.1 LC_PORT=5900
    # to fall back to an internal port, without editing config.json, and rsync won't overwrite it)
    port = int(os.environ.get("LC_PORT") or app_obj.cfg["server"]["port"])
    host = os.environ.get("LC_HOST") or app_obj.cfg["server"].get("host", "0.0.0.0")
    # prefer a proper certificate (acme.sh installs it to certs/live.crt+live.key, for public domains, no browser warning);
    # otherwise fall back to a netcert self-signed one (for LAN/direct-IP access).
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
            print(f"  访问令牌:    {app_obj.token}   （保密！这是管理员超级令牌，别外泄、别把日志贴到公开处）")
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
        # 10048 = WSAEADDRINUSE. The most common cause is a previous instance still running (that black window wasn't closed,
        # or it was started hidden). Don't dump a screenful of traceback; speak plainly.
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
