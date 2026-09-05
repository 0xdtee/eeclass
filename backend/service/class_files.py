# -*- coding: utf-8 -*-
"""Class file library + the (user-invisible) knowledge index built from it.

Users upload course material (syllabus PDF, lecture slides, handouts, notes...) into a per-account library.
For every text-bearing file we extract plain text once and ask DeepSeek for a compact index
(topic / keywords / one-line summary). That index is the "knowledge base": it is never shown in the UI,
it only exists so that after a lecture we can decide *which* material is worth feeding into the summary.

Two ways material reaches the summary:
  * manual mode  -- the user ticks files themselves; we just load their text.
  * auto mode    -- we score every indexed file against the transcript locally (keyword/topic overlap,
                    no API call) and keep the few that clearly match.

Extraction is stdlib + poppler only: .txt/.md, .pdf (pdftotext), .docx / .pptx (they are zips of XML).
"""
import json
import os
import re
import subprocess
import zipfile

TEXT_EXT = {".txt", ".md", ".markdown", ".csv", ".log", ".json"}
DOC_EXT = {".pdf", ".docx", ".pptx"}
INDEXABLE = TEXT_EXT | DOC_EXT

MAX_TEXT = 200_000        # cap stored extracted text per file
MAX_MATERIAL = 12_000     # cap per-file text handed to the summarizer


def files_dir(records_root, owner_id):
    d = os.path.join(records_root, "class_files", owner_id or "owner")
    os.makedirs(d, exist_ok=True)
    return d


