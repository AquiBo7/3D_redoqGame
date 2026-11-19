import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhonePanel } from '../data/storySchema';
import { PhonePanelView } from './phonePanel';
import { PhoneVibrationView } from './phoneVibrate';
import { initMuteButton } from './muteButton';
import { isShortcutKey } from './uiDom';

const audio = vi.hoisted(() => ({
  muted: false,
  setMuted: vi.fn(),
  unlockAudio: vi.fn(),
  playUiClick: vi.fn(),
}));
vi.mock('../audio/audioManager', () => ({
  isMuted: () => audio.muted,
  setMuted: (muted: boolean) => { audio.muted = muted; audio.setMuted(muted); },
  unlockAudio: audio.unlockAudio,
  playUiClick: audio.playUiClick,
}));

// 无 DOM 依赖的轻量替身：保留节点树、查询、hidden 与捕获/冒泡调度，不调用私有方法。
class FakeEvent {
  readonly code: string;
  readonly repeat: boolean;
  target: FakeEventTarget | null = null;
  defaultPrevented = false;
  propagationStopped = false;
  immediateStopped = false;

  constructor(readonly type: string, options: { code?: string; repeat?: boolean } = {}) {
    this.code = options.code ?? '';
    this.repeat = options.repeat ?? false;
  }

  preventDefault(): void { this.defaultPrevented = true; }
  stopPropagation(): void { this.propagationStopped = true; }
  stopImmediatePropagation(): void {
    this.immediateStopped = true;
    this.stopPropagation();
  }
}

type Listener = (event: FakeEvent) => void;
class FakeEventTarget {
  private readonly listeners = new Map<string, { listener: Listener; capture: boolean }[]>();

  addEventListener(type: string, listener: Listener, capture = false): void {
    const list = this.listeners.get(type) ?? [];
    list.push({ listener, capture });
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: Listener, capture = false): void {
    this.listeners.set(type, (this.listeners.get(type) ?? [])
      .filter((item) => item.listener !== listener || item.capture !== capture));
  }

  listenerCount(type: string): number { return this.listeners.get(type)?.length ?? 0; }

  dispatchEvent(event: FakeEvent): boolean {
    event.target = this;
    const path: FakeEventTarget[] = [this];
    if (this instanceof FakeNode) {
      let parent = this.parentNode;
      while (parent) { path.push(parent); parent = parent.parentNode; }
      if (path[path.length - 1] === fakeDocument) path.push(fakeWindow);
    }
    const invoke = (target: FakeEventTarget, capture: boolean): void => {
      for (const item of [...(target.listeners.get(event.type) ?? [])]) {
        if (item.capture === capture) item.listener(event);
        if (event.immediateStopped) break;
      }
    };
    for (let i = path.length - 1; i >= 0; i -= 1) {
      invoke(path[i], true);
      if (event.propagationStopped) return !event.defaultPrevented;
    }
    for (const target of path) {
      invoke(target, false);
      if (event.propagationStopped) break;
    }
    return !event.defaultPrevented;
  }
}

class FakeNode extends FakeEventTarget {
  parentNode: FakeNode | null = null;
  get parentElement(): FakeElement | null {
    return this.parentNode instanceof FakeElement ? this.parentNode : null;
  }
}

class FakeElement extends FakeNode {
  className = '';
  type = '';
  title = '';
  innerHTML = '';
  scrollTop = 0;
  scrollHeight = 0;
  readonly children: FakeElement[] = [];
  private text = '';
  private readonly attributes = new Map<string, string>();

