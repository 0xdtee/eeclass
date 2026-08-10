# -*- coding: utf-8 -*-
"""Accumulate a labelled parallel translation corpus from recorded classroom sessions.

Why this exists: every recognized caption line may be translated live (recognizer does ASR, an LLM does the
translation into one of nine languages). Each session records its language pair in meta.json (translate_from is
also the recognized source language for the multilingual/Gummy backend; translate_to is the target). Joining the
per-line source text (transcript.jsonl) with the per-line translation (translations.json) yields a domain-specific
(classroom) parallel corpus with language labels -- the data a paper on real-time multilingual educational
captioning / decoupled ASR+MT would need.

Companion to collect_corpus.py (which builds the homophone-correction dataset); this one covers the multilingual
recognition + translation direction. Pure read-only over records/; rescans idempotently, safe to run from cron.

Outputs (research/corpus/):
  · parallel.jsonl            —— one row per translated line: (src_lang, tgt_lang, source_text, target_text) plus
                                 provenance and whether the source line was human-reviewed (a cleaner eval subset).
  · multilingual_sessions.jsonl —— one row per session: language pair, backend, line/char/hour counts, whether it
                                 used the multilingual recognizer -- feeds the coverage/growth stats.

Usage:  ../.venv/bin/python research/collect_translation.py [--root <records_dir>]
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from collect_corpus import (   # noqa: E402  (reuse the shared scan helpers)
    AI_BY, DEFAULT_ROOT, OUT_DIR, read_jsonl, load_meta, subject_of, write_jsonl,
)

# Recognizer backends that actually read a non-Chinese/foreign source language (the multilingual claim).
MULTILINGUAL_BACKENDS = {"aliyun_gummy"}


def scan(root):
    parallel, sessions = [], []
    dir_counter = {}
    for name in sorted(os.listdir(root)):
        d = os.path.join(root, name)
        tp = os.path.join(d, "transcript.jsonl")
        if not os.path.isdir(d) or not os.path.exists(tp):
            continue
        meta = load_meta(d)
        src_lang = meta.get("translate_from") or ""
        tgt_lang = meta.get("translate_to") or ""
        backend = meta.get("backend", "")
        subject = subject_of(name, meta)
        date = name[:10] if len(name) >= 10 else ""
        translation_on = bool(src_lang) and bool(tgt_lang) and src_lang != tgt_lang

        raw = {}
        for j in read_jsonl(tp):
            if "id" in j:
                raw[j["id"]] = j.get("text", "")

        # line ids a human (not the AI corrector) edited -> the source text was reviewed -> a cleaner eval subset
        human_edited = set()
        for e in read_jsonl(os.path.join(d, "edits.jsonl")):
            if e.get("by") not in AI_BY and e.get("line_id") is not None:
                human_edited.add(e["line_id"])

        # translations.json: {line-id-as-string: translated text}
        trans = {}
        tpath = os.path.join(d, "translations.json")
        if os.path.exists(tpath):
            import json
            try:
                trans = json.load(open(tpath, encoding="utf-8"))
            except Exception:
                trans = {}

        n_translated = 0
        for lid_str, target_text in trans.items():
            try:
                lid = int(lid_str)
            except (TypeError, ValueError):
                continue
            source_text = raw.get(lid, "")
            target_text = (target_text or "").strip()
            if not source_text or not target_text:
                continue
            n_translated += 1
            dir_key = f"{src_lang}->{tgt_lang}"
            dir_counter[dir_key] = dir_counter.get(dir_key, 0) + 1
            parallel.append({
                "sid": name, "date": date, "subject": subject, "backend": backend,
                "src_lang": src_lang, "tgt_lang": tgt_lang,
                "line_id": lid,
                "source_text": source_text, "target_text": target_text,
                "src_chars": len(source_text), "tgt_chars": len(target_text),
                "source_human_reviewed": lid in human_edited,
            })

        n_chars = sum(len(t) for t in raw.values())
        sessions.append({
            "sid": name, "date": date, "subject": subject, "backend": backend,
            "src_lang": src_lang, "tgt_lang": tgt_lang, "translation_on": translation_on,
            "multilingual": backend in MULTILINGUAL_BACKENDS,
            "n_lines": len(raw), "n_translated": n_translated,
            "n_source_chars": n_chars,
            "duration_s": meta.get("duration_s"),
        })
    return parallel, sessions, dir_counter


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=DEFAULT_ROOT, help="records/ directory to scan")
    args = ap.parse_args()
    if not os.path.isdir(args.root):
        print(f"records dir not found: {args.root}", file=sys.stderr)
        sys.exit(1)

    parallel, sessions, dir_counter = scan(args.root)
    os.makedirs(OUT_DIR, exist_ok=True)
    write_jsonl(os.path.join(OUT_DIR, "parallel.jsonl"), parallel)
    write_jsonl(os.path.join(OUT_DIR, "multilingual_sessions.jsonl"), sessions)

    reviewed = sum(1 for r in parallel if r["source_human_reviewed"])
    ml_sessions = [s for s in sessions if s["multilingual"]]
    src_langs = {}
    for r in parallel:
        src_langs[r["src_lang"]] = src_langs.get(r["src_lang"], 0) + 1
    hours = sum((s["duration_s"] or 0) for s in sessions if s["translation_on"]) / 3600.0

    print(f"scanned {len(sessions)} sessions from {args.root}")
    print(f"  parallel translation pairs: {len(parallel)}  (human-reviewed source: {reviewed})")
    print(f"  translated audio hours: {hours:.1f}")
    print(f"  by direction: {dict(sorted(dir_counter.items(), key=lambda kv: -kv[1]))}")
    print(f"  by source language: {dict(sorted(src_langs.items(), key=lambda kv: -kv[1]))}")
    print(f"  multilingual-recognizer sessions: {len(ml_sessions)}")
    print(f"  -> {OUT_DIR}/{{parallel,multilingual_sessions}}.jsonl")


if __name__ == "__main__":
    main()
