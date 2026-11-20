import './crystalGame.css';

export interface CrystalGameOptions { joined: boolean; tries: number }
export interface CrystalGameResult { hits: number; kills: number; tries: number }
export type CrystalPhase = 'ready' | 'phase1' | 'failed' | 'phase2' | 'ended';
export type CrystalEnemyKind = 'small' | 'big' | 'splitter';
export interface CrystalEnemy { id: number; kind: CrystalEnemyKind; side: -1 | 1; distance: number; hp: number }
export interface CrystalInput { left?: boolean; right?: boolean; attack?: boolean }
export interface CrystalModel extends CrystalGameResult {
  joined: boolean; phase: CrystalPhase; ticks: number; phaseTicks: number; remainder: number;
  player: number; side: -1 | 1; enemies: CrystalEnemy[]; nextId: number; spawned: number;
  nextSpawn: number; nextAttack: number; nextAllyAttack: number; attemptHits: number; attemptKills: number;
  lastAttack: number; lastAllyAttack: number;
}
const HZ = 60;
const TARGET = 20;
const NARRATIVE_TICKS = 12 * HZ;

export function createCrystalModel(options: CrystalGameOptions): CrystalModel {
  return { joined: options.joined, tries: Number.isFinite(options.tries) ? Math.max(0, Math.floor(options.tries)) : 0,
    hits: 0, kills: 0, phase: 'ready', ticks: 0, phaseTicks: 0, remainder: 0, player: -0.4, side: -1,
    enemies: [], nextId: 0, spawned: 0, nextSpawn: 1, nextAttack: 0, nextAllyAttack: 0,
    attemptHits: 0, attemptKills: 0, lastAttack: -60, lastAllyAttack: -60 };
}
export function crystalDifficulty(model: CrystalModel): { speed: number; tolerance: number } {
  return model.tries >= 3 ? { speed: 0.7, tolerance: 8 } : { speed: 1, tolerance: 5 };
}
export function crystalState(model: CrystalModel): 'whole' | 'cracked' | 'broken' {
  if (model.phase === 'failed' || (model.phase === 'ended' && !model.joined)) return 'broken';
  return model.attemptHits > 0 || model.phase === 'ended' ? 'cracked' : 'whole';
}
function beginPhase(model: CrystalModel, phase: 'phase1' | 'phase2'): void {
  model.phase = phase;
  model.phaseTicks = 0;
  model.enemies = [];
  model.spawned = 0;
  model.nextSpawn = 1;
  model.nextAttack = model.nextAllyAttack = model.ticks;
}
/** 仅准备页或真实失败后可开始；重试保留跨尝试统计。 */
export function startCrystalAttempt(model: CrystalModel): boolean {
  if (model.phase !== 'ready' && model.phase !== 'failed') return false;
  beginPhase(model, 'phase1');
  model.attemptHits = model.attemptKills = 0;
  model.player = -0.4;
  model.side = -1;
  return true;
}
/** 跳过的是阶段一，不伪造击败，也不跳过叙事。 */
export function skipCrystalAttempt(model: CrystalModel): boolean {
  if (model.phase !== 'failed' || model.tries < 5) return false;
  beginPhase(model, 'phase2');
  model.attemptHits = 0;
  return true;
}
function spawn(model: CrystalModel, kind: CrystalEnemyKind, side: -1 | 1, distance = 1): void {
  model.enemies.push({ id: model.nextId++, kind, side, distance, hp: kind === 'big' ? 2 : 1 });
}
/** 一次攻击只命中当前一侧、拦截范围内最近的实体；队友走同一结算路径。 */
export function attackCrystal(model: CrystalModel, ally = false): CrystalEnemy | null {
  if (model.phase !== 'phase1' && model.phase !== 'phase2') return null;
  if (ally && !model.joined) return null;
  if (model.ticks < (ally ? model.nextAllyAttack : model.nextAttack)) return null;
  if (!ally && Math.abs(model.player) < 0.2) return null;
  const side = ally ? -model.side : model.side;
  let target: CrystalEnemy | undefined;
  for (const enemy of model.enemies) {
    if (enemy.side === side && enemy.distance <= 0.72 && (!target || enemy.distance < target.distance)) target = enemy;
  }
  if (!target) return null;
  if (ally) { model.nextAllyAttack = model.ticks + 18; model.lastAllyAttack = model.ticks; }
  else { model.nextAttack = model.ticks + 18; model.lastAttack = model.ticks; }
  target.hp -= 1;
  if (target.hp === 0) {
    model.enemies = model.enemies.filter((enemy) => enemy !== target);
    model.kills += 1;
    if (model.phase === 'phase1') model.attemptKills += 1;
    if (target.kind === 'splitter') {
      spawn(model, 'small', target.side, target.distance + 0.07);
      spawn(model, 'small', target.side, target.distance + 0.15);
    }
    if (model.phase === 'phase1' && model.attemptKills >= TARGET) beginPhase(model, 'phase2');
  }
  return target;
}
/** 固定步长纯模拟：同样的逐帧输入得到同样结果，不使用随机或墙上时钟。 */
export function advanceCrystalModel(model: CrystalModel, seconds: number, input: CrystalInput = {}): void {
  if (!Number.isFinite(seconds) || seconds <= 0 || (model.phase !== 'phase1' && model.phase !== 'phase2')) return;
  const budget = model.remainder + Math.min(seconds, 120) * HZ;
  const steps = Math.floor(budget + 1e-8);
  model.remainder = Math.max(0, budget - steps);
  for (let i = 0; i < steps; i += 1) {
    if (model.phase !== 'phase1' && model.phase !== 'phase2') { model.remainder = 0; break; }
    model.ticks += 1;
    model.phaseTicks += 1;
    const movement = Number(Boolean(input.right)) - Number(Boolean(input.left));
    model.player = Math.max(-0.62, Math.min(0.62, model.player + movement * 1.8 / HZ));
    if (Math.abs(model.player) >= 0.2) model.side = model.player < 0 ? -1 : 1;
    if (model.phaseTicks >= model.nextSpawn) {
      const surge = model.phase === 'phase2';
      const kind: CrystalEnemyKind = surge && model.spawned % 3 === 0 ? 'splitter' : model.spawned % 5 === 4 ? 'big' : 'small';
      spawn(model, kind, model.spawned % 2 === 0 ? -1 : 1);
      model.spawned += 1;
      // 首段持续补充漏过的敌人，只有真实击败才能过关，没有超时自动胜利。
      model.nextSpawn = model.phaseTicks + (surge ? 6 : 78);
    }
    if (input.attack) attackCrystal(model);
    if (model.joined) attackCrystal(model, true);
    const speed = (model.phase === 'phase2' ? 0.9 : 0.22) * crystalDifficulty(model).speed;
    const survivors: CrystalEnemy[] = [];
    for (const enemy of model.enemies) {
      enemy.distance -= speed / HZ;
      if (enemy.distance > 0.12) survivors.push(enemy);
      else { model.hits += 1; model.attemptHits += 1; }
    }
    model.enemies = survivors;
    if (model.phase === 'phase1' && model.attemptHits >= crystalDifficulty(model).tolerance) {
      model.tries += 1;
      model.phase = 'failed';
      model.remainder = 0;
    } else if (model.phase === 'phase2' && model.phaseTicks >= NARRATIVE_TICKS) {
      // 有界的剧情收束决定水晶外观，不伪造 hits / kills，也不将失败当过关。
      model.phase = 'ended';
      model.remainder = 0;
    }
  }
}

