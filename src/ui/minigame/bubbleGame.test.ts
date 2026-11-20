import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { advanceBubbleModel, attackBubble, bubblePhase, BubbleGame, createBubbleModel } from './bubbleGame';
import type { Mock } from 'vitest';
import type { BubbleGameResult, BubbleModel } from './bubbleGame';

function advanceToEnd(model: BubbleModel): void { advanceBubbleModel(model, 25); }

describe('清气泡确定性模拟', () => {
  it('精确覆盖前十五秒、后十秒，结束后不再推进', () => {
    const model = createBubbleModel();
    advanceBubbleModel(model, 14.99);
    expect(bubblePhase(model)).toBe('quiet');
    advanceBubbleModel(model, 0.01);
    expect(model.ticks).toBe(900);
    expect(bubblePhase(model)).toBe('surge');
    advanceBubbleModel(model, 9.99);
    expect(bubblePhase(model)).toBe('surge');
    advanceBubbleModel(model, 0.01);
    expect(model.ticks).toBe(1500);
    expect(bubblePhase(model)).toBe('ended');
    const snapshot = JSON.stringify(model);
    advanceBubbleModel(model, 1000);
    expect(attackBubble(model)).toBeNull();
    expect(JSON.stringify(model)).toBe(snapshot);
  });

  it('同种子与不同分帧产生相同结果，拒绝无效时间', () => {
    const one = createBubbleModel(123);
    const many = createBubbleModel(123);
    advanceToEnd(one);
    for (let i = 0; i < 2500; i += 1) advanceBubbleModel(many, 0.01);
    expect(many).toEqual(one);
    const empty = createBubbleModel();
    for (const invalid of [-1, NaN, Infinity, 0]) advanceBubbleModel(empty, invalid);
    expect(empty).toEqual(createBubbleModel());
  });

  it('碰到中央只计一次 hits；有效攻击只计 kills，空击不计数', () => {
    const model = createBubbleModel();
    model.nextSpawn = Infinity;
    model.bubbles = [{ id: 1, angle: 0, distance: 0.121, size: 1 },
      { id: 2, angle: 1, distance: 0.6, size: 1 }, { id: 3, angle: 2, distance: 0.7, size: 1 }];
    expect(attackBubble(model, 999)).toBeNull();
    expect(attackBubble(model, 2)?.id).toBe(2);
    expect(attackBubble(model, 3)).toBeNull();
    advanceBubbleModel(model, 1 / 60);
    expect(model.hits).toBe(1);
    expect(model.kills).toBe(1);
    advanceBubbleModel(model, 8 / 60);
    expect(attackBubble(model)?.id).toBe(3);
    advanceBubbleModel(model, 1);
    expect(model.hits).toBe(1);
    expect(model.kills).toBe(2);
  });

  it('空格路径选最近气泡，拦截真实改变统计但无法挡完末段涌入', () => {
    const active = createBubbleModel(42);
    const idle = createBubbleModel(42);
    const nearest = createBubbleModel();
    nearest.bubbles = [{ id: 1, angle: 0, distance: 0.9, size: 1 },
      { id: 2, angle: 1, distance: 0.2, size: 1 }];
    expect(attackBubble(nearest)?.id).toBe(2);
    let beforeSurgeHits = 0;
    for (let i = 0; i < 1500; i += 1) {
      advanceBubbleModel(active, 1 / 60);
      attackBubble(active);
      if (i === 899) beforeSurgeHits = active.hits;
    }
    advanceToEnd(idle);
    expect(beforeSurgeHits).toBe(0);
    expect(active.kills).toBeGreaterThan(0);
    expect(active.hits).toBeGreaterThan(0);
    expect(active.hits).toBeLessThan(idle.hits);
    expect(idle.kills).toBe(0);
  });
});

