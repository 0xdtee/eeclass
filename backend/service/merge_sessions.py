# -*- coding: utf-8 -*-
"""Merge a class that got split in two back into one (dry-run by default; --apply to write).

    python merge_sessions.py <first sid> <second sid> [--records ../records] [--apply]

The second class is folded into the first exactly the way a continued recording would have written it:
its lines get ids after the first's and times shifted by the first's audio length, its audio is appended
to the first's audio.wav, board shots move with their times shifted, and per-line side files
(marks.json, translations.json, edits.jsonl) follow the new ids. The first class's meta.json and its
database row get the combined length and line count; the second class leaves the database and the search
index, and its whole directory is MOVED (never deleted) out of records into ../merged-sessions/.

Before writing, every file of the first class that changes -- including its original audio -- is copied to
../merged-sessions/backup-<first sid>-<stamp>/, so the merge can be undone by copying them back.
Audio offloaded to OSS is fetched first; the OSS sync then uploads the merged file on its next pass.
The merged class keeps the first class's title, unless that is only the default 「课程 MM-DD HH:MM」 and the
second has a real one. It keeps the summary of the LONGER part (a 40-second false start must not replace the
summary of the 100-minute class behind it); regenerate it to cover the whole class.
"""
import argparse
import json
import os
import re
import shutil
import sys
import tempfile
import time

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
SR = 16000
# the title a class gets when nobody named it (server: "课程 MM-DD HH:MM"; English UI: "Course ...")
DEFAULT_TITLE = re.compile(r"^(课程|Course) \d{2}-\d{2} \d{2}:?\d{2}$")


