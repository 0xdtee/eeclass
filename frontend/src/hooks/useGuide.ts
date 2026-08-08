import { useSyncExternalStore } from 'react';

/**
 * 全局「逐步引导」:说明书点「前往使用」后跳到功能页,用高亮+箭头直接指向下一步该点的按钮,
 * 点击该按钮(或「下一步」)即前进到下一步。
 * targets[i] 是第 i 步要指向的元素的 CSS 选择器(通常是 [data-guide="xxx"]),没有就居中提示。
 * 用模块级共享 state —— SPA 换路由组件树不卸载,引导状态自然跨页保留。
 */
export interface GuideState {
  active: boolean;
  title: string;
  steps: string[];
  targets: string[];   // 与 steps 对齐,元素选择器;空串表示该步无指向
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
    set({ ...state, active: false });   // 最后一步 → 完成并关闭
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
