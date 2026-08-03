# -*- coding: utf-8 -*-
"""离线划重点：纯规则，零延迟零费用。

四类信号加权打分：
  1. 口头强信号  「这个必考 / 期末大题 / 记一下 / 划重点」        +2
  2. 口头中信号  「注意 / 关键 / 核心 / 也就是说」                +1
  3. 定义句式    「……叫做…… / 定义为 / 记作」                    +2（标成定义，绿色）
  4. 定理公式    「格林公式 / 拉格朗日定理 / 判别法」              +1
  5. 重复强调    90 秒内说过高度相似的话                          +1
  6. 数学符号密度                                                +1

总分 ≥ key_score 就高亮。课后可再对 transcript 做语义分析补充重点。
"""
import re
import time

CJK_MATH = re.compile(r"[=＝+－\-×÷∫∮∑∏√∞≤≥≠∂∇αβγθλμπσωΔΩ]|[A-Za-z]\s*[\^_]|d[xyzt]\b")
NUMERIC = re.compile(r"\d")


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
        """返回 (kind, score, reasons)。kind ∈ {None, 'key', 'define'}"""
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

        # 重复强调：老师把同一句话说两遍，基本就是重点
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