def _load_json(p, default):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _write_json(p, data):
    with open(p + ".tmp", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(p + ".tmp", p)


def _lines(d):
    p = os.path.join(d, "transcript.jsonl")
    out = []
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            for ln in f:
                if ln.strip():
                    out.append(json.loads(ln))
    return out


def _ts(sec):
    s = int(sec)
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def _owner(d):
    return (_load_json(os.path.join(d, "meta.json"), {}) or {}).get("owner") or \
        (_load_json(os.path.join(d, "owner.json"), {}) or {}).get("owner")


def _audio(d, root, tmpdir):
    """Path to this class's audio, fetching it from OSS when it was offloaded; None if it exists nowhere."""
    local = os.path.join(d, "audio.wav")
    if os.path.exists(local):
        return local, "local"
    try:
        import oss_store
        if oss_store.enabled():
            rel = os.path.relpath(local, root).replace(os.sep, "/")
            dst = os.path.join(tmpdir, os.path.basename(d) + ".wav")
            if oss_store.download_to(rel, dst):
                return dst, "oss"
    except Exception as e:
        print(f"  ! OSS fetch failed for {os.path.basename(d)}: {e}")
    return None, "missing"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("first")
    ap.add_argument("second")
    ap.add_argument("--records", default="")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    cfg = _load_json(os.path.join(HERE, "config.json"), {}) or {}
    root = os.path.abspath(a.records) if a.records else os.path.normpath(
        os.path.join(HERE, (cfg.get("server") or {}).get("records_dir", "../records")))
    A, B = os.path.join(root, a.first), os.path.join(root, a.second)
    for d in (A, B):
        if not os.path.isdir(d):
            sys.exit(f"no such class: {d}")
    if _owner(A) != _owner(B):
        sys.exit(f"different accounts: {_owner(A)} vs {_owner(B)}")
    if a.first >= a.second:
        sys.exit("give the earlier class first")

    stamp = time.strftime("%Y%m%d-%H%M%S")
    park = os.path.normpath(os.path.join(root, "..", "merged-sessions"))
    backup = os.path.join(park, f"backup-{a.first}-{stamp}")
    tmpdir = tempfile.mkdtemp(prefix="merge-")
    print(f"mode: {'APPLY' if a.apply else 'dry-run (nothing written)'}\nfirst : {a.first}\nsecond: {a.second}")

    la, lb = _lines(A), _lines(B)
    ma = _load_json(os.path.join(A, "meta.json"), {}) or {}
    mb = _load_json(os.path.join(B, "meta.json"), {}) or {}
    wa, wa_src = _audio(A, root, tmpdir)
    wb, wb_src = _audio(B, root, tmpdir)
    last_end_a = max([float(l.get("end") or 0) for l in la] or [0])
    if wa:
        offset = sf.info(wa).frames / SR
    else:
        offset = max(float(ma.get("duration_s") or 0), last_end_a)
    dur_b = (sf.info(wb).frames / SR) if wb else max(float(mb.get("duration_s") or 0),
                                                       max([float(l.get("end") or 0) for l in lb] or [0]))
    id_shift = max([int(l.get("id") or 0) for l in la] or [0])
    print(f"first : {len(la)} lines, audio {wa_src}, {offset:.1f}s (last line ends {last_end_a:.1f}s)")
    print(f"second: {len(lb)} lines, audio {wb_src}, {dur_b:.1f}s -> ids +{id_shift}, times +{offset:.1f}s")
    if wa and not wb:
        print("  ! second class has no audio anywhere: its stretch is filled with silence so later times stay aligned")
    if not wa:
        print("  ! first class has no audio anywhere: audio is left as it is, only the transcript merges")

    # second class's lines, renumbered and retimed
    new_b = []
    for l in lb:
        l = dict(l)
        l["id"] = int(l.get("id") or 0) + id_shift
        for k in ("start", "end"):
            if l.get(k) is not None:
                l[k] = round(float(l[k]) + offset, 2)
        l["ts"] = _ts(l.get("start") or 0)
        new_b.append(l)
    shift_key = lambda k: str(int(k) + id_shift)

    marks = _load_json(os.path.join(A, "marks.json"), {}) or {}
    marks_b = {shift_key(k): v for k, v in (_load_json(os.path.join(B, "marks.json"), {}) or {}).items()}
    trans = _load_json(os.path.join(A, "translations.json"), {}) or {}
    trans_b = {shift_key(k): v for k, v in (_load_json(os.path.join(B, "translations.json"), {}) or {}).items()}
    edits_b = []
    if os.path.exists(os.path.join(B, "edits.jsonl")):
        with open(os.path.join(B, "edits.jsonl"), encoding="utf-8") as f:
            for ln in f:
                if ln.strip():
                    e = json.loads(ln)
                    if e.get("line_id") is not None:
                        e["line_id"] = int(e["line_id"]) + id_shift
                    edits_b.append(e)
    shots_b = _load_json(os.path.join(B, "shots", "shots.json"), []) or []
    note_b = ""
    if os.path.exists(os.path.join(B, "note.txt")):
        note_b = open(os.path.join(B, "note.txt"), encoding="utf-8").read().strip()
    names_a = _load_json(os.path.join(A, "speaker_names.json"), {}) or {}
    names_b = _load_json(os.path.join(B, "speaker_names.json"), {}) or {}
    clash = {k: (names_a[k], v) for k, v in names_b.items() if k in names_a and names_a[k] != v}
    print(f"side files from second: marks {len(marks_b)}, translations {len(trans_b)}, edits {len(edits_b)}, "
          f"shots {len(shots_b)}, note {'yes' if note_b else 'no'}, speaker names {len(names_b)}"
          + (f" (conflicting, first's kept: {clash})" if clash else ""))
    meta = {**ma, "duration_s": round(offset + dur_b, 1), "lines": len(la) + len(new_b)}
    if DEFAULT_TITLE.match(str(ma.get("title") or "")) and mb.get("title") and not DEFAULT_TITLE.match(str(mb["title"])):
        meta["title"] = mb["title"]
        for k in ("tags", "sched_date"):
            if not ma.get(k) and mb.get(k):
                meta[k] = mb[k]
    sum_b = _load_json(os.path.join(B, "summary.json"), None)
    take_b_summary = bool(sum_b and sum_b.get("summary")) and dur_b > offset
    print(f"merged: {meta['lines']} lines, {meta['duration_s']}s, title 「{meta.get('title')}」, "
          f"summary from the {'second' if take_b_summary else 'first'} part (the longer one)")
    if not a.apply:
        shutil.rmtree(tmpdir, ignore_errors=True)
        print("\nDry run only. Re-run with --apply to write.")
        return

    # ---- backup everything of the first class that changes ----
    os.makedirs(backup, exist_ok=True)
    for fn in ("transcript.jsonl", "transcript.md", "meta.json", "marks.json", "translations.json",
               "edits.jsonl", "note.txt", "speaker_names.json", "summary.json"):
        if os.path.exists(os.path.join(A, fn)):
            shutil.copy2(os.path.join(A, fn), backup)
    if os.path.exists(os.path.join(A, "shots")):
        shutil.copytree(os.path.join(A, "shots"), os.path.join(backup, "shots"))
    if wa:
        shutil.copy2(wa, os.path.join(backup, "audio.wav"))
    print(f"backup -> {backup}")

    # ---- audio first: if it fails, nothing else has changed ----
    if wa:
        out = os.path.join(A, "audio.wav.merging")
        with sf.SoundFile(out, "w", samplerate=SR, channels=1, format="WAV", subtype="PCM_16") as o:
            for src in (wa, wb):
                if src:
                    with sf.SoundFile(src) as f:
                        while True:
                            buf = f.read(SR * 60, dtype="int16")
                            if not len(buf):
                                break
                            o.write(buf if buf.ndim == 1 else buf[:, 0])
            if not wb:
                o.write(np.zeros(int(round(dur_b * SR)), dtype="int16"))
        os.replace(out, os.path.join(A, "audio.wav"))
        print(f"audio merged: {sf.info(os.path.join(A, 'audio.wav')).frames / SR:.1f}s")

    with open(os.path.join(A, "transcript.jsonl"), "a", encoding="utf-8") as f:
        for l in new_b:
            f.write(json.dumps(l, ensure_ascii=False) + "\n")
    if os.path.exists(os.path.join(B, "transcript.md")):
        with open(os.path.join(A, "transcript.md"), "a", encoding="utf-8") as f:
            f.write(f"\n\n---(合并自 {a.second})---\n")
            f.write(open(os.path.join(B, "transcript.md"), encoding="utf-8").read())
    if marks_b:
        _write_json(os.path.join(A, "marks.json"), {**marks, **marks_b})
    if trans_b:
        _write_json(os.path.join(A, "translations.json"), {**trans, **trans_b})
    if edits_b:
        with open(os.path.join(A, "edits.jsonl"), "a", encoding="utf-8") as f:
            for e in edits_b:
                f.write(json.dumps(e, ensure_ascii=False) + "\n")
    if note_b:
        pa = os.path.join(A, "note.txt")
        note_a = open(pa, encoding="utf-8").read().rstrip() if os.path.exists(pa) else ""
        with open(pa, "w", encoding="utf-8") as f:
            f.write((note_a + "\n\n" if note_a else "") + note_b + "\n")
    if names_b:
        _write_json(os.path.join(A, "speaker_names.json"), {**names_b, **names_a})
    if shots_b:
        sa_dir = os.path.join(A, "shots")
        os.makedirs(sa_dir, exist_ok=True)
        shots_a = _load_json(os.path.join(sa_dir, "shots.json"), []) or []
        taken = {s.get("id") for s in shots_a} | {s.get("file") for s in shots_a}
        for s in shots_b:
            s = dict(s)
            s["at"] = round(float(s.get("at") or 0) + offset, 2)
            src = os.path.join(B, "shots", s.get("file", ""))
            if s.get("file") in taken or s.get("id") in taken:
                s["id"] = f"{s.get('id')}_m"
                base, ext = os.path.splitext(s["file"])
                s["file"] = f"{base}_m{ext}"
            if os.path.exists(src):
                shutil.copy2(src, os.path.join(sa_dir, s["file"]))
            shots_a.append(s)
        _write_json(os.path.join(sa_dir, "shots.json"), sorted(shots_a, key=lambda x: x.get("at", 0)))
    if take_b_summary:
        shutil.copy2(os.path.join(B, "summary.json"), os.path.join(A, "summary.json"))
    _write_json(os.path.join(A, "meta.json"), meta)
    print("files of the first class updated")

    # ---- index: database row + search ----
    try:
        import recordings_db
        import db
        recordings_db.upsert_recording(a.first, title=meta.get("title"), duration_s=meta["duration_s"], meta=meta)
        if take_b_summary:
            recordings_db.upsert_recording(a.first, summary=sum_b["summary"], key_points=sum_b.get("key_points") or [],
                                           has_summary=True)
        with db.connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM recordings WHERE sid = %s", (a.second,))
        print("database: first updated, second removed")
    except Exception as e:
        print(f"  ! database update failed ({e}); the class list may still show the second class")
    try:
        from library import Library
        con = Library(root)._db()
        for sid in (a.first, a.second):
            con.execute("DELETE FROM lines WHERE sid=?", (sid,))
            con.execute("DELETE FROM indexed WHERE sid=?", (sid,))
        con.commit()
        con.close()
        print("search index: both dropped (the first is re-indexed on the next search)")
    except Exception as e:
        print(f"  ! search index cleanup failed: {e}")

    os.makedirs(park, exist_ok=True)
    shutil.move(B, os.path.join(park, a.second))
    print(f"second class moved out of records -> {os.path.join(park, a.second)}")
    shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    main()
