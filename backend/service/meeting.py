"""Standalone multi-language meeting translator.

Deliberately isolated from the recording/session machinery (no VAD, no speaker id, no PostgreSQL, no
files on disk): a meeting translator only needs to hear a sentence and show its translation.

Alibaba Cloud's Gummy realtime stream auto-detects the spoken language but honors only ONE translation
target per stream, so N translations need N streams (all fed the same audio). Their sentences are
correlated by TIME (same audio -> same window) into a bucket per utterance, which is emitted as one
line a short debounce after it goes quiet -- one line per utterance, all translations, no duplicates.
Whatever language is being spoken is the source and drops out of its own translation. The browser
sends 16 kHz mono Int16 PCM frames, forwarded to every stream as-is.
"""

import json
import os
import re
import time

from aiohttp import WSMsgType, web

SR = 16000
_HAN = re.compile(r"[一-鿿]")
# Gummy's result carries no detected-language field, so we guess the spoken language from the script
# (used only to label the source and to suppress translating a language into itself).
_KANA = re.compile(r"[぀-ヿ゠-ヿ]")        # hiragana + katakana
_HANGUL = re.compile(r"[가-힣]")
_CYRILLIC = re.compile(r"[Ѐ-ӿ]")
_LATIN_ACCENT = re.compile(r"[À-ÿ]")       # accented Latin -> a European language other than English

# Cap concurrent connections; each uses up to MAX_LANGS cloud streams, so keep this modest.
_MAX_CONN = 8
_active = 0


def _detect_src(text: str) -> str:
    """Best-effort source-language code from the recognized text, for an honest direction badge.
    Kana/Hangul/Cyrillic are checked before Han (Japanese also uses Han); accented Latin marks a
    non-English European language; otherwise plain Latin is treated as English."""
    text = text or ""
    if _HANGUL.search(text):
        return "ko"
    if _KANA.search(text):
        return "ja"
    if _CYRILLIC.search(text):
        return "ru"
    if _HAN.search(text):
        return "zh"
    if _LATIN_ACCENT.search(text):
        return "xx"   # accented European (French/German/Spanish/...) -> "foreign", not English
    return "en"


# Languages the meeting translator offers -- the set Gummy recognizes (matches summarize.TRANS_LANG_NAMES).
SUPPORTED_LANGS = ["zh", "en", "ja", "ko", "fr", "de", "es", "it", "ru"]
# Each selected language runs its own Gummy realtime stream, so cap how many can be picked at once.
MAX_LANGS = 3


class _TransStream:
    """A Gummy realtime stream translating into one target language (source auto-detected). Reports each
    event to on_event(sentence_id, is_final, original_text, translation, begin_ms, end_ms) -- interim
    events carry Gummy's streaming (real-time) translation, so each language updates live as spoken."""

    def __init__(self, target, on_event):
        import dashscope
        key = os.environ.get("DASHSCOPE_API_KEY")
        if not key:
            raise RuntimeError("没配 DASHSCOPE_API_KEY，在 start-server.sh 里设")
        dashscope.api_key = key
        self.target = target
        self.on_event = on_event
        self._r = None
        self._closed = True
        self._open()

    def _pick(self, tl):
        if tl is None:
            return ""
        for lang in (self.target, self.target.upper(),
                     {"zh": "zh-CN", "en": "en-US"}.get(self.target, self.target)):
            try:
                tr = tl.get_translation(lang)
            except Exception:
                tr = None
            if tr is not None and getattr(tr, "text", ""):
                return (tr.text or "").strip()
        return ""

    def _open(self):
        from dashscope.audio.asr import (TranslationRecognizerCallback,
                                         TranslationRecognizerRealtime)
        outer = self

        class _CB(TranslationRecognizerCallback):
            def on_event(self, request_id, transcription_result, translation_result, usage):
                tr = transcription_result
                if tr is None or not getattr(tr, "text", ""):
                    return
                sid = getattr(tr, "sentence_id", 0)
                text = (tr.text or "").strip()
                is_final = bool(getattr(tr, "is_sentence_end", False))
                translation = outer._pick(translation_result)
                begin = getattr(tr, "begin_time", None)
                end = getattr(tr, "end_time", None)
                outer.on_event(sid, is_final, text, translation, begin, end)

            def on_error(self, message):
                outer._closed = True

            def on_close(self):
                outer._closed = True

        self._r = TranslationRecognizerRealtime(
            model="gummy-realtime-v1", callback=_CB(), format="pcm", sample_rate=SR,
            transcription_enabled=True, source_language="auto",
            translation_enabled=True, translation_target_languages=[self.target])
        self._r.start()
        self._closed = False

    def push(self, pcm_bytes: bytes):
        if self._closed:
            try:
                self._open()
            except Exception:
                return
        try:
            self._r.send_audio_frame(pcm_bytes)
        except Exception:
            self._closed = True

    def close(self):
        try:
            if self._r is not None and not self._closed:
                self._r.stop()
        except Exception:
            pass
        self._closed = True


