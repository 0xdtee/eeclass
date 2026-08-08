# -*- coding: utf-8 -*-
"""Write captions into Word via COM -- no Office add-in required.

Why this module exists: Word's web add-in subsystem is dead on this machine
(registration, manifest, and certificate are all correct, but Word never scans,
the cache never rebuilds, and no runtime log is produced), so the task-pane
route never surfaces a button. COM automation is a completely separate channel,
verified working in practice.

Design notes:
  - COM must be used inside a **single-threaded apartment (STA)**, and a given
    Word object may only be touched by the thread that created it. So this
    opens its own thread; outsiders only push to a queue and never touch COM
    objects across threads.
  - Batched writes (0.6s per batch by default). One COM call per sentence makes
    Word's UI visibly stutter.
  - **A failed write must never affect recording/transcription.** Word being
    closed, the document being closed, or the user dragging the window all make
    COM calls raise; these are all swallowed and recorded as status, and the
    server persists as usual.
"""
import ctypes
import queue
import threading
import time

# Word constants (don't import the constants module, to avoid depending on the type-library cache)
WD_COLLAPSE_END = 0
WD_STYLE_NORMAL = -1
WD_STYLE_HEADING2 = -3
WD_NO_HIGHLIGHT = 0
WD_YELLOW = 7
WD_BRIGHT_GREEN = 4

HIGHLIGHT = {"key": WD_YELLOW, "define": WD_BRIGHT_GREEN}


def _bgr(hex_color):
    """#RRGGBB -> the BGR integer Word wants."""
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (b << 16) | (g << 8) | r


class WordWriter:
    """Writes recognition results into a Word document in real time. The only thread-safe entry points are push/rename/close."""

    def __init__(self, style=None, target="active", flush_s=0.6):
        s = style or {}
        self.prefix_color = _bgr(s.get("prefix_color", "#9AA0A6"))
        self.prefix_size = s.get("prefix_size", 9)
        self.text_color = _bgr(s.get("text_color", "#000000"))
        self.text_size = s.get("text_size", 11)
        self.target = target          # "active" uses the current document, "new" creates a new one
        self.flush_s = flush_s

        self.q = queue.Queue()
        self.ok = False               # whether writing is currently possible
        self.err = None
        self.doc_name = None
        self.written = 0
        self._app = None
        self._doc = None
        self._run = False
        self._thread = None
        self._started = threading.Event()
        self._has_para = False        # whether the current paragraph has been started (decides append vs. new paragraph)

    # ---------------- public (any thread) ----------------
    def start(self, title=None):
        self._run = True
        self._title = title
        self._thread = threading.Thread(target=self._loop, daemon=True, name="wordcom")
        self._thread.start()
        self._started.wait(20)
        return {"ok": self.ok, "doc": self.doc_name, "error": self.err}

    def push(self, rec):
        if self._run:
            self.q.put(("line", rec))

    def rename(self, old, new):
        if self._run and old and new and old != new:
            self.q.put(("rename", (old, new)))

    def close(self):
        self._run = False
        if self._thread:
            self._thread.join(timeout=8)

    def status(self):
        return {"ok": self.ok, "doc": self.doc_name, "error": self.err, "written": self.written}

    # ---------------- COM thread ----------------
    def _loop(self):
        # STA: Word automation must use a single-threaded apartment; MTA fails in all sorts of weird ways
        ctypes.windll.ole32.CoInitializeEx(None, 2)
        try:
            self._attach()
            if self.ok and self._title:
                self._write_title(self._title)
        except Exception as e:
            self.ok, self.err = False, f"连接 Word 失败: {e}"
        finally:
            self._started.set()

        pending = []
        last = time.time()
        while self._run:
            try:
                kind, payload = self.q.get(timeout=0.2)
                if kind == "rename":
                    self._flush(pending); pending = []
                    self._rename(*payload)
                else:
                    pending.append(payload)
            except queue.Empty:
                pass
            if pending and (time.time() - last >= self.flush_s or len(pending) >= 40):
                self._flush(pending)
                pending = []
                last = time.time()
        self._flush(pending)
        ctypes.windll.ole32.CoUninitialize()

    def _attach(self):
        import comtypes.client as cc
        try:
            app = cc.GetActiveObject("Word.Application")
        except Exception:
            app = cc.CreateObject("Word.Application")
        app.Visible = True
        self._app = app
        if self.target == "new" or app.Documents.Count == 0:
            self._doc = app.Documents.Add()
        else:
            self._doc = app.ActiveDocument
        self.doc_name = self._doc.Name
        self.ok, self.err = True, None

    # ---- paragraphs and characters must be handled separately ----
    # Word's paragraph style applies to "the paragraph the paragraph-mark belongs to". If you set Style on a range that
    # spans a paragraph mark, the style sticks to the trailing paragraph instead of the one you expected -- the heading ends up
    # at the end of the document. So: always set the style on the Paragraph object, and set font/highlight on the character range.
    def _new_para(self, style=WD_STYLE_NORMAL):
        last = self._doc.Paragraphs.Last
        if last.Range.Text.strip():        # only start a new paragraph if the last one has content; reuse an empty paragraph directly
            self._doc.Paragraphs.Add()
            last = self._doc.Paragraphs.Last
        last.Style = style
        return last

    def _append_run(self, text, size=None, color=None, highlight=WD_NO_HIGHLIGHT):
        """Appends a string of characters at the end of the last paragraph, formatting only that string."""
        p = self._doc.Paragraphs.Last
        r = self._doc.Range(p.Range.End - 1, p.Range.End - 1)
        r.InsertAfter(text)      # after InsertAfter, r expands onto the just-inserted content
        f = r.Font
        if size is not None:
            f.Size = size
        if color is not None:
            f.Color = color
        f.Bold = False
        r.HighlightColorIndex = highlight
        return r

    def _write_title(self, title):
        stamp = time.strftime("%Y/%m/%d %H:%M")
        head = (title + " · " if title else "") + stamp
        self._new_para(WD_STYLE_HEADING2)
        self._append_run(head)   # leave font size and color to the "Heading 2" style, don't override
        self._has_para = False

    def _flush(self, items):
        if not items or not self.ok:
            return
        try:
            for it in items:
                if it.get("new_para") or not self._has_para:
                    self._new_para(WD_STYLE_NORMAL)
                    self._append_run(f"[{it['ts']} {it['speaker']}] ",
                                     self.prefix_size, self.prefix_color)
                    self._has_para = True
                self._append_run(it["text"], self.text_size, self.text_color,
                                 HIGHLIGHT.get(it.get("kind"), WD_NO_HIGHLIGHT))
                self.written += 1
        except Exception as e:
            # Word closed / document closed / busy. Don't retry, don't block -- the record persists anyway.
            self.ok = False
            self.err = f"写入 Word 中断: {e}（录音和转写仍在继续，记录不会丢）"

    def _rename(self, old, new):
        if not self.ok:
            return
        try:
            find = self._doc.Content.Find
            find.ClearFormatting()
            find.Replacement.ClearFormatting()
            # only replace the name inside "[time name] "; body text that happens to share the name won't be clobbered
            find.Text = " " + old + "] "
            find.Replacement.Text = " " + new + "] "
            find.Forward = True
            find.Wrap = 1          # wdFindContinue
            find.MatchCase = True
            find.Execute(Replace=2)   # wdReplaceAll
        except Exception as e:
            self.err = f"改名替换失败: {e}"
