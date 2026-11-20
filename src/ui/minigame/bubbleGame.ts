import './bubbleGame.css';

export interface BubbleGameResult { hits: number; kills: number }
export interface Bubble { id: number; angle: number; distance: number; size: number }
export interface BubbleModel extends BubbleGameResult {
  ticks: number;
  remainder: number;
  seed: number;
  nextId: number;
  nextSpawn: number;
  nextAttack: number;
  lastHit: number;
  bubbles: Bubble[];
}

const HZ = 60;
const QUIET_TICKS = 15 * HZ;
const END_TICKS = 25 * HZ;
const ATTACK_TICKS = 9;

/** 无 DOM、无实时时钟的轻量模拟；固定步长与种子使回放可确定复现。 */
export function createBubbleModel(seed = 0x51a7): BubbleModel {
  return { ticks: 0, remainder: 0, seed: seed >>> 0, nextId: 0,
    nextSpawn: 1, nextAttack: 0, lastHit: -HZ, bubbles: [], hits: 0, kills: 0 };
}

export function bubblePhase(model: BubbleModel): 'quiet' | 'surge' | 'ended' {
  return model.ticks >= END_TICKS ? 'ended' : model.ticks >= QUIET_TICKS ? 'surge' : 'quiet';
}

function random(model: BubbleModel): number {
  model.seed = (Math.imul(model.seed, 1664525) + 1013904223) >>> 0;
  return model.seed / 4294967296;
}

/** 原地推进，秒为单位；隐藏页面由视图暂停。超大增量最多模拟本局剩余时间。 */
export function advanceBubbleModel(model: BubbleModel, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0 || bubblePhase(model) === 'ended') return;
  const budget = model.remainder + Math.min(seconds, 25) * HZ;
  const steps = Math.min(END_TICKS - model.ticks, Math.floor(budget + 1e-8));
  model.remainder = Math.max(0, budget - steps);
  for (let i = 0; i < steps; i += 1) {
    model.ticks += 1;
    const surge = model.ticks >= QUIET_TICKS;
    const pressure = Math.max(0, (model.ticks - QUIET_TICKS) / (END_TICKS - QUIET_TICKS));
    if (model.ticks === QUIET_TICKS) model.nextSpawn = model.ticks;
    if (model.ticks >= model.nextSpawn && model.ticks < END_TICKS) {
      model.bubbles.push({ id: model.nextId++, angle: random(model) * Math.PI * 2,
        distance: 1, size: 0.88 + random(model) * 0.24 });
      // 后段涌入速度超过连续拦截速度；不伪造命中，统计只来自真实碰撞。
      model.nextSpawn = model.ticks + (surge ? Math.max(4, Math.round(10 - pressure * 6)) : 48);
    }
    const speed = surge ? 0.56 + pressure * 0.44 : 0.2;
    model.bubbles = model.bubbles.filter((bubble) => {
      bubble.distance -= speed / HZ;
      if (bubble.distance > 0.12) return true;
      model.hits += 1;
      model.lastHit = model.ticks;
      return false;
    });
  }
  if (bubblePhase(model) === 'ended') model.remainder = 0;
}

/** 省略 id 时攻击离中央最近的气泡；指针和键盘共用节奏与统计规则。 */
export function attackBubble(model: BubbleModel, id?: number): Bubble | null {
  if (bubblePhase(model) === 'ended' || model.ticks < model.nextAttack) return null;
  let index = -1;
  for (let i = 0; i < model.bubbles.length; i += 1) {
    if (id !== undefined ? model.bubbles[i].id === id
      : index < 0 || model.bubbles[i].distance < model.bubbles[index].distance) index = i;
    if (id !== undefined && index >= 0) break;
  }
  if (index < 0) return null;
  const [bubble] = model.bubbles.splice(index, 1);
  model.nextAttack = model.ticks + ATTACK_TICKS;
  model.kills += 1;
  return bubble;
}

type Mode = 'ready' | 'running' | 'ending' | 'finished';
interface Ripple { x: number; y: number; age: number }
interface Session {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D | null;
  panel: HTMLElement;
  title: HTMLElement;
  copy: HTMLElement;
  status: HTMLElement;
  button: HTMLButtonElement;
  model: BubbleModel;
  mode: Mode;
  width: number;
  height: number;
  raf: number | null;
  lastTime: number | null;
  endTime: number;
  ambience: number;
  ripples: Ripple[];
  cleanups: (() => void)[];
  previousFocus: HTMLElement | null;
  reducedMotion: boolean;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

/** 只负责小游戏呈现与统计；事件总线、剧情结算和控制锁由调用方接入。 */
export class BubbleGame {
  private session: Session | null = null;
  private disposed = false;

