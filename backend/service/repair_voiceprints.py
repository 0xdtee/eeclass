# -*- coding: utf-8 -*-
"""Repair voiceprint naming damaged by registry drift (dry-run by default; --apply to write).

Before the fix, an account's voiceprint library held only a pid into the global registry, and every finished
recording folded its speakers into that registry. An enrolled person's centroid drifted toward whoever
sounded roughly alike, and with a loose match threshold their name got stamped on teachers who never spoke
to the account owner. This script, per account:

1. Library: every entry without its own frozen vector gets one rebuilt from the account's sessions where a
   speaker was explicitly named that (speaker_names.json) and whose voiceprint is cached (speakers.json).
   Entries with no such source are reported and left on the registry fallback -- re-tag or delete them.
2. Transcripts: lines labelled with a library name are re-checked against the (repaired) frozen vectors,
   one name per speaker per session, at the strict threshold. Speakers that no longer match get the name
   the same speaker_id already carries elsewhere in that session (e.g. 老师), else the default 老师/同学X.
   Speakers explicitly renamed in speaker_names.json are left alone.

Every file written is first copied to <file>.bak-<timestamp>.

    python repair_voiceprints.py [--account jerry_test] [--records ../records] [--threshold 0.45] [--embed] [--apply]

Only cached voiceprints (speakers.json) are used unless --embed is given, which computes missing ones from
audio.wav (loads each whole recording into memory -- heavy on a live server).

--account matches the start of the library file id (lib_<id>.json); 'owner' means library.json.
"""
import argparse
import json
import os
import shutil
import sys
import time

import numpy as np

import voiceprint
from speaker import VOICEPRINT_THRESHOLD, assign_library_names

HERE = os.path.dirname(os.path.abspath(__file__))
# Tags of one person agree with their mean at ~0.85-0.95; well below that is someone else.
TAG_AGREEMENT = 0.6


def _load_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _norm(e):
    e = np.asarray(e if e is not None else [], dtype=np.float32)
    n = np.linalg.norm(e)
    return e / n if n > 0 else e


def default_name(idx):
    # same as server.speaker_name (not imported: server.py pulls in the whole service at import time)
    return "老师" if idx == 0 else "同学" + "ABCDEFG"[(idx - 1) % 7]


def _backup_write(path, write, stamp, apply):
    if not apply:
        return
    if os.path.exists(path):
        shutil.copy2(path, f"{path}.bak-{stamp}")
    write(path)


def _session_owner(d):
    for fn in ("meta.json", "owner.json"):
        o = (_load_json(os.path.join(d, fn), {}) or {}).get("owner")
        if o:
            return o
    return None


