import { useSyncExternalStore } from 'react';

/**
 * Global "step-by-step guide": after clicking "Go use it" in the manual, jump to the feature page and use highlight+arrow to point directly at the button to click next,
 * clicking that button (or "Next") advances to the next step.
 * targets[i] is the CSS selector of the element step i points at (usually [data-guide="xxx"]); if absent, show a centered hint.
 * Uses module-level shared state — in an SPA the component tree isn't unmounted on route changes, so the guide state naturally persists across pages.
 */
export interface GuideState {
  active: boolean;
  title: string;
  steps: string[];
  targets: string[];   // Aligned with steps, element selectors; empty string means the step has no target
  index: number;
}

let state: GuideState = { active: false, title: '', steps: [], targets: [], index: 0 };
const listeners = new Set<() => void>();

function set(next: GuideState) {
  state = next;
  listeners.forEach((l) => l());
}

export function startGuide(title: string, steps?: string[], targets?: string[]) {
  const s = (steps || []).filter((x) => x && x.trim());
  if (!s.length) return;
  const t = s.map((_, i) => (targets && targets[i]) || '');
  set({ active: true, title, steps: s, targets: t, index: 0 });
}

export function nextGuide() {
  if (!state.active) return;
  if (state.index >= state.steps.length - 1) {
    set({ ...state, active: false });   // Last step → finish and close
  } else {
    set({ ...state, index: state.index + 1 });
  }
}

export function prevGuide() {
  if (!state.active || state.index <= 0) return;
  set({ ...state, index: state.index - 1 });
}

export function endGuide() {
  if (!state.active) return;
  set({ ...state, active: false });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useGuide(): GuideState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
