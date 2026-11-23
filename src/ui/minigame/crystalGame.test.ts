import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CrystalGame, advanceCrystalModel, attackCrystal, createCrystalModel, crystalDifficulty,
  crystalState, skipCrystalAttempt, startCrystalAttempt } from './crystalGame';
import type { CrystalEnemy, CrystalGameResult, CrystalModel } from './crystalGame';
import type { Mock } from 'vitest';

function model(joined = false, tries = 0): CrystalModel {
  const m = createCrystalModel({ joined, tries });
  startCrystalAttempt(m);
  return m;
}
function enemy(kind: CrystalEnemy['kind'], id = 1, side: -1 | 1 = -1, distance = 0.6): CrystalEnemy {
  return { kind, id, side, distance, hp: kind === 'big' ? 2 : 1 };
}
function playFirst(m: CrystalModel): void {
  for (let i = 0; i < 3600 && m.phase === 'phase1'; i += 1) {
    const nearest = [...m.enemies].sort((a, b) => a.distance - b.distance)[0];
    const goal = (nearest?.side ?? m.side) * 0.4;
    advanceCrystalModel(m, 1 / 60, { left: m.player > goal + 0.02, right: m.player < goal - 0.02, attack: true });
  }
}

describe('水晶固定步长模型', () => {
  it('准备页不推进，输入校验和重入不改变尝试', () => {
    const m = createCrystalModel({ joined: false, tries: NaN });
    advanceCrystalModel(m, 100);
    expect(m.phase).toBe('ready');
    expect(m.ticks).toBe(0);
    expect(m.tries).toBe(0);
    expect(skipCrystalAttempt(m)).toBe(false);
    expect(startCrystalAttempt(m)).toBe(true);
    const before = structuredClone(m);
    expect(startCrystalAttempt(m)).toBe(false);
    for (const seconds of [NaN, Infinity, -1, 0]) advanceCrystalModel(m, seconds);
    expect(m).toEqual(before);
  });

  it('相同输入跨不同分帧与阶段边界完全确定', () => {
    const one = model(true), many = model(true);
    advanceCrystalModel(one, 28, { attack: true });
    for (let i = 0; i < 2800; i += 1) advanceCrystalModel(many, 0.01, { attack: true });
    expect(many).toEqual(one);
    expect(one.phase).toBe('phase2');
    advanceCrystalModel(one, 12, { attack: true });
    for (let i = 0; i < 1200; i += 1) advanceCrystalModel(many, 0.01, { attack: true });
    expect(many).toEqual(one);
  });

  it('阶段一约二十五至三十秒，必须真实击败二十只', () => {
    const m = model();
    playFirst(m);
    expect(m.phase).toBe('phase2');
    expect(m.attemptKills).toBe(20);
    expect(m.kills).toBe(20);
    expect(m.ticks / 60).toBeGreaterThanOrEqual(25);
    expect(m.ticks / 60).toBeLessThanOrEqual(30);
    const idle = model();
    advanceCrystalModel(idle, 120);
    expect(idle.phase).toBe('failed');
    expect(idle.kills).toBe(0);
    expect(idle.tries).toBe(1);
    const snapshot = structuredClone(idle);
    advanceCrystalModel(idle, 120);
    expect(idle).toEqual(snapshot);
  });

  it('小怪一击、大怪两击、分裂怪实际生成两只，空击及冷却不计数', () => {
    const m = model(); m.nextSpawn = Infinity;
    m.enemies = [enemy('small'), enemy('big', 2), enemy('small', 3, 1)];
    expect(attackCrystal(m)?.id).toBe(1);
    expect(m.kills).toBe(1);
    expect(attackCrystal(m)).toBeNull();
    advanceCrystalModel(m, 0.3);
    expect(attackCrystal(m)?.hp).toBe(1);
    expect(m.kills).toBe(1);
    advanceCrystalModel(m, 0.3);
    attackCrystal(m);
    expect(m.kills).toBe(2);
    advanceCrystalModel(m, 0.3);
    expect(attackCrystal(m)).toBeNull();
    expect(attackCrystal(m, true)).toBeNull();
    m.phase = 'phase2'; m.enemies = [enemy('splitter', 10)]; m.nextId = 11;
    attackCrystal(m);
    expect(m.enemies.map((e) => e.kind)).toEqual(['small', 'small']);
    expect(new Set(m.enemies.map((e) => e.id)).size).toBe(2);
    expect(m.kills).toBe(3);
    advanceCrystalModel(m, 0.6, { attack: true });
    expect(m.kills).toBe(5);
    expect(m.enemies).toHaveLength(0);
  });

  it('真实碰撞只计一次，移动有边界与侧向要求', () => {
    const m = model(); m.nextSpawn = Infinity;
    m.enemies = [enemy('small', 1, 1, 0.121)];
    advanceCrystalModel(m, 1 / 60);
    expect(m.hits).toBe(1);
    expect(crystalState(m)).toBe('cracked');
    advanceCrystalModel(m, 1, { left: true });
    expect(m.hits).toBe(1); expect(m.player).toBe(-0.62);
    advanceCrystalModel(m, 1, { right: true });
    expect(m.player).toBe(0.62); expect(m.side).toBe(1);
    m.enemies = [enemy('small', 2, 1, 0.9)];
    expect(attackCrystal(m)).toBeNull();
    m.enemies[0].distance = 0.5; m.player = 0;
    expect(attackCrystal(m)?.id).toBe(2);
  });

  it('累计失败三次减速和增耐受，五次才可主动跳过且保留统计', () => {
    const m = model();
    expect(crystalDifficulty(m)).toEqual({ speed: 1, tolerance: 5 });
    for (let failure = 1; failure <= 5; failure += 1) {
      advanceCrystalModel(m, 120);
      expect(m.phase).toBe('failed'); expect(m.tries).toBe(failure);
      expect(crystalState(m)).toBe('broken');
      if (failure < 5) expect(skipCrystalAttempt(m)).toBe(false);
      if (failure === 3) expect(crystalDifficulty(m)).toEqual({ speed: 0.7, tolerance: 8 });
      if (failure < 5) expect(startCrystalAttempt(m)).toBe(true);
    }
    expect(m.hits).toBe(31);
    const before = { hits: m.hits, kills: m.kills, tries: m.tries };
    expect(skipCrystalAttempt(m)).toBe(true);
    expect(m.phase).toBe('phase2');
    expect(m).toMatchObject(before);
    expect(m.attemptKills).toBe(0);
    expect(skipCrystalAttempt(m)).toBe(false);
    const normal = model(), easy = model(false, 3);
    normal.nextSpawn = easy.nextSpawn = Infinity;
    normal.enemies = [enemy('small', 1, -1, 1)]; easy.enemies = [enemy('small', 1, -1, 1)];
    advanceCrystalModel(normal, 1); advanceCrystalModel(easy, 1);
    expect((1 - easy.enemies[0].distance) / (1 - normal.enemies[0].distance)).toBeCloseTo(0.7);
  });

  it('重试保留实际击败统计而清空阶段进度', () => {
    const m = model(); m.enemies = [enemy('small')]; attackCrystal(m);
    advanceCrystalModel(m, 120);
    const hits = m.hits;
    startCrystalAttempt(m);
    expect(m.kills).toBe(1); expect(m.hits).toBe(hits); expect(m.tries).toBe(1);
    expect(m.attemptKills).toBe(0); expect(m.attemptHits).toBe(0);
    expect(crystalState(m)).toBe('whole');
  });

  it('队友守另一侧；后段有界，独自碎裂、并肩带裂纹，结束不可再结算', () => {
    const solo = model(false, 5), joined = model(true, 5);
    for (const m of [solo, joined]) {
      m.phase = 'failed'; skipCrystalAttempt(m);
      advanceCrystalModel(m, 0.1);
      expect(m.enemies.some((e) => e.kind === 'splitter')).toBe(true);
      advanceCrystalModel(m, 11.9, { attack: true });
      expect(m.phase).toBe('ended'); expect(m.phaseTicks).toBe(720);
      expect(m.hits).toBeGreaterThan(0); expect(m.kills).toBeGreaterThan(0);
      const before = structuredClone(m);
      advanceCrystalModel(m, 100); expect(attackCrystal(m)).toBeNull();
      expect(m).toEqual(before);
    }
    expect(crystalState(solo)).toBe('broken'); expect(crystalState(joined)).toBe('cracked');
    expect(joined.hits).toBeLessThan(solo.hits); expect(joined.kills).toBeGreaterThan(solo.kills);
    const ally = model(true); ally.nextSpawn = Infinity;
    ally.enemies = [enemy('small', 1, -1), enemy('small', 2, 1)];
    expect(attackCrystal(ally, true)?.id).toBe(2);
    expect(ally.enemies[0].id).toBe(1);
  });
});

