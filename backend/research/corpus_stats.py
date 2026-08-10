# -*- coding: utf-8 -*-
"""Paper-ready statistics over the accumulated research corpus (built by collect_corpus.py).

Reports the dataset section + baseline error analysis a paper needs:
  · corpus size and growth over time (sessions / hours / characters / labelled homophone pairs)
  · runtime coverage per ASR backend (sessions, mean RTF) -- for the systems angle
  · human-edit error taxonomy (homophone vs other, same-length vs length-changing, char-diff/edit-distance)
  · CER anchored to the raw ASR output on human-reviewed lines
  · AI-corrector vs human agreement (precision / miss-rate / silently-accepted) -- the real-world value of
    the AI correction layer, measured against human ground truth
  · homophone-term vocabulary and per-subject homophone-error rate

Usage:  ../.venv/bin/python research/corpus_stats.py
"""
import json
import os
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(HERE, "corpus")


def load(name):
    p = os.path.join(CORPUS, name)
    if not os.path.exists(p):
        return []
    return [json.loads(l) for l in open(p, encoding="utf-8") if l.strip()]


def lev(a, b):
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


def pct(a, b):
    return f"{(a / b * 100):.1f}%" if b else "—"


def main():
    sessions = load("sessions.jsonl")
    corr = load("corrections.jsonl")
    homo = load("homophone_pairs.jsonl")
    if not sessions:
        print("empty corpus -- run collect_corpus.py first (on the machine that holds records/).")
        return

    human = [c for c in corr if c["source"] == "human"]
    ai = [c for c in corr if c["source"] == "ai"]
    total_chars = sum(s["n_chars"] for s in sessions)
    total_hours = sum((s.get("duration_s") or 0) for s in sessions) / 3600.0

    print("=" * 70)
    print("CORPUS OVERVIEW")
    print("=" * 70)
    print(f"sessions:            {len(sessions)}")
    print(f"audio hours:         {total_hours:.1f}")
    print(f"transcript chars:    {total_chars:,}")
    print(f"human edits:         {len(human)}")
    print(f"ai edits:            {len(ai)}")
    print(f"labelled homophone pairs (human): {len(homo)}")

    # growth by month
    by_month = defaultdict(lambda: {"sessions": 0, "chars": 0, "homo": 0})
    for s in sessions:
        mo = (s.get("date") or "")[:7]
        by_month[mo]["sessions"] += 1
        by_month[mo]["chars"] += s["n_chars"]
        by_month[mo]["homo"] += s.get("n_homophone_human", 0)
    print("\ngrowth by month:")
    print(f"  {'month':<9}{'sessions':>9}{'chars':>10}{'homo_pairs':>12}")
    for mo in sorted(by_month):
        m = by_month[mo]
        print(f"  {mo:<9}{m['sessions']:>9}{m['chars']:>10,}{m['homo']:>12}")

    print("\n" + "=" * 70)
    print("RUNTIME COVERAGE PER ASR BACKEND  (systems angle)")
    print("=" * 70)
    per_be = defaultdict(lambda: {"n": 0, "rtf": [], "hours": 0.0})
    for s in sessions:
        be = s.get("backend") or "?"
        per_be[be]["n"] += 1
        if isinstance(s.get("rtf"), (int, float)):
            per_be[be]["rtf"].append(s["rtf"])
        per_be[be]["hours"] += (s.get("duration_s") or 0) / 3600.0
    print(f"  {'backend':<18}{'sessions':>9}{'hours':>8}{'mean_RTF':>10}")
    for be in sorted(per_be, key=lambda b: -per_be[b]["n"]):
        v = per_be[be]
        mr = sum(v["rtf"]) / len(v["rtf"]) if v["rtf"] else float("nan")
        print(f"  {be:<18}{v['n']:>9}{v['hours']:>8.1f}{mr:>10.3f}")

    print("\n" + "=" * 70)
    print("HUMAN-EDIT ERROR TAXONOMY  (ground truth)")
    print("=" * 70)
    if human:
        n_homo = sum(1 for c in human if c["is_homophone"])
        n_same = sum(1 for c in human if c["same_len"])
        print(f"  homophone (same-len, all diffs homophonic): {n_homo}/{len(human)} = {pct(n_homo, len(human))}")
        print(f"  same length (substitution-only):            {n_same}/{len(human)} = {pct(n_same, len(human))}")
        cd = Counter(min(c["n_char_diff"], 5) for c in human if c["same_len"])
        print("  char-diff per same-length edit:  " + "  ".join(f"{k}{'+' if k == 5 else ''}:{cd[k]}" for k in sorted(cd)))
        ed = Counter(min(c["edit_distance"], 6) for c in human)
        print("  edit-distance histogram:         " + "  ".join(f"{k}{'+' if k == 6 else ''}:{ed[k]}" for k in sorted(ed)))

        # CER anchored to raw ASR output on human-reviewed lines
        d = sum(lev(c["raw_original"], c["after"]) for c in human if c.get("raw_original"))
        nchar = sum(len(c["after"]) for c in human if c.get("raw_original"))
        print(f"  CER on human-reviewed lines (raw ASR vs human final): {pct(d, nchar)}  ({d}/{nchar} chars)")
    else:
        print("  (no human edits yet)")

    print("\n" + "=" * 70)
    print("AI-CORRECTOR vs HUMAN GROUND TRUTH")
    print("=" * 70)
    # last human / ai / raw per (sid, line_id)
    hmap, amap, rawmap = {}, {}, {}
    for c in corr:
        key = (c["sid"], c["line_id"])
        if c["source"] == "human":
            hmap[key] = c["after"]
        else:
            amap[key] = c["after"]
        if c.get("raw_original"):
            rawmap.setdefault(key, c["raw_original"])
    both = [k for k in amap if k in hmap]
    ai_only = [k for k in amap if k not in hmap]
    human_only = [k for k in hmap if k not in amap]
    if amap or hmap:
        agree = sum(1 for k in both if amap[k] == hmap[k])
        print(f"  lines AI-corrected & then human-edited: {len(both)}")
        print(f"    AI == human final (AI was right):     {agree}/{len(both)} = {pct(agree, len(both))}")
        print(f"    human overrode the AI correction:     {len(both) - agree}/{len(both)} = {pct(len(both) - agree, len(both))}")
        print(f"  lines AI-corrected, human never edited (silently accepted): {len(ai_only)}")
        print(f"  lines human-edited but AI never corrected (AI missed):      {len(human_only)}")
    else:
        print("  (no edits yet)")

    print("\n" + "=" * 70)
    print("HOMOPHONE VOCABULARY & PER-SUBJECT ERROR RATE")
    print("=" * 70)
    vocab = Counter()
    for h in homo:
        for t in h.get("terms", []):
            vocab[t] += 1
    print(f"  unique candidate homophone terms: {len(vocab)}")
    if vocab:
        top = "  ".join(f"{t}({n})" for t, n in vocab.most_common(15))
        print(f"  top terms: {top}")
    subj = defaultdict(lambda: {"homo": 0, "chars": 0})
    for s in sessions:
        subj[s.get("subject") or "?"]["homo"] += s.get("n_homophone_human", 0)
        subj[s.get("subject") or "?"]["chars"] += s["n_chars"]
    rows = sorted(subj.items(), key=lambda kv: -kv[1]["homo"])[:12]
    print(f"\n  {'subject':<20}{'homo_pairs':>11}{'chars':>10}{'per_10k_chars':>14}")
    for name, v in rows:
        rate = v["homo"] / v["chars"] * 10000 if v["chars"] else 0
        print(f"  {str(name)[:20]:<20}{v['homo']:>11}{v['chars']:>10,}{rate:>14.2f}")


if __name__ == "__main__":
    main()