class MultiTranslator:
    """One Gummy translation stream per selected language, fed the same audio. Gummy can only translate
    into ONE language per stream, so N translations need N streams. Their sentences are correlated by
    TIME (same audio -> same [begin,end] window). A finalized sentence is collected into a time bucket
    that gathers the original (preferring the master = first selected language) plus each language's
    translation; the bucket is emitted as ONE line a short debounce after activity stops. That single,
    debounced emit is what avoids the earlier duplicate/flicker (from emitting per-stream and patching).

    on_line(line_id, original, translations): a finalized sentence with all its translations.
    on_partial(original, translations): the in-progress sentence, updated live.
    """

    FLUSH_AFTER = 0.7   # seconds of quiet before a bucket is emitted

    def __init__(self, langs, on_line, on_line_update, on_partial, on_correct=None, make_ds=None):
        import threading
        self.langs = list(langs)
        self.master = self.langs[0]
        self.on_line = on_line
        self.on_partial = on_partial
        self.on_correct = on_correct       # (line_id, src, {lang: text}) -- DeepSeek-corrected, aligned translations
        self._make_ds = make_ds            # factory for a DeepSeek client (post-hoc re-translation)
        self._corr_sem = threading.Semaphore(4)   # cap concurrent correction calls
        self._cur = {"o": "", "tr": {}}     # current (in-progress) sentence, for the live preview
        self._buckets = []                   # {"o","tr","b","e","last","emitted","id"}
        self._next_id = int(time.time() * 1000)
        self._lock = threading.Lock()
        self._stop = False
        self._streams = [_TransStream(lc, self._handler(lc)) for lc in self.langs]
        self._flusher = threading.Thread(target=self._flush_loop, daemon=True)
        self._flusher.start()

    @staticmethod
    def _norm(x):
        return re.sub(r"[\W_]+", "", x or "").lower()

    @staticmethod
    def _overlap(a1, b1, a2, b2, tol=200):
        if a1 is None or b1 is None or a2 is None or b2 is None:
            return False
        return a1 <= b2 + tol and a2 <= b1 + tol

    def _handler(self, target):
        is_master = (target == self.master)

        def h(sid, is_final, text, translation, begin=None, end=None):
            src = _detect_src(text)
            show = bool(translation) and target != src and self._norm(translation) != self._norm(text)

            if not is_final:
                with self._lock:
                    if is_master:
                        self._cur["o"] = text
                    if show:
                        self._cur["tr"][target] = translation
                    o, tr = self._cur["o"], dict(self._cur["tr"])
                if o:
                    self.on_partial(o, tr)
                return

            with self._lock:
                bk = None
                for cand in self._buckets:
                    if not cand["emitted"] and self._overlap(begin, end, cand["b"], cand["e"]):
                        bk = cand
                        break
                if bk is None:
                    bk = {"o": "", "tr": {}, "b": begin, "e": end, "last": 0.0, "emitted": False, "id": None}
                    self._buckets.append(bk)
                    if len(self._buckets) > 60:
                        self._buckets = self._buckets[-60:]
                if is_master or not bk["o"]:
                    bk["o"] = text
                if show:
                    bk["tr"][target] = translation
                if begin is not None and (bk["b"] is None or begin < bk["b"]):
                    bk["b"] = begin
                if end is not None and (bk["e"] is None or end > bk["e"]):
                    bk["e"] = end
                bk["last"] = time.monotonic()
                if is_master:
                    self._cur = {"o": "", "tr": {}}
        return h

    def _flush_loop(self):
        while not self._stop:
            time.sleep(0.15)
            emits = []
            now = time.monotonic()
            with self._lock:
                for bk in self._buckets:
                    if not bk["emitted"] and bk["o"] and now - bk["last"] > self.FLUSH_AFTER:
                        bk["emitted"] = True
                        bk["id"] = self._next_id
                        self._next_id += 1
                        emits.append((bk["id"], bk["o"], dict(bk["tr"])))
            for e in emits:
                self.on_line(*e)
                # Real-time-first, correct-later: re-translate the finalized sentence with DeepSeek so every
                # selected language lines up on the same row and reads more accurately than the raw streams.
                if self._make_ds and self.on_correct:
                    lid, o, _tr = e
                    import threading
                    threading.Thread(target=self._correct, args=(lid, o), daemon=True).start()

    def _correct(self, lid, original):
        if not original:
            return
        with self._corr_sem:
            try:
                ds = self._make_ds()
                if not ds or not getattr(ds, "ready", False):
                    return
                res = ds.translate_multi(original, self.langs)
            except Exception:
                return
        if res and (res.get("translations") or res.get("src")):
            try:
                self.on_correct(lid, res.get("src") or "", res.get("translations") or {})
            except Exception:
                pass

    def push(self, pcm_bytes: bytes):
        for st in self._streams:
            st.push(pcm_bytes)

    def close(self):
        self._stop = True
        for st in self._streams:
            st.close()


