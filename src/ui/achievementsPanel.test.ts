import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus, type GameEvents } from '../core/eventBus';
import type { MetaProgress } from '../core/state';
import { ACHIEVEMENTS } from '../data/achievements';
import { ASSET_MANIFEST, READY_EXTERNAL_ASSETS } from '../data/assetManifest';
import { playUiClick } from '../audio/audioManager';
import { initAchievementsPanel } from './achievementsPanel';

vi.mock('../audio/audioManager', () => ({ playUiClick: vi.fn() }));

// 最小 DOM：运行真实面板、事件总线、资产回退与定时器，不依赖浏览器或 WebGL。
class FakeElement extends EventTarget {
  className = '';
  type = '';
  hidden = false;
  inert = false;
  tabIndex = -1;
  src = '';
  alt = '';
  draggable = true;
  scrollTop = 0;
  onerror: (() => void) | null = null;
  parentElement: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  private text = '';
  private readonly attributes = new Map<string, string>();

  constructor(readonly tagName: string) { super(); }
  get ownerDocument(): FakeDocument { return doc; }
  get isConnected(): boolean { return this === doc.body || (this.parentElement?.isConnected ?? false); }
  get textContent(): string { return this.text + this.children.map((child) => child.textContent).join(''); }
  set textContent(value: string) { this.replaceChildren(); this.text = value; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.remove();
      node.parentElement = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes: FakeElement[]): void {
    for (const child of this.children) child.parentElement = null;
    this.children.length = 0;
    this.text = '';
    this.append(...nodes);
  }
  remove(): void {
    const siblings = this.parentElement?.children;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }
  matches(selector: string): boolean {
    return selector.split(',').some((part) => {
      const value = part.trim();
      if (value.startsWith('.')) return this.className.split(/\s+/).includes(value.slice(1));
      if (value === '[hidden]') return this.hidden;
      if (value === '[inert]') return this.inert;
      return this.tagName === value;
    });
  }
  querySelectorAll(selector: string): FakeElement[] {
    const found: FakeElement[] = [];
    for (const child of this.children) {
      if (child.matches(selector)) found.push(child);
      found.push(...child.querySelectorAll(selector));
    }
    return found;
  }
  closest(selector: string): FakeElement | null {
    return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null;
  }
  contains(node: FakeElement | null): boolean {
    return this === node || this.children.some((child) => child.contains(node));
  }
  click(): void { this.dispatchEvent(new Event('click')); }
  focus(): void {
    doc.activeElement = this;
    const event = new Event('focusin');
    Object.defineProperty(event, 'target', { value: this });
    doc.dispatchEvent(event);
  }
}

class FakeDocument extends EventTarget {
  readonly body = new FakeElement('body');
  activeElement: FakeElement | null = null;
  createElement(tag: string): FakeElement { return new FakeElement(tag); }
}

let doc: FakeDocument;
let win: EventTarget;
let bus: EventBus;
let dispose: () => void;
let opener: FakeElement;

function query(selector: string): FakeElement {
  const node = doc.body.querySelectorAll(selector)[0];
  if (!node) throw new Error(`找不到节点：${selector}`);
  return node;
}
function key(value: string, shiftKey = false): Event {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperties(event, { key: { value }, shiftKey: { value: shiftKey } });
  win.dispatchEvent(event);
  return event;
}
function meta(achievements: string[] = []): MetaProgress {
  return { unlockedRoles: ['bystander'], unlockedEndings: [], achievements };
}
function changed(achievements: string[], newlyUnlocked: string[] = []): void {
  bus.emit('meta:changed', { meta: meta(achievements), newlyUnlocked });
}
function toastId(): string | undefined {
  return query('.achievements-toast').children[0]?.dataset.achievementId;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  doc = new FakeDocument();
  win = new EventTarget();
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  vi.stubGlobal('HTMLElement', FakeElement);
  opener = doc.createElement('button');
  doc.body.append(opener);
  opener.focus();
  bus = new EventBus();
  dispose = initAchievementsPanel(bus);
});