def _accounts(vpdir, want):
    """[(library file, owner id as stored in sessions)]."""
    out = []
    for fn in sorted(os.listdir(vpdir)):
        if fn == "library.json":
            owner = "owner"
        elif fn.startswith("lib_") and fn.endswith(".json"):
            owner = fn[4:-5]
        else:
            continue
        if want and not owner.startswith(want):
            continue
        out.append((os.path.join(vpdir, fn), owner))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--account", default="")
    ap.add_argument("--records", default="")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--threshold", type=float, default=None,
                    help="match threshold (default: config speaker.voiceprint_threshold, else %s)" % VOICEPRINT_THRESHOLD)
    ap.add_argument("--embed", action="store_true", help="compute voiceprints missing from speakers.json")
    a = ap.parse_args()

    cfg = _load_json(os.path.join(HERE, "config.json"), {}) or {}
    root = os.path.abspath(a.records) if a.records else os.path.normpath(
        os.path.join(HERE, (cfg.get("server") or {}).get("records_dir", "../records")))
    th = a.threshold if a.threshold is not None else float(
        (cfg.get("speaker") or {}).get("voiceprint_threshold", VOICEPRINT_THRESHOLD))
    vpdir = os.path.join(root, "voiceprints")
    stamp = time.strftime("%Y%m%d-%H%M%S")
    print(f"records: {root}\nmatch threshold: {th}\nmode: {'APPLY' if a.apply else 'dry-run (nothing written)'}")
    if th < VOICEPRINT_THRESHOLD:
        print(f"  ! config.json speaker.voiceprint_threshold={th} is below the recommended {VOICEPRINT_THRESHOLD}")

    embedder = None

    def session_voices(d):
        nonlocal embedder
        cached = _load_json(os.path.join(d, "speakers.json"))
        if cached is not None:
            return cached
        if not a.embed or not os.path.exists(os.path.join(d, "audio.wav")):
            return None
        if embedder is None:
            from speaker import SpeakerID
            embedder = SpeakerID(cfg)
            if not embedder.enabled:
                sys.exit(f"voiceprint model unavailable: {embedder.err}")
        return voiceprint.extract_session_voices(d, embedder.embed, write_cache=a.apply)

    accounts = _accounts(vpdir, a.account)
    if not accounts:
        sys.exit("no matching account library")
    sessions = [os.path.join(root, s) for s in sorted(os.listdir(root))
                if os.path.isdir(os.path.join(root, s)) and s != "voiceprints"]

    for libpath, owner in accounts:
        lib = _load_json(libpath, []) or []
        mine = [d for d in sessions if _session_owner(d) == owner]
        print(f"\n===== {os.path.basename(libpath)}  ({len(lib)} entries, {len(mine)} sessions)")

        # ---- 1. frozen vectors for entries that only have a pid
        lib_changed = False
        for v in lib:
            if v.get("embedding"):
                print(f"  [{v.get('name')}] already has its own vector (n={v.get('n', 1)})")
                continue
            embs, srcs = [], []
            for d in mine:
                names = _load_json(os.path.join(d, "speaker_names.json"), {}) or {}
                ids = [int(k) for k, nm in names.items() if nm == v.get("name")]
                if not ids:
                    continue
                for sp in (session_voices(d) or {}).get("speakers", []):
                    if sp.get("idx") in ids and sp.get("embedding"):
                        embs.append(_norm(sp["embedding"]))
                        srcs.append(f"{os.path.basename(d)}#{sp['idx']}({sp.get('seconds')}s)")
            if not embs:
                print(f"  [{v.get('name')}] NO tagged source found -- still on the drifting registry centroid; re-tag or delete it")
                continue
            c = _norm(np.sum(embs, axis=0))
            if len(embs) > 1:
                sims = [round(float(e @ c), 3) for e in embs]
                print(f"  [{v.get('name')}] tag agreement with their mean: {sims}")
                # a tag far from the others is most likely a past false backfill, not this person: leave it out
                keep = [i for i, s in enumerate(sims) if s >= TAG_AGREEMENT]
                if keep and len(keep) < len(embs):
                    print(f"  [{v.get('name')}] dropped as outliers (< {TAG_AGREEMENT}): "
                          f"{', '.join(srcs[i] for i in range(len(embs)) if i not in keep)}")
                    embs, srcs = [embs[i] for i in keep], [srcs[i] for i in keep]
                    c = _norm(np.sum(embs, axis=0))
            v["embedding"] = [float(x) for x in c]
            v["n"] = len(embs)
            lib_changed = True
            print(f"  [{v.get('name')}] rebuilt from {len(embs)} tagged speaker(s): {', '.join(srcs)}")
        if lib_changed:
            def _w(p, lib=lib):
                with open(p + ".part", "w", encoding="utf-8") as f:
                    json.dump(lib, f, ensure_ascii=False)
                os.replace(p + ".part", p)
            _backup_write(libpath, _w, stamp, a.apply)

        library = [(v.get("name", ""), _norm(v["embedding"])) for v in lib if v.get("embedding")]
        lib_names = {v.get("name") for v in lib}

        # ---- 2. transcripts
        total_fixed = 0
        for d in mine:
            tp = os.path.join(d, "transcript.jsonl")
            if not os.path.exists(tp):
                continue
            try:
                with open(tp, encoding="utf-8") as f:
                    lines = [json.loads(x) for x in f if x.strip()]
            except Exception:
                print(f"  ! {os.path.basename(d)}: unreadable transcript, skipped")
                continue
            flagged = {int(L.get("speaker_id", 0) or 0) for L in lines if L.get("speaker") in lib_names}
            if not flagged:
                continue
            manual = {int(k) for k in (_load_json(os.path.join(d, "speaker_names.json"), {}) or {})}
            voices = {sp["idx"]: _norm(sp["embedding"]) for sp in (session_voices(d) or {}).get("speakers", [])
                      if sp.get("embedding")}
            matched = assign_library_names(voices, library, th) if library else {}
            final, why = {}, {}
            for sid in sorted(flagged):
                if sid in manual:
                    continue
                if sid in matched:
                    final[sid] = matched[sid]
                    sim = max(float(voices[sid] @ e) for nm, e in library if nm == matched[sid])
                    why[sid] = f"voice matches {matched[sid]} ({sim:.3f})"
                    continue
                others = {}
                for L in lines:
                    if int(L.get("speaker_id", 0) or 0) == sid and L.get("speaker") not in lib_names:
                        others[L.get("speaker")] = others.get(L.get("speaker"), 0) + 1
                final[sid] = max(others, key=others.get) if others else default_name(sid)
                best = max((float(voices[sid] @ e) for _, e in library), default=None) if sid in voices else None
                why[sid] = ("no cached voiceprint" if best is None else f"best library sim {best:.3f} < {th}")
            n = 0
            for L in lines:
                sid = int(L.get("speaker_id", 0) or 0)
                if sid in final and L.get("speaker") in lib_names and L.get("speaker") != final[sid]:
                    L["speaker"] = final[sid]
                    n += 1
            if not n:
                continue
            total_fixed += n
            desc = "; ".join(f"id{sid}->{final[sid]} ({why[sid]})" for sid in final)
            print(f"  {os.path.basename(d)}: {n} line(s) relabelled  [{desc}]")

            def _w(p, lines=lines):
                with open(p + ".tmp", "w", encoding="utf-8") as f:
                    for L in lines:
                        f.write(json.dumps(L, ensure_ascii=False) + "\n")
                os.replace(p + ".tmp", p)
            _backup_write(tp, _w, stamp, a.apply)
        print(f"  transcripts: {total_fixed} line(s) {'relabelled' if a.apply else 'would be relabelled'}")

    if not a.apply:
        print("\nDry run only. Re-run with --apply to write (each file is backed up first).")


if __name__ == "__main__":
    main()