def generate_minutes(ds, turns, lang="zh-Hans"):
    """Turn the meeting's turns into structured minutes via DeepSeek, written in `lang`.

    `lang` may be a language code from TRANS_LANG_NAMES (zh/en/ja/ko/fr/...) to force the minutes into
    that specific language, or a UI language (zh-Hans/zh-Hant/en). We feed the originals (what was
    actually said, in order) and ask for a JSON of {title, summary, points, decisions, todos}.
    """
    from summarize import lang_note, TRANS_LANG_NAMES

    lang_name = TRANS_LANG_NAMES.get(lang)
    note = (
        (f"\n\nOUTPUT LANGUAGE: write EVERY text value in the JSON (title, summary, every item of "
         f"points and decisions, and each todo's task and owner) in {lang_name}, regardless of the "
         f"meeting's language. Keep the JSON keys unchanged.")
        if lang_name else lang_note(lang)
    )

    said = []
    for tn in turns:
        o = (tn.get("original") or "").strip()
        if o:
            said.append(o)
    transcript = "\n".join(said)[: ds.max_chars]

    system = ("你是专业的会议记录员。根据一场会议的逐句发言(中英文混合),整理出结构化、忠实、可执行的会议纪要。"
              "只输出 JSON,不要编造发言里没有的内容。")
    user = (
        "以下是一场会议的逐句发言(中英文混合,顺序即发言先后):\n\n"
        + transcript +
        "\n\n请整理成会议纪要,输出一个 JSON 对象,字段:\n"
        "title:会议主题(一句话);\n"
        "summary:整体概述(2-4 句);\n"
        "points:讨论要点(字符串数组);\n"
        "decisions:达成的决定或结论(字符串数组,没有就空数组);\n"
        "todos:待办事项(数组,每项 {\"task\": \"要做的事\", \"owner\": \"负责人,发言里没提到就留空字符串\"})。"
        + note
    )
    out = ds._chat(system, user)
    return {
        "title": out.get("title") or "",
        "summary": out.get("summary") or "",
        "points": out.get("points") or [],
        "decisions": out.get("decisions") or [],
        "todos": out.get("todos") or [],
    }


def merge_sessions(existing, incoming, cap=300):
    """Upsert saved meeting sessions by id, newest first, capped. Used both when the browser saves a
    finished meeting and when a freshly logged-in browser hands over its local (anonymous) history."""
    by_id = {}
    for s in list(existing) + list(incoming):
        if isinstance(s, dict) and s.get("id"):
            by_id[s["id"]] = s
    merged = sorted(by_id.values(), key=lambda s: s.get("created", 0), reverse=True)
    return merged[:cap]


