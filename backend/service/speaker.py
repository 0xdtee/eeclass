# -*- coding: utf-8 -*-
"""说话人识别（声纹 + 在线聚类 + 事后合并）。

每句话 → 声纹向量 → 和已知说话人的中心向量比余弦相似度 → 命中就归进去并更新
中心，没命中就新建一个人。

**为什么是现在这套参数**（本机用带标注的三人对话实测，44 句）：

    模型          同人相似度最低   异人95分位   100%准确的阈值范围
    campplus         0.178        0.254      只有 0.30 一个点
    eres2netv2       0.319        0.256      0.20 ~ 0.40 一整片

原来用 campplus + 阈值 0.60：准确率 90.9%，**把 3 个人聚成了 7 个**——因为同一个人
两句话的相似度经常只有 0.4 出头，够不到 0.60 就被判成新人。这就是"一个人被拆成
同学A/B/C"的由来。换 eres2netv2 + 阈值 0.35 后：100% 准确、正好 3 个人。
（试过的无效方案：把音频幅度归一化再提声纹——毫无差别，别再试。）

即便如此，真实课堂比测试集难，所以再加一道兜底：**只合并、不拆分**。每句之后检查
一遍各个中心，两个"人"的中心像到一定程度就判定是同一个人，把后建的并进先建的，
并把已经写进 Word 的名字一起替换掉。只合并不拆分是有意的——合并错了顶多两个人
混成一个，拆错了则会让文档里冒出一堆莫须有的"同学"。
"""
import os
import numpy as np

SR = 16000
HERE = os.path.dirname(os.path.abspath(__file__))

DEFAULT_MODEL = "3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx"


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

        self.centroids = []   # 已归一化
        self.durations = []
        self.counts = []
        self.last_id = 0
        self.ex = None
        self.err = None
        self._merges = []     # 待上报的合并 [(被并掉的id, 并入的id)]
        self.library = []     # 跨会话声纹库 [(name, 归一化向量)],命中就用标记的身份
        self.vp_threshold = s.get("voiceprint_threshold", s["threshold"])

        if not self.enabled:
            return

        model_path = model_path or os.path.join(HERE, "models", s.get("model", DEFAULT_MODEL))
        try:
            import sherpa_onnx
            if not os.path.exists(model_path):
                raise FileNotFoundError(f"找不到声纹模型 {model_path}（跑一次 install.ps1 下载）")
            self.ex = sherpa_onnx.SpeakerEmbeddingExtractor(
                sherpa_onnx.SpeakerEmbeddingExtractorConfig(
                    model=model_path, num_threads=2, debug=False))
        except Exception as e:
            self.err = f"声纹模型加载失败({e})，将全部标记为同一个说话人"
            self.enabled = False

    # ---- 声纹 ----
    def embed(self, audio):
        s = self.ex.create_stream()
        s.accept_waveform(SR, np.ascontiguousarray(audio, dtype=np.float32))
        s.input_finished()
        e = np.array(self.ex.compute(s), dtype=np.float32)
        n = np.linalg.norm(e)
        return e / n if n > 0 else e

    # ---- 在线聚类 ----
    def identify(self, audio):
        """返回 (speaker_index, 置信度)。索引从 0 开始。"""
        if not self.enabled or self.ex is None:
            return 0, 0.0
        if audio.size < self.min_samples:
            return self.last_id, 0.0  # 太短，声纹不可靠，沿用上一句

        try:
            emb = self.embed(audio)
        except Exception:
            return self.last_id, 0.0

        dur = audio.size / SR
        if not self.centroids:
            self._add(emb, dur)
            self.last_id = 0
            return 0, 1.0

        sims = np.array([float(np.dot(emb, c)) for c in self.centroids])
        best = int(np.argmax(sims))
        score = float(sims[best])

        if score >= self.threshold or len(self.centroids) >= self.max_speakers:
            # 人数到顶时也归到最像的那个，别无限增殖
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

    # ---- 事后合并：同一个人被拆成两份时收回来 ----
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
        """把 frm 并进 to（总是并进先出现的那个，编号小的先建，也就是先说话的）。"""
        wa, wb = self.durations[to], self.durations[frm]
        c = self.centroids[to] * wa + self.centroids[frm] * wb
        self.centroids[to] = c / (np.linalg.norm(c) or 1.0)
        self.durations[to] += self.durations[frm]
        self.counts[to] += self.counts[frm]
        del self.centroids[frm]
        del self.durations[frm]
        del self.counts[frm]
        # 后面的编号整体前移，之前报出去的 id 要跟着修正
        self._merges.append((frm, to))
        if self.last_id == frm:
            self.last_id = to
        elif self.last_id > frm:
            self.last_id -= 1

    # ---- 跨会话声纹库匹配 ----
    def set_library(self, entries, threshold=None):
        """entries: [{name, embedding}]。加载已标记的声纹,新录音里命中就用该名字。"""
        self.library = []
        for v in entries or []:
            e = np.asarray(v.get("embedding") or [], dtype=np.float32)
            n = np.linalg.norm(e)
            if e.size and n > 0:
                self.library.append((v.get("name", ""), e / n))
        if threshold is not None:
            self.vp_threshold = threshold

    def match_name(self, idx):
        """会话内第 idx 个说话人的声纹中心 匹配声纹库,命中返回标记的名字,否则 None。"""
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
        """第 idx 个说话人当前的声纹中心(已归一化),没有返回 None。录音中改名后存进账号声纹库用。"""
        if idx is None or idx < 0 or idx >= len(self.centroids):
            return None
        return self.centroids[idx].copy()

    def take_merges(self):
        """取走待上报的合并，服务端据此把文档里写过的名字替换掉。"""
        m, self._merges = self._merges, []
        return m

    def main_speaker(self):
        """说得最多的那个，默认认定是老师。"""
        if not self.durations:
            return 0
        return int(np.argmax(self.durations))

    def stats(self):
        return [{"id": i, "seconds": round(d, 1), "utterances": self.counts[i]}
                for i, d in enumerate(self.durations)]
