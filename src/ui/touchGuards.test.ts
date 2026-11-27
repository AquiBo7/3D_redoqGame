import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTouchGuards } from './touchGuards';

class StubElement {
  constructor(readonly insideDebug = false) {}
  closest(selector: string): StubElement | null {
    return selector === '.debug-panel' && this.insideDebug ? this : null;
  }
}

describe('installTouchGuards 全局触控与防误触保护', () => {
  let listeners: Map<string, Set<EventListener>>;
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    listeners = new Map();
    vi.stubGlobal('Element', StubElement);
    const target = {
      addEventListener: (type: string, fn: EventListener) => {
        const set = listeners.get(type) ?? new Set();
        set.add(fn);
        listeners.set(type, set);
      },
      removeEventListener: (type: string, fn: EventListener) => {
        listeners.get(type)?.delete(fn);
      },
    } as unknown as HTMLElement;
    cleanup = installTouchGuards(target);
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    vi.unstubAllGlobals();
  });

  function emit(type: string, extra: Record<string, unknown> = {}) {
    let defaultPrevented = false;
    const event = {
      type,
      target: extra.target ?? new StubElement(false),
      cancelable: true,
      touches: extra.touches ?? [{ identifier: 0 }],
      preventDefault: () => { defaultPrevented = true; },
      ...extra,
    };
    for (const fn of listeners.get(type) ?? []) {
      fn(event as unknown as Event);
    }
    return { defaultPrevented };
  }

  it('拦截页面内 dblclick / dragstart / gesturestart / 双指 touchstart 与非调试区选词/右键', () => {
    expect(emit('dblclick').defaultPrevented).toBe(true);
    expect(emit('dragstart').defaultPrevented).toBe(true);
    expect(emit('gesturestart').defaultPrevented).toBe(true);
    expect(emit('selectstart').defaultPrevented).toBe(true);
    expect(emit('contextmenu').defaultPrevented).toBe(true);
    expect(emit('touchstart', { touches: [{}, {}] }).defaultPrevented).toBe(true);
    // 单指触屏保留正常点击，不被拦截
    expect(emit('touchstart', { touches: [{}] }).defaultPrevented).toBe(false);
  });

  it('允许调试面板内部复制文本与打开上下文菜单，清理后不再拦截', () => {
    const debugEl = new StubElement(true);
    expect(emit('selectstart', { target: debugEl }).defaultPrevented).toBe(false);
    expect(emit('contextmenu', { target: debugEl }).defaultPrevented).toBe(false);

    cleanup?.();
    cleanup = null;
    expect(emit('dblclick').defaultPrevented).toBe(false);
  });
});