  constructor(readonly tagName: string) { super(); }
  get hidden(): boolean { return this.attributes.has('hidden'); }
  set hidden(value: boolean) {
    if (value) this.attributes.set('hidden', '');
    else this.attributes.delete('hidden');
  }
  get textContent(): string { return this.text + this.children.map((child) => child.textContent).join(''); }
  set textContent(value: string) { this.replaceChildren(); this.text = value; }
  get classList(): { contains: (name: string) => boolean; toggle: (name: string, force: boolean) => void } {
    return {
      contains: (name) => this.className.split(/\s+/).includes(name),
      toggle: (name, force) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        if (force) classes.add(name); else classes.delete(name);
        this.className = Array.from(classes).join(' ');
      },
    };
  }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  append(...nodes: FakeElement[]): void {
    for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); }
  }
  appendChild(node: FakeElement): FakeElement { this.append(node); return node; }
  replaceChildren(...nodes: FakeElement[]): void {
    for (const child of this.children) child.parentNode = null;
    this.children.length = 0;
    this.text = '';
    this.append(...nodes);
  }
  remove(): void {
    const siblings = this.parentElement?.children;
    if (siblings) {
      const index = siblings.indexOf(this);
      if (index >= 0) siblings.splice(index, 1);
    }
    this.parentNode = null;
  }
  matches(selector: string): boolean {
    return selector.split(',').some((part) => {
      const value = part.trim();
      if (value.startsWith('.')) return this.classList.contains(value.slice(1));
      if (value === '[contenteditable]:not([contenteditable="false"])') {
        return this.attributes.has('contenteditable') && this.getAttribute('contenteditable') !== 'false';
      }
      const attribute = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(value);
      if (attribute) return this.attributes.has(attribute[1])
        && (attribute[2] === undefined || this.getAttribute(attribute[1]) === attribute[2]);
      return this.tagName.toLowerCase() === value;
    });
  }
  closest(selector: string): FakeElement | null {
    if (this.matches(selector)) return this;
    return this.parentElement?.closest(selector) ?? null;
  }
  querySelectorAll(selector: string): FakeElement[] {
    const found: FakeElement[] = [];
    for (const child of this.children) {
      if (child.matches(selector)) found.push(child);
      found.push(...child.querySelectorAll(selector));
    }
    return found;
  }
  querySelector(selector: string): FakeElement | null { return this.querySelectorAll(selector)[0] ?? null; }
  click(): void { this.dispatchEvent(new FakeEvent('click')); }
  focus(): void { fakeDocument.activeElement = this; }
}

class FakeDocument extends FakeNode {
  readonly body = new FakeElement('body');
  activeElement: FakeElement | null = null;
  constructor() { super(); this.body.parentNode = this; }
  createElement(tag: string): FakeElement { return new FakeElement(tag); }
  querySelectorAll(selector: string): FakeElement[] { return this.body.querySelectorAll(selector); }
}

let fakeWindow: FakeEventTarget & {
  matchMedia: (query: string) => { matches: boolean };
  setTimeout: (callback: () => void, delay: number) => number;
  clearTimeout: (id: number) => void;
};
let fakeDocument: FakeDocument;
let coarse = false;
let cleanups: (() => void)[];
const panelData: PhonePanel = {
  id: 'test-phone', closeActionId: 'test-close',
  sections: [{ kind: 'memo', id: 'test-memo', title: '备忘录', updatedAt: '今天', items: ['带上证件'] }],
};
const vibrationData = { vibrationId: 'test-vibration', preview: '迎新群有新消息' };

function query(selector: string): FakeElement {
  const element = fakeDocument.body.querySelector(selector);
  if (!element) throw new Error(`找不到 DOM 节点：${selector}`);
  return element;
}
function press(code = 'KeyE', options: { repeat?: boolean; prevented?: boolean; target?: FakeEventTarget } = {}): FakeEvent {
  const event = new FakeEvent('keydown', { code, repeat: options.repeat });
  if (options.prevented) event.preventDefault();
  (options.target ?? fakeWindow).dispatchEvent(event);
  return event;
}
function createPhone(): { phone: PhonePanelView; onAction: ReturnType<typeof vi.fn> } {
  const onAction = vi.fn();
  const phone = new PhonePanelView(fakeDocument.body as unknown as HTMLElement, { onAction });
  cleanups.push(() => phone.dispose());
  return { phone, onAction };
}
function createVibration(): { view: PhoneVibrationView; onView: ReturnType<typeof vi.fn>; onIgnore: ReturnType<typeof vi.fn>; onMessageClose: ReturnType<typeof vi.fn> } {
  const callbacks = { onView: vi.fn(), onIgnore: vi.fn(), onMessageClose: vi.fn() };
  const view = new PhoneVibrationView(fakeDocument.body as unknown as HTMLElement, callbacks);
  cleanups.push(() => view.dispose());
  return { view, ...callbacks };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.clearAllMocks();
  audio.muted = false;
  coarse = false;
  cleanups = [];
  fakeDocument = new FakeDocument();
  fakeWindow = Object.assign(new FakeEventTarget(), {
    matchMedia: () => ({ matches: coarse }),
    setTimeout: (callback: () => void, delay: number) => globalThis.setTimeout(callback, delay) as unknown as number,
    clearTimeout: (id: number) => globalThis.clearTimeout(id),
  });
  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('Node', FakeNode);
  vi.stubGlobal('Element', FakeElement);
  vi.stubGlobal('HTMLElement', FakeElement);
});
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('isShortcutKey 输入保护', () => {
  it('只接受指定 code，过滤 repeat 和 defaultPrevented', () => {
    expect(isShortcutKey(press() as unknown as KeyboardEvent, 'KeyE')).toBe(true);
    expect(isShortcutKey(press('KeyO') as unknown as KeyboardEvent, 'KeyE')).toBe(false);
    expect(isShortcutKey(press('KeyE', { repeat: true }) as unknown as KeyboardEvent, 'KeyE')).toBe(false);
    expect(isShortcutKey(press('KeyE', { prevented: true }) as unknown as KeyboardEvent, 'KeyE')).toBe(false);
  });

  it.each(['input', 'textarea', 'select'])('不打断 %s 输入，也识别其子节点与实际焦点', (tag) => {
    const input = fakeDocument.createElement(tag);
    const child = fakeDocument.createElement('span');
    input.append(child);
    fakeDocument.body.append(input);
    expect(isShortcutKey(press('KeyE', { target: child }) as unknown as KeyboardEvent, 'KeyE')).toBe(false);
    input.focus();
    expect(isShortcutKey(press() as unknown as KeyboardEvent, 'KeyE')).toBe(false);
  });

  it.each(['', 'true', 'plaintext-only'])('过滤 contenteditable=%s 的元素、子元素与文本节点', (value) => {
    const editable = fakeDocument.createElement('div');
    editable.setAttribute('contenteditable', value);
    const child = fakeDocument.createElement('span');
    editable.append(child);
    fakeDocument.body.append(editable);
    const textNode = new FakeNode();
    textNode.parentNode = child;
    for (const target of [editable, child, textNode]) {
      expect(isShortcutKey(press('KeyE', { target }) as unknown as KeyboardEvent, 'KeyE')).toBe(false);
    }
  });

  it('普通按钮与 contenteditable=false 不阻止快捷键', () => {
    const button = fakeDocument.createElement('button');
    button.setAttribute('contenteditable', 'false');
    fakeDocument.body.append(button);
    button.focus();
    expect(isShortcutKey(press('KeyE', { target: button }) as unknown as KeyboardEvent, 'KeyE')).toBe(true);
  });
});

