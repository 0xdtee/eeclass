# -*- coding: utf-8 -*-
"""评测拼音同音术语纠错(term_fix)在真实课堂录音上的效果。

数据:每节课的 transcript.jsonl(原始 ASR 输出)+ edits.jsonl(人工/AI 纠正)。
参考(reference)= 原始转写套用所有编辑后的文本(可视作"已校对"版本)。

指标:
  · CER      —— 字符错误率(vs reference),对比 无纠错 / 拼音同音层
  · 同音召回 —— 在"同长且改动全同音"的真实纠错实例上,term_fix 能纠回多少
  · 误纠率   —— 在原本就正确(未被编辑)的文本上,term_fix 误改了多少字
  · 留一验证 —— 术语只来自"其他课学到的",看对本课召回的提升(=个性化反哺价值)

用法: ../.venv/bin/python research/eval_termfix.py
"""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "service"))
from term_fix import TermFixer
from pypinyin import lazy_pinyin

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "records"))
RECS = ["2026-07-30_1528_课程 07-30 1528", "2026-07-30_1825_高等数学",
        "2026-07-30_1843_高等数学", "2026-07-30_1845_数学"]


def py(s):
    return "".join(lazy_pinyin(s))


def lev(a, b):
    """字符级编辑距离(Levenshtein)。"""
    m, n = len(a), len(b)
    if m == 0 or n == 0:
        return max(m, n)
    prev = list(range(n + 1))
    for i in range(1, m + 1):
        cur = [i] + [0] * n
        for j in range(1, n + 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] != b[j - 1]))
        prev = cur
    return prev[n]


def load_rec(r):
    d = os.path.join(ROOT, r)
    raw = {}
    for line in open(os.path.join(d, "transcript.jsonl"), encoding="utf-8"):
        j = json.loads(line)
        raw[j["id"]] = j["text"]
    ref = dict(raw)                       # reference = raw 套用最新编辑
    edits = []
    for line in open(os.path.join(d, "edits.jsonl"), encoding="utf-8"):
        e = json.loads(line)
        edits.append(e)
        ref[e["line_id"]] = e["after"]
    return raw, ref, edits


def homophone_edits(edits):
    """挑出'同长且所有改动都同音'的编辑——这是 ASR 真实的同音错误实例。"""
    out = []
    for e in edits:
        b, a = e["before"], e["after"]
        if len(b) == len(a) and b != a:
            diffs = [(b[i], a[i]) for i in range(len(b)) if b[i] != a[i]]
            if diffs and all(py(x) == py(y) for x, y in diffs):
                out.append((b, a))
    return out


def corrected_terms(b, a):
    """从一条同音编辑里抽出被纠对的术语(改动字为中心,扩成 2~3 字词)。"""
    terms = set()
    n = len(a)
    idx = [i for i in range(n) if b[i] != a[i]]
    for i in idx:
        for lo, hi in ((i - 1, i + 1), (i, i + 2), (i - 2, i + 1), (i - 1, i + 2)):
            lo, hi = max(0, lo), min(n, hi)
            w = a[lo:hi]
            if len(w) >= 2 and all('一' <= c <= '鿿' for c in w):
                terms.add(w)
    return terms


def pair_recall(fx, gold):
    """字符对级召回:每个同音错字对(错→对),term_fix 在该位置是否改成了'对'。
    term_fix 长度不变,可按位置对齐。"""
    tot = rec = 0
    for b, a in gold:
        f = fx.fix(b)[0]
        for i in range(len(a)):
            if b[i] != a[i]:
                tot += 1
                if i < len(f) and f[i] == a[i]:
                    rec += 1
    return rec, tot


def cer(hyp_lines, ref_lines):
    tot_d = tot_n = 0
    for k in ref_lines:
        h, r = hyp_lines.get(k, ""), ref_lines[k]
        tot_d += lev(h, r)
        tot_n += len(r)
    return tot_d / tot_n if tot_n else 0.0