// 轻量 DOM 桩，与现有小游戏保持一致，不增添运行时或测试依赖。
class TargetStub extends EventTarget {
  listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener) return;
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener); super.addEventListener(type, listener);
  }
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (listener) this.listeners.get(type)?.delete(listener);
    super.removeEventListener(type, listener);
  }
  get listenerCount(): number { return [...this.listeners.values()].reduce((n, set) => n + set.size, 0); }
}
let doc: DocumentStub;
const context = new Proxy<Record<string, unknown>>({}, {
  get: (_target, key) => key === 'createRadialGradient' ? () => ({ addColorStop: vi.fn() }) : vi.fn(),
});
class ElementStub extends TargetStub {
  className = ''; textContent = ''; dataset: Record<string, string> = {}; children: ElementStub[] = [];
  parent: ElementStub | null = null; hidden = false; disabled = false; tabIndex = -1; type = ''; width = 0; height = 0;
  rect = { width: 800, height: 400, left: 0, top: 0 };
  captures = new Set<number>();
  constructor(readonly tag: string) { super(); }
  get isConnected(): boolean { return this.tag === 'host' || this.parent?.isConnected === true; }
  append(...children: ElementStub[]): void { for (const child of children) { child.parent = this; this.children.push(child); } }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; }
  contains(node: ElementStub | null): boolean { return this === node || this.children.some((child) => child.contains(node)); }
  setAttribute(): void {}
  focus(): void { doc.activeElement = this; }
  getBoundingClientRect(): typeof this.rect { return this.rect; }
  getContext(): unknown { return context; }
  setPointerCapture(id: number): void { this.captures.add(id); }
}
class DocumentStub extends TargetStub {
  hidden = false; activeElement: ElementStub | null = null; elements: ElementStub[] = [];
  createElement(tag: string): ElementStub { const e = new ElementStub(tag); this.elements.push(e); return e; }
}
class ObserverStub {
  static instances: ObserverStub[] = [];
  disconnected = false;
  constructor(readonly callback: () => void) { ObserverStub.instances.push(this); }
  observe(): void {}
  disconnect(): void { this.disconnected = true; }
}
function fire(target: EventTarget, type: string, props: Record<string, unknown> = {}): Event {
  const event = new Event(type, { cancelable: true }); Object.assign(event, props); target.dispatchEvent(event); return event;
}

