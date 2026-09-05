/**
 * Convert a LaTeX-ish string (as used in the on-screen KaTeX) into readable plain text for Word/PDF export,
 * where KaTeX can't run. The output only uses characters the export CJK font (HarmonyOS Sans SC) actually has —
 * verified glyphs get real Unicode (→ × ≤ ∑ ∫ √ ² ₃ α…), the few missing ones fall back to ASCII/Chinese
 * (⊆→包含于, ∅→空集, ∘→o, x^{n+1}→x^(n+1)) so nothing renders as tofu.
 */

// Superscript / subscript digits (all present in the font); superscript n present, +/- are NOT — those stay caret.
const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', n: 'ⁿ' };
const SUB: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };

// LaTeX command -> replacement. Greek is filled in below; only verified-or-safe glyphs used.
const SYM: Record<string, string> = {
  to: '→', rightarrow: '→', longrightarrow: '→', mapsto: '→', longmapsto: '→', xrightarrow: '→',
  leftarrow: '←', gets: '←', longleftarrow: '←',
  Rightarrow: '=>', implies: '=>', Longrightarrow: '=>',
  Leftrightarrow: '<=>', iff: '<=>', Longleftrightarrow: '<=>', leftrightarrow: '<->',
  times: '×', div: '÷', cdot: '·', cdotp: '·', ast: '*', star: '*', bullet: '·',
  pm: '±', mp: '∓', // ∓ missing -> handled by fallback replace below
  leq: '≤', le: '≤', leqslant: '≤', geq: '≥', ge: '≥', geqslant: '≥',
  neq: '≠', ne: '≠', approx: '≈', cong: '≈', simeq: '≈', equiv: '≡',
  ll: '≪', gg: '≫', infty: '∞', in: '∈', notin: '∉', ni: '∋',
  cup: '∪', cap: '∩', setminus: '\\', emptyset: '∅', varnothing: '∅',
  subset: '⊆', subseteq: '⊆', supset: '⊇', supseteq: '⊇',
  forall: '∀', exists: '∃', neg: '¬', lnot: '¬', land: '∧', wedge: '∧', lor: '∨', vee: '∨',
  sum: '∑', prod: '∏', int: '∫', oint: '∮', iint: '∫∫', partial: '∂', nabla: '∇',
  angle: '∠', perp: '⊥', parallel: '∥', circ: '∘',
  ldots: '…', cdots: '…', dots: '…', dotsc: '…', dotsb: '…', vdots: '…',
  prime: '′', deg: '°', degree: '°', backslash: '\\',
  quad: '  ', qquad: '    ',
};
// Greek letters (the font carries the full block).
const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο',
  pi: 'π', varpi: 'π', rho: 'ρ', varrho: 'ρ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ',
  phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ',
  Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};
// Fallbacks for the handful of glyphs the font lacks, applied after command expansion.
const MISSING: Record<string, string> = {
  '∓': '-/+', '∅': '空集', '∘': 'o', '⊆': '包含于', '⊇': '包含', '∀': '任意', '∃': '存在',
  '∉': '不属于', '∋': '含', '≪': '≤≤', '≫': '≥≥', '∇': 'grad',
};

const supsub = (body: string, map: Record<string, string>, open: string): string => {
  if (/^[0-9n]+$/.test(body) && [...body].every((c) => map[c])) return [...body].map((c) => map[c]).join('');
  if (body.length === 1) return `${open}${body}`;   // _{i} -> _i, not _(i)
  return `${open}(${body})`;
};

export function latexToPlain(input: string): string {
  let s = String(input ?? '');
  if (!/[\\^_${}]/.test(s)) return s;   // no math markup at all -> leave untouched

  // 1. strip delimiters and spacing/formatting commands
  s = s.replace(/\$\$?/g, '').replace(/\\[()[\]]/g, '');
  s = s.replace(/\\(displaystyle|textstyle|scriptstyle|limits|nolimits|left|right|big|Big|bigg|Bigg)\b/g, '');
  s = s.replace(/\\[,;:!> ]/g, ' ').replace(/~/g, ' ');
  // 2. text/style wrappers and accents -> keep the inner content (drop the styling/accent)
  s = s.replace(/\\(?:text|textrm|textbf|textit|mathrm|mathbf|mathit|mathsf|mathtt|operatorname|mathbb|mathcal|mathscr|mathfrak|boldsymbol|bm|vec|hat|bar|tilde|dot|ddot|check|acute|grave|breve|overline|underline|overrightarrow|overleftarrow|widehat|widetilde)\s*\{([^{}]*)\}/g, '$1');
  s = s.replace(/\\(?:vec|hat|bar|tilde|dot|ddot|check|acute|grave|breve)\s+(\w)/g, '$1');
  // 3. degree written as ^\circ
  s = s.replace(/\^\s*\{?\s*\\circ\s*\}?/g, '°');
  // 4. fractions (a few passes for light nesting) and roots
  for (let i = 0; i < 4; i++) s = s.replace(/\\(?:d|t)?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)');
  s = s.replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, '($2)^(1/$1)');
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)');
  // 5. command words: greek, then symbols; unknown \foo -> foo
  s = s.replace(/\\([A-Za-z]+)/g, (_m, name) => GREEK[name] ?? SYM[name] ?? name);
  // 6. super/sub scripts
  s = s.replace(/\^\{([^{}]*)\}/g, (_m, b) => supsub(b, SUP, '^'));
  s = s.replace(/\^(\\?[A-Za-z0-9])/g, (_m, c) => SUP[c] ?? `^${c}`);
  s = s.replace(/_\{([^{}]*)\}/g, (_m, b) => supsub(b, SUB, '_'));
  s = s.replace(/_([A-Za-z0-9])/g, (_m, c) => SUB[c] ?? `_${c}`);
  // 7. drop leftover braces / stray backslashes, tidy whitespace
  s = s.replace(/[{}]/g, '').replace(/\\/g, '');
  // 8. swap out glyphs the font can't show
  s = s.replace(/[∓∅∘⊆⊇∀∃∉∋≪≫∇]/g, (c) => MISSING[c] ?? c);
  return s.replace(/[ \t]{2,}/g, ' ').trim();
}
