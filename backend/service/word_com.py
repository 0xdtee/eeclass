# -*- coding: utf-8 -*-
"""通过 COM 把字幕写进 Word —— 不需要 Office 加载项。

为什么有这个模块：这台机器上 Word 的 Web 加载项子系统是死的（注册、manifest、
证书全对，但 Word 从不扫描、缓存不重建、运行时日志不生成），所以任务窗格那条路
点不出按钮。COM 自动化是完全独立的另一条通道，实测可用。

设计要点：
  · COM 必须在**单线程套间(STA)**里用，且同一个 Word 对象只能被创建它的线程碰。
    所以这里自己开一个线程，外面只往队列里塞，绝不跨线程碰 COM 对象。
  · 攒批写入（默认 0.6 秒一批）。一句一次 COM 调用会让 Word 界面明显卡顿。
  · **写不进去绝不能影响录音转写**。Word 被关掉、文档被关掉、用户正在拖动窗口
    都会让 COM 调用抛异常，这里一律吞掉并记录状态，服务端照常落盘。
"""
import ctypes
import queue
import threading
import time

# Word 常量（不引 constants 模块，省得依赖类型库缓存）
WD_COLLAPSE_END = 0
WD_STYLE_NORMAL = -1
WD_STYLE_HEADING2 = -3
WD_NO_HIGHLIGHT = 0
WD_YELLOW = 7
WD_BRIGHT_GREEN = 4

HIGHLIGHT = {"key": WD_YELLOW, "define": WD_BRIGHT_GREEN}


def _bgr(hex_color):
    """#RRGGBB -> Word 要的 BGR 整数。"""
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (b << 16) | (g << 8) | r


class WordWriter:
    """把识别结果实时写进 Word 文档。线程安全的入口只有 push/rename/close。"""

    def __init__(self, style=None, target="active", flush_s=0.6):
        s = style or {}
        self.prefix_color = _bgr(s.get("prefix_color", "#9AA0A6"))
        self.prefix_size = s.get("prefix_size", 9)
        self.text_color = _bgr(s.get("text_color", "#000000"))
        self.text_size = s.get("text_size", 11)
        self.target = target          # "active" 用当前文档，"new" 新建一篇
        self.flush_s = flush_s

        self.q = queue.Queue()
        self.ok = False               # 当前能不能写
        self.err = None
        self.doc_name = None
        self.written = 0
        self._app = None
        self._doc = None
        self._run = False
        self._thread = None
        self._started = threading.Event()
        self._has_para = False        # 当前段落是否已经起头（决定接着写还是另起一段）

    # ---------------- 对外（任意线程） ----------------
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

    # ---------------- COM 线程 ----------------
    def _loop(self):
        # STA：Word 自动化必须用单线程套间，用 MTA 会各种诡异失败
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

    # ---- 段落与字符要分开处理 ----
    # Word 的段落样式作用于「段落标记所属的那一段」。如果把 Style 设在一个跨越
    # 段落标记的 range 上，样式会粘在末尾那段上、而不是你以为的那段——标题会跑到
    # 文末去。所以：样式一律设在 Paragraph 对象上，字体/高亮才设在字符 range 上。
    def _new_para(self, style=WD_STYLE_NORMAL):
        last = self._doc.Paragraphs.Last
        if last.Range.Text.strip():        # 末段有内容才另起一段；空段直接复用
            self._doc.Paragraphs.Add()
            last = self._doc.Paragraphs.Last
        last.Style = style
        return last

    def _append_run(self, text, size=None, color=None, highlight=WD_NO_HIGHLIGHT):
        """在最后一段末尾追加一串字符，只给这串字符设格式。"""
        p = self._doc.Paragraphs.Last
        r = self._doc.Range(p.Range.End - 1, p.Range.End - 1)
        r.InsertAfter(text)      # InsertAfter 之后 r 扩张到刚插入的内容上
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
        self._append_run(head)   # 字号颜色交给「标题 2」样式，别覆盖
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
            # Word 被关了/文档被关了/正忙。不重试、不阻塞——记录照样落盘。
            self.ok = False
            self.err = f"写入 Word 中断: {e}（录音和转写仍在继续，记录不会丢）"

    def _rename(self, old, new):
        if not self.ok:
            return
        try:
            find = self._doc.Content.Find
            find.ClearFormatting()
            find.Replacement.ClearFormatting()
            # 只替换 "[时间 名字] " 里的名字，正文里恰好同名的字不会被误伤
            find.Text = " " + old + "] "
            find.Replacement.Text = " " + new + "] "
            find.Forward = True
            find.Wrap = 1          # wdFindContinue
            find.MatchCase = True
            find.Execute(Replace=2)   # wdReplaceAll
        except Exception as e:
            self.err = f"改名替换失败: {e}"
