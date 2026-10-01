# -*- coding: utf-8 -*-
"""Pick the built-in term list for a class from its title / subject tags / course name.

Course hotwords only apply to classes bound to a course in the course library, which classes started from
the timetable never are -- so in practice no class ever got any. These lists come from the textbooks of
common first-year courses and attach by name instead: 「高等数学A(1) 第3课」 gets the calculus terms.
records/subject_terms.json, when present, replaces the shipped subject_terms.json.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
_cache = {}


def _load(records_root):
    paths = ([os.path.join(records_root, "subject_terms.json")] if records_root else []) +         [os.path.join(HERE, "subject_terms.json")]
    for p in paths:
        try:
            mtime = os.path.getmtime(p)
        except OSError:
            continue
        hit = _cache.get(p)
        if hit and hit[0] == mtime:
            return hit[1]
        try:
            with open(p, encoding="utf-8") as f:
                subjects = (json.load(f) or {}).get("subjects") or []
        except Exception as e:
            print(f"⚠️ 科目术语表读取失败 {p}: {e}", flush=True)
            continue
        _cache[p] = (mtime, subjects)
        return subjects
    return []


def match(context, records_root=None):
    """[(subject name, terms, cloud_only)] for every subject whose `match` occurs in `context` and no `unless`
    does. cloud_only: terms that may bias the cloud recognizer but must not drive local replacement."""
    context = context or ""
    out = []
    for s in _load(records_root):
        if any(m in context for m in s.get("match") or []) and not any(u in context for u in s.get("unless") or []):
            out.append((s.get("name", ""), list(s.get("terms") or []), set(s.get("cloud_only") or [])))
    return out


def local_terms(terms, cloud_only):
    """The subset safe for the local homophone fixer: 3+ characters (two-character ones collide with
    everyday words -- 可积/科技, 极值/机制, 边际/编辑) and not marked cloud-only."""
    return [t for t in terms if len(t) >= 3 and t not in cloud_only]
