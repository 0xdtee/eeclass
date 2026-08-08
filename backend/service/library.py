# -*- coding: utf-8 -*-
r"""Course library: course grouping, glossary, correction table, full-text search index, whiteboard screenshots.

Everything lives under records\, plain files, with no database service:
    records\library.json          courses, per-course glossary and correction table, session ownership
    records\search.db             SQLite FTS5 full-text index (safe to delete and rebuild anytime)
    records\<session>\shots\      whiteboard screenshots + shots.json

Why search uses SQLite FTS5: a semester has dozens of classes and tens of thousands of sentences.
Scanning each file in Python works, but every search reads tens of megabytes of jsonl, so a tap
on a phone takes several seconds. FTS5 ships with the standard library (the sqlite3 module),
adds zero dependencies, and queries in milliseconds. Chinese has no word boundaries, so it uses
unicode61 to index per-character, and splits query terms into single characters joined with AND --
good enough without installing a tokenizer.
"""
import json
import os
import re
import sqlite3
import time

HERE = os.path.dirname(os.path.abspath(__file__))


def _now():
    return time.strftime("%Y-%m-%d %H:%M:%S")


class Library:
    def __init__(self, records_root):
        self.root = records_root
        self.lib_path = os.path.join(self.root, "library.json")
        self.db_path = os.path.join(self.root, "search.db")

    # ---------------- courses ----------------
    def load(self):
        if not os.path.exists(self.lib_path):
            return {"courses": [], "assign": {}}
        try:
            with open(self.lib_path, encoding="utf-8") as f:
                d = json.load(f)
        except Exception:
            return {"courses": [], "assign": {}}
        d.setdefault("courses", [])
        d.setdefault("assign", {})     # {session_id: course_id}
        return d

    def save(self, d):
        os.makedirs(self.root, exist_ok=True)
        with open(self.lib_path, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=2)

    def courses(self):
        d = self.load()
        by_course = {}
        for sid, cid in d["assign"].items():
            by_course.setdefault(cid, []).append(sid)
        out = []
        for c in d["courses"]:
            out.append({**c, "session_ids": sorted(by_course.get(c["id"], []), reverse=True)})
        return out

    def add_course(self, name, owner=None):
        d = self.load()
        cid = "c" + str(int(time.time() * 1000))[-9:]
        d["courses"].append({"id": cid, "name": name or "新课程", "created": _now(),
                             "owner": owner, "hotwords": "", "corrections": []})
        self.save(d)
        return next(c for c in self.courses() if c["id"] == cid)

    def course_owner(self, cid):
        d = self.load()
        c = next((x for x in d["courses"] if x["id"] == cid), None)
        return c.get("owner") if c else None

    def update_course(self, cid, patch):
        d = self.load()
        for c in d["courses"]:
            if c["id"] == cid:
                for k in ("name", "hotwords", "corrections", "color"):
                    if k in patch:
                        c[k] = patch[k]
                self.save(d)
                return next(x for x in self.courses() if x["id"] == cid)
        return None

    def delete_course(self, cid):
        d = self.load()
        d["courses"] = [c for c in d["courses"] if c["id"] != cid]
        d["assign"] = {k: v for k, v in d["assign"].items() if v != cid}
        self.save(d)

    def assign(self, sid, cid):
        d = self.load()
        if cid:
            d["assign"][sid] = cid
        else:
            d["assign"].pop(sid, None)
        self.save(d)

    def course_of(self, sid):
        d = self.load()
        cid = d["assign"].get(sid)
        if not cid:
            return None
        return next((c for c in d["courses"] if c["id"] == cid), None)

    # ---------------- correction table ----------------
    def corrections_for(self, cid):
        d = self.load()
        c = next((x for x in d["courses"] if x["id"] == cid), None)
        if not c:
            return []
        return [r for r in (c.get("corrections") or []) if r.get("enabled", True) and r.get("from")]

    @staticmethod
    def apply_corrections(text, rules):
        """Replace immediately after recognition. Rules are sorted by the length of the "misheard word" in descending order, so short words don't get replaced first and break up long ones."""
        for r in sorted(rules, key=lambda r: -len(r.get("from", ""))):
            if r["from"] in text:
                text = text.replace(r["from"], r.get("to", ""))
        return text

    # ---------------- full-text search ----------------
    # FTS5's built-in tokenizer (unicode61) treats a run of Chinese as **one** token,
    # because CJK characters are all "letters" in Unicode with no separators between them. The result is that searching for one term
    # fails to match a sentence containing it -- the whole sentence is a single token.
    # We don't want to pull in a third-party tokenizer (jieba and the like), so both on insert and on query we split Chinese **character by character**,
    # keeping English and digits as whole words. On query we wrap it in quotes to make it a phrase query, guaranteeing the characters stay in order.
    @staticmethod
    def _tok(text):
        out = []
        for ch in text or "":
            if "一" <= ch <= "鿿" or "㐀" <= ch <= "䶿":
                out.append(" " + ch + " ")
            else:
                out.append(ch)
        return re.sub(r"\s+", " ", "".join(out)).strip()

    def _db(self):
        os.makedirs(self.root, exist_ok=True)
        con = sqlite3.connect(self.db_path)
        con.execute("""CREATE VIRTUAL TABLE IF NOT EXISTS lines USING fts5(
            sid UNINDEXED, line_id UNINDEXED, ts UNINDEXED, start UNINDEXED,
            speaker UNINDEXED, kind UNINDEXED, text UNINDEXED, body,
            tokenize='unicode61')""")
        con.execute("""CREATE TABLE IF NOT EXISTS indexed(
            sid TEXT PRIMARY KEY, mtime REAL, n INTEGER)""")
        return con

    def reindex(self, sessions_lines):
        """sessions_lines: iterate over (sid, mtime, [line...]). Only rebuild sessions that changed."""
        con = self._db()
        done = {r[0]: r[1] for r in con.execute("SELECT sid, mtime FROM indexed")}
        n_new = 0
        for sid, mtime, lines in sessions_lines:
            if done.get(sid) == mtime:
                continue
            con.execute("DELETE FROM lines WHERE sid=?", (sid,))
            con.executemany(
                "INSERT INTO lines(sid,line_id,ts,start,speaker,kind,text,body) VALUES(?,?,?,?,?,?,?,?)",
                [(sid, l.get("id"), l.get("ts", ""), l.get("start", 0),
                  l.get("speaker", ""), l.get("kind") or "", l.get("text", ""),
                  self._tok(l.get("text", ""))) for l in lines])
            con.execute("INSERT OR REPLACE INTO indexed(sid,mtime,n) VALUES(?,?,?)",
                        (sid, mtime, len(lines)))
            n_new += 1
        con.commit()
        con.close()
        return n_new

    def search(self, q, limit=50):
        q = (q or "").strip()
        if not q:
            return [], 0
        # The query is also split character by character and wrapped as a phrase query -- this way a term only matches when its characters are adjacent,
        # and won't dredge up sentences where the characters happen to appear scattered apart.
        toks = self._tok(q)
        if not toks:
            return [], 0
        expr = 'body : "' + toks.replace('"', "") + '"'
        con = self._db()
        try:
            rows = con.execute(
                "SELECT sid,line_id,ts,start,speaker,kind,text FROM lines "
                "WHERE lines MATCH ? ORDER BY rank LIMIT ?", (expr, limit)).fetchall()
            total = con.execute("SELECT count(*) FROM lines WHERE lines MATCH ?",
                                (expr,)).fetchone()[0]
        except sqlite3.OperationalError:
            return [], 0
        finally:
            con.close()
        return [{"sid": r[0], "line_id": r[1], "ts": r[2], "start": r[3],
                 "speaker": r[4], "kind": r[5] or None, "text": r[6]} for r in rows], total

    # ---------------- whiteboard screenshots ----------------
    def shots_dir(self, sid):
        return os.path.join(self.root, os.path.basename(sid), "shots")

    def shots(self, sid):
        p = os.path.join(self.shots_dir(sid), "shots.json")
        if not os.path.exists(p):
            return []
        try:
            with open(p, encoding="utf-8") as f:
                return sorted(json.load(f), key=lambda s: s.get("at", 0))
        except Exception:
            return []

    def _save_shots(self, sid, data):
        d = self.shots_dir(sid)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "shots.json"), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def add_shot(self, sid, at, raw_bytes, ext="jpg", note=""):
        d = self.shots_dir(sid)
        os.makedirs(d, exist_ok=True)
        shots = self.shots(sid)
        sid_num = max([int(s["id"].split("_")[-1]) for s in shots] or [0]) + 1
        name = f"shot_{sid_num:03d}.{ext}"
        with open(os.path.join(d, name), "wb") as f:
            f.write(raw_bytes)
        s = int(at)
        item = {"id": f"shot_{sid_num:03d}", "file": name, "at": round(float(at), 2),
                "ts": f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}",
                "note": note, "created": _now(),
                "size": len(raw_bytes)}
        shots.append(item)
        self._save_shots(sid, shots)
        return item

    def update_shot(self, sid, shot_id, note):
        shots = self.shots(sid)
        for s in shots:
            if s["id"] == shot_id:
                s["note"] = note
                self._save_shots(sid, shots)
                return s
        return None

    def delete_shot(self, sid, shot_id):
        shots = self.shots(sid)
        keep = [s for s in shots if s["id"] != shot_id]
        gone = [s for s in shots if s["id"] == shot_id]
        for s in gone:
            try:
                os.remove(os.path.join(self.shots_dir(sid), s["file"]))
            except OSError:
                pass
        self._save_shots(sid, keep)
        return len(gone) > 0
