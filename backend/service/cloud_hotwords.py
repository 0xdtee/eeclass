# -*- coding: utf-8 -*-
"""Course hotwords -> a DashScope vocabulary (热词表), so cloud recognition is biased toward them.

Accounts that aren't admins always record on paraformer-realtime-v2, and until now the course's hotwords
never reached it: they only fed the local homophone fixer, which can repair 影射 -> 映射 but can do nothing
once an accent has pushed recognition onto different sounds. A vocabulary biases the recognizer itself
toward 拉格朗日, 兰姆达, 西格玛... before it commits to the wrong ones.

Vocabularies are server-side objects created through an API call, so they're cached: the same word list
(and model and weight) maps to the same vocabulary_id, kept in a small JSON file next to the records. At most
MAX_TABLES are kept; past that the least recently used one is rewritten in place instead of creating more.
Anything that goes wrong returns None and recognition simply runs without hotwords.

Limits checked against the live API (2026-10): a word may be at most 15 characters; prefix is lowercase
letters/digits under 10 characters.
"""
import hashlib
import json
import os
import threading
import time

MAX_WORDS = 500          # per vocabulary
MAX_LEN = 15             # characters per word; 16 is rejected as "vocabulary format invalid"
MAX_TABLES = 8
PREFIX = "eeclass"
_LOCK = threading.Lock()


def clean_words(words):
    """Dedupe, strip, drop what the API would reject; keeps first-seen order (course words come first)."""
    out, seen = [], set()
    for w in words or []:
        w = str(w).strip()
        if not w or len(w) > MAX_LEN or w in seen:
            continue
        seen.add(w)
        out.append(w)
        if len(out) >= MAX_WORDS:
            break
    return out


def _lang(w):
    return "en" if all(ord(c) < 128 for c in w) else "zh"


def _load(path):
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _save(path, d):
    tmp = path + ".part"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def vocabulary_id(words, model, cache_path, weight=4):
    """vocabulary_id for this word list on `model`, creating or recycling a vocabulary as needed; None on failure."""
    words = clean_words(words)
    if not words:
        return None
    vocab = [{"text": w, "weight": int(weight), "lang": _lang(w)} for w in words]
    key = hashlib.sha1(json.dumps([model, weight, words], ensure_ascii=False).encode("utf-8")).hexdigest()[:16]
    with _LOCK:
        cache = _load(cache_path)
        hit = cache.get(key)
        if hit and hit.get("id"):
            hit["used"] = time.time()
            _save(cache_path, cache)
            return hit["id"]
        try:
            from dashscope.audio.asr import VocabularyService
            vs = VocabularyService()
            same_model = [(k, v) for k, v in cache.items() if v.get("model") == model and v.get("id")]
            if len(same_model) >= MAX_TABLES:
                old_key, old = min(same_model, key=lambda kv: kv[1].get("used", 0))
                vs.update_vocabulary(old["id"], vocab)
                vid = old["id"]
                cache.pop(old_key, None)
            else:
                vid = vs.create_vocabulary(target_model=model, prefix=PREFIX, vocabulary=vocab)
        except Exception as e:
            print(f"[hotwords] 云端热词表不可用,本次不带热词识别: {e}", flush=True)
            return None
        cache[key] = {"id": vid, "model": model, "words": len(words), "used": time.time()}
        try:
            _save(cache_path, cache)
        except Exception as e:
            print(f"[hotwords] 热词表缓存写入失败: {e}", flush=True)
        return vid


def for_session(asr_cfg, model):
    """vocabulary_id for the session whose asr config carries `_cloud_hotwords` (set by Session), else None."""
    spec = asr_cfg.get("_cloud_hotwords") or {}
    if not spec.get("words") or not spec.get("cache"):
        return None
    return vocabulary_id(spec["words"], model, spec["cache"], spec.get("weight", 4))