describe('PhonePanelView E', () => {
  it('World 先注册时仍在捕获阶段保护同次打开，并在 180ms 后收起', () => {
    const world = vi.fn(() => phone.open(panelData));
    fakeWindow.addEventListener('keydown', world);
    const { phone, onAction } = createPhone();
    press();
    expect(world).toHaveBeenCalledTimes(1);
    expect(phone.isOpen()).toBe(true);
    const protectedEvent = press();
    expect(protectedEvent.defaultPrevented).toBe(true);
    expect(protectedEvent.immediateStopped).toBe(true);
    expect(world).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();
    vi.advanceTimersByTime(180);
    press();
    expect(phone.isOpen()).toBe(false);
    expect(onAction).toHaveBeenCalledExactlyOnceWith('test-phone', 'close');
    expect(world).toHaveBeenCalledTimes(1);
  });

  it('打开回调在更早捕获监听中触发时，同一事件也不会解锁/收起', () => {
    fakeWindow.addEventListener('keydown', () => phone.open({ ...panelData, lockTime: '8:47' }), true);
    const { phone, onAction } = createPhone();
    const event = press();
    expect(event.immediateStopped).toBe(true);
    expect(query('.phone__lockscreen')).toBeDefined();
    expect(phone.isOpen()).toBe(true);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('锁屏 E 只解锁，冷却内继续消费 E，等待完整 180ms 才收起', () => {
    const { phone, onAction } = createPhone();
    phone.open({ ...panelData, lockTime: '8:47' });
    vi.advanceTimersByTime(180);
    press();
    expect(fakeDocument.body.querySelector('.phone__lockscreen')).toBeNull();
    expect(query('.phone__home-title').textContent).toBe('今天');
    vi.advanceTimersByTime(179);
    expect(press().defaultPrevented).toBe(true);
    vi.advanceTimersByTime(179);
    press();
    expect(phone.isOpen()).toBe(true);
    expect(onAction).not.toHaveBeenCalled();
    vi.advanceTimersByTime(180);
    press();
    expect(phone.isOpen()).toBe(false);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('按钮解锁与进入子页都会更新冷却，子页 E 直接收起而非返回', () => {
    const { phone, onAction } = createPhone();
    phone.open({ ...panelData, lockTime: '8:47' });
    vi.advanceTimersByTime(180);
    query('.phone__lockscreen').click();
    press();
    expect(phone.isOpen()).toBe(true);
    vi.advanceTimersByTime(180);
    query('.phone__row').click();
    expect(query('.phone__section-title').textContent).toBe('备忘录');
    press();
    expect(phone.isOpen()).toBe(true);
    vi.advanceTimersByTime(180);
    press();
    expect(phone.isOpen()).toBe(false);
    expect(onAction).toHaveBeenCalledExactlyOnceWith('test-phone', 'close');
  });

  it('repeat、输入焦点与已处理事件不收起，也不延长冷却', () => {
    const { phone, onAction } = createPhone();
    phone.open(panelData);
    vi.advanceTimersByTime(179);
    const input = fakeDocument.createElement('input');
    fakeDocument.body.append(input);
    for (const options of [{ repeat: true }, { prevented: true }, { target: input }]) press('KeyE', options);
    input.focus();
    press();
    fakeDocument.activeElement = null;
    vi.advanceTimersByTime(1);
    press();
    expect(phone.isOpen()).toBe(false);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('保留收起按钮，hide 不触发剧情回调，dispose 移除节点和监听', () => {
    const { phone, onAction } = createPhone();
    phone.open(panelData);
    query('.phone__close').click();
    expect(phone.isOpen()).toBe(false);
    expect(onAction).toHaveBeenCalledTimes(1);
    phone.open(panelData);
    phone.hide();
    expect(onAction).toHaveBeenCalledTimes(1);
    phone.open(panelData);
    phone.dispose();
    expect(fakeWindow.listenerCount('keydown')).toBe(0);
    expect(fakeDocument.body.querySelector('.phone-overlay')).toBeNull();
    expect(phone.isOpen()).toBe(false);
    vi.advanceTimersByTime(180);
    expect(press().defaultPrevented).toBe(false);
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});

describe('PhoneVibrationView E', () => {
  it('提示条与消息卡双向切换，show/每次 E 均有 180ms 冷却并阻止 World', () => {
    const world = vi.fn();
    fakeWindow.addEventListener('keydown', world);
    const { view, onView, onMessageClose } = createVibration();
    view.show(vibrationData);
    expect(press().immediateStopped).toBe(true);
    expect(onView).not.toHaveBeenCalled();
    vi.advanceTimersByTime(180);
    press();
    expect(query('.phone-vibrate').hidden).toBe(true);
    expect(query('.vibration-message').hidden).toBe(false);
    expect(query('.vibration-message__text').textContent).toBe(vibrationData.preview);
    expect(onView).toHaveBeenCalledExactlyOnceWith('test-vibration');
    vi.advanceTimersByTime(179);
    press();
    expect(onMessageClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(180);
    press();
    expect(query('.vibration-message').hidden).toBe(true);
    expect(onMessageClose).toHaveBeenCalledExactlyOnceWith('test-vibration');
    expect(world).not.toHaveBeenCalled();
    expect(press().defaultPrevented).toBe(false);
    expect(world).toHaveBeenCalledTimes(1);
  });

  it.each(['phone-overlay', 'dialogue', 'choices', 'controls-guide'])('提示条让位于可见 %s 模态，隐藏后可查看', (className) => {
    const { view, onView } = createVibration();
    const modal = fakeDocument.createElement('div');
    modal.className = className;
    modal.setAttribute('role', 'dialog');
    fakeDocument.body.append(modal);
    view.show(vibrationData);
    vi.advanceTimersByTime(180);
    const otherShortcut = vi.fn();
    fakeWindow.addEventListener('keydown', otherShortcut);
    expect(press().defaultPrevented).toBe(false);
    expect(otherShortcut).toHaveBeenCalledTimes(1);
    expect(onView).not.toHaveBeenCalled();
    modal.hidden = true;
    press();
    expect(onView).toHaveBeenCalledTimes(1);
  });

  it('祖先 hidden 的模态不拦截；消息已开时，即使其他模态可见也正常收起', () => {
    const { view, onMessageClose } = createVibration();
    const wrapper = fakeDocument.createElement('div');
    wrapper.hidden = true;
    const modal = fakeDocument.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    wrapper.append(modal);
    fakeDocument.body.append(wrapper);
    view.show(vibrationData);
    vi.advanceTimersByTime(180);
    press();
    expect(query('.vibration-message').hidden).toBe(false);
    wrapper.hidden = false;
    vi.advanceTimersByTime(180);
    press();
    expect(onMessageClose).toHaveBeenCalledTimes(1);
  });

  it('repeat、已消费事件及 editable 子节点不打开或关闭消息', () => {
    const { view, onView, onMessageClose } = createVibration();
    const editable = fakeDocument.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const child = fakeDocument.createElement('span');
    editable.append(child);
    fakeDocument.body.append(editable);
    view.show(vibrationData);
    vi.advanceTimersByTime(180);
    for (const options of [{ repeat: true }, { prevented: true }, { target: child }]) press('KeyE', options);
    expect(onView).not.toHaveBeenCalled();
    press();
    vi.advanceTimersByTime(180);
    for (const options of [{ repeat: true }, { prevented: true }, { target: child }]) press('KeyE', options);
    expect(onMessageClose).not.toHaveBeenCalled();
    press();
    expect(onMessageClose).toHaveBeenCalledTimes(1);
  });

  it('查看/收起/忽略按钮保留，按钮查看后同次 E 不收起，自动忽略仍有效', () => {
    const { view, onView, onIgnore, onMessageClose } = createVibration();
    view.show(vibrationData);
    query('.phone-vibrate__button--primary').click();
    expect(onView).toHaveBeenCalledTimes(1);
    press();
    expect(onMessageClose).not.toHaveBeenCalled();
    query('.vibration-message__close').click();
    expect(onMessageClose).toHaveBeenCalledTimes(1);
    view.show(vibrationData);
    const ignore = query('.phone-vibrate__actions').children[1];
    expect(ignore.textContent).toBe('忽略');
    ignore.click();
    expect(onIgnore).toHaveBeenCalledTimes(1);
    view.show(vibrationData);
    vi.advanceTimersByTime(8000);
    expect(onIgnore).toHaveBeenCalledTimes(2);
    expect(query('.phone-vibrate').hidden).toBe(true);
  });

  it('dispose 清除捕获监听、节点与自动隐藏计时器', () => {
    const { view, onView, onIgnore } = createVibration();
    view.show(vibrationData);
    view.dispose();
    expect(fakeWindow.listenerCount('keydown')).toBe(0);
    expect(fakeDocument.body.querySelector('.phone-vibrate')).toBeNull();
    expect(fakeDocument.body.querySelector('.vibration-message')).toBeNull();
    expect(press().defaultPrevented).toBe(false);
    vi.advanceTimersByTime(8000);
    expect(onView).not.toHaveBeenCalled();
    expect(onIgnore).not.toHaveBeenCalled();
  });
});

describe('静音 O', () => {
  it('O 与点击复用切换，更新视觉/title/ARIA，取消静音才解锁并播放反馈', () => {
    cleanups.push(initMuteButton());
    const button = query('.mute-toggle');
    expect(button.title).toBe('静音 (O)');
    const event = press('KeyO');
    expect(event.defaultPrevented).toBe(true);
    expect(event.immediateStopped).toBe(true);
    expect(audio.setMuted).toHaveBeenLastCalledWith(true);
    expect(button.classList.contains('is-muted')).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('取消静音');
    expect(button.title).toBe('取消静音 (O)');
    expect(audio.unlockAudio).not.toHaveBeenCalled();
    press('KeyO');
    expect(audio.setMuted).toHaveBeenLastCalledWith(false);
    expect(audio.unlockAudio).toHaveBeenCalledTimes(1);
    expect(audio.playUiClick).toHaveBeenCalledTimes(1);
    expect(button.classList.contains('is-muted')).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    button.click();
    button.click();
    expect(audio.setMuted).toHaveBeenCalledTimes(4);
    expect(audio.unlockAudio).toHaveBeenCalledTimes(2);
    expect(audio.playUiClick).toHaveBeenCalledTimes(2);
  });

  it('触屏 title 无角标且保留按钮；已存静音状态初始化正确', () => {
    coarse = true;
    audio.muted = true;
    cleanups.push(initMuteButton());
    const button = query('.mute-toggle');
    expect(button.title).toBe('取消静音');
    expect(button.classList.contains('is-muted')).toBe(true);
    button.click();
    expect(button.title).toBe('静音');
    expect(audio.setMuted).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('忽略 repeat、输入/可编辑子节点、defaultPrevented 与其他键', () => {
    cleanups.push(initMuteButton());
    const editable = fakeDocument.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const child = fakeDocument.createElement('span');
    editable.append(child);
    const input = fakeDocument.createElement('input');
    fakeDocument.body.append(editable, input);
    for (const options of [{ repeat: true }, { prevented: true }, { target: input }, { target: child }]) press('KeyO', options);
    input.focus();
    press('KeyO');
    press('KeyE');
    expect(audio.setMuted).not.toHaveBeenCalled();
  });

  it('清理同时移除键盘和按钮 click 监听', () => {
    const dispose = initMuteButton();
    cleanups.push(dispose);
    const button = query('.mute-toggle');
    dispose();
    expect(fakeWindow.listenerCount('keydown')).toBe(0);
    expect(fakeDocument.body.querySelector('.mute-toggle')).toBeNull();
    press('KeyO');
    button.click();
    expect(audio.setMuted).not.toHaveBeenCalled();
  });
});