  constructor(private readonly container: HTMLElement,
    private readonly onEnd: (result: BubbleGameResult) => void) {}

  show(): void {
    if (this.disposed) return;
    this.hide();
    const root = element('section', 'bubble-game');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', '留一点安静，清气泡');
    root.dataset.mode = 'ready';
    const header = element('header', 'bubble-game__header');
    header.append(element('span', 'bubble-game__eyebrow', '喧嚣之间'),
      element('h2', 'bubble-game__heading', '留一点安静'));
    const status = element('p', 'bubble-game__status', '为中央的微光，留下一点空间。');
    status.setAttribute('aria-live', 'polite');
    header.append(status);
    const field = element('div', 'bubble-game__field');
    const canvas = element('canvas', 'bubble-game__canvas');
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'group');
    canvas.setAttribute('aria-label', '点击或轻触气泡进行拦截；按空格键拦截离中央最近的气泡，可按住连续拦截。');
    const panel = element('div', 'bubble-game__panel');
    panel.setAttribute('aria-live', 'polite');
    panel.setAttribute('aria-atomic', 'true');
    const title = element('h3', 'bubble-game__panel-title', '把声音，挡在光之外');
    const copy = element('p', 'bubble-game__copy', '点击或轻触灰蓝气泡，别让它们碰到中央的微光。也可以按空格键，拦截最近的气泡；按住可连续拦截。随后声音会加速涌入，挡不住所有声音并不是你的错。');
    const button = element('button', 'bubble-game__button', '开始 · 守住微光');
    button.type = 'button';
    panel.append(title, copy, button);
    field.append(canvas, panel);
    root.append(header, field, element('p', 'bubble-game__hint', '点击 / 轻触气泡  ·  空格拦截最近气泡（可按住）'));
    const s: Session = { root, canvas, context: canvas.getContext('2d'), panel, title, copy,
      status, button, model: createBubbleModel(), mode: 'ready', width: 1, height: 1,
      raf: null, lastTime: null, endTime: 0, ambience: 0, ripples: [], cleanups: [],
      previousFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches };
    this.session = s;
    this.container.append(root);