describe('CrystalGame 生命周期与双端输入', () => {
  let game: CrystalGame, host: ElementStub, win: TargetStub, frames: Map<number, FrameRequestCallback>;
  let onEnd: Mock<(result: CrystalGameResult) => void>, now: number, frameId: number;
  const ui = (name = ''): ElementStub => {
    const result = doc.elements.find((e) => e.isConnected && e.className === `crystal-game${name ? `__${name}` : ''}`);
    if (!result) throw new Error(`缺少界面 ${name}`);
    return result;
  };
  const current = (): CrystalModel => (game as unknown as { session: { model: CrystalModel } }).session.model;
  const tick = (ms: number): void => { now += ms; const pending = [...frames.values()]; frames.clear(); for (const frame of pending) frame(now); };
  const start = (): void => { game.show(); fire(ui('button'), 'click'); };
  const finish = (): void => {
    start(); fire(ui(), 'keydown', { code: 'Space', key: ' ' }); tick(28000);
    expect(ui().dataset.mode).toBe('phase2'); tick(12000);
    expect(ui().dataset.mode).toBe('ending'); tick(1200);
    expect(ui().dataset.mode).toBe('ended');
  };
  beforeEach(() => {
    now = frameId = 0; frames = new Map(); doc = new DocumentStub(); win = new TargetStub(); host = new ElementStub('host');
    Object.assign(win, { devicePixelRatio: 3, matchMedia: () => ({ matches: false }) });
    ObserverStub.instances = [];
    vi.stubGlobal('window', win); vi.stubGlobal('document', doc); vi.stubGlobal('HTMLElement', ElementStub);
    vi.stubGlobal('ResizeObserver', ObserverStub); vi.stubGlobal('performance', { now: () => now });
    vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => { frames.set(++frameId, frame); return frameId; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    onEnd = vi.fn(); game = new CrystalGame(host as unknown as HTMLElement, onEnd, { joined: true, tries: 0 });
  });
  afterEach(() => { game.dispose(); vi.unstubAllGlobals(); });

  it('显式开始、叙事后继续且仅一次回调，无可见数值', () => {
    game.show(); tick(30000); expect(ui().dataset.mode).toBe('ready');
    expect(ui('canvas').width).toBe(1200); expect(ui('canvas').height).toBe(600);
    fire(ui('button'), 'click'); fire(ui('button'), 'click');
    fire(ui(), 'keydown', { code: 'Space' }); tick(40000);
    expect(ui().dataset.mode).toBe('ending');
    expect(ui('title').textContent).toBe('挡不住所有的，但不是一个人。');
    fire(ui('button'), 'click'); expect(onEnd).not.toHaveBeenCalled();
    tick(1199); expect(ui('button').disabled).toBe(true); tick(1);
    expect(frames.size).toBe(0);
    expect(doc.elements.map((e) => e.textContent).join('')).not.toMatch(/\d|hits|kills|harm|评分/);
    const button = ui('button'), result = current();
    fire(button, 'click'); fire(button, 'click');
    expect(onEnd).toHaveBeenCalledExactlyOnceWith({ hits: result.hits, kills: result.kills, tries: 0 });
    expect(host.children).toHaveLength(0);
  });

  it('键盘方向、空格/J、点击共用攻击，按键松开停止', () => {
    start(); const m = current(); m.nextSpawn = Infinity;
    expect(fire(ui(), 'keydown', { code: 'KeyD', key: 'd' }).defaultPrevented).toBe(true);
    tick(1000); expect(m.player).toBe(0.62);
    fire(ui(), 'keyup', { code: 'KeyD', key: 'd' }); tick(500); expect(m.player).toBe(0.62);
    fire(ui(), 'keydown', { code: 'ArrowLeft', key: 'ArrowLeft' }); tick(1000);
    fire(ui(), 'keyup', { code: 'ArrowLeft', key: 'ArrowLeft' }); expect(m.player).toBe(-0.62);
    m.enemies = [enemy('big')];
    fire(ui(), 'keydown', { code: 'KeyJ', key: 'j' }); tick(350);
    fire(ui(), 'keyup', { code: 'KeyJ', key: 'j' }); expect(m.kills).toBe(1);
    m.enemies = [enemy('small', 2)]; tick(500); expect(m.kills).toBe(1);
    fire(ui('canvas'), 'click'); expect(m.kills).toBe(2);
    fire(ui(), 'keydown', { code: 'KeyA', key: 'a' }); fire(win, 'blur');
    m.player = 0; tick(100); expect(m.player).toBe(0);
  });

  it('触屏多指同时移动拦截，取消和失去捕获清理，右键无效', () => {
    start(); const m = current(); m.nextSpawn = Infinity; m.joined = false;
    m.enemies = [enemy('big', 1, 1)];
    fire(ui('right'), 'pointerdown', { button: 0, pointerId: 1, pointerType: 'touch' });
    fire(ui('attack'), 'pointerdown', { button: 0, pointerId: 2, pointerType: 'touch' });
    tick(1000); expect(m.player).toBe(0.62); expect(m.kills).toBe(1);
    fire(win, 'pointercancel', { pointerId: 1 }); fire(ui('attack'), 'lostpointercapture', { pointerId: 2 });
    m.player = 0.4; m.enemies = [enemy('small', 2, 1)]; tick(500);
    expect(m.player).toBe(0.4); expect(m.kills).toBe(1);
    fire(ui('canvas'), 'pointerdown', { button: 2, pointerId: 3 }); tick(500); expect(m.kills).toBe(1);
    fire(ui('attack'), 'pointerdown', { button: 0, pointerId: 4 }); tick(17);
    fire(win, 'pointerup', { pointerId: 4 }); expect(m.kills).toBe(2);
  });

  it('失败重试与跳过按钮门槛、独行字幕、焦点循环', () => {
    game.dispose(); game = new CrystalGame(host as unknown as HTMLElement, onEnd, { joined: false, tries: 0 });
    start();
    for (let i = 1; i <= 5; i += 1) {
      tick(120000); expect(ui().dataset.mode).toBe('failed');
      expect(ui('skip').hidden).toBe(i < 5);
      if (i < 5) fire(ui('button'), 'click');
    }
    expect(doc.activeElement).toBe(ui('button'));
    fire(ui(), 'keydown', { key: 'Tab' }); expect(doc.activeElement).toBe(ui('skip'));
    fire(ui(), 'keydown', { key: 'Tab', shiftKey: true }); expect(doc.activeElement).toBe(ui('button'));
    fire(ui('skip'), 'click'); expect(ui().dataset.mode).toBe('phase2');
    tick(12000); expect(ui('title').textContent).toBe('一个人很难挡住所有人。');
    tick(1200); fire(ui('button'), 'click');
    expect(onEnd.mock.calls[0][0]).toMatchObject({ tries: 5, kills: 0 });
  });

  it('重复 show 不重置，hide 释放资源和焦点，过期回调无法复活', () => {
    const previous = new ElementStub('button'); host.append(previous); previous.focus();
    start(); tick(1000); const m = current(), canvas = ui('canvas'), button = ui('button');
    const stale = [...frames.values()][0], observer = ObserverStub.instances[0];
    const staleClick = [...(button.listeners.get('click') ?? [])][0] as EventListener;
    game.show(); expect(current()).toBe(m); expect(frames.size).toBe(1);
    game.hide(); game.hide(); expect(doc.activeElement).toBe(previous); expect(canvas.width).toBe(1);
    expect(frames.size).toBe(0); expect(observer.disconnected).toBe(true);
    expect(doc.elements.every((e) => e.listenerCount === 0)).toBe(true);
    expect(win.listenerCount + doc.listenerCount).toBe(0);
    game.show(); stale(now + 99999); observer.callback(); staleClick(new Event('click')); fire(button, 'click');
    expect(ui().dataset.mode).toBe('ready'); expect(frames.size).toBe(1); expect(onEnd).not.toHaveBeenCalled();
  });

  it('页面不可见时取消 RAF 和输入，恢复不追赶，横竖 resize 不重置', () => {
    start(); tick(1000); const before = structuredClone(current()); const stale = [...frames.values()][0];
    doc.hidden = true; fire(doc, 'visibilitychange'); expect(frames.size).toBe(0);
    stale(now + 60000); fire(ui('attack'), 'click'); tick(60000); expect(current()).toEqual(before);
    doc.hidden = false; fire(doc, 'visibilitychange');
    stale(now + 60000); expect(frames.size).toBe(1); expect(current()).toEqual(before);
    tick(0); expect(current()).toEqual(before);
    ui('canvas').rect = { width: 300, height: 600, left: 0, top: 0 }; fire(win, 'resize');
    expect(ui('canvas').width).toBe(450); expect(ui('canvas').height).toBe(900);
    expect(current()).toEqual(before); tick(1000); expect(current().ticks).toBe(before.ticks + 60);
  });

  it.each(['show', 'hide', 'dispose'] as const)('结算回调同步 %s 安全且清理在回调之前', (method) => {
    onEnd.mockImplementation(() => {
      expect(host.children).toHaveLength(0); expect(frames.size).toBe(0);
      expect(win.listenerCount + doc.listenerCount).toBe(0); game[method]();
    });
    finish(); const old = ui('button'); fire(old, 'click'); fire(old, 'click');
    expect(onEnd).toHaveBeenCalledTimes(1);
    if (method === 'show') expect(ui().dataset.mode).toBe('ready');
    else expect(host.children).toHaveLength(0);
    game.dispose(); game.show(); expect(host.children).toHaveLength(0); expect(frames.size).toBe(0);
  });
});
