# -*- coding: utf-8 -*-
"""Speaker identification (voiceprint + online clustering + post-hoc merging).

Each sentence -> voiceprint vector -> cosine similarity against known speakers'
centroids -> if it matches, assign to that speaker and update the centroid;
if not, create a new person.

**Why these particular parameters** (measured locally on an annotated
three-person conversation, 44 sentences):

    model           same-person min sim   other-person 95pct   threshold range for 100% accuracy
    campplus            0.178                0.254             only the single point 0.30
    eres2netv2          0.319                0.256             the whole span 0.20 ~ 0.40

Originally campplus + threshold 0.60: 90.9% accuracy, **grouped 3 people into 7**
-- because two sentences from the same person often only reach a similarity just
over 0.4, fall short of 0.60, and get judged as a new person. That's where "one
person split into classmate A/B/C" came from. Switching to eres2netv2 + threshold
0.35: 100% accuracy, exactly 3 people.
(A tried approach that didn't work: normalizing audio amplitude before extracting
the voiceprint -- made no difference at all, don't try it again.)

Even so, a real classroom is harder than the test set, so we add one more safety
net: **merge only, never split**. After each sentence we scan the centroids again,
and if two "people" centroids are similar to a certain degree we judge them the
same person, merge the later-created one into the earlier one, and replace the
name already written into Word too. Merge-only is deliberate -- a wrong merge at
worst blends two people into one, while a wrong split litters the document with a
crowd of phantom "classmates".
"""
import os
import threading
import numpy as np

SR = 16000
HERE = os.path.dirname(os.path.abspath(__file__))

DEFAULT_MODEL = "3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx"

# The eres2netv2 embedding extractor is the largest model a session loads -- and EVERY session loads it
# (even cloud-ASR ones use it for diarization). It is stateless: each embed() opens its own create_stream(),
# so one instance is safe to share across all concurrent sessions. Cache it per model path so 40 concurrent
# recordings share ONE extractor instead of loading 40 copies (which would OOM the box at high concurrency).
_EX_CACHE = {}
_EX_LOCK = threading.Lock()


def _get_extractor(model_path):
    with _EX_LOCK:
        ex = _EX_CACHE.get(model_path)
        if ex is None:
            import sherpa_onnx
            ex = sherpa_onnx.SpeakerEmbeddingExtractor(
                sherpa_onnx.SpeakerEmbeddingExtractorConfig(
                    model=model_path, num_threads=2, debug=False))
            _EX_CACHE[model_path] = ex
        return ex


class SpeakerID:
    def __init__(self, cfg, model_path=None):
        s = cfg["speaker"]
        self.enabled = s["enabled"]
        self.threshold = s["threshold"]
        self.merge_threshold = s.get("merge_threshold", 0.55)
        self.merge_min_utts = s.get("merge_min_utterances", 2)
        self.min_samples = int(s["min_audio_ms"] * SR / 1000)
        self.max_speakers = s["max_speakers"]
        self.ema = s["ema"]

        self.centroids = []   # already normalized
        self.durations = []
        self.counts = []
        self.last_id = 0
        self.ex = None
        self.err = None
        self._merges = []     # merges pending to be reported [(merged-away id, merged-into id)]
        self.library = []     # cross-session voiceprint store [(name, normalized vector)]; on a match, use the tagged identity
        self.vp_threshold = s.get("voiceprint_threshold", s["threshold"])

        if not self.enabled:
            return

        model_path = model_path or os.path.join(HERE, "models", s.get("model", DEFAULT_MODEL))
        try:
            if not os.path.exists(model_path):
                raise FileNotFoundError(f"找不到声纹模型 {model_path}（跑一次 install.ps1 下载）")
            self.ex = _get_extractor(model_path)   # shared, process-wide (stateless extractor; per-session state stays on self)
        except Exception as e:
            self.err = f"声纹模型加载失败({e})，将全部标记为同一个说话人"
            self.enabled = False

    # ---- voiceprint ----
    def embed(self, audio):
        s = self.ex.create_stream()
        s.accept_waveform(SR, np.ascontiguousarray(audio, dtype=np.float32))
        s.input_finished()
        e = np.array(self.ex.compute(s), dtype=np.float32)
        n = np.linalg.norm(e)
        return e / n if n > 0 else e

    # ---- online clustering ----
    def identify(self, audio):
        """Return (speaker_index, confidence). Index starts at 0."""
        self.last_emb = None    # this utterance's raw voiceprint (None if too short) -- collected for post-hoc re-clustering
        if not self.enabled or self.ex is None:
            return 0, 0.0
        if audio.size < self.min_samples:
            return self.last_id, 0.0  # too short, voiceprint unreliable, reuse the previous sentence's speaker

        try:
            emb = self.embed(audio)
        except Exception:
            return self.last_id, 0.0
        self.last_emb = emb

        dur = audio.size / SR
        if not self.centroids:
            self._add(emb, dur)
            self.last_id = 0
            return 0, 1.0

        sims = np.array([float(np.dot(emb, c)) for c in self.centroids])
        best = int(np.argmax(sims))
        score = float(sims[best])

        if score >= self.threshold or len(self.centroids) >= self.max_speakers:
            # when the speaker count is maxed out, still assign to the closest one instead of growing forever
            self._update(best, emb, dur)
            self.last_id = best
        else:
            self._add(emb, dur)
            self.last_id = len(self.centroids) - 1

        self._collapse()
        return self.last_id, score

    def _add(self, emb, dur):
        self.centroids.append(emb.copy())
        self.durations.append(dur)
        self.counts.append(1)

    def _update(self, i, emb, dur):
        c = (1 - self.ema) * self.centroids[i] + self.ema * emb
        self.centroids[i] = c / (np.linalg.norm(c) or 1.0)
        self.durations[i] += dur
        self.counts[i] += 1

    # ---- post-hoc merge: reclaim one person that got split into two ----
    def _collapse(self):
        changed = True
        while changed and len(self.centroids) > 1:
            changed = False
            n = len(self.centroids)
            for i in range(n):
                for j in range(i + 1, n):
                    if min(self.counts[i], self.counts[j]) < self.merge_min_utts:
                        continue
                    if float(np.dot(self.centroids[i], self.centroids[j])) < self.merge_threshold:
                        continue
                    self._merge(j, i)
                    changed = True
                    break
                if changed:
                    break

    def _merge(self, frm, to):
        """Merge frm into to (always into the one that appeared first, the lower number was created first, i.e. spoke first)."""
        wa, wb = self.durations[to], self.durations[frm]
        c = self.centroids[to] * wa + self.centroids[frm] * wb
        self.centroids[to] = c / (np.linalg.norm(c) or 1.0)
        self.durations[to] += self.durations[frm]
        self.counts[to] += self.counts[frm]
        del self.centroids[frm]
        del self.durations[frm]
        del self.counts[frm]
        # the later numbers all shift down, so ids already reported have to be corrected accordingly
        self._merges.append((frm, to))
        if self.last_id == frm:
            self.last_id = to
        elif self.last_id > frm:
            self.last_id -= 1

    # ---- cross-session voiceprint store matching ----
    def set_library(self, entries, threshold=None):
        """entries: [{name, embedding}]. Load already-tagged voiceprints; on a match in the new recording, use that name."""
        self.library = []
        for v in entries or []:
            e = np.asarray(v.get("embedding") or [], dtype=np.float32)
            n = np.linalg.norm(e)
            if e.size and n > 0:
                self.library.append((v.get("name", ""), e / n))
        if threshold is not None:
            self.vp_threshold = threshold

    def match_name(self, idx):
        """Match the voiceprint centroid of the idx-th speaker in this session against the voiceprint store; return the tagged name on a match, else None."""
        if not self.library or idx < 0 or idx >= len(self.centroids):
            return None
        c = self.centroids[idx]
        best, bs = None, -1.0
        for name, e in self.library:
            s = float(np.dot(c, e))
            if s > bs:
                bs, best = s, name
        return best if bs >= self.vp_threshold else None

    def centroid_of(self, idx):
        """The idx-th speaker's current voiceprint centroid (already normalized), None if there is none. Used to save into the account voiceprint store after renaming mid-recording."""
        if idx is None or idx < 0 or idx >= len(self.centroids):
            return None
        return self.centroids[idx].copy()

    def add_speaker(self, emb, dur=0.0):
        """Force a brand-new speaker centroid from this embedding and return its index. Used by the overlap-separation
        path to guarantee the two simultaneously-speaking streams are kept as two distinct speakers, even when their
        (separation-artifacted) voiceprints look similar to the online clusterer."""
        if emb is None:
            return self.last_id
        self._add(emb, dur)
        return len(self.centroids) - 1

    def lib_sim(self, emb, name):
        """Cosine similarity of `emb` to the (best) library entry tagged `name`; -1 if no such entry."""
        best = -1.0
        for nm, e in self.library:
            if nm == name:
                best = max(best, float(np.dot(emb, e)))
        return best

    def take_merges(self):
        """Take the pending merges; the server uses them to replace names already written into the document."""
        m, self._merges = self._merges, []
        return m

    def main_speaker(self):
        """The one who talks the most, assumed by default to be the teacher."""
        if not self.durations:
            return 0
        return int(np.argmax(self.durations))

    def stats(self):
        return [{"id": i, "seconds": round(d, 1), "utterances": self.counts[i]}
                for i, d in enumerate(self.durations)]


def recluster_session(session_dir, cfg, utt_recs, spk, name_fn):
    """Post-hoc GLOBAL re-clustering of a finished recording's speakers, rewriting transcript.jsonl.

    Online clustering is greedy (first centroid absorbs later utterances) and reuses the previous speaker for
    short (<min_audio_ms) sentences -- on far-field/quiet audio this collapses several people into one. Here we
    take the per-utterance voiceprints collected DURING recording (utt_recs = [(start, emb), ...], matched to
    transcript lines by start time -- no dependency on audio.wav, which may be disabled/offloaded) and cluster
    ALL utterances together (agglomerative on cosine), which separates speakers far better. Names: clusters
    ordered by total speech (most talkative -> teacher), with voiceprint-store matches kept. Returns True if it
    rewrote the transcript. name_fn(rank)->display name; spk provides the voiceprint library for naming.
    """
    import json as _json
    sc = cfg.get("speaker", {}) or {}
    if not sc.get("enabled", True) or spk is None or not getattr(spk, "enabled", False):
        return False
    tp = os.path.join(session_dir, "transcript.jsonl")
    if not os.path.exists(tp):
        return False
    lines = []
    with open(tp, encoding="utf-8") as f:
        for ln in f:
            ln = ln.strip()
            if not ln:
                continue
            try:
                lines.append(_json.loads(ln))
            except Exception:
                return False   # unparseable transcript -> don't risk rewriting
    if len(lines) < 2:
        return False

    # match each line to the voiceprint captured for it during recording, keyed by start time
    by_start = {}
    for st, em in (utt_recs or []):
        if em is not None:
            by_start[round(float(st), 2)] = em
    if len(by_start) < 2:
        return False
    embs = []
    for L in lines:
        st = round(float(L.get("start", 0) or 0), 2)
        em = by_start.get(st)
        if em is None:                       # tolerate tiny rounding drift
            cand = [(abs(k - st), k) for k in by_start if abs(k - st) <= 0.15]
            em = by_start[min(cand)[1]] if cand else None
        embs.append(em)
    idxs = [i for i, em in enumerate(embs) if em is not None]
    if len(idxs) < 2:
        return False

    thr = float(sc.get("recluster_threshold", sc.get("threshold", 0.35)))
    maxs = int(sc.get("max_speakers", 8))

    def _n(v):
        nn = np.linalg.norm(v)
        return v / nn if nn > 0 else v

    members = [[i] for i in idxs]                 # each cluster = list of line indices
    cents = [embs[i].copy() for i in idxs]
    while len(members) > 1:
        bi = bj = -1
        bs = -2.0
        for i in range(len(members)):
            for j in range(i + 1, len(members)):
                sim = float(np.dot(_n(cents[i]), _n(cents[j])))
                if sim > bs:
                    bi, bj, bs = i, j, sim
        # stop once nothing is similar enough AND we're within the speaker cap; otherwise force-merge closest
        if bs < thr and len(members) <= maxs:
            break
        wi, wj = len(members[bi]), len(members[bj])
        cents[bi] = _n(cents[bi] * wi + cents[bj] * wj)
        members[bi] += members[bj]
        del members[bj]
        del cents[bj]

    # order clusters by total speech duration (desc) -> rank 0 is the teacher
    def _dur(members_of):
        tot = 0.0
        for i in members_of:
            tot += max(0.0, float(lines[i].get("end", 0) or 0) - float(lines[i].get("start", 0) or 0))
        return tot
    order = sorted(range(len(members)), key=lambda k: _dur(members[k]), reverse=True)

    rank_of_line = {}
    cent_of_rank = {}
    for rank, k in enumerate(order):
        cent_of_rank[rank] = cents[k]
        for i in members[k]:
            rank_of_line[i] = rank

    # short lines (no embedding): carry the previous assigned line's speaker, else the main speaker
    labels = []
    last = 0
    for i in range(len(lines)):
        if i in rank_of_line:
            last = rank_of_line[i]
        labels.append(last)

    # names: voiceprint-store match first, else 老师/同学A...
    names = {}
    for rank in range(len(order)):
        nm = None
        lib = getattr(spk, "library", None)
        if lib:
            c = cent_of_rank.get(rank)
            best, bscore = None, -1.0
            for lname, le in lib:
                sc2 = float(np.dot(c, le))
                if sc2 > bscore:
                    bscore, best = sc2, lname
            if best is not None and bscore >= getattr(spk, "vp_threshold", thr):
                nm = best
        names[rank] = nm or name_fn(rank)

    # nothing changed? skip the rewrite
    changed = any(int(lines[i].get("speaker_id", -999)) != labels[i] for i in range(len(lines)))
    if not changed:
        return False
    for i, L in enumerate(lines):
        L["speaker_id"] = labels[i]
        L["speaker"] = names[labels[i]]
    tmp = tp + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        for L in lines:
            f.write(_json.dumps(L, ensure_ascii=False) + "\n")
    os.replace(tmp, tp)
    return True


def cluster_utterances(lines, utt_recs, cfg):
    """Global agglomerative voiceprint clustering of a session's lines. Returns a list of group ids (one per
    line, ints from 0 by first appearance) or None if there isn't enough usable voiceprint. Same matching +
    clustering as recluster_session, exposed so the LLM relabeler can pass it as an audio-grounded hint."""
    sc = cfg.get("speaker", {}) or {}
    by_start = {}
    for st, em in (utt_recs or []):
        if em is not None:
            by_start[round(float(st), 2)] = em
    if len(by_start) < 2:
        return None
    embs = []
    for L in lines:
        st = round(float(L.get("start", 0) or 0), 2)
        em = by_start.get(st)
        if em is None:
            cand = [(abs(k - st), k) for k in by_start if abs(k - st) <= 0.15]
            em = by_start[min(cand)[1]] if cand else None
        embs.append(em)
    idxs = [i for i, em in enumerate(embs) if em is not None]
    if len(idxs) < 2:
        return None
    thr = float(sc.get("recluster_threshold", sc.get("threshold", 0.35)))
    maxs = int(sc.get("max_speakers", 8))

    def _n(v):
        nn = np.linalg.norm(v)
        return v / nn if nn > 0 else v

    members = [[i] for i in idxs]
    cents = [embs[i].copy() for i in idxs]
    while len(members) > 1:
        bi = bj = -1
        bs = -2.0
        for i in range(len(members)):
            for j in range(i + 1, len(members)):
                s = float(np.dot(_n(cents[i]), _n(cents[j])))
                if s > bs:
                    bi, bj, bs = i, j, s
        if bs < thr and len(members) <= maxs:
            break
        wi, wj = len(members[bi]), len(members[bj])
        cents[bi] = _n(cents[bi] * wi + cents[bj] * wj)
        members[bi] += members[bj]
        del members[bj]
        del cents[bj]

    gid_of_line = {}
    for gid, mem in enumerate(members):
        for i in mem:
            gid_of_line[i] = gid
    order = {}
    groups = []
    last = 0
    for i in range(len(lines)):
        if i in gid_of_line:
            g = gid_of_line[i]
            if g not in order:
                order[g] = len(order)
            last = order[g]
        groups.append(last)
    return groups