// 不引入 DOM 依赖：事件/焦点/RAF/观察器桩覆盖视图真正的生命周期。
class TargetStub extends EventTarget {
  listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener) return;
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
    super.addEventListener(type, listener);
  }
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (listener) this.listeners.get(type)?.delete(listener);
    super.removeEventListener(type, listener);
  }
  get listenerCount(): number {
    return Array.from(this.listeners.values()).reduce((total, set) => total + set.size, 0);
  }
}
let doc: DocumentStub;
const context = new Proxy<Record<string, unknown>>({}, {
  get: (_target, key) => key === 'createRadialGradient' ? () => ({ addColorStop: vi.fn() }) : vi.fn(),
});
class ElementStub extends TargetStub {
  className = '';
  textContent = '';
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  children: ElementStub[] = [];
  parent: ElementStub | null = null;
  hidden = false;
  disabled = false;
  tabIndex = -1;
  type = '';
  width = 0;
  height = 0;
  rect = { left: 0, top: 0, width: 600, height: 400 };
  constructor(readonly tag: string) { super(); }
  get isConnected(): boolean { return this.tag === 'host' || this.parent?.isConnected === true; }
  append(...children: ElementStub[]): void {
    for (const child of children) { child.parent = this; this.children.push(child); }
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  contains(node: ElementStub | null): boolean {
    return node === this || this.children.some((child) => child.contains(node));
  }
  setAttribute(key: string, value: string): void { this.attributes.set(key, value); }
  focus(): void { doc.activeElement = this; }
  getBoundingClientRect(): typeof this.rect { return this.rect; }
  getContext(): unknown { return context; }
}
class DocumentStub extends TargetStub {
  hidden = false;
  activeElement: ElementStub | null = null;
  elements: ElementStub[] = [];
  createElement(tag: string): ElementStub {
    const node = new ElementStub(tag);
    this.elements.push(node);
    return node;
  }
}
class ObserverStub {
  static instances: ObserverStub[] = [];
  disconnected = false;
  constructor(readonly callback: () => void) { ObserverStub.instances.push(this); }
  observe(): void {}
  disconnect(): void { this.disconnected = true; }
}
function fire(target: EventTarget, type: string, props: Record<string, unknown> = {}): Event {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, props);
  target.dispatchEvent(event);
  return event;
}
function find(root: ElementStub, className: string): ElementStub {
  if (root.className === className) return root;
  for (const child of root.children) {
    const result = findOrNull(child, className);
    if (result) return result;
  }
  throw new Error(`缺少元素 ${className}`);
}
function findOrNull(root: ElementStub, className: string): ElementStub | null {
  if (root.className === className) return root;
  for (const child of root.children) {
    const result = findOrNull(child, className);
    if (result) return result;
  }
  return null;
}