# ---------- text extraction ----------
def _xml_text(raw):
    """Strip XML tags, keeping paragraph breaks -- good enough for docx/pptx body text."""
    s = raw.decode("utf-8", "ignore")
    s = re.sub(r"</w:p>|</a:p>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"')
    return s


def extract_text(path, ext):
    """Plain text of one file; '' when the type carries no text (image/audio/video) or extraction fails."""
    ext = (ext or "").lower()
    try:
        if ext in TEXT_EXT:
            with open(path, encoding="utf-8", errors="ignore") as f:
                return f.read()[:MAX_TEXT]
        if ext == ".pdf":
            out = subprocess.run(["pdftotext", "-layout", "-q", path, "-"],
                                 capture_output=True, timeout=120)
            return out.stdout.decode("utf-8", "ignore")[:MAX_TEXT]
        if ext == ".docx":
            with zipfile.ZipFile(path) as z:
                return _xml_text(z.read("word/document.xml"))[:MAX_TEXT]
        if ext == ".pptx":
            parts = []
            with zipfile.ZipFile(path) as z:
                names = sorted(n for n in z.namelist()
                               if re.match(r"ppt/slides/slide\d+\.xml$", n))
                for n in names:
                    parts.append(_xml_text(z.read(n)))
            return "\n\n".join(parts)[:MAX_TEXT]
    except Exception:
        return ""
    return ""


def text_path(d, fid):
    return os.path.join(d, fid + ".extracted.txt")


def save_text(d, fid, text):
    if not text or not text.strip():
        return False
    with open(text_path(d, fid), "w", encoding="utf-8") as f:
        f.write(text)
    return True


def load_text(d, fid, limit=MAX_MATERIAL):
    p = text_path(d, fid)
    if not os.path.exists(p):
        return ""
    try:
        with open(p, encoding="utf-8", errors="ignore") as f:
            return f.read()[:limit]
    except Exception:
        return ""


# ---------- hidden knowledge index ----------
_INDEX_SYS = (
    "你在为一个课堂笔记应用建立资料索引(用户看不到这份索引,它只用于判断这份资料和某节课是否相关)。"
    "用户给你一份课程资料的正文节选。请输出严格 JSON:"
    '{"topic":"这份资料属于什么课/什么主题,一句话","keywords":["能代表这份资料的关键词/术语,8~20个"],'
    '"summary":"这份资料讲了什么,2~3句"}。'
    "keywords 要具体(学科术语、章节名、概念名、公式名、人名等),不要写「知识」「内容」这类空词。只输出 JSON。")


def build_index(ds, name, text):
    """Ask DeepSeek for {topic, keywords, summary}; returns {} when unavailable."""
    text = (text or "").strip()
    if not text or not getattr(ds, "ready", False):
        return {}
    head = text[:6000]
    tail = text[-2000:] if len(text) > 8000 else ""
    body = f"资料文件名:{name}\n\n正文节选:\n{head}" + (f"\n…\n{tail}" if tail else "")
    try:
        out = ds._chat(_INDEX_SYS, body, temperature=0.1)
    except Exception:
        return {}
    if not isinstance(out, dict):
        return {}
    kws = [str(k).strip() for k in (out.get("keywords") or []) if str(k).strip()]
    return {
        "topic": str(out.get("topic", "")).strip(),
        "keywords": kws[:30],
        "summary": str(out.get("summary", "")).strip(),
    }


# ---------- local relevance scoring (auto mode, no API call) ----------
_STOP = set("的了是在和与及或对为把被这那有就都也很非常我们你们他们大家一个我你他就是这个那个什么怎么可以不是"
            "老师同学今天现在因为所以但是然后而且如果那么知识内容课程资料东西问题时候")


def _terms(s):
    """Chinese-friendly term set: CJK bigrams + latin/number words, minus stopwords."""
    s = (s or "").lower()
    out = set()
    for w in re.findall(r"[a-z][a-z0-9+#._-]{1,}", s):
        if len(w) > 1:
            out.add(w)
    han = re.findall(r"[一-鿿]+", s)
    for run in han:
        for i in range(len(run) - 1):
            bg = run[i:i + 2]
            if bg not in _STOP:
                out.add(bg)
    return out


def score_file(transcript_terms, idx, name=""):
    """0..1 relevance of one indexed file to the lecture. Keywords weigh most, then topic/summary/filename."""
    if not transcript_terms:
        return 0.0
    kw = idx.get("keywords") or []
    hit_kw = 0
    for k in kw:
        kt = _terms(k)
        if kt and len(kt & transcript_terms) >= max(1, len(kt) // 2):
            hit_kw += 1
    kw_score = hit_kw / max(4, len(kw)) if kw else 0.0

    def overlap(text):
        t = _terms(text)
        return len(t & transcript_terms) / len(t) if t else 0.0

    topic_score = overlap(idx.get("topic", ""))
    sum_score = overlap(idx.get("summary", ""))
    name_score = overlap(os.path.splitext(name or "")[0])
    return min(1.0, 0.55 * kw_score + 0.2 * topic_score + 0.15 * sum_score + 0.10 * name_score)


def pick_relevant(transcript, index_map, files, top_n=3, threshold=0.18):
    """Auto mode: rank indexed files against the transcript, keep the clear matches.
    index_map: {fid: index dict}; files: the library metadata list. Returns [(fid, name, score)]."""
    terms = _terms(transcript)
    if not terms:
        return []
    by_id = {f.get("id"): f for f in (files or [])}
    scored = []
    for fid, idx in (index_map or {}).items():
        if fid not in by_id or not isinstance(idx, dict):
            continue
        s = score_file(terms, idx, by_id[fid].get("name", ""))
        if s >= threshold:
            scored.append((fid, by_id[fid].get("name", ""), round(s, 3)))
    scored.sort(key=lambda x: -x[2])
    return scored[:top_n]


def load_materials(d, picks, files):
    """[(fid, name, score)] or [fid] -> [{name, text}] for the summarizer (skips files with no text)."""
    by_id = {f.get("id"): f for f in (files or [])}
    out = []
    for p in (picks or []):
        fid = p[0] if isinstance(p, (list, tuple)) else p
        txt = load_text(d, fid)
        if not txt.strip():
            continue
        out.append({"name": (by_id.get(fid) or {}).get("name", fid), "text": txt})
    return out