afterEach(() => {
  dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Phase D 成就列表', () => {
  it('打开先同步 requestMeta，每次获取新数据且不补发历史提示', () => {
    changed(['A1']);
    const request = vi.fn(() => {
      expect(query('.achievements').hidden).toBe(true);
      changed(['A3']);
    });
    bus.on('ui:requestMeta', request);
    bus.emit('ui:openAchievements');
    expect(request).toHaveBeenCalledOnce();
    const rows = query('.achievements__list').children;
    expect(rows).toHaveLength(6);
    expect(rows[0].textContent).toContain('尚未完成的结局');
    expect(rows[2].textContent).toContain('另一种围观');
    expect(rows[2].textContent).toContain('已记录');
    expect(toastId()).toBeUndefined();
    expect(playUiClick).not.toHaveBeenCalled();
    key('Escape');
    bus.emit('ui:openAchievements');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('所有未解锁标题隐藏，A6 描述也隐藏，五个普通成就不会在 UI 推导 A6', () => {
    bus.emit('ui:openAchievements');
    const rows = query('.achievements__list').children;
    expect(rows.map((row) => row.querySelectorAll('.achievements__name')[0].textContent)).toEqual(Array(6).fill('？？？'));
    expect(rows[5].querySelectorAll('.achievements__description')[0].textContent).toBe('？？？');
    expect(rows[5].textContent).not.toContain('看见');
    expect(rows[5].querySelectorAll('.achievements__status')).toHaveLength(0);
    changed(['A1', 'A2', 'A3', 'A4', 'A5']);
    expect(query('.achievements__list').children[5].textContent).toBe('？？？？？？');
    expect(toastId()).toBeUndefined();
    changed(ACHIEVEMENTS.map((entry) => entry.id));
    expect(query('.achievements__list').children[5].textContent).toContain('看见');
    expect(toastId()).toBeUndefined();
  });

  it('按纯数据呈现金银图标和状态，资产缺省为内联回退且不猜 PNG 地址', () => {
    changed(ACHIEVEMENTS.map((entry) => entry.id));
    bus.emit('ui:openAchievements');
    const rows = query('.achievements__list').children;
    rows.forEach((row, index) => {
      const entry = ACHIEVEMENTS[index];
      expect(row.textContent).toBe(entry.title + entry.description + entry.status);
      const image = row.querySelectorAll('img')[0];
      const assetId = entry.color === 'gold' ? 'trophy_gold' : 'trophy_silver';
      expect(image.dataset.assetId).toBe(assetId);
      expect(image.alt).toBe(ASSET_MANIFEST[assetId].alt);
      expect(image.draggable).toBe(false);
      if (READY_EXTERNAL_ASSETS[assetId] === ASSET_MANIFEST[assetId].path) {
        expect(image.src).toBe(ASSET_MANIFEST[assetId].path);
        image.onerror?.();
      }
      expect(image.src).toMatch(/^data:image\/svg\+xml/);
    });
  });

  it('Tab/Shift+Tab 循环，焦点逃逸收回，Esc 恢复焦点和背景原有 inert 状态', () => {
    const alreadyInert = doc.createElement('div');
    alreadyInert.inert = true;
    doc.body.append(alreadyInert);
    bus.emit('ui:openAchievements');
    const close = query('.achievements__close');
    const list = query('.achievements__list');
    expect(query('.achievements').getAttribute('aria-modal')).toBe('true');
    expect(doc.activeElement).toBe(close);
    expect(opener.inert).toBe(true);
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(doc.activeElement).toBe(list);
    key('Tab');
    expect(doc.activeElement).toBe(close);
    key('Tab', true);
    expect(doc.activeElement).toBe(list);
    key('Tab', true);
    expect(doc.activeElement).toBe(close);
    opener.focus();
    expect(doc.activeElement).toBe(close);
    expect(key('Escape').defaultPrevented).toBe(true);
    expect(doc.activeElement).toBe(opener);
    expect(opener.inert).toBe(false);
    expect(alreadyInert.inert).toBe(true);
    expect(key('Tab').defaultPrevented).toBe(false);
  });

  it('重复打开不覆盖返回焦点；关闭按钮、遮罩可关闭；已移除入口不再聚焦', () => {
    const focus = vi.spyOn(opener, 'focus');
    bus.emit('ui:openAchievements');
    bus.emit('ui:openAchievements');
    query('.achievements__close').click();
    expect(focus).toHaveBeenCalledOnce();
    bus.emit('ui:openAchievements');
    query('.achievements').click();
    expect(query('.achievements').hidden).toBe(true);
    bus.emit('ui:openAchievements');
    opener.remove();
    focus.mockClear();
    key('Escape');
    expect(focus).not.toHaveBeenCalled();
  });
});

describe('新增提示队列与清理', () => {
  it('只响应 newlyUnlocked，去重未知 ID，当前成就先于 A6 且各显示 3.2 秒', () => {
    changed(['A1', 'A2', 'A3', 'A4', 'A5', 'A6']);
    expect(vi.getTimerCount()).toBe(0);
    changed(['A5', 'A6'], ['A6', 'A5', 'A5', 'unknown', 'A6']);
    expect(toastId()).toBe('A5');
    expect(query('.achievements-toast').textContent).toContain('已记录');
    expect(query('.achievements-toast').querySelectorAll('img')[0].dataset.assetId).toBe('trophy_silver');
    expect(query('.achievements-toast').getAttribute('aria-live')).toBe('polite');
    changed(['A5', 'A6'], ['A5', 'A6']);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(3199);
    expect(toastId()).toBe('A5');
    vi.advanceTimersByTime(1);
    expect(toastId()).toBe('A6');
    expect(query('.achievements-toast').textContent).toContain('已完成');
    expect(query('.achievements-toast').querySelectorAll('img')[0].dataset.assetId).toBe('trophy_gold');
    vi.advanceTimersByTime(3200);
    expect(toastId()).toBeUndefined();
    changed(['A5', 'A6'], ['A5', 'A6']);
    expect(vi.getTimerCount()).toBe(0);
    expect(playUiClick).toHaveBeenCalledTimes(2);
  });

  it('跨事件追加保持队列，不抢断当前提示；打开/关闭列表不触发或丢弃提示', () => {
    changed(['A1'], ['A1']);
    vi.advanceTimersByTime(1000);
    changed(['A1', 'A2'], ['A2']);
    bus.emit('ui:openAchievements');
    key('Escape');
    expect(toastId()).toBe('A1');
    vi.advanceTimersByTime(2200);
    expect(toastId()).toBe('A2');
    vi.advanceTimersByTime(3200);
    expect(toastId()).toBeUndefined();
  });

  it.each(['game:title', 'scene:transition'] as const)('%s 关闭弹窗并清空当前/等待提示及定时器', (event) => {
    changed(['A1', 'A6'], ['A1', 'A6']);
    bus.emit('ui:openAchievements');
    if (event === 'game:title') bus.emit(event, { hasSave: true });
    else bus.emit(event, { fromSceneId: null, toSceneId: 'S1', sceneKey: 'room', role: 'bystander', title: '' } as GameEvents['scene:transition']);
    expect(query('.achievements').hidden).toBe(true);
    expect(doc.activeElement).toBe(opener);
    expect(vi.getTimerCount()).toBe(0);
    expect(toastId()).toBeUndefined();
    changed(['A1', 'A6'], ['A1', 'A6']);
    vi.advanceTimersByTime(6400);
    expect(toastId()).toBeUndefined();
    expect(playUiClick).toHaveBeenCalledOnce();
  });

  it('dispose 幂等并释放订阅、键盘/焦点/点击监听、DOM 和定时器', () => {
    changed(['A1', 'A6'], ['A1', 'A6']);
    bus.emit('ui:openAchievements');
    const oldClose = query('.achievements__close');
    dispose();
    dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(doc.body.children).toEqual([opener]);
    expect(opener.inert).toBe(false);
    expect(doc.activeElement).toBe(opener);
    const request = vi.fn();
    bus.on('ui:requestMeta', request);
    bus.emit('ui:openAchievements');
    changed(['A2'], ['A2']);
    oldClose.click();
    expect(request).not.toHaveBeenCalled();
    expect(key('Escape').defaultPrevented).toBe(false);
    opener.focus();
    expect(doc.activeElement).toBe(opener);
    vi.advanceTimersByTime(10000);
    expect(playUiClick).toHaveBeenCalledOnce();
    expect(doc.body.children).toEqual([opener]);
  });
});

describe('展示边界与移动端样式契约', () => {
  it('不触碰存档、不读取结局推导解锁、不主动解锁音频', () => {
    const source = readFileSync(new URL('./achievementsPanel.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/saveStore|localStorage|loadMeta|saveMeta|unlockedEndings|unlockAudio|getAudioContext|\.resume\(/);
    expect(source).not.toMatch(/恭喜|失败|innerHTML/);
    expect(source).toContain("import './achievementsPanel.css'");
  });

  it('48px 安全区、44px 触点、横竖屏可滚动、减少动画与 3.2 秒时长', () => {
    const css = readFileSync(new URL('./achievementsPanel.css', import.meta.url), 'utf8');
    expect(css).toContain('calc(48px + env(safe-area-inset-bottom))');
    for (const edge of ['left', 'right', 'top']) expect(css).toContain(`safe-area-inset-${edge}`);
    expect(css).toContain('min-height: 44px');
    expect(css).toMatch(/\.achievements__list\s*\{[^}]*overflow: auto/s);
    expect(css).toMatch(/\.achievements__sheet\s*\{[^}]*max-height: 100%/s);
    expect(css).toContain('orientation: landscape');
    expect(css).toContain('orientation: portrait');
    expect(css).toContain('100dvh');
    expect(css).toContain(':focus-visible');
    expect(css).toMatch(/\.achievements\[hidden\]\s*\{\s*display: none/);
    expect(css).toContain('achievements-toast-slide 3.2s');
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation: none !important/);
  });
});