async def meeting_minutes_http(request, *, make_ds, check_token):
    """POST endpoint: generate meeting minutes from the turns the browser collected (login required)."""
    if not check_token(request):
        return web.json_response({"error": "令牌不对"}, status=401)
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "请求不是合法 JSON"}, status=400)
    turns = body.get("turns") or []
    if not turns:
        return web.json_response({"error": "没有可整理的会议内容"}, status=400)
    ds = make_ds()
    if not ds.ready:
        return web.json_response(
            {"error": "还没配 DeepSeek API key，无法生成会议纪要。"}, status=503)

    import asyncio
    try:
        out = await asyncio.get_running_loop().run_in_executor(
            None, generate_minutes, ds, turns, body.get("lang") or "zh-Hans")
    except Exception as e:
        return web.json_response({"error": f"DeepSeek 调用失败：{e}"}, status=502)
    return web.json_response(out)


async def convert_to_pdf(src_path, out_dir):
    """Convert a presentation (ppt/pptx/odp/key) at src_path to a PDF in out_dir via LibreOffice.
    Returns the output PDF path, or None on failure / if LibreOffice is missing."""
    import asyncio
    import os as _os

    base = _os.path.splitext(_os.path.basename(src_path))[0]
    pdf_path = _os.path.join(out_dir, base + ".pdf")
    try:
        proc = await asyncio.create_subprocess_exec(
            "soffice", "--headless", "--convert-to", "pdf", "--outdir", out_dir, src_path,
            env={**_os.environ, "HOME": out_dir},
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        await asyncio.wait_for(proc.communicate(), timeout=120)
    except Exception:
        return None
    return pdf_path if _os.path.exists(pdf_path) else None


async def remux_to_mp4(src_path, out_path):
    """Remux a non-web-native video (.mov/.avi/.mkv/...) into a browser-playable MP4 with ffmpeg. Copies
    the (usually H.264) video stream so it's fast, transcodes audio to AAC, and adds faststart. Falls
    back to a full re-encode if the copy fails. Returns out_path on success, else None."""
    import asyncio

    async def run(args):
        try:
            proc = await asyncio.create_subprocess_exec(
                "ffmpeg", "-y", *args,
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
            await asyncio.wait_for(proc.communicate(), timeout=600)
            return proc.returncode == 0
        except Exception:
            return False

    import os as _os
    ok = await run(["-i", src_path, "-c:v", "copy", "-c:a", "aac", "-movflags", "+faststart", out_path])
    if not ok or not _os.path.exists(out_path) or _os.path.getsize(out_path) == 0:
        ok = await run(["-i", src_path, "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
                        "-c:a", "aac", "-movflags", "+faststart", out_path])
    return out_path if (ok and _os.path.exists(out_path) and _os.path.getsize(out_path) > 0) else None


async def meeting_slides_http(request, *, check_token):
    """Accept an uploaded .pptx/.ppt/.pdf and return it as a PDF (LibreOffice converts PPT to PDF), so
    the browser can page through the slides with pdf.js. Login required, like the other endpoints."""
    if not check_token(request):
        return web.json_response({"error": "令牌不对"}, status=401)
    import asyncio
    import os as _os
    import tempfile

    try:
        reader = await request.multipart()
        field = await reader.next()
        while field is not None and field.name != "file":
            field = await reader.next()
        if field is None:
            return web.json_response({"error": "没有文件"}, status=400)
        filename = field.filename or "slides"
        data = await field.read()
    except Exception:
        return web.json_response({"error": "上传失败"}, status=400)
    if not data:
        return web.json_response({"error": "空文件"}, status=400)

    ext = _os.path.splitext(filename)[1].lower()
    if ext == ".pdf":
        return web.Response(body=data, content_type="application/pdf")
    if ext not in (".ppt", ".pptx", ".odp", ".key"):
        return web.json_response({"error": "只支持 PPT / PPTX / PDF"}, status=400)

    with tempfile.TemporaryDirectory() as d:
        src = _os.path.join(d, "in" + ext)
        with open(src, "wb") as f:
            f.write(data)
        try:
            proc = await asyncio.create_subprocess_exec(
                "soffice", "--headless", "--convert-to", "pdf", "--outdir", d, src,
                env={**_os.environ, "HOME": d},
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            await asyncio.wait_for(proc.communicate(), timeout=90)
        except FileNotFoundError:
            return web.json_response({"error": "服务器未安装 PPT 转换组件(LibreOffice),请改用 PDF"}, status=503)
        except Exception as e:
            return web.json_response({"error": f"转换失败:{e}"}, status=500)
        pdf_path = _os.path.join(d, "in.pdf")
        if not _os.path.exists(pdf_path):
            return web.json_response({"error": "转换失败(未生成 PDF)"}, status=500)
        with open(pdf_path, "rb") as f:
            out = f.read()
    return web.Response(body=out, content_type="application/pdf")


async def meeting_ws(request, *, check_token, make_ds=None):
    """WebSocket endpoint for the meeting translator. Login required (like the app's other features);
    the concurrency cap limits abuse.

    The user picks up to MAX_LANGS languages. Each gets its own Gummy realtime stream (fed the same
    audio), and translation into every selected language streams in real time as the sentence is spoken.
    Sentences are correlated across streams by the recognized original text (their sentence_ids don't
    line up reliably); whatever language is being spoken is the source and drops out of its own
    translation -- so with 3 languages selected you get 2 live translations at once.
    """
    global _active
    if not check_token(request):
        return web.json_response({"error": "令牌不对"}, status=401)

    import asyncio

    ws = web.WebSocketResponse(heartbeat=20, max_msg_size=8 * 1024 * 1024)
    await ws.prepare(request)
    loop = asyncio.get_running_loop()

    def _send(msg):
        # Called from an SDK socket thread -> hop onto the event loop before touching the ws.
        def _do():
            if not ws.closed:
                loop.create_task(ws.send_str(json.dumps(msg, ensure_ascii=False)))
        loop.call_soon_threadsafe(_do)

    session_langs = ["en", "zh"]   # subtitle languages the user selected (updated on 'start')

    def on_partial(text, translations):
        _send({"type": "partial", "original": text, "src": _detect_src(text), "translations": translations})

    def on_line(lid, text, translations):
        _send({"type": "line", "id": lid, "original": text, "src": _detect_src(text),
               "translations": translations})

    def on_line_update(lid, lang, translation):
        _send({"type": "line_update", "id": lid, "lang": lang, "translation": translation})

    def on_correct(lid, src, translations):
        # DeepSeek re-translated the line: replace its translations with the aligned, cleaned set.
        _send({"type": "line_correct", "id": lid, "src": src, "translations": translations})

    engine = None
    counted = False
    try:
        async for m in ws:
            if m.type == WSMsgType.BINARY:
                if engine is not None:
                    engine.push(m.data)
                continue
            if m.type != WSMsgType.TEXT:
                continue
            try:
                msg = json.loads(m.data)
                cmd = msg.get("cmd")
            except Exception:
                continue
            if cmd == "start":
                if engine is not None:
                    # A stale engine (e.g. a 'stop' was lost) must not make this start a no-op -- tear it
                    # down and start fresh, so a start always produces a 'started'.
                    engine.close()
                    engine = None
                    if counted:
                        _active = max(0, _active - 1)
                        counted = False
                if _active >= _MAX_CONN:
                    _send({"type": "error", "msg": "服务器繁忙，稍后再试"})
                    continue
                langs = msg.get("langs")
                if isinstance(langs, list):
                    picked = [l for l in langs if l in SUPPORTED_LANGS][:MAX_LANGS]
                    session_langs[:] = picked or ["en", "zh"]
                try:
                    engine = MultiTranslator(session_langs, on_line=on_line,
                                             on_line_update=on_line_update, on_partial=on_partial,
                                             on_correct=on_correct, make_ds=make_ds)
                    _active += 1
                    counted = True
                    _send({"type": "started"})
                except Exception as e:
                    _send({"type": "error", "msg": f"{type(e).__name__}: {e}"})
            elif cmd == "stop":
                if engine is not None:
                    engine.close()
                    engine = None
                if counted:
                    _active = max(0, _active - 1)
                    counted = False
                _send({"type": "stopped"})
    finally:
        if engine is not None:
            engine.close()
        if counted:
            _active = max(0, _active - 1)
    return ws