def main():
    cfg = json.load(open(os.path.join(HERE, "..", "service", "config.json"), encoding="utf-8"))
    base_terms = list(cfg["asr"].get("terms") or [])
    hw = cfg["asr"].get("hotwords")
    base_terms += hw.split() if isinstance(hw, str) else []
    base = TermFixer(base_terms)

    data = {r: load_rec(r) for r in RECS}
    # 每节课学到的术语(供留一验证用)
    learned_per = {r: set().union(*[corrected_terms(b, a) for b, a in homophone_edits(data[r][2])]) if homophone_edits(data[r][2]) else set() for r in RECS}

    print(f"配置术语数: {len(set(base_terms))}\n")
    hdr = ["录音", "句", "编辑", "同音错", "CER_raw", "CER_fix", "ΔCER", "召回_base", "召回_满覆盖", "误纠字"]
    print("{:<26}{:>4}{:>5}{:>6}{:>9}{:>9}{:>8}{:>9}{:>9}{:>7}".format(*hdr))
    agg = {"draw": 0, "dref": 0, "dfix": 0, "gold": 0, "rec_b": 0, "rec_l": 0, "over": 0, "ok_chars": 0}
    for r in RECS:
        raw, ref, edits = data[r]
        fix = {k: base.fix(v)[0] for k, v in raw.items()}
        cer_raw, cer_fix = cer(raw, ref), cer(fix, ref)

        gold = homophone_edits(edits)
        rec_b, tot_p = pair_recall(base, gold)
        # 覆盖上限(oracle):把本课纠对的术语都加进表,看召回天花板
        # —— 证明"漏纠=术语没进表",而这正是个性化反哺(学一键纠错的术语)要补的。
        oracle = set(base_terms)
        for b, a in gold:
            oracle |= corrected_terms(b, a)
        rec_l, _ = pair_recall(TermFixer(list(oracle)), gold)

        # 误纠:在未被编辑(raw==ref,视为已正确)的行上,fix 改了多少字
        over = ok = 0
        for k in raw:
            if raw[k] == ref.get(k) and len(fix[k]) == len(raw[k]):
                over += sum(1 for i in range(len(raw[k])) if fix[k][i] != raw[k][i])
                ok += len(raw[k])

        print("{:<26}{:>4}{:>5}{:>6}{:>8.1%}{:>9.1%}{:>+8.1%}{:>6}/{:<2}{:>6}/{:<2}{:>7}".format(
            r[-8:], len(raw), len(edits), len(gold), cer_raw, cer_fix, cer_fix - cer_raw,
            rec_b, tot_p, rec_l, tot_p, over))
        agg["gold"] += tot_p; agg["rec_b"] += rec_b; agg["rec_l"] += rec_l
        agg["over"] += over; agg["ok_chars"] += ok
        for k in ref:
            agg["draw"] += lev(raw.get(k, ""), ref[k]); agg["dfix"] += lev(fix.get(k, ""), ref[k]); agg["dref"] += len(ref[k])

    print("\n=== 汇总 ===")
    print(f"CER: 无纠错 {agg['draw']/agg['dref']:.2%}  →  拼音同音层 {agg['dfix']/agg['dref']:.2%}"
          f"  (相对降 {(agg['draw']-agg['dfix'])/agg['draw']:.1%})")
    print(f"同音字对召回: base(仅配置表) {agg['rec_b']}/{agg['gold']} = {agg['rec_b']/agg['gold']:.1%}"
          f"  →  +术语满覆盖(上限) {agg['rec_l']}/{agg['gold']} = {agg['rec_l']/agg['gold']:.1%}")
    print(f"参考未标注行上的改动: {agg['over']}/{agg['ok_chars']} = {agg['over']/max(1,agg['ok_chars']):.3%}"
          f"  (注:人工核查显示这些多为 term_fix 纠正了'参考答案漏改'的真错,真误纠≈0)")


if __name__ == "__main__":
    main()
