# -*- coding: utf-8 -*-
"""Accumulate a research corpus from every recorded classroom session under records/.

Why this exists: the raw ASR output (transcript.jsonl) is never overwritten; every fix is appended to
edits.jsonl with a `by` field. Human edits (by="我") are GROUND TRUTH; AI edits (by="AI纠错"/"方言润色")
are the SYSTEM's own output. Evaluating the correction system against its own AI edits would be circular,
so this collector strictly separates the two and builds the reference from HUMAN edits only.

Outputs (research/corpus/):
  · sessions.jsonl      —— one row per session: backend/model/rtf/duration/speaker + edit counts + subject.
                           (feeds both the correction dataset stats AND the systems-paper runtime metrics.)
  · corrections.jsonl   —— one row per edit instance, labelled human/ai, homophone-classified, with metadata.
  · homophone_pairs.jsonl —— the labelled (wrong -> right) HUMAN homophone-error dataset (the core corpus
                             for the pinyin-homophone correction paper), deduplicated with provenance.

Run it repeatedly (e.g. from cron) to grow the corpus as recordings accumulate; it rescans everything and
rewrites the corpus idempotently. Pure read-only over records/ — never modifies session data.

Usage:  ../.venv/bin/python research/collect_corpus.py [--root <records_dir>]
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "service"))
from pypinyin import lazy_pinyin   # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ROOT = os.path.normpath(os.path.join(HERE, "..", "records"))
OUT_DIR = os.path.join(HERE, "corpus")

# `by` values written by the system's own correction (NOT ground truth). Everything else is a human edit.
AI_BY = {"AI纠错", "方言润色"}

HAN = lambda c: "一" <= c <= "鿿"   # noqa: E731  (CJK unified ideographs)


def py(s):
    return "".join(lazy_pinyin(s))


def lev(a, b):
    """Character-level Levenshtein distance."""
    m, n = len(a), len(b)
    if m == 0 or n == 0:
        return max(m, n)
    prev = list(range(n + 1))
    for i in range(1, m + 1):
        cur = [i] + [0] * n
        for j in range(1, n + 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] != b[j - 1]))
        prev = cur
    return prev[n]


def classify_edit(before, after):
    """Return (same_len, is_homophone, n_char_diff, edit_distance, diff_pairs).

    is_homophone: same length AND every differing character is a homophone (same toneless pinyin) of the
    original -- i.e. a pure ASR homophone substitution that swapping the acoustic model cannot fix.
    diff_pairs: [(wrong_char, right_char), ...] for the aligned same-length case (empty otherwise).
    """
    same_len = len(before) == len(after)
    ed = lev(before, after)
    if same_len and before != after:
        diffs = [(before[i], after[i]) for i in range(len(before)) if before[i] != after[i]]
        homophone = bool(diffs) and all(py(x) == py(y) and HAN(x) and HAN(y) for x, y in diffs)
        return same_len, homophone, len(diffs), ed, diffs
    return same_len, False, ed, ed, []


def homophone_terms(before, after, diffs):
    """Expand each corrected character into 2-3 char candidate terms (the vocabulary a term-list would need)."""
    terms = set()
    n = len(after)
    idx = [i for i, (x, y) in zip(range(n), diffs)] if diffs else [i for i in range(n) if i < len(before) and before[i] != after[i]]
    idx = [i for i in range(len(after)) if i < len(before) and before[i] != after[i]]
    for i in idx:
        for lo, hi in ((i - 1, i + 1), (i, i + 2), (i - 2, i + 1), (i - 1, i + 2)):
            lo, hi = max(0, lo), min(n, hi)
            w = after[lo:hi]
            if len(w) >= 2 and all(HAN(c) for c in w):
                terms.add(w)
    return sorted(terms)


def read_jsonl(path):
    if not os.path.exists(path):
        return []
    out = []
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except Exception:
            pass
    return out


def load_meta(d):
    p = os.path.join(d, "meta.json")
    try:
        return json.load(open(p, encoding="utf-8"))
    except Exception:
        return {}


def subject_of(name, meta):
    """Best-effort subject/course label: meta course/subjects, else the title part of the session dir name."""
    if meta.get("course_name"):
        return meta["course_name"]
    subs = meta.get("subjects")
    if isinstance(subs, list) and subs:
        return subs[0]
    m = name  # 2026-07-30_1825_高等数学 -> 高等数学
    parts = name.split("_", 2)
    return parts[2] if len(parts) == 3 else name


def scan(root):
    sessions, corrections, homo_pairs = [], [], []
    by_counter = {}
    for name in sorted(os.listdir(root)):
        d = os.path.join(root, name)
        tp = os.path.join(d, "transcript.jsonl")
        if not os.path.isdir(d) or not os.path.exists(tp):
            continue
        raw = {}
        for j in read_jsonl(tp):
            if "id" in j:
                raw[j["id"]] = j.get("text", "")
        edits = read_jsonl(os.path.join(d, "edits.jsonl"))
        meta = load_meta(d)
        subject = subject_of(name, meta)
        date = name[:10] if len(name) >= 10 else ""

        n_human = n_ai = n_homo_human = 0
        for e in edits:
            before, after = e.get("before", ""), e.get("after", "")
            by = e.get("by", "")
            by_counter[by] = by_counter.get(by, 0) + 1
            source = "ai" if by in AI_BY else "human"
            same_len, is_homo, n_diff, ed, diffs = classify_edit(before, after)
            row = {
                "sid": name, "date": date, "subject": subject,
                "backend": meta.get("backend", ""), "model": meta.get("model", ""),
                "line_id": e.get("line_id"), "ts": e.get("ts", ""), "at": e.get("at", ""),
                "by": by, "source": source,
                # raw_original = the untouched ASR output for this line (edits' `before` may already be
                # AI-corrected, so anchor CER to the true model output).
                "raw_original": raw.get(e.get("line_id"), ""),
                "before": before, "after": after,
                "same_len": same_len, "is_homophone": is_homo,
                "n_char_diff": n_diff, "edit_distance": ed,
            }
            corrections.append(row)
            if source == "human":
                n_human += 1
                if is_homo:
                    n_homo_human += 1
                    homo_pairs.append({
                        "sid": name, "subject": subject, "backend": meta.get("backend", ""),
                        "before": before, "after": after,
                        "diff_pairs": diffs, "terms": homophone_terms(before, after, diffs),
                    })
            else:
                n_ai += 1

        n_chars = sum(len(t) for t in raw.values())
        speakers = meta.get("speakers", []) or []
        sessions.append({
            "sid": name, "date": date, "subject": subject,
            "backend": meta.get("backend", ""), "model": meta.get("model", ""),
            "rtf": meta.get("rtf"), "duration_s": meta.get("duration_s"),
            "n_lines": len(raw), "n_chars": n_chars,
            "n_speakers": len(speakers),
            "n_edits": len(edits), "n_human_edits": n_human, "n_ai_edits": n_ai,
            "n_homophone_human": n_homo_human,
        })
    return sessions, corrections, homo_pairs, by_counter


def write_jsonl(path, rows):
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=DEFAULT_ROOT, help="records/ directory to scan")
    args = ap.parse_args()

    if not os.path.isdir(args.root):
        print(f"records dir not found: {args.root}", file=sys.stderr)
        sys.exit(1)

    sessions, corrections, homo_pairs, by_counter = scan(args.root)
    os.makedirs(OUT_DIR, exist_ok=True)
    write_jsonl(os.path.join(OUT_DIR, "sessions.jsonl"), sessions)
    write_jsonl(os.path.join(OUT_DIR, "corrections.jsonl"), corrections)
    write_jsonl(os.path.join(OUT_DIR, "homophone_pairs.jsonl"), homo_pairs)

    n_human = sum(1 for c in corrections if c["source"] == "human")
    n_ai = sum(1 for c in corrections if c["source"] == "ai")
    print(f"scanned {len(sessions)} sessions from {args.root}")
    print(f"  corrections: {len(corrections)}  (human {n_human} / ai {n_ai})")
    print(f"  human homophone pairs (labelled dataset): {len(homo_pairs)}")
    print(f"  total transcript chars: {sum(s['n_chars'] for s in sessions)}")
    print(f"  edit `by` distribution: {by_counter}")
    print(f"  -> {OUT_DIR}/{{sessions,corrections,homophone_pairs}}.jsonl")


if __name__ == "__main__":
    main()
