import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhonePanel } from '../data/storySchema';
import { chapter1 } from '../data/story.ch1';
import { SceneMachine } from '../core/sceneMachine';
import { PhonePanelView } from './phonePanel';
import { PhoneVibrationView } from './phoneVibrate';
import { initMuteButton } from './muteButton';
import { isShortcutKey } from './uiDom';
import { EventBus } from '../core/eventBus';
import { createInitialStoryState } from '../core/state';
import { IntertitleView } from './intertitle';
import { initVignette, vignetteOpacity } from './vignette';
import { initGameUi } from './gameUi';

vi.mock('./assetImage', () => ({
  renderAssetImage: (_assetId: string, container: HTMLElement) => {
    const image = document.createElement('img');
    image.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
    container.append(image);
    return image;
  },
}));

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
  playPhoneChime: vi.fn(),
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
  readonly style: Record<string, string> = {};
  disabled = false;
  inert = false;
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
  get classList(): {
    contains: (name: string) => boolean;
    toggle: (name: string, force: boolean) => void;
    add: (...names: string[]) => void;
    remove: (...names: string[]) => void;
  } {
    return {
      add: (...names) => { for (const name of names) this.classList.toggle(name, true); },
      remove: (...names) => { for (const name of names) this.classList.toggle(name, false); },
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
  contains(node: FakeElement | null): boolean {
    return node === this || this.children.some((child) => child.contains(node));
  }
  click(): void { this.dispatchEvent(new FakeEvent('click')); }
  focus(): void { fakeDocument.activeElement = this; }
}

class FakeDocument extends FakeNode {
  readonly body = new FakeElement('body');
  activeElement: FakeElement | null = null;
  constructor() { super(); this.body.parentNode = this; }
  createElement(tag: string): FakeElement { return new FakeElement(tag); }
  querySelectorAll(selector: string): FakeElement[] { return this.body.querySelectorAll(selector); }
  querySelector(selector: string): FakeElement | null { return this.body.querySelector(selector); }
}

let fakeWindow: FakeEventTarget & {
  matchMedia: (query: string) => { matches: boolean };
  setTimeout: (callback: () => void, delay: number) => number;
  clearTimeout: (id: number) => void;
  setInterval: (callback: () => void, delay: number) => number;
  clearInterval: (id: number) => void;
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
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
  vi.clearAllMocks();
  audio.muted = false;
  coarse = false;
  cleanups = [];
  fakeDocument = new FakeDocument();
  fakeWindow = Object.assign(new FakeEventTarget(), {
    matchMedia: () => ({ matches: coarse }),
    setTimeout: (callback: () => void, delay: number) => globalThis.setTimeout(callback, delay) as unknown as number,
    clearTimeout: (id: number) => globalThis.clearTimeout(id),
    setInterval: (callback: () => void, delay: number) => globalThis.setInterval(callback, delay) as unknown as number,
    clearInterval: (id: number) => globalThis.clearInterval(id),
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

describe('Phase A 手机合照', () => {
  const photoPanel: PhonePanel = {
    id: 'photo-phone', closeActionId: 'photo-close',
    sections: [{
      kind: 'photo', id: 'group-photo', title: '开学第一天照片合集',
      assetId: 'cg_s6_gate_panorama',
      hotspot: { x: 60, y: 50, width: 10, height: 20 },
      likeActionId: 'like-photo', noticeActionId: 'notice-photo',
    }],
  };

  it('默认时钟为 8:40，小图展开、百分比热区静默记录且点赞幂等', () => {
    const { phone, onAction } = createPhone();
    phone.open(photoPanel);
    expect(query('.phone__clock').textContent).toBe('8:40');
    query('.phone__photo-thumbnail').click();
    expect(query('.phone__photo-modal').hidden).toBe(false);
    expect(query('.phone-frame').inert).toBe(true);
    const hotspot = query('.phone__photo-hotspot');
    expect(Number.parseFloat(hotspot.style.left)).toBeCloseTo(65);
    expect(hotspot.style.top).toBe('60%');
    expect(hotspot.style.width).toBe('10%');
    expect(hotspot.style.height).toBe('20%');
    hotspot.click();
    hotspot.click();
    expect(onAction).toHaveBeenCalledExactlyOnceWith('photo-phone', 'reply', 'notice-photo');
    expect(phone.isOpen()).toBe(true);
    expect(query('.phone__photo-modal').hidden).toBe(false);
    const likes = fakeDocument.body.querySelectorAll('.phone__photo-like');
    likes[1].click();
    likes[0].click();
    expect(onAction).toHaveBeenCalledTimes(2);
    expect(onAction).toHaveBeenLastCalledWith('photo-phone', 'reply', 'like-photo');
    expect(likes.every((button) => button.textContent === '已赞')).toBe(true);
    expect(likes.every((button) => button.getAttribute('aria-pressed') === 'true')).toBe(true);
    query('.phone__photo-back').click();
    query('.phone__photo-thumbnail').click();
    query('.phone__photo-hotspot').click();
    query('.phone__photo-like').click();
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it('真实 S9 合照通过 UI 回传独立观察和点赞，关闭后进入 S10', () => {
    const bus = new EventBus();
    const machine = new SceneMachine({ chapter: chapter1, bus });
    bus.on('ui:phoneAction', ({ phoneId, action, optionId }) => machine.onPhoneAction(phoneId, action, optionId));
    const ui = initGameUi({ bus, getControls: () => null });
    cleanups.push(() => ui.dispose());
    machine.startNew('S9', 'bystander');
    machine.onChooseOption('s9-choice', 's9-look');
    const logBefore = machine.getState().log.length;
    query('.phone__photo-thumbnail').click();
    const hotspot = query('.phone__photo-hotspot');
    expect(hotspot.style.left).toBe('37.75%');
    expect(hotspot.style.top).toBe('53.5%');
    hotspot.click();
    hotspot.click();
    expect(machine.getState().noticedPhoto).toBe(true);
    expect(machine.getState().likedPhoto).toBe(false);
    query('.phone__photo-like').click();
    query('.phone__photo-like').click();
    expect(machine.getState().likedPhoto).toBe(true);
    expect(machine.getState().log.slice(logBefore).map((entry) => entry.summary)).toEqual([
      '在群合照的台阶上找到了浅黄色的小背影。', '给迎新群的合照点了赞。',
    ]);
    query('.phone__photo-back').click();
    query('.phone__close').click();
    expect(machine.getSceneId()).toBe('S10');
    expect(query('.intertitle__line').textContent).toBe('入学第三天，你记住了室友的名字。');
  });

  it('关闭放大、Esc 与 E 都只返回图片，恢复焦点且不触发手机关闭', () => {
    const { phone, onAction } = createPhone();
    phone.open(photoPanel);
    const thumbnail = query('.phone__photo-thumbnail');
    for (const close of [() => query('.phone__photo-back').click(), () => press('Escape'), () => press('KeyE')]) {
      thumbnail.click();
      vi.advanceTimersByTime(180);
      close();
      expect(phone.isOpen()).toBe(true);
      expect(query('.phone__photo-modal').hidden).toBe(true);
      expect(query('.phone-frame').inert).toBe(false);
      expect(fakeDocument.activeElement).toBe(thumbnail);
      expect(onAction).not.toHaveBeenCalled();
    }
    query('.phone__close').click();
    expect(onAction).toHaveBeenCalledExactlyOnceWith('photo-phone', 'close');
  });

  it('hide/dispose 关闭图片且取消交互；新面板不会残留旧图片', () => {
    const { phone, onAction } = createPhone();
    phone.open(photoPanel);
    query('.phone__photo-thumbnail').click();
    const oldHotspot = query('.phone__photo-hotspot');
    phone.hide();
    expect(query('.phone__photo-modal').hidden).toBe(true);
    oldHotspot.click();
    phone.open(panelData);
    expect(query('.phone__photo-modal').hidden).toBe(true);
    expect(fakeDocument.body.querySelector('.phone__photo-hotspot')).toBeNull();
    oldHotspot.click();
    phone.dispose();
    expect(fakeWindow.listenerCount('keydown')).toBe(0);
    expect(onAction).not.toHaveBeenCalled();
  });
});

function createIntertitle(): { view: IntertitleView; onEnd: ReturnType<typeof vi.fn> } {
  const onEnd = vi.fn();
  const view = new IntertitleView(fakeDocument.body as unknown as HTMLElement, onEnd);
  cleanups.push(() => view.dispose());
  return { view, onEnd };
}

describe('Phase A 黑幕字幕', () => {
  it('七行按默认每行 2000ms 播放，结束仅回调一次', () => {
    const { view, onEnd } = createIntertitle();
    const lines = ['第一行', '第二行', '第三行', '第四行', '第五行', '第六行', '第七行'];
    view.show({ stepId: 's10', lines });
    for (const line of lines) {
      expect(query('.intertitle__line').textContent).toBe(line);
      expect(query('.intertitle__line').style.animationDuration).toBe('2000ms');
      vi.advanceTimersByTime(1999);
      expect(onEnd).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
    }
    expect(query('.intertitle').hidden).toBe(true);
    expect(onEnd).toHaveBeenCalledExactlyOnceWith('s10');
    query('.intertitle__skip').click();
    vi.runAllTimers();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('按钮和 Escape 跳过取消计时器，不可跳过时屏蔽继续键', () => {
    const { view, onEnd } = createIntertitle();
    view.show({ stepId: 'skip-button', lines: ['字幕'] });
    query('.intertitle__skip').click();
    expect(onEnd).toHaveBeenCalledExactlyOnceWith('skip-button');
    expect(vi.getTimerCount()).toBe(0);
    view.show({ stepId: 'skip-key', lines: ['字幕'] });
    expect(press('Escape').immediateStopped).toBe(true);
    expect(onEnd).toHaveBeenLastCalledWith('skip-key');
    view.show({ stepId: 'required', lines: ['字幕'], skippable: false, lineDurationMs: 300 });
    expect(query('.intertitle__skip').hidden).toBe(true);
    query('.intertitle__skip').click();
    for (const code of ['Escape', 'Space', 'Enter']) expect(press(code).defaultPrevented).toBe(true);
    expect(onEnd).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(300);
    expect(onEnd).toHaveBeenLastCalledWith('required');
  });

  it('重入、hide 和 dispose 取消旧 timer；空段同步完成', () => {
    const { view, onEnd } = createIntertitle();
    view.show({ stepId: 'old', lines: ['旧字幕'] });
    vi.advanceTimersByTime(1000);
    view.show({ stepId: 'replacement', lines: ['新字幕'], lineDurationMs: 500 });
    vi.advanceTimersByTime(500);
    expect(onEnd).toHaveBeenCalledExactlyOnceWith('replacement');
    view.show({ stepId: 'empty', lines: [] });
    expect(onEnd).toHaveBeenLastCalledWith('empty');
    view.show({ stepId: 'hidden', lines: ['字幕'] });
    view.hide();
    vi.runAllTimers();
    view.show({ stepId: 'disposed', lines: ['字幕'] });
    view.dispose();
    view.show({ stepId: 'after-dispose', lines: [] });
    expect(vi.getTimerCount()).toBe(0);
    expect(fakeWindow.listenerCount('keydown')).toBe(0);
    expect(fakeDocument.body.querySelector('.intertitle')).toBeNull();
    expect(onEnd).toHaveBeenCalledTimes(2);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('无效时长 %s 使用默认值', (lineDurationMs) => {
    const { view, onEnd } = createIntertitle();
    view.show({ stepId: 'duration', lines: ['字幕'], lineDurationMs });
    vi.advanceTimersByTime(1999);
    expect(onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onEnd).toHaveBeenCalledExactlyOnceWith('duration');
  });
});

describe('Phase A 暗角', () => {
  it.each([[0, 0], [20, 0], [29.99, 0], [30, 0.28], [49.99, 0.28], [50, 0.52], [69.99, 0.52], [70, 0.78], [100, 0.78]])('harm %s 映射到 %s', (harm, opacity) => {
    expect(vignetteOpacity(harm)).toBe(opacity);
  });

  it('复用同一层，状态下降可恢复，销毁取消订阅且没有数值 UI', () => {
    const bus = new EventBus();
    const dispose = initVignette(fakeDocument.body as unknown as HTMLElement, bus);
    cleanups.push(dispose);
    const layer = query('.vignette');
    const emitHarm = (harm: number): void => bus.emit('state:changed', {
      sceneId: 'S9', role: 'bystander', state: { ...createInitialStoryState(), harm }, changedKeys: ['harm'],
    });
    emitHarm(70);
    expect(layer.style.opacity).toBe('0.78');
    emitHarm(71);
    expect(query('.vignette')).toBe(layer);
    emitHarm(20);
    expect(layer.style.opacity).toBe('0');
    expect(layer.textContent).toBe('');
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    dispose();
    emitHarm(80);
    expect(layer.style.opacity).toBe('0');
    expect(fakeDocument.body.querySelector('.vignette')).toBeNull();
  });
});

describe('Phase A gameUi 接线', () => {
  it('字幕统一锁定、结束通知与下一段无闪动交接，dispose 取消计时器', async () => {
    const bus = new EventBus();
    const port = { lockControls: vi.fn(), unlockControls: vi.fn() };
    const ui = initGameUi({ bus, getControls: () => port });
    cleanups.push(() => ui.dispose());
    const ended = vi.fn();
    bus.on('ui:dialogueEnd', ended);
    bus.on('ui:dialogueEnd', ({ stepId }) => {
      if (stepId === 'first') bus.emit('ui:showIntertitle', { lineDurationMs: 2000, skippable: true, stepId: 'second', lines: ['下一段'] });
    });
    bus.emit('ui:showIntertitle', { lineDurationMs: 100, skippable: true, stepId: 'first', lines: ['第一段'] });
    await Promise.resolve();
    expect(port.lockControls).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    expect(ended).toHaveBeenCalledExactlyOnceWith({ stepId: 'first' });
    expect(query('.intertitle__line').textContent).toBe('下一段');
    expect(port.unlockControls).not.toHaveBeenCalled();
    press('Escape');
    await Promise.resolve();
    expect(ended).toHaveBeenLastCalledWith({ stepId: 'second' });
    expect(port.unlockControls).toHaveBeenCalledTimes(1);
    bus.emit('ui:showIntertitle', { lineDurationMs: 2000, skippable: true, stepId: 'empty', lines: [] });
    await Promise.resolve();
    expect(port.lockControls).toHaveBeenCalledTimes(1);
    bus.emit('ui:showIntertitle', { lineDurationMs: 2000, skippable: true, stepId: 'disposed', lines: ['不能再完成'] });
    await Promise.resolve();
    ui.dispose();
    vi.runAllTimers();
    expect(ended).toHaveBeenCalledTimes(3);
    expect(port.unlockControls).toHaveBeenCalledTimes(2);
    expect(fakeWindow.listenerCount('keydown')).toBe(0);
    expect(fakeDocument.body.querySelector('.vignette')).toBeNull();
  });

  it('手机替换及场景切换会取消字幕，不发出失效步骤结束', async () => {
    const bus = new EventBus();
    const port = { lockControls: vi.fn(), unlockControls: vi.fn() };
    const ui = initGameUi({ bus, getControls: () => port });
    cleanups.push(() => ui.dispose());
    const ended = vi.fn();
    bus.on('ui:dialogueEnd', ended);
    bus.emit('ui:showIntertitle', { lineDurationMs: 2000, skippable: true, stepId: 'old', lines: ['旧字幕'] });
    await Promise.resolve();
    bus.emit('ui:showPhone', { stepId: 'phone', panel: panelData });
    await Promise.resolve();
    expect(query('.intertitle').hidden).toBe(true);
    expect(port.unlockControls).not.toHaveBeenCalled();
    bus.emit('ui:showIntertitle', { lineDurationMs: 2000, skippable: true, stepId: 'next', lines: ['新字幕'] });
    bus.emit('scene:transition', { fromSceneId: 'S9', toSceneId: 'S10', sceneKey: 'building', role: 'bystander', title: '' });
    await Promise.resolve();
    vi.runAllTimers();
    expect(ended).not.toHaveBeenCalled();
    expect(port.unlockControls).toHaveBeenCalledTimes(1);
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
