# -*- coding: utf-8 -*-
"""Offline highlighting: pure rules, zero latency, zero cost.

Four kinds of signals are scored with weights:
  1. Strong verbal cue   "this is definitely on the exam / big final question / write this down / this is key"   +2
  2. Medium verbal cue   "note that / crucial / core / in other words"                                          +1
  3. Definition phrasing  "...is called... / defined as / denoted"                                              +2 (marked as a definition, green)
  4. Theorem/formula     "Green's formula / Lagrange's theorem / convergence test"                             +1
  5. Repeated emphasis   a highly similar sentence said within 90 seconds                                       +1
  6. Density of math symbols                                                                                    +1

Highlight when the total score >= key_score. After class, semantic analysis of the transcript can add more highlights.
"""
import re
import time

CJK_MATH = re.compile(r"[=＝+－\-×÷∫∮∑∏√∞≤≥≠∂∇αβγθλμπσωΔΩ]|[A-Za-z]\s*[\^_]|d[xyzt]\b")
NUMERIC = re.compile(r"\d")
# "X的定义 / 定义如下 / 什么是X / 先讲定义" only ANNOUNCE that a definition is coming -- the defining content is
# the following sentence(s). These lines mention 「定义」 but aren't the definition, so don't green-highlight them.
_ANNOUNCE_DEF = re.compile(r"的定义|定义如下|什么是|叫什么|下面.{0,6}定义|先.{0,8}定义|讲.{0,4}定义|定义[是这那][样个]?")
# Real defining phrasing (this sentence actually defines something) -- keep the highlight even if it also announces.
_REAL_DEF = re.compile(r"称为|叫做|叫作|定义为|记作|记为|是指|所谓|也就是说")


def _bigrams(s):
    s = re.sub(r"[，。！？、；：\s,.!?;:]", "", s)
    return {s[i:i + 2] for i in range(len(s) - 1)} if len(s) > 1 else {s}


def _similar(a, b):
    A, B = _bigrams(a), _bigrams(b)
    if not A or not B:
        return 0.0
    return len(A & B) / len(A | B)


class Highlighter:
    def __init__(self, cfg):
        h = cfg["highlight"]
        self.enabled = h["enabled"]
        self.key_score = h["key_score"]
        self.strong = h["strong_words"]
        self.medium = h["medium_words"]
        self.define = h["define_patterns"]
        self.formula = h["formula_patterns"]
        self.win = h["repeat_window_s"]
        self.rep_sim = h["repeat_similarity"]
        self.recent = []  # [(t, text)]

    def judge(self, text, t_sec):
        """Returns (kind, score, reasons). kind in {None, 'key', 'define'}"""
        if not self.enabled or not text:
            return None, 0, []

        score = 0
        reasons = []
        is_define = False

        hits = [w for w in self.strong if w in text]
        if hits:
            score += 2
            reasons.append("强调:" + "/".join(hits[:3]))

        hits = [w for w in self.medium if w in text]
        if hits:
            score += 1
            reasons.append("提示:" + "/".join(hits[:3]))

        hits = [w for w in self.define if w in text]
        if hits and len(text) >= 8:
            # Skip announcement-only sentences ("X的定义" / "什么是X") -- they name a definition but aren't one;
            # the real definition is the next line. Keep the highlight if the sentence actually defines something.
            if _ANNOUNCE_DEF.search(text) and not _REAL_DEF.search(text):
                pass
            else:
                score += 2
                is_define = True
                reasons.append("定义:" + hits[0])

        hits = [w for w in self.formula if w in text]
        if hits:
            score += 1
            reasons.append("定理公式:" + hits[0])

        if len(CJK_MATH.findall(text)) >= 2 or (NUMERIC.search(text) and len(text) < 25 and "=" in text):
            score += 1
            reasons.append("含公式")

        # repeated emphasis: if the teacher says the same sentence twice, it's basically a key point
        self.recent = [(t, s) for (t, s) in self.recent if t_sec - t <= self.win]
        if len(text) >= 8:
            for _, prev in self.recent:
                if _similar(text, prev) >= self.rep_sim:
                    score += 1
                    reasons.append("重复强调")
                    break
        self.recent.append((t_sec, text))

        if score < self.key_score:
            return None, score, reasons
        return ("define" if is_define and score < self.key_score + 2 else "key"), score, reasons
