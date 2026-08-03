# -*- coding: utf-8 -*-
"""跨会话声纹库(去重存储):

声纹本体只存一份 —— **全局去重库** records/voiceprints/registry.json:
    {"persons": [{"id","centroid":[...归一化向量],"n","seconds"}]}
判定为同一个人的声纹合并成一条(像“很多人上传同一份文件,云端只算一份”),
不管有多少节课、多少账号采到,同一个人只保存一条声纹向量。

各账号的库 lib_<账号>.json 只存**引用**:[{id, name, pid}] —— pid 指向 registry 里那个人。
名字是各账号私有的,声纹本体共享去重。老格式(条目内联 embedding)仍兼容读。

- 过去某节课的声音:从 transcript.jsonl 的说话人分段 + audio.wav 现算每个说话人的声纹中心,
  缓存到 <session>/speakers.json(本地缓存、可重算,不上 OSS),供“语音标记区”列出、试听、打标签。
声纹向量用和实时识别同一个 eres2netv2 提取器(SpeakerID.embed),跨会话/跨账号可比。
"""
import os
import re
import json
import hashlib
import numpy as np

SR = 16000
# 去重合并阈值:比匹配阈值(0.35)保守一些,只有相当确定是同一个人才并成一条,
# 避免把两个不同的人误并、污染声纹。"如果声纹显示是一个人"——够像才算一个人。
REG_MERGE_TH = 0.45


def _dir(root):
    d = os.path.join(root, "voiceprints")
    os.makedirs(d, exist_ok=True)
    return d


def _key_id(key):
    """把账号标识(邮箱等)变成安全的文件名片段;不同账号不撞车。"""
    s = re.sub(r"[^A-Za-z0-9]+", "_", str(key)).strip("_").lower()[:24]
    h = hashlib.sha1(str(key).encode("utf-8")).hexdigest()[:8]
    return f"{s}_{h}" if s else h


# ---------- 全局去重库(声纹本体只存一份) ----------
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
    """把一条声纹登记进全局去重库:和已有的人够像(>=阈值)就并进那个人(不新增、更新中心),
    否则新建一个人。返回 (person_id, reg, is_new)。传 reg 可批量登记、最后一次落盘。"""
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
        c = _norm(_norm(best.get("centroid") or []) * n + e)   # 加权平均、再归一化
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


# ---------- 各账号的库(只存 名字 + 指向去重库的 pid 引用) ----------
def _lib_path(root, key=None):
    """每个账号一个库文件 lib_<账号>.json;老的全局 library.json 留给拥有者/未登录(key=owner/None)。"""
    d = _dir(root)
    if key in (None, "", "owner"):
        return os.path.join(d, "library.json")
    return os.path.join(d, f"lib_{_key_id(key)}.json")


def _load_raw(root, key=None):
    """读账号库的原始条目(可能是新格式 {id,name,pid} 或老格式 {id,name,embedding})。"""
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
    """给匹配用的库:[{id, name, embedding}]。声纹向量按 pid 从全局去重库现取(存一份、多处引用);
    老格式条目内联的 embedding 也照样能读。取不到向量的条目跳过。"""
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
    """标记/改名时调用:先把声纹登记进全局去重库(同一个人合并成一条、只存一份),
    账号库里只留 名字→pid 的引用。同名的更新引用,没有就新建。"""
    name = str(name).strip() or "未命名"
    e = _norm(embedding)
    if e.size == 0:
        return None
    pid, _, _ = register(root, e)          # 全局去重:拿到这个人的唯一 id(已把本条并进去)
    lib = _load_raw(root, key)
    for v in lib:
        if v.get("name") == name:
            v["pid"] = pid
            v.pop("embedding", None)       # 老格式内联向量清掉,改为引用去重库
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
    """一次性:把已有各账号库里内联的 embedding 折进全局去重库,条目改成 pid 引用。
    同一个人(跨账号)只在 registry 里留一条。返回处理了多少条。幂等:已是 pid 的跳过。"""
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
    """在库里找和 embedding 最像的声音,>=阈值返回 (voice_dict, 相似度),否则 (None, 相似度)。"""
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
    """把跨会话提取的说话人(每条含 embedding)按声纹相似度聚成"人"。
    贪心:按时长从大到小(向量更可靠的先当种子),和已有簇中心相似度 >=阈值就并进去(时长加权更新中心),
    否则新建一簇。返回 [{members:[voice...], seconds, centroid(归一化 list)}],时长降序。"""
    items = sorted(voices, key=lambda v: -(v.get("seconds") or 0))
    clusters = []   # {'c': 归一化中心, 'dur': 总时长, 'members': [...]}
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
    # 后合并:贪心按顺序可能把同一个人拆成两簇;再比各簇中心(比单段更稳),够像就并起来。
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
    """从一节课的 transcript.jsonl(说话人分段)+ audio.wav 算每个说话人的声纹中心 + 试听时间戳,
    缓存 <dir>/speakers.json 并返回。embed_fn = SpeakerID.embed。没有音频/转写返回 None。"""
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
    """把所有历史课的说话人声纹折进全局去重库(同一个人只留一条)。用已缓存的 speakers.json,
    没缓存且给了 embed_fn 才现算。一次性/换机重建用,幂等。返回 (登记条数, 去重后人数)。"""
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
