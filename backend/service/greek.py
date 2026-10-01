# -*- coding: utf-8 -*-
"""Greek letters spoken in class -> their symbols (兰姆达 -> λ, 2分之派 -> 2分之π).

Lectures name Greek letters all the time and ASR writes them as whatever Chinese sounds closest -- and with a
teacher's accent the same letter comes out several ways in one class (兰姆达 / 莱姆达 / 兰达 for λ in one real
lecture). Turning them into symbols makes the transcript read like the blackboard and gives search,
highlighting and the summary one spelling to work with.

Two tiers, because a wrong replacement costs more than a missed one:
  * distinctive names (阿尔法, 西格玛, 兰姆达, 欧米伽...) are replaced anywhere;
  * names that are also ordinary words or name fragments (派 π as in 派出所, 缪 μ as in 荒谬, 兰达, 克西, 伊塔...)
    only when maths sits right next to them: a digit / Latin letter / operator / another Greek symbol, or
    分之, 乘, 除以, 等于, 平方 and the like.
A 大 in front picks the capital where one is in common use (大西格玛 -> Σ, 大德尔塔 -> Δ); 小 is dropped.
English names (lambda, sigma...) are converted only inside Chinese speech; in an all-English line 'pi' or
'delta' may just be English. The two-letter mu / nu / xi are left out: too easily something else.
"""
import re

GREEK_CHARS = "αβγδεζηθικλμνξοπρστυφχψωΓΔΘΛΞΠΣΦΨΩ"

# (lowercase, capital or None, names replaced anywhere, names replaced only in maths context)
# Variants are what ASR produced in real classes plus the usual accent slips (l/n, front/back nasal, z/zh).
_LETTERS = [
    ("α", None, ["阿尔法", "阿尔发", "阿耳法", "阿法"], []),
    ("β", None, ["贝塔", "倍塔", "被塔", "蓓塔"], ["贝它"]),
    ("γ", "Γ", ["伽马", "伽玛", "嘎马", "嘎玛", "珈马"], ["甘马", "咖马"]),
    ("δ", "Δ", ["德尔塔", "得尔塔", "德耳塔", "代尔塔", "戴尔塔"], ["德塔", "德尔"]),
    ("ε", None, ["艾普西隆", "艾普西龙", "伊普西隆", "伊普西龙", "依普西龙", "一普西龙", "埃普西隆", "埃普西龙",
                 "艾普塞隆", "伊普塞隆"], ["普西隆", "普西龙"]),
    ("ζ", None, ["泽塔"], []),
    ("η", None, [], ["伊塔", "艾塔", "依塔"]),
    ("θ", "Θ", ["西塔", "希塔", "塞塔", "赛塔"], ["西它"]),
    ("κ", None, ["卡帕"], []),
    ("λ", "Λ", ["兰姆达", "拉姆达", "兰姆塔", "拉姆塔", "莱姆达", "兰布达", "拉布达", "朗姆达", "南姆达", "拉木达",
                "兰木达"], ["兰达"]),
    ("μ", None, [], ["缪", "谬"]),
    ("ν", None, [], ["纽"]),
    ("ξ", "Ξ", [], ["克西", "克赛", "可赛"]),
    ("π", "Π", [], ["派"]),
    ("ρ", None, [], ["柔", "肉"]),
    ("σ", "Σ", ["西格玛", "西格马", "希格玛", "希格马", "西个马", "斯格玛", "西哥马"], []),
    ("τ", None, [], ["涛"]),
    ("υ", None, ["宇普西龙", "宇普西隆"], []),
    ("φ", "Φ", [], ["斐", "菲"]),
    ("χ", None, [], ["凯"]),
    ("ψ", "Ψ", [], ["普西", "普赛", "普塞"]),
    ("ω", "Ω", ["欧米伽", "欧米茄", "欧米嘎", "奥米伽", "奥米茄", "欧米加", "欧密伽"], []),
]
_ENGLISH = {
    "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ε", "zeta": "ζ", "eta": "η",
    "theta": "θ", "iota": "ι", "kappa": "κ", "lambda": "λ", "lamda": "λ", "pi": "π", "rho": "ρ", "sigma": "σ", "tau": "τ", "upsilon": "υ", "phi": "φ", "chi": "χ", "psi": "ψ",
    "omega": "ω",
}

# "maths right here": the character next to the name, or a maths word touching it
_MATH_CH = r"0-9A-Za-z" + GREEK_CHARS + r"+\-×÷*/=＝<>≤≥≠^_()（）'′·²³√∞∫∑∂"
_MATH_BEFORE = re.compile(r"(?:[" + _MATH_CH + r"]\s*|分之|乘以?|除以|等于)$")
_MATH_AFTER = re.compile(r"^(?:\s*[" + _MATH_CH + r"]|分之|乘以?|除以|等于|的平方|平方|次方|的立方|是一个?数)")
_CN = re.compile(r"[一-鿿]")

_FORMS = {}      # spoken form -> (lowercase, capital, needs_context)
for _low, _cap, _free, _ctx in _LETTERS:
    for _n in _free:
        _FORMS[_n] = (_low, _cap, False)
    for _n in _ctx:
        _FORMS[_n] = (_low, _cap, True)
# longest first, so 阿尔法 wins over 阿法 and 德尔塔 over 德尔
_NAME_RE = re.compile(r"(大|小)?(" + "|".join(re.escape(n) for n in sorted(_FORMS, key=len, reverse=True)) + r")")
_ENGLISH_RE = re.compile(r"(?<![A-Za-z])(" + "|".join(sorted(_ENGLISH, key=len, reverse=True)) + r")(?![A-Za-z])",
                         re.IGNORECASE)


def _in_maths(text, start, end):
    return bool(_MATH_BEFORE.search(text[:start]) or _MATH_AFTER.search(text[end:]))


def normalize(text):
    """Return (text with Greek letter names replaced by symbols, [(spoken, symbol), ...])."""
    if not text:
        return text, []
    changes = []

    def name(m):
        size, spoken = m.group(1), m.group(2)
        low, cap, needs_ctx = _FORMS[spoken]
        if needs_ctx and not _in_maths(m.string, m.start(2), m.end(2)):
            return m.group(0)
        if size == "大" and cap:
            sym = cap
        elif size == "大":
            return m.group(0)            # no capital in use (大派 is not a letter): leave it
        else:
            sym = low                    # plain, or 小 (dropped)
        changes.append((m.group(0), sym))
        return sym

    text = _NAME_RE.sub(name, text)

    if _CN.search(text):
        def english(m):
            sym = _ENGLISH[m.group(1).lower()]
            changes.append((m.group(1), sym))
            return sym
        text = _ENGLISH_RE.sub(english, text)
    return text, changes


def spoken_names():
    """One spoken name per letter, for ASR hotword lists (biases recognition toward the letter names)."""
    return [free[0] for _, _, free, _ in _LETTERS if free]