    const listen = (target: EventTarget, type: string, callback: EventListener): void => {
      target.addEventListener(type, callback);
      s.cleanups.push(() => target.removeEventListener(type, callback));
    };
    listen(button, 'click', () => {
      if (this.session !== s) return;
      if (s.mode === 'ready') {
        s.mode = 'running';
        root.dataset.mode = 'running';
        panel.hidden = true;
        status.textContent = '先拦住靠近的声音。';
        s.lastTime = performance.now();
        canvas.focus({ preventScroll: true });
      } else if (s.mode === 'finished') {
        const result = { hits: s.model.hits, kills: s.model.kills };
        // 必须先失效旧会话并清理；回调同步 show / hide / dispose 不会被旧局覆盖。
        this.hide();
        this.onEnd(result);
      }
    });
    listen(canvas, 'pointerdown', (event) => {
      if (this.session !== s || s.mode !== 'running') return;
      const pointer = event as PointerEvent;
      if (pointer.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      canvas.focus({ preventScroll: true });
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = (pointer.clientX - rect.left) * s.width / rect.width;
      const y = (pointer.clientY - rect.top) * s.height / rect.height;
      // 重叠目标优先拦截离指针最近的一个，触屏命中范围至少直径 48px。
      let selected: Bubble | undefined;
      let distance = Infinity;
      for (const bubble of s.model.bubbles) {
        const point = this.project(s, bubble);
        const d = Math.hypot(x - point.x, y - point.y);
        if (d <= Math.max(24, point.radius + 6) && d < distance) {
          selected = bubble;
          distance = d;
        }
      }
      if (selected) this.attack(s, selected.id);
    });
    let heldSpace = false;
    listen(root, 'keydown', (event) => {
      const key = event as KeyboardEvent;
      if (this.session !== s) return;
      // 对话框内保留焦点，避免 Tab 将游戏输入交给背景世界。
      if (key.key === 'Tab') {
        event.preventDefault();
        (s.mode === 'running' ? canvas : button.disabled ? root : button).focus({ preventScroll: true });
      }
      if (key.code !== 'Space' && key.key !== ' ') return;
      event.stopPropagation();
      if (s.mode === 'running') {
        event.preventDefault();
        heldSpace = true;
        this.attack(s);
      }
    });
    listen(root, 'keyup', (event) => {
      const key = event as KeyboardEvent;
      if (key.code === 'Space' || key.key === ' ') {
        heldSpace = false;
        event.stopPropagation();
        if (s.mode === 'running') event.preventDefault();
      }
    });
    listen(window, 'blur', () => { heldSpace = false; });
    listen(root, 'focusout', () => { heldSpace = false; });
    root.tabIndex = -1;
    const resize = (): void => {
      if (this.session !== s) return;
      const rect = canvas.getBoundingClientRect();
      s.width = Math.max(1, rect.width);
      s.height = Math.max(1, rect.height);
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 1.5));
      canvas.width = Math.round(s.width * dpr);
      canvas.height = Math.round(s.height * dpr);
      s.context?.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.draw(s);
    };
    listen(window, 'resize', resize);
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(resize);
      observer.observe(canvas);
      s.cleanups.push(() => observer.disconnect());
    }
    const schedule = (): void => {
      if (this.session === s && s.raf === null && !document.hidden && s.mode !== 'finished') {
        s.raf = requestAnimationFrame(frame);
      }
    };
    const frame = (now: number): void => {
      if (this.session !== s) return;
      s.raf = null;
      const seconds = s.lastTime === null ? 0 : Math.max(0, (now - s.lastTime) / 1000);
      s.lastTime = now;
      s.ambience += Math.min(seconds, 0.1);
      s.ripples = s.ripples.filter((ripple) => { ripple.age += seconds; return ripple.age < 0.6; });
      if (s.mode === 'running') {
        // 分帧补步时也保持按住空格的攻击节奏，避免帧率决定玩家表现。
        let remaining = Math.min(seconds, 25);
        while (remaining > 1e-8 && bubblePhase(s.model) !== 'ended') {
          const step = Math.min(1 / HZ, remaining);
          advanceBubbleModel(s.model, step);
          if (heldSpace) this.attack(s);
          remaining -= step;
        }
        if (bubblePhase(s.model) === 'surge' && root.dataset.phase !== 'surge') {
          root.dataset.phase = 'surge';
          status.textContent = '声音越来越密。你仍可以拦下一些。';
        }
        if (bubblePhase(s.model) === 'ended') {
          s.mode = 'ending';
          root.dataset.mode = 'ending';
          heldSpace = false;
          panel.hidden = false;
          title.textContent = '一个人，很难挡住所有声音。';
          copy.textContent = '微光暂时被淹没了。但你刚才的回应，并没有消失。';
          status.textContent = '先停一停，慢慢呼吸。';
          button.textContent = '继续';
          button.disabled = true;
          root.focus({ preventScroll: true });
        }
      } else if (s.mode === 'ending') {
        s.endTime += seconds;
        if (s.endTime >= 1.4) {
          s.mode = 'finished';
          root.dataset.mode = 'finished';
          button.disabled = false;
          button.focus({ preventScroll: true });
        }
      }
      this.draw(s);
      schedule();
    };
    listen(document, 'visibilitychange', () => {
      heldSpace = false;
      s.lastTime = null;
      if (document.hidden && s.raf !== null) {
        cancelAnimationFrame(s.raf);
        s.raf = null;
      } else schedule();
    });
    resize();
    button.focus({ preventScroll: true });
    schedule();
  }

  hide(): void {
    const s = this.session;
    if (!s) return;
    this.session = null;
    if (s.raf !== null) cancelAnimationFrame(s.raf);
    s.raf = null;
    for (const cleanup of s.cleanups) cleanup();
    s.cleanups.length = 0;
    const restoreFocus = s.root.contains(document.activeElement);
    s.root.remove();
    // 释放大画布缓冲区，且不误删容器内调用方的其他 UI。
    s.canvas.width = 1;
    s.canvas.height = 1;
    if (restoreFocus && s.previousFocus?.isConnected) s.previousFocus.focus({ preventScroll: true });
  }

  dispose(): void {
    this.disposed = true;
    this.hide();
  }

  private project(s: Session, bubble: Bubble): { x: number; y: number; radius: number } {
    const orbit = Math.max(1, Math.min(s.width, s.height) / 2 - 30);
    return { x: s.width / 2 + Math.cos(bubble.angle) * bubble.distance * orbit,
      y: s.height / 2 + Math.sin(bubble.angle) * bubble.distance * orbit,
      radius: Math.max(13, Math.min(22, orbit * 0.105)) * bubble.size };
  }

  private attack(s: Session, id?: number): void {
    const bubble = attackBubble(s.model, id);
    if (!bubble) return;
    const point = this.project(s, bubble);
    s.ripples.push({ x: point.x / s.width, y: point.y / s.height, age: 0 });
    if (s.ripples.length > 24) s.ripples.shift();
  }

  private draw(s: Session): void {
    const ctx = s.context;
    if (!ctx) return;
    const { width: w, height: h } = s;
    const cx = w / 2;
    const cy = h / 2;
    const orbit = Math.max(1, Math.min(w, h) / 2 - 30);
    const t = s.reducedMotion ? 0 : s.ambience;
    const ended = s.mode === 'ending' || s.mode === 'finished';
    const surge = bubblePhase(s.model) !== 'quiet';
    ctx.clearRect(0, 0, w, h);
    const atmosphere = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.65);
    atmosphere.addColorStop(0, surge ? '#283a46' : '#233f49');
    atmosphere.addColorStop(0.48, '#152a36');
    atmosphere.addColorStop(1, '#0c1824');
    ctx.fillStyle = atmosphere;
    ctx.fillRect(0, 0, w, h);
    const circle = (x: number, y: number, radius: number): void => {
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.1, radius), 0, Math.PI * 2);
    };
    // 低成本尘光与轨道，背景不依赖图片或高频噪点。
    for (let i = 0; i < 38; i += 1) {
      const x = ((i * 0.6180339 + 0.13) % 1) * w;
      const y = ((i * 0.4142135 + 0.21) % 1) * h + Math.sin(t * 0.3 + i) * 3;
      ctx.fillStyle = `rgba(192,212,211,${0.1 + (i % 4) * 0.025})`;
      circle(x, y, i % 3 === 0 ? 1.3 : 0.7);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(158,190,195,0.12)';
    ctx.lineWidth = 1;
    for (const ratio of [0.36, 0.68, 1.06]) {
      circle(cx, cy, orbit * ratio);
      ctx.stroke();
    }
    ctx.setLineDash([2, 12]);
    circle(cx, cy, orbit * 0.86);
    ctx.stroke();
    ctx.setLineDash([]);
    const pulse = ended ? 0.32 : 0.92 + Math.sin(t * 1.7) * 0.08;
    const aura = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(28, orbit * 0.6));
    aura.addColorStop(0, `rgba(250,225,151,${0.28 * pulse})`);
    aura.addColorStop(0.4, `rgba(229,205,144,${0.09 * pulse})`);
    aura.addColorStop(1, 'rgba(229,205,144,0)');
    ctx.fillStyle = aura;
    ctx.fillRect(0, 0, w, h);
    // 中央微光不是血条；受击仅产生柔和扩散，剧情末尾统一被喧嚣遮住。
    const hitAge = (s.model.ticks - s.model.lastHit) / HZ;
    if (!ended && hitAge < 0.7 && !s.reducedMotion) {
      ctx.strokeStyle = `rgba(241,214,153,${0.25 * (1 - hitAge / 0.7)})`;
      circle(cx, cy, 16 + hitAge * 42);
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = ended ? '#7c8377' : '#f7e7af';
    ctx.shadowColor = '#f7dfa0';
    ctx.shadowBlur = ended ? 8 : 20;
    const core = Math.max(5, Math.min(10, orbit * 0.08));
    ctx.fillRect(-core / 2, -core / 2, core, core);
    ctx.restore();
    ctx.globalAlpha = ended ? 0.28 : 1;
    for (const bubble of s.model.bubbles) {
      const { x, y, radius } = this.project(s, bubble);
      if (surge) {
        ctx.strokeStyle = 'rgba(142,167,187,0.2)';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(bubble.angle) * radius * 1.8, y + Math.sin(bubble.angle) * radius * 1.8);
        ctx.stroke();
      }
      const wash = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, 0, x, y, radius);
      wash.addColorStop(0, '#718997');
      wash.addColorStop(1, '#42596e');
      ctx.fillStyle = wash;
      circle(x, y, radius);
      ctx.fill();
      ctx.strokeStyle = 'rgba(177,198,211,0.44)';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + radius * 0.35, y + radius * 0.8);
      ctx.lineTo(x + radius * 0.72, y + radius * 1.16);
      ctx.lineTo(x + radius * 0.73, y + radius * 0.6);
      ctx.fill();
      ctx.fillStyle = '#d0dce0';
      for (let dot = -1; dot <= 1; dot += 1) {
        circle(x + dot * radius * 0.32, y, Math.max(1.4, radius * 0.075));
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    for (const ripple of s.ripples) {
      const fade = 1 - ripple.age / 0.6;
      ctx.strokeStyle = `rgba(243,225,178,${fade * 0.7})`;
      circle(ripple.x * w, ripple.y * h, s.reducedMotion ? 24 : 18 + ripple.age * 50);
      ctx.stroke();
      if (!s.reducedMotion) {
        for (let i = 0; i < 5; i += 1) {
          const angle = i * Math.PI * 0.4;
          const distance = 15 + ripple.age * 40;
          ctx.fillStyle = `rgba(237,223,180,${fade})`;
          circle(ripple.x * w + Math.cos(angle) * distance, ripple.y * h + Math.sin(angle) * distance, fade * 2);
          ctx.fill();
        }
      }
    }
  }
}
