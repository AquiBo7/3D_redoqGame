// audio/audioManager.test.ts —— 静音开关持久化与无上下文静默降级
// 纯 Node 环境：不创建 AudioContext，仅验证状态与 localStorage 契约。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

function installStorage(): void {
  const fakeStorage = {
    getItem: (key: string): string | null => store.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      store.set(key, value);
    },
    removeItem: (key: string): void => {
      store.delete(key);
    },
    clear: (): void => {
      store.clear();
    },
    key: (index: number): string | null => [...store.keys()][index] ?? null,
    get length(): number {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: fakeStorage,
    configurable: true,
  });
}

describe('静音开关', () => {
  beforeEach(() => {
    store.clear();
    vi.resetModules();
    installStorage();
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    vi.resetModules();
  });

  it('默认不静音；切换后写入 localStorage 并可被新会话读取', async () => {
    const audio = await import('./audioManager');
    expect(audio.isMuted()).toBe(false);

    expect(audio.toggleMuted()).toBe(true);
    expect(audio.isMuted()).toBe(true);
    expect(store.get('yitiaojietu:muted')).toBe('1');

    expect(audio.toggleMuted()).toBe(false);
    expect(store.get('yitiaojietu:muted')).toBe('0');

    // 模拟刷新：模块重新加载后仍读取持久化状态
    store.set('yitiaojietu:muted', '1');
    vi.resetModules();
    const reloaded = await import('./audioManager');
    expect(reloaded.isMuted()).toBe(true);
  });

  it('localStorage 不可用时静默降级，不抛出异常', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => {
          throw new Error('storage disabled');
        },
        setItem: () => {
          throw new Error('storage disabled');
        },
      },
      configurable: true,
    });

    const audio = await import('./audioManager');
    expect(audio.isMuted()).toBe(false);
    expect(() => audio.setMuted(true)).not.toThrow();
    expect(audio.isMuted()).toBe(true);
  });

  it('没有 AudioContext 时播放接口全部静默 no-op', async () => {
    const audio = await import('./audioManager');
    expect(() => {
      audio.playAlarm();
      audio.playUiClick();
      audio.playPhoneChime();
      audio.updateFootsteps(0.016, 1.9, true);
    }).not.toThrow();
  });
});