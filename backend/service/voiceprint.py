# -*- coding: utf-8 -*-
"""Cross-session voiceprint store (deduplicated):

The voiceprints themselves are stored only once -- in the **global dedup store**
records/voiceprints/registry.json:
    {"persons": [{"id","centroid":[...normalized vector],"n","seconds"}]}
Voiceprints judged to be the same person are merged into one entry (like "many
users uploading the same file, the cloud only keeps one copy"); no matter how
many classes or accounts captured it, one person keeps just one voiceprint vector.

Each account's store lib_<account>.json holds only **references**: [{id, name, pid}]
-- pid points to that person in the registry. Names are private to each account;
the voiceprints themselves are shared and deduplicated. The old format (embedding
inlined in the entry) can still be read.

- Audio from some past class: from the speaker segments in transcript.jsonl plus
  audio.wav, compute each speaker's voiceprint centroid on the fly and cache it to
  <session>/speakers.json (local cache, recomputable, not uploaded to OSS), so the
  "voice tagging area" can list, preview, and label them.
Voiceprint vectors use the same eres2netv2 extractor as live recognition
(SpeakerID.embed), so they're comparable across sessions and accounts.
"""
import os
import re
import json
import hashlib
import numpy as np

SR = 16000
# dedup merge threshold: more conservative than the match threshold (0.35); only merge into one
# entry when we're quite sure it's the same person, to avoid merging two different people and polluting the voiceprint. "If the voiceprint says it's one person" -- similar enough only.
REG_MERGE_TH = 0.45


def _dir(root):
    d = os.path.join(root, "voiceprints")
    os.makedirs(d, exist_ok=True)
    return d


def _key_id(key):
    """Turn an account id (email, etc.) into a safe filename fragment; different accounts don't collide."""
    s = re.sub(r"[^A-Za-z0-9]+", "_", str(key)).strip("_").lower()[:24]
    h = hashlib.sha1(str(key).encode("utf-8")).hexdigest()[:8]
    return f"{s}_{h}" if s else h


# ---------- global dedup store (voiceprints stored only once) ----------
def _reg_path(root):
    return os.path.join(_dir(root), "registry.json")


def load_registry(root):
    p = _reg_path(root)
    if not os.path.exists(p):
        return {"persons": []}
    try:
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) and isinstance(d.get("persons"), list) else {"persons": []}
    except Exception:
        return {"persons": []}


def save_registry(root, reg):
    p = _reg_path(root)
    tmp = p + ".part"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(reg, f, ensure_ascii=False)
    os.replace(tmp, p)


def register(root, embedding, seconds=0.0, threshold=REG_MERGE_TH, reg=None):
    """Register a voiceprint into the global dedup store: if it's similar enough (>= threshold) to an
    existing person, merge into that person (no new entry, update centroid); otherwise create a new
    person. Returns (person_id, reg, is_new). Pass reg to register in batch and write to disk once at the end."""
    own = reg is None
    if own:
        reg = load_registry(root)
    e = _norm(embedding)
    if e.size == 0:
        return None, reg, False
    persons = reg["persons"]
    best, bs = None, -1.0
    for p in persons:
        s = float(np.dot(e, _norm(p.get("centroid") or [])))
        if s > bs:
            bs, best = s, p
    if best is not None and bs >= threshold:
        n = int(best.get("n", 1) or 1)
        c = _norm(_norm(best.get("centroid") or []) * n + e)   # weighted average, then renormalize
        best["centroid"] = [float(x) for x in c]
        best["n"] = n + 1
        best["seconds"] = round(float(best.get("seconds", 0) or 0) + float(seconds or 0), 1)
        pid, is_new = best["id"], False
    else:
        import secrets
        pid = "p" + secrets.token_hex(5)
        persons.append({"id": pid, "centroid": [float(x) for x in e],
                        "n": 1, "seconds": round(float(seconds or 0), 1)})
        is_new = True
    if own:
        save_registry(root, reg)
    return pid, reg, is_new


def registry_centroid(root, pid, reg=None):
    reg = reg if reg is not None else load_registry(root)
    for p in reg.get("persons", []):
        if p.get("id") == pid:
            return p.get("centroid")
    return None


# ---------- per-account stores (only name + a pid reference into the dedup store) ----------
def _lib_path(root, key=None):
    """One store file per account, lib_<account>.json; the old global library.json is left for the owner / not-logged-in (key=owner/None)."""
    d = _dir(root)
    if key in (None, "", "owner"):
        return os.path.join(d, "library.json")
    return os.path.join(d, f"lib_{_key_id(key)}.json")