type ViewMode = CrystalPhase | 'ending';
interface Session {
  root: HTMLElement; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null;
  panel: HTMLElement; title: HTMLElement; copy: HTMLElement; status: HTMLElement;
  button: HTMLButtonElement; skip: HTMLButtonElement; controls: HTMLElement; model: CrystalModel;
  mode: ViewMode; raf: number | null; rafToken: number; lastTime: number | null; endingTime: number;
  width: number; height: number; cleanups: (() => void)[]; previousFocus: HTMLElement | null;
  keys: Set<string>; pointers: Map<number, string>; reducedMotion: boolean;
}
function element<K extends keyof HTMLElementTagNameMap>(tag: K, name: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = `crystal-game${name ? `__${name}` : ''}`;
  node.textContent = text;
  return node;
}

/** 独立 Canvas 呈现，不修改剧情；由调用者负责事件总线与世界输入锁。 */
export class CrystalGame {
  private session: Session | null = null;
  private disposed = false;
  private readonly options: CrystalGameOptions;
  constructor(private readonly container: HTMLElement,
    private readonly onEnd: (result: CrystalGameResult) => void, options: CrystalGameOptions) {
    this.options = { ...options };
  }
  show(): void {
    if (this.disposed || this.session) return;
    const root = element('section', '');
    root.tabIndex = -1;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', '守住微光');
    const header = element('header', 'header');
    const status = element('p', 'status', '为彼此，留一处安静的地方。');
    status.setAttribute('aria-live', 'polite');
    header.append(element('span', 'eyebrow', '喧嚣之外'), element('h2', 'heading', '守住微光'), status);
    const field = element('div', 'field');
    const canvas = element('canvas', 'canvas');
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', '左右移动守护水晶，空格或 J 拦截。');
    const panel = element('div', 'panel');
    panel.setAttribute('aria-live', 'polite');
    const title = element('h3', 'title', '站在微光身边');
    const copy = element('p', 'copy', '左右移动，站到声音来的一侧，再按住攻击。大的气泡需要多次拦截。随后喧嚣会涌来，挡不住所有声音并不是你的错。');
    const button = element('button', 'button', '开始守护');
    const skip = element('button', 'skip', '跳过本关');
    button.type = skip.type = 'button';
    skip.hidden = true;
    panel.append(title, copy, button, skip);
    field.append(canvas, panel);
    const controls = element('div', 'controls');
    const directions = element('div', 'directions');
    const left = element('button', 'left', '←');
    const right = element('button', 'right', '→');
    const attack = element('button', 'attack', '拦截');
    left.setAttribute('aria-label', '向左移动');
    right.setAttribute('aria-label', '向右移动');
    for (const control of [left, right, attack]) control.type = 'button';
    directions.append(left, right);
    controls.append(directions, element('p', 'hint', 'A / D 或 ← → 移动 · 空格 / J / 点击拦截'), attack);
    root.append(header, field, controls);
    const s: Session = { root, canvas, ctx: canvas.getContext('2d'), panel, title, copy, status, button, skip, controls,
      model: createCrystalModel(this.options), mode: 'ready', raf: null, rafToken: 0, lastTime: null, endingTime: 0,
      width: 1, height: 1, cleanups: [], keys: new Set(), pointers: new Map(),
      previousFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches };
    this.session = s;
    this.container.append(root);
    const active = (): boolean => this.session === s;
    const running = (): boolean => active() && !document.hidden && (s.model.phase === 'phase1' || s.model.phase === 'phase2');
    const clearInput = (): void => { s.keys.clear(); s.pointers.clear(); };
    const listen = (target: EventTarget, type: string, handler: EventListener): void => {
      const guarded: EventListener = (event) => { if (active()) handler(event); };
      target.addEventListener(type, guarded);
      s.cleanups.push(() => target.removeEventListener(type, guarded));
    };
    const schedule = (): void => {
      if (active() && s.raf === null && !document.hidden && s.mode !== 'ended' && s.mode !== 'failed') {
        const token = ++s.rafToken;
        s.raf = requestAnimationFrame((now) => { if (s.rafToken === token) frame(now); });
      }
    };
    const sync = (): void => {
      if (s.mode === s.model.phase || s.mode === 'ending') return;
      clearInput();
      s.mode = s.model.phase;
      root.dataset.mode = s.mode;
      panel.hidden = s.mode === 'phase1' || s.mode === 'phase2';
      controls.hidden = !panel.hidden;
      if (s.mode === 'phase1' || s.mode === 'phase2') {
        status.textContent = s.mode === 'phase1' ? (s.model.joined ? '你守住一侧，另一侧有人回应。' : '靠近声音来的一侧，拦住它们。') : '声音越来越密。你仍可以拦下一些。';
        canvas.focus({ preventScroll: true });
      } else if (s.mode === 'failed') {
        title.textContent = '先停一停，再试一次';
        copy.textContent = '微光暂时暗了。可以重新站到它身边。';
        button.textContent = '再试一次';
        skip.hidden = s.model.tries < 5;
        button.focus({ preventScroll: true });
      } else if (s.mode === 'ended') {
        s.mode = 'ending';
        root.dataset.mode = 'ending';
        title.textContent = s.model.joined ? '挡不住所有的，但不是一个人。' : '一个人很难挡住所有人。';
        copy.textContent = s.model.joined ? '裂纹还在，微光也还在。身旁的人没有离开。' : '水晶碎了，但你刚才的回应，并没有消失。';
        status.textContent = '慢慢呼吸，把这束光带回去。';
        button.textContent = '继续';
        button.disabled = true;
        skip.hidden = true;
        root.focus({ preventScroll: true });
      }
    };
    listen(button, 'click', (event) => {
      event.stopPropagation();
      if (document.hidden || button.disabled) return;
      if (s.mode === 'ended') {
        const { hits, kills, tries } = s.model;
        this.hide();
        this.onEnd({ hits, kills, tries });
      } else if (startCrystalAttempt(s.model)) {
        skip.hidden = true;
        s.lastTime = performance.now();
        sync(); schedule();
      }
    });
    listen(skip, 'click', (event) => {
      event.stopPropagation();
      if (!document.hidden && skipCrystalAttempt(s.model)) {
        skip.hidden = true;
        s.lastTime = performance.now();
        sync(); schedule();
      }
    });
    const action = (key: KeyboardEvent): string | undefined => {
      if (key.code === 'KeyA' || key.code === 'ArrowLeft' || key.key === 'ArrowLeft' || key.key?.toLowerCase() === 'a') return 'left';
      if (key.code === 'KeyD' || key.code === 'ArrowRight' || key.key === 'ArrowRight' || key.key?.toLowerCase() === 'd') return 'right';
      if (key.code === 'Space' || key.code === 'KeyJ' || key.key === ' ' || key.key?.toLowerCase() === 'j') return 'attack';
      return undefined;
    };
    listen(root, 'keydown', (event) => {
      const key = event as KeyboardEvent;
      if (key.key === 'Tab') {
        event.preventDefault(); event.stopPropagation();
        const choices: HTMLElement[] = running() ? [canvas, left, right, attack] : s.mode === 'ending' ? [root] : skip.hidden ? [button] : [button, skip];
        const current = choices.indexOf(document.activeElement as HTMLElement);
        choices[(current + (key.shiftKey ? choices.length - 1 : 1)) % choices.length].focus({ preventScroll: true });
      }
      const mapped = action(key);
      if (!mapped) return;
      event.stopPropagation();
      if (!running()) return;
      event.preventDefault();
      s.keys.add(key.code || key.key);
    });
    listen(root, 'keyup', (event) => {
      const key = event as KeyboardEvent;
      if (!action(key)) return;
      event.stopPropagation();
      if (running()) event.preventDefault();
      s.keys.delete(key.code || key.key);
    });
    for (const [target, name] of [[left, 'left'], [right, 'right'], [attack, 'attack'], [canvas, 'attack']] as const) {
      listen(target, 'pointerdown', (event) => {
        const pointer = event as PointerEvent;
        if (!running() || pointer.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        canvas.focus({ preventScroll: true });
        s.pointers.set(pointer.pointerId, name);
        if (typeof target.setPointerCapture === 'function') target.setPointerCapture(pointer.pointerId);
        if (name === 'attack') { attackCrystal(s.model); sync(); this.draw(s); }
      });
      listen(target, 'lostpointercapture', (event) => { s.pointers.delete((event as PointerEvent).pointerId); });
      listen(target, 'click', (event) => {
        event.stopPropagation();
        if (running() && name === 'attack') { attackCrystal(s.model); sync(); this.draw(s); }
      });
    }
    for (const type of ['pointerup', 'pointercancel']) listen(window, type, (event) => { s.pointers.delete((event as PointerEvent).pointerId); });
    listen(window, 'blur', clearInput);
    listen(root, 'focusout', clearInput);
    const resize = (): void => {
      if (!active()) return;
      const rect = canvas.getBoundingClientRect();
      s.width = Math.max(1, rect.width); s.height = Math.max(1, rect.height);
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 1.5));
      canvas.width = Math.round(s.width * dpr); canvas.height = Math.round(s.height * dpr);
      s.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.draw(s);
    };
    listen(window, 'resize', resize);
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(resize);
      observer.observe(canvas);
      s.cleanups.push(() => observer.disconnect());
    }
    const frame = (now: number): void => {
      if (!active()) return;
      s.raf = null;
      if (document.hidden) { s.lastTime = null; clearInput(); return; }
      const seconds = s.lastTime === null ? 0 : Math.max(0, (now - s.lastTime) / 1000);
      s.lastTime = now;
      if (s.mode === 'ending') {
        s.endingTime += seconds;
        if (s.endingTime >= 1.2) {
          s.mode = 'ended'; root.dataset.mode = 'ended'; button.disabled = false; button.focus({ preventScroll: true });
        }
      } else if (running()) {
        const held = new Set(s.pointers.values());
        for (const code of s.keys) {
          const mapped = action({ code, key: code } as KeyboardEvent);
          if (mapped) held.add(mapped);
        }
        advanceCrystalModel(s.model, seconds, { left: held.has('left'), right: held.has('right'), attack: held.has('attack') });
        sync();
      }
      this.draw(s); schedule();
    };
    listen(document, 'visibilitychange', () => {
      clearInput(); s.lastTime = null;
      if (document.hidden) {
        s.rafToken += 1;
        if (s.raf !== null) cancelAnimationFrame(s.raf);
        s.raf = null;
      } else schedule();
    });
    root.dataset.mode = 'ready'; controls.hidden = true;
    resize(); button.focus({ preventScroll: true }); schedule();
  }
  hide(): void {
    const s = this.session;
    if (!s) return;
    this.session = null;
    if (s.raf !== null) cancelAnimationFrame(s.raf);
    for (const cleanup of s.cleanups) cleanup();
    s.keys.clear(); s.pointers.clear();
    const restore = s.root.contains(document.activeElement);
    s.root.remove(); s.canvas.width = s.canvas.height = 1;
    if (restore && s.previousFocus?.isConnected) s.previousFocus.focus({ preventScroll: true });
  }
  dispose(): void { this.disposed = true; this.hide(); }

  private draw(s: Session): void {
    const ctx = s.ctx;
    if (!ctx) return;
    const { width: w, height: h, model: m } = s;
    const cx = w / 2, cy = h * 0.55, scale = Math.min(w * 0.45, 440);
    const size = Math.max(14, Math.min(28, h * 0.12));
    ctx.clearRect(0, 0, w, h);
    const wash = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h));
    wash.addColorStop(0, '#294649'); wash.addColorStop(1, '#0d2029');
    ctx.fillStyle = wash; ctx.fillRect(0, 0, w, h);
    const circle = (x: number, y: number, r: number): void => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); };
    for (let i = 0; i < 38; i += 1) {
      ctx.fillStyle = 'rgba(220,218,183,0.15)';
      circle(((i * 0.618 + 0.1) % 1) * w, ((i * 0.414 + 0.2) % 1) * h, i % 3 === 0 ? 1.2 : 0.6); ctx.fill();
    }
    ctx.strokeStyle = '#547073'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(w * 0.04, cy + size * 1.3); ctx.lineTo(w * 0.96, cy + size * 1.3); ctx.stroke();
    const state = crystalState(m);
    ctx.save(); ctx.translate(cx, cy);
    ctx.fillStyle = state === 'broken' ? '#aaa58c' : '#f1dfa3';
    ctx.shadowColor = '#f1dfa3'; ctx.shadowBlur = state === 'broken' ? 0 : 22;
    if (state === 'broken') {
      for (let i = 0; i < 5; i += 1) {
        const x = (i - 2) * size * 0.5, y = size * (0.6 + (i % 2) * 0.2);
        ctx.beginPath(); ctx.moveTo(x, y - size * 0.3); ctx.lineTo(x + size * 0.3, y + size * 0.3); ctx.lineTo(x - size * 0.2, y + size * 0.3); ctx.closePath(); ctx.fill();
      }
    } else {
      ctx.beginPath(); ctx.moveTo(0, -size * 1.4); ctx.lineTo(size * 0.65, -size * 0.2); ctx.lineTo(size * 0.4, size); ctx.lineTo(-size * 0.4, size); ctx.lineTo(-size * 0.65, -size * 0.2); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0; ctx.strokeStyle = '#ae9c67';
      ctx.beginPath(); ctx.moveTo(0, -size * 1.4); ctx.lineTo(-size * 0.18, size); ctx.stroke();
      if (state === 'cracked') {
        ctx.strokeStyle = '#53615b'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(size * 0.5, -size * 0.4); ctx.lineTo(-size * 0.2, 0); ctx.lineTo(size * 0.2, size * 0.3); ctx.lineTo(-size * 0.4, size * 0.7); ctx.stroke();
      }
    }
    ctx.restore();
    const person = (position: number, ally: boolean): void => {
      const x = cx + position * scale, y = cy + size * 0.5;
      ctx.fillStyle = ally ? '#d99b68' : '#d3d9d0';
      circle(x, y - size * 0.95, size * 0.23); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x, y - size * 0.65); ctx.lineTo(x + size * 0.32, y + size * 0.65); ctx.lineTo(x - size * 0.32, y + size * 0.65); ctx.closePath(); ctx.fill();
      const age = m.ticks - (ally ? m.lastAllyAttack : m.lastAttack);
      if (age < 12) {
        ctx.strokeStyle = ally ? '#e3ab7d' : '#f5e8bc'; ctx.lineWidth = 2;
        circle(x, y - size * 0.3, size * (s.reducedMotion ? 1.3 : 1 + age / 12)); ctx.stroke();
      }
    };
    person(m.player, false);
    if (m.joined) person(-m.side * 0.42, true);
    for (const enemy of m.enemies) {
      const x = cx + enemy.side * enemy.distance * scale, y = cy - size * 0.1;
      const r = size * (enemy.kind === 'big' ? 0.85 : enemy.kind === 'splitter' ? 0.7 : 0.55);
      ctx.fillStyle = '#617f8e'; ctx.strokeStyle = '#9bb1ba'; ctx.lineWidth = 1;
      if (enemy.kind === 'big') {
        ctx.beginPath();
        for (let i = 0; i < 24; i += 1) {
          const angle = i * Math.PI / 12, radius = r * (i % 2 ? 1 : 1.25);
          if (i === 0) ctx.moveTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
          else ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
        }
        ctx.closePath();
      } else circle(x, y, r);
      ctx.fill(); ctx.stroke();
      if (enemy.kind === 'splitter' || enemy.hp === 1 && enemy.kind === 'big') {
        ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x - r * 0.2, y); ctx.lineTo(x + r * 0.15, y + r); ctx.stroke();
      }
      ctx.fillStyle = '#e0e6e5';
      for (let dot = -1; dot <= 1; dot += 1) { circle(x + dot * r * 0.35, y, 1.5); ctx.fill(); }
    }
  }
}