describe('BubbleGame 生命周期与交互', () => {
  let host: ElementStub;
  let win: TargetStub;
  let game: BubbleGame;
  let onEnd: Mock<(result: BubbleGameResult) => void>;
  let frames: Map<number, FrameRequestCallback>;
  let now: number;
  let frameId: number;
  const tick = (milliseconds: number): void => {
    now += milliseconds;
    const pending = [...frames.values()];
    frames.clear();
    for (const frame of pending) frame(now);
  };
  const ui = (): { root: ElementStub; button: ElementStub; canvas: ElementStub } => {
    const root = find(host, 'bubble-game');
    return { root, button: find(root, 'bubble-game__button'), canvas: find(root, 'bubble-game__canvas') };
  };
  const finish = (): void => {
    fire(ui().button, 'click');
    tick(25000);
    expect(ui().root.dataset.mode).toBe('ending');
    tick(1400);
    expect(ui().root.dataset.mode).toBe('finished');
  };

  beforeEach(() => {
    now = 0;
    frameId = 0;
    frames = new Map();
    doc = new DocumentStub();
    win = new TargetStub();
    Object.assign(win, { devicePixelRatio: 3, matchMedia: () => ({ matches: false }) });
    host = new ElementStub('host');
    ObserverStub.instances = [];
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', win);
    vi.stubGlobal('HTMLElement', ElementStub);
    vi.stubGlobal('ResizeObserver', ObserverStub);
    vi.stubGlobal('performance', { now: () => now });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    onEnd = vi.fn();
    game = new BubbleGame(host as unknown as HTMLElement, onEnd);
  });
  afterEach(() => { game.dispose(); vi.unstubAllGlobals(); });

  it('show 等待开始；字幕后继续才回调，不输出数值统计', () => {
    game.show();
    expect(ui().canvas.width).toBe(900);
    expect(ui().canvas.height).toBe(600);
    tick(30000);
    expect(ui().root.dataset.mode).toBe('ready');
    expect(ui().button.textContent).toContain('开始');
    fire(ui().button, 'click');
    tick(14999);
    expect(ui().root.dataset.phase).not.toBe('surge');
    tick(1);
    expect(ui().root.dataset.phase).toBe('surge');
    tick(10000);
    expect(ui().button.disabled).toBe(true);
    fire(ui().button, 'click');
    expect(onEnd).not.toHaveBeenCalled();
    tick(1399);
    expect(ui().button.disabled).toBe(true);
    tick(1);
    expect(frames.size).toBe(0);
    const visibleText = doc.elements.map((node) => node.textContent).join('');
    expect(visibleText).not.toMatch(/\d|hits|kills|harm|血条|评分/);
    fire(ui().button, 'click');
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd.mock.calls[0][0]).toEqual({ hits: expect.any(Number), kills: 0 });
    expect(host.children).toHaveLength(0);
    expect(win.listenerCount + doc.listenerCount).toBe(0);
  });

  it('空格可按住拦截，指针可命中或落空且右键不攻击', () => {
    game.show();
    const { root, canvas, button } = ui();
    fire(button, 'click');
    tick(17);
    const first = createBubbleModel();
    advanceBubbleModel(first, 0.017);
    const bubble = first.bubbles[0];
    const clientX = 300 + Math.cos(bubble.angle) * bubble.distance * 170;
    const clientY = 200 + Math.sin(bubble.angle) * bubble.distance * 170;
    fire(canvas, 'pointerdown', { clientX: 0, clientY: 0, button: 0 });
    fire(canvas, 'pointerdown', { clientX, clientY, button: 2 });
    fire(canvas, 'pointerdown', { clientX, clientY, button: 0 });
    tick(25000);
    tick(1400);
    fire(button, 'click');
    expect(onEnd.mock.calls[0][0].kills).toBe(1);
    game.show();
    fire(ui().button, 'click');
    expect(fire(ui().root, 'keydown', { code: 'Space' }).defaultPrevented).toBe(true);
    tick(25000);
    tick(1400);
    fire(ui().button, 'click');
    expect(onEnd.mock.calls[1][0].kills).toBeGreaterThan(1);
    expect(root.listenerCount).toBe(0);
  });

  it('重复 show 重置、hide 取消所有资源；过期 RAF 和点击不能复活旧局', () => {
    const sibling = new ElementStub('aside');
    host.append(sibling);
    game.show();
    const old = ui();
    fire(old.button, 'click');
    tick(5000);
    const oldFrame = [...frames.values()][0];
    const oldObserver = ObserverStub.instances[0];
    game.show();
    expect(frames.size).toBe(1);
    expect(old.root.parent).toBeNull();
    expect(oldObserver.disconnected).toBe(true);
    expect(old.canvas.width).toBe(1);
    expect(old.root.listenerCount + old.canvas.listenerCount + old.button.listenerCount).toBe(0);
    oldFrame(now + 99999);
    oldObserver.callback();
    fire(old.button, 'click');
    expect(ui().root.dataset.mode).toBe('ready');
    expect(frames.size).toBe(1);
    game.hide();
    game.hide();
    expect(frames.size).toBe(0);
    expect(host.children).toEqual([sibling]);
    expect(doc.elements.every((node) => node.listenerCount === 0)).toBe(true);
    expect(win.listenerCount + doc.listenerCount).toBe(0);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('回调执行时资源已清理，支持同步重入 show，旧继续按钮仅一次', () => {
    onEnd.mockImplementation(() => {
      expect(host.children).toHaveLength(0);
      expect(frames.size).toBe(0);
      expect(doc.listenerCount + win.listenerCount).toBe(0);
      game.show();
    });
    game.show();
    const oldButton = ui().button;
    finish();
    fire(oldButton, 'click');
    expect(ui().root.dataset.mode).toBe('ready');
    expect(frames.size).toBe(1);
    fire(oldButton, 'click');
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it.each(['hide', 'dispose'] as const)('回调同步 %s 不留动画或监听', (method) => {
    onEnd.mockImplementation(() => game[method]());
    game.show();
    finish();
    fire(ui().button, 'click');
    expect(frames.size).toBe(0);
    expect(win.listenerCount + doc.listenerCount).toBe(0);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('隐藏页面暂停而非后台受击；resize 保留游戏，dispose 永久释放', () => {
    game.show();
    fire(ui().button, 'click');
    tick(1000);
    doc.hidden = true;
    fire(doc, 'visibilitychange');
    expect(frames.size).toBe(0);
    tick(60000);
    doc.hidden = false;
    fire(doc, 'visibilitychange');
    tick(0);
    expect(ui().root.dataset.mode).toBe('running');
    ui().canvas.rect = { left: 0, top: 0, width: 300, height: 600 };
    fire(win, 'resize');
    expect(ui().canvas.width).toBe(450);
    expect(ui().canvas.height).toBe(900);
    tick(14000);
    expect(ui().root.dataset.phase).toBe('surge');
    game.dispose();
    game.dispose();
    game.show();
    expect(host.children).toHaveLength(0);
    expect(frames.size).toBe(0);
    expect(win.listenerCount + doc.listenerCount).toBe(0);
    expect(ObserverStub.instances.every((observer) => observer.disconnected)).toBe(true);
    expect(onEnd).not.toHaveBeenCalled();
  });
});