def _load_raw(root, key=None):
    """Read the raw entries of an account store (may be the new format {id,name,pid} or the old format {id,name,embedding})."""
    p = _lib_path(root, key)
    if not os.path.exists(p):
        return []
    try:
        with open(p, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_raw(root, lib, key=None):
    p = _lib_path(root, key)
    tmp = p + ".part"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(lib, f, ensure_ascii=False)
    os.replace(tmp, p)


def load_library(root, key=None):
    """Store for matching: [{id, name, embedding}]. Voiceprint vectors are fetched on the fly by pid from the
    global dedup store (stored once, referenced in many places); embeddings inlined in old-format entries can
    also be read. Entries whose vector can't be fetched are skipped."""
    raw = _load_raw(root, key)
    if not raw:
        return []
    reg = load_registry(root)
    idx = {p.get("id"): p.get("centroid") for p in reg.get("persons", [])}
    out = []
    for v in raw:
        emb = idx.get(v.get("pid")) if v.get("pid") else v.get("embedding")
        if emb:
            out.append({"id": v.get("id"), "name": v.get("name", ""), "embedding": emb})
    return out


def add_voice(root, name, embedding, key=None):
    return upsert_voice(root, name, embedding, key)


def upsert_voice(root, name, embedding, key=None):
    """Called when tagging/renaming: first register the voiceprint into the global dedup store (the same person
    merged into one entry, stored only once), the account store only keeps a name->pid reference. Same name
    updates the reference, none exists creates a new one."""
    name = str(name).strip() or "未命名"
    e = _norm(embedding)
    if e.size == 0:
        return None
    pid, _, _ = register(root, e)          # global dedup: get this person's unique id (this entry has already been merged in)
    lib = _load_raw(root, key)
    for v in lib:
        if v.get("name") == name:
            v["pid"] = pid
            v.pop("embedding", None)       # clear the old-format inlined vector, switch to a dedup-store reference
            v.pop("n", None)
            _save_raw(root, lib, key)
            return v.get("id")
    import secrets
    vid = "v" + secrets.token_hex(4)
    lib.append({"id": vid, "name": name, "pid": pid})
    _save_raw(root, lib, key)
    return vid


def remove_voice(root, vid, key=None):
    _save_raw(root, [v for v in _load_raw(root, key) if v.get("id") != vid], key)


def rename_voice(root, vid, name, key=None):
    lib = _load_raw(root, key)
    for v in lib:
        if v.get("id") == vid:
            v["name"] = str(name).strip() or v.get("name", "未命名")
    _save_raw(root, lib, key)


def migrate_libraries(root, threshold=REG_MERGE_TH):
    """One-off: fold the embeddings inlined in existing account stores into the global dedup store, changing
    entries into pid references. The same person (across accounts) keeps just one entry in the registry. Returns
    how many entries were processed. Idempotent: entries already using pid are skipped."""
    d = _dir(root)
    reg = load_registry(root)
    moved = 0
    for fn in sorted(os.listdir(d)):
        if not (fn == "library.json" or (fn.startswith("lib_") and fn.endswith(".json"))):
            continue
        path = os.path.join(d, fn)
        try:
            with open(path, encoding="utf-8") as f:
                lib = json.load(f)
        except Exception:
            continue
        if not isinstance(lib, list):
            continue
        changed = False
        for v in lib:
            if v.get("pid") or not v.get("embedding"):
                continue
            pid, reg, _ = register(root, v["embedding"], seconds=0.0,
                                   threshold=threshold, reg=reg)
            v["pid"] = pid
            v.pop("embedding", None)
            v.pop("n", None)
            changed = True
            moved += 1
        if changed:
            tmp = path + ".part"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(lib, f, ensure_ascii=False)
            os.replace(tmp, path)
    save_registry(root, reg)
    return moved


def _norm(e):
    e = np.asarray(e, dtype=np.float32)
    n = np.linalg.norm(e)
    return e / n if n > 0 else e


def best_match(embedding, library, threshold):
    """Find the voice in the store most similar to embedding; return (voice_dict, similarity) if >= threshold, else (None, similarity)."""
    if not library:
        return None, 0.0
    e = _norm(embedding)
    best, bs = None, -1.0
    for v in library:
        s = float(np.dot(e, _norm(v.get("embedding") or [])))
        if s > bs:
            bs, best = s, v
    return (best if bs >= threshold else None), bs


def cluster_voices(voices, threshold):
    """Cluster cross-session speakers (each carrying an embedding) into "people" by voiceprint similarity.
    Greedy: process longest-duration first (vectors are more reliable, so they seed clusters first), and if the
    similarity to an existing cluster centroid is >= threshold merge in (duration-weighted centroid update),
    otherwise start a new cluster. Returns [{members:[voice...], seconds, centroid(normalized list)}], sorted by duration descending."""
    items = sorted(voices, key=lambda v: -(v.get("seconds") or 0))
    clusters = []   # {'c': normalized centroid, 'dur': total duration, 'members': [...]}
    for v in items:
        e = _norm(v.get("embedding") or [])
        if e.size == 0:
            continue
        best, bs = None, -1.0
        for cl in clusters:
            s = float(np.dot(e, cl["c"]))
            if s > bs:
                bs, best = s, cl
        w = (v.get("seconds") or 0.0) or 0.01
        if best is not None and bs >= threshold:
            nc = best["c"] * best["dur"] + e * w
            n = np.linalg.norm(nc)
            best["c"] = nc / n if n > 0 else nc
            best["dur"] += w
            best["members"].append(v)
        else:
            clusters.append({"c": e.copy(), "dur": w, "members": [v]})
    # post-merge: greedy ordering may split one person into two clusters; compare cluster centroids again (steadier than a single segment), and merge if similar enough.
    merged = True
    while merged and len(clusters) > 1:
        merged = False
        n = len(clusters)
        for i in range(n):
            for j in range(i + 1, n):
                if float(np.dot(clusters[i]["c"], clusters[j]["c"])) >= threshold:
                    a, b = clusters[i], clusters[j]
                    nc = a["c"] * a["dur"] + b["c"] * b["dur"]
                    nn = np.linalg.norm(nc)
                    a["c"] = nc / nn if nn > 0 else nc
                    a["dur"] += b["dur"]
                    a["members"].extend(b["members"])
                    del clusters[j]
                    merged = True
                    break
            if merged:
                break
    out = []
    for cl in clusters:
        secs = sum((m.get("seconds") or 0) for m in cl["members"])
        out.append({"members": cl["members"], "seconds": round(secs, 1),
                    "centroid": [float(x) for x in cl["c"]]})
    out.sort(key=lambda c: -c["seconds"])
    return out


def extract_session_voices(session_dir, embed_fn, min_seconds=2.0, cap_seconds=12.0):
    """From a class's transcript.jsonl (speaker segments) + audio.wav, compute each speaker's voiceprint centroid
    plus preview timestamps, cache to <dir>/speakers.json and return it. embed_fn = SpeakerID.embed. Returns None if there's no audio/transcript."""
    cache = os.path.join(session_dir, "speakers.json")
    if os.path.exists(cache):
        try:
            with open(cache, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    tp = os.path.join(session_dir, "transcript.jsonl")
    ap = os.path.join(session_dir, "audio.wav")
    if not (os.path.exists(tp) and os.path.exists(ap)):
        return None
    try:
        import soundfile as sf
        audio, sr = sf.read(ap, dtype="float32")
    except Exception:
        return None
    if getattr(audio, "ndim", 1) > 1:
        audio = audio[:, 0]
    by = {}
    try:
        with open(tp, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                r = json.loads(line)
                sid = r.get("speaker_id")
                if sid is None:
                    continue
                by.setdefault(int(sid), []).append(r)
    except Exception:
        return None
    speakers = []
    for sid, rows in by.items():
        rows.sort(key=lambda r: (r.get("end", 0) - r.get("start", 0)), reverse=True)
        segs, tot = [], 0
        for r in rows:
            s = int(max(0.0, r.get("start", 0)) * sr)
            e = int(max(0.0, r.get("end", 0)) * sr)
            if e > s and e <= audio.size:
                segs.append(audio[s:e])
                tot += (e - s)
            if tot >= cap_seconds * sr:
                break
        secs = tot / sr
        if not segs or secs < min_seconds:
            continue
        try:
            emb = embed_fn(np.concatenate(segs))
        except Exception:
            continue
        speakers.append({
            "idx": sid,
            "name": rows[0].get("speaker", ""),
            "seconds": round(secs, 1),
            "sample_start": round(float(rows[0].get("start", 0)), 2),
            "embedding": [float(x) for x in emb],
        })
    data = {"speakers": speakers}
    try:
        with open(cache, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
    except Exception:
        pass
    return data


def fold_sessions_into_registry(root, embed_fn=None, threshold=REG_MERGE_TH):
    """Fold every past class's speaker voiceprints into the global dedup store (the same person keeps just one entry).
    Uses cached speakers.json, only recomputing on the fly when there's no cache and embed_fn is given. For one-off /
    machine-migration rebuilds, idempotent. Returns (entries registered, deduplicated person count)."""
    reg = load_registry(root)
    seen = 0
    for name in sorted(os.listdir(root)):
        d = os.path.join(root, name)
        if not os.path.isdir(d):
            continue
        cache = os.path.join(d, "speakers.json")
        data = None
        if os.path.exists(cache):
            try:
                with open(cache, encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:
                data = None
        elif embed_fn is not None:
            data = extract_session_voices(d, embed_fn)
        for sp in (data or {}).get("speakers", []):
            emb = sp.get("embedding") or []
            if emb:
                register(root, emb, seconds=sp.get("seconds", 0),
                         threshold=threshold, reg=reg)
                seen += 1
    save_registry(root, reg)
    return seen, len(reg["persons"])
