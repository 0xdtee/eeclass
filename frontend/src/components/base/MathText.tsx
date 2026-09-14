import { useMemo } from 'react';
import katex from 'katex';

/**
 * Renders text that may contain LaTeX math formulas:
 * - Inline formulas wrapped in $...$, display formulas in $$...$$, rendered via KaTeX;
 * - Everything else is treated as plain text (HTML escaped, line breaks preserved).
 *
 * The AI is asked to delimit math with $, but in practice it often writes bare LaTeX-flavoured text
 * ("sh x=(e^x-e^{-x})/2"), which then showed up raw on screen. When a string carries no $ at all we
 * find the formulas ourselves (see markBareMath) so old summaries render without being regenerated.
 */
export default function MathText({ text, className }: { text?: string; className?: string }) {
  const html = useMemo(() => renderMath(markBareMath(text || '')), [text]);
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

// ── Bare-math detection ────────────────────────────────────────────────
// Characters a formula may be built from. Chinese text is not in the set, so prose naturally ends a span.
const MATH_CHARS =
  "A-Za-z0-9_^{}\\[\\]()+\\-*/=<>|.,'’′!\\\\ " +
  '≤≥≠≈≡∈∉⊂⊆⊃⊇∪∩∅∞∑∏∫∮√∂∇±∓×÷·→←⇒⇔∀∃¬∧∨∠⊥∥∘…';
const GREEK_CHARS = 'αβγδεζηθικλμνξοπρστυφχψωΓΔΘΛΞΠΣΦΨΩ';
const CANDIDATE = new RegExp(`[${MATH_CHARS}${GREEK_CHARS}]+`, 'g');
/** A run only counts as a formula if it carries one of these; otherwise "高等数学A(1)" would become math. */
const STRONG =
  /[\^_\\≤≥≠≈≡∈∉⊂⊆⊃⊇∪∩∅∞∑∏∫∮√∂∇±∓×÷→⇒⇔∀∃]|=|[A-Za-z0-9)\]]\s*[<>]\s*[A-Za-z0-9(\[]|\|[^|]+\|/;

const UNICODE_TEX: Record<string, string> = {
  '≤': '\\le ', '≥': '\\ge ', '≠': '\\ne ', '≈': '\\approx ', '≡': '\\equiv ', '∈': '\\in ', '∉': '\\notin ',
  '⊂': '\\subset ', '⊆': '\\subseteq ', '⊃': '\\supset ', '⊇': '\\supseteq ', '∪': '\\cup ', '∩': '\\cap ',
  '∅': '\\varnothing ', '∞': '\\infty ', '∑': '\\sum ', '∏': '\\prod ', '∫': '\\int ', '∮': '\\oint ',
  '√': '\\sqrt ', '∂': '\\partial ', '∇': '\\nabla ', '±': '\\pm ', '∓': '\\mp ', '×': '\\times ', '÷': '\\div ',
  '·': '\\cdot ', '→': '\\to ', '←': '\\leftarrow ', '⇒': '\\Rightarrow ', '⇔': '\\Leftrightarrow ',
  '∀': '\\forall ', '∃': '\\exists ', '¬': '\\neg ', '∧': '\\land ', '∨': '\\lor ', '∠': '\\angle ',
  '⊥': '\\perp ', '∥': '\\parallel ', '∘': '\\circ ', '…': '\\dots ', '′': "'", '’': "'",
};
const GREEK_TEX: Record<string, string> = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'varepsilon', ζ: 'zeta', η: 'eta', θ: 'theta', ι: 'iota',
  κ: 'kappa', λ: 'lambda', μ: 'mu', ν: 'nu', ξ: 'xi', π: 'pi', ρ: 'rho', σ: 'sigma', τ: 'tau', υ: 'upsilon',
  φ: 'varphi', χ: 'chi', ψ: 'psi', ω: 'omega', Γ: 'Gamma', Δ: 'Delta', Θ: 'Theta', Λ: 'Lambda', Ξ: 'Xi',
  Π: 'Pi', Σ: 'Sigma', Φ: 'Phi', Ψ: 'Psi', Ω: 'Omega',
};
/** Upright, not italic: "sh x" should not read as s·h·x. */
const FUNCS = ['arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'log', 'ln', 'lg', 'exp', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'deg', 'gcd', 'sh', 'ch', 'th'];
const FUNC_RE = new RegExp(`\\b(${FUNCS.join('|')})\\b`, 'g');

function toTex(s: string): string {
  let out = '';
  for (const c of s) out += UNICODE_TEX[c] ?? (GREEK_TEX[c] ? `\\${GREEK_TEX[c]} ` : c);
  return out.replace(FUNC_RE, (m) => `\\operatorname{${m}}`);
}

/**
 * Wrap the formulas in an undelimited string with $, so the normal renderer below picks them up.
 * A string that already uses $ is left alone -- the author said where the math is.
 */
function markBareMath(s: string): string {
  if (!s || s.includes('$')) return s;
  let out = '', last = 0;
  for (const m of s.matchAll(CANDIDATE)) {
    const raw = m[0];
    const lead = raw.length - raw.replace(/^[\s.,!]+/, '').length;
    const body = raw.replace(/^[\s.,!]+/, '').replace(/[\s.,!]+$/, '');
    if (body.length < 2 || !STRONG.test(body) || !/[A-Za-z0-9]/.test(body)) continue;
    const start = (m.index ?? 0) + lead;
    out += s.slice(last, start) + '$' + toTex(body) + '$';
    last = start + body.length;
  }
  return out + s.slice(last);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMath(s: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === '$') {
      const block = s[i + 1] === '$';
      const delim = block ? '$$' : '$';
      const end = s.indexOf(delim, i + delim.length);
      if (end !== -1) {
        const tex = s.slice(i + delim.length, end);
        try {
          out.push(katex.renderToString(tex, { throwOnError: false, displayMode: block }));
        } catch {
          out.push(esc(delim + tex + delim));
        }
        i = end + delim.length;
        continue;
      }
      // Unclosed $: treat as a normal character, advance one position to avoid an infinite loop
      out.push('$');
      i += 1;
      continue;
    }
    const next = s.indexOf('$', i);
    const chunk = next === -1 ? s.slice(i) : s.slice(i, next);
    out.push(esc(chunk).replace(/\n/g, '<br/>'));
    i = next === -1 ? s.length : next;
  }
  return out.join('');
}
