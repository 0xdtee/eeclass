# -*- coding: utf-8 -*-
"""同音术语纠正:把识别出的「读音相同但字错」的片段换回正确术语。

原理:给一份术语表(如「映射/值域/导数」),对识别文本逐位置做定长窗口比对,
若窗口内每个汉字的拼音(忽略声调)与某术语完全一致、但字不同,就替换成该术语。
——专治「映射→影射」「值域→职域」「导数→到数」这类同音错;换 ASR 模型救不了它们。

只处理 >=2 字的术语(单字太容易误纠);英文/数字/标点按原字符参与比对,不受影响。
"""
from pypinyin import lazy_pinyin


class TermFixer:
    def __init__(self, terms):
        self.terms = sorted({t.strip() for t in terms if len(t.strip()) >= 2}, key=len, reverse=True)
        self.by_py = {}
        for t in self.terms:
            self.by_py.setdefault(tuple(lazy_pinyin(t)), t)   # 先登记的术语优先
        self.lens = sorted({len(t) for t in self.terms}, reverse=True)

    def _py_per_char(self, text):
        # 逐字取拼音,保证与术语的逐字拼音对齐;非汉字返回其本身
        return [lazy_pinyin(c)[0] if c.strip() else c for c in text]

    def fix(self, text):
        if not text or not self.terms:
            return text, []
        pys = self._py_per_char(text)
        out = []
        changes = []
        i, n = 0, len(text)
        while i < n:
            hit = None
            for L in self.lens:
                if i + L <= n:
                    term = self.by_py.get(tuple(pys[i:i + L]))
                    if term and text[i:i + L] != term:
                        hit = (term, L)
                        break
            if hit:
                term, L = hit
                changes.append((text[i:i + L], term))
                out.append(term)
                i += L
            else:
                out.append(text[i])
                i += 1
        return "".join(out), changes


if __name__ == "__main__":
    terms = ["映射", "逆映射", "值域", "定义域", "对应法则", "导数", "偏导数",
             "邻域", "极限", "微分", "积分", "三要素", "单射", "满射", "双射"]
    fx = TermFixer(terms)
    samples = [
        "这个就是影射的三要素。",
        "所以它的值域啊没有取到Y里边所有的元素。",
        "职域RF。",
        "呃其实有的书呢也叫它的影射啊。",
        "现在这个逆影射呢是从它的值余找一个点。",
        "到数和偏到数的定义。",
    ]
    for s in samples:
        y, ch = fx.fix(s)
        print(f"原:{s}\n改:{y}   {ch}\n")
