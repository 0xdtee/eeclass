# -*- coding: utf-8 -*-
"""Homophone term correction: replace recognized spans that \"sound right but use the wrong characters\" with the correct term.

How it works: given a glossary (e.g. mapping / range / derivative), scan the recognized text position by position with a fixed-length window;
if every Chinese character in the window has the same pinyin (ignoring tones) as some term but different characters, replace it with that term.
-- This targets homophone errors, where a term gets written with different characters that share its pinyin; swapping the ASR model can't fix them.

Only handles terms of length >= 2 (single characters are too easily miscorrected); English/digits/punctuation are compared as their literal characters and are unaffected.
"""
from pypinyin import lazy_pinyin


class TermFixer:
    def __init__(self, terms):
        self.terms = sorted({t.strip() for t in terms if len(t.strip()) >= 2}, key=len, reverse=True)
        self.by_py = {}
        for t in self.terms:
            self.by_py.setdefault(tuple(lazy_pinyin(t)), t)   # Terms registered earlier take priority
        self.lens = sorted({len(t) for t in self.terms}, reverse=True)

    def _py_per_char(self, text):
        # Take pinyin character by character to align with the term's per-character pinyin; non-Chinese characters return themselves
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
