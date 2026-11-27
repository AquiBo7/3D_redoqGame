// ui/momentView.ts —— 叙事演出浮层（开场电视早间新闻 + 五种结局张力手法）
// 纯展示层：只消费 core 的 ui:showMoment 事件，结束后通过回调回发 ui:momentEnd。
// 严禁 import three；hide / dispose / 替换均视为取消，绝不触发旧步骤回调。

import type { GameEvents } from '../core/eventBus';
import { renderAssetImage } from './assetImage';
import { createButton, createElement, isShortcutKey } from './uiDom';
import './momentView.css';

export type MomentPayload = GameEvents['ui:showMoment'];
export type MomentOutcome = 'completed' | 'interrupted';

const DEFAULT_NEWS_LINES = [
  '……近日，多所学校提醒学生：转发未经核实的内容，同样可能伤害他人。',
  '某学生因一张被断章取义的照片，被围攻数日，最终关闭了账号，也不再出门。',
  '教育部门同时呼吁：面对网络争议多些宽容与理性核实，不做跟风伤害的推手，共同拒绝网络暴力。',
];

const DEFAULT_HESITATION_LINES = [
  '她从速写本上轻轻撕下一页纸，指尖停在纸边。',
  '她看了一眼桌面，又把纸轻轻放回本子里。',
  '安静了一会儿，她还是重新把那张纸拿了起来。',
];

/** 最差结局概括式通知文案池（严禁具体辱骂词、真实平台名或自伤词） */
const WORST_NOTIFICATIONS: ReadonlyArray<{
  source: string;
  text: string;
  tone: 'group' | 'wall' | 'dm' | 'system';
}> = [
  { source: '班群', text: '有人转发了一张新的对话截图', tone: 'group' },
  { source: '校园墙', text: '有新的跟评提到了你', tone: 'wall' },
  { source: '私信', text: '陌生账号：刚才那段对话是真的吗？', tone: 'dm' },
  { source: '迎新群', text: '未读消息持续增加，讨论仍在继续', tone: 'group' },
  { source: '校园见闻', text: '搬运帖的转发数正在上升', tone: 'wall' },
  { source: '班群', text: '又有人截下了刚才的聊天记录', tone: 'group' },
  { source: '校园墙', text: '你所在的楼层多了十几条新回复', tone: 'wall' },
  { source: '私信', text: '陌生账号：发帖的人是不是他？', tone: 'dm' },
  { source: '群提醒', text: '那张截图又被转进了别的群', tone: 'group' },
  { source: '校园墙', text: '新的话题正在快速扩散', tone: 'wall' },
  { source: '班群 · 99+', text: '有人把两个人的名字并排放在了一起', tone: 'group' },
  { source: '系统提醒', text: '有 37 条新回复与转发等待查看', tone: 'system' },
  { source: '校园墙 · 热议', text: '匿名帖热度持续攀升，新增 120+ 条讨论', tone: 'wall' },
  { source: '私信', text: '陌生账号：你当时在现场吗？怎么不说清楚', tone: 'dm' },
  { source: '迎新群 · @你', text: '有人在群里 @ 了你，要求出来解释', tone: 'group' },
  { source: '校园见闻', text: '有人把截图做了局部放大并重新配文', tone: 'wall' },
  { source: '隔壁班群', text: '刚刚那张图已经传到年级大群了', tone: 'group' },
  { source: '系统提醒', text: '短时间内收到 89 条点赞与转发通知', tone: 'system' },
  { source: '匿名投稿', text: '话题浏览量正在快速上涨，评论不断刷新', tone: 'wall' },
  { source: '私信请求', text: '多个陌生账号请求添加好友并附带留言', tone: 'dm' },
  { source: '班群 · 99+', text: '有人翻出了更早之前的旧发言截图', tone: 'group' },
  { source: '校园墙', text: '搬运合集已出现第三条关联帖子', tone: 'wall' },
  { source: '群提醒', text: '五个群聊几乎同时出现了同一张截图', tone: 'group' },
  { source: '系统提醒', text: '有 99+ 条未读互动消息等待处理', tone: 'system' },
  { source: '校园墙', text: '新回复：事情到底是怎么回事？', tone: 'wall' },
  { source: '私信', text: '陌生账号：大家都在转，你还没看到吗？', tone: 'dm' },
  { source: '匿名楼层', text: '讨论仍在发酵，新的猜测接连涌入', tone: 'wall' },
  { source: '系统提醒', text: '通知频率过高，消息列表持续刷新中', tone: 'system' },
];

/** 约 7 秒（~7000ms）内逐步加速堆积 56 条全屏弹窗，节奏由慢转急 */
const WORST_FLOOD_COUNT = 56;
const WORST_INTERVALS_MS: readonly number[] = Array.from({ length: WORST_FLOOD_COUNT }, (_, i) => {
  const t = i / (WORST_FLOOD_COUNT - 1);
  // 前缓后急：从 ~395ms 指数压缩至 ~36ms，含起手 160ms 总堆积约 7.0 秒
  return Math.max(36, Math.round(395 * Math.pow(0.068, Math.pow(t, 0.84))));
});

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function formatNumber(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString('en-US');
}

export class MomentView {
  private readonly root: HTMLElement;
  private readonly doc: Document;
  private readonly onEnd: (stepId: string, outcome: MomentOutcome) => void;
  private readonly onMessagePop?: (intensity: number) => void;

  private session: { stepId: string; moment: MomentPayload['moment'] } | null = null;
  private previousFocus: HTMLElement | null = null;
  private timers = new Set<number>();
  private frames = new Set<number>();
  private cleanupActive: (() => void) | null = null;
  private disposed = false;

  constructor(
    container: HTMLElement,
    onEnd: (stepId: string, outcome: MomentOutcome) => void,
    onMessagePop?: (intensity: number) => void,
  ) {
    this.doc = container.ownerDocument;
    this.onEnd = onEnd;
    this.onMessagePop = onMessagePop;
    this.root = this.doc.createElement('section');
    this.root.className = 'moment';
    this.root.hidden = true;
    this.root.tabIndex = -1;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', '剧情演出');
    container.append(this.root);
  }

  show(payload: MomentPayload): void {
    if (this.disposed) return;
    const previous = this.session ? this.previousFocus : (this.doc.activeElement as HTMLElement | null);
    this.hide();
    this.previousFocus = previous;

    const session = { stepId: payload.stepId, moment: payload.moment };
    this.session = session;
    this.root.className = `moment moment--${payload.moment}`;
    this.root.dataset.moment = payload.moment;
    this.root.hidden = false;

    switch (payload.moment) {
      case 'opening-news':
        this.renderOpeningNews(session, payload.lines?.length ? payload.lines : DEFAULT_NEWS_LINES);
        break;
      case 'best-hesitation':
        this.renderBestHesitation(session, payload.lines?.length ? payload.lines : DEFAULT_HESITATION_LINES);
        break;
      case 'middle-pause':
        this.renderMiddlePause(session, payload.lines?.[0] ?? '……没事。');
        break;
      case 'worst-flood':
        this.renderWorstFlood(session, payload.lines?.[0] ?? '话题换了一个名字，围观并没有停下。');
        break;
      case 'bystander-cursor':
        this.renderBystanderCursor(session, payload.lines?.[0] ?? '你什么都没做。');
        break;
      case 'joined-rewind':
        this.renderJoinedRewind(session, payload.lines?.[0] ?? '那天我俩都迟到，被拍惨了哈哈。');
        break;
    }
  }

  hide(): void {
    const wasActive = this.session !== null;
    const ownsFocus = this.root.contains(this.doc.activeElement);
    this.session = null;
    this.clearTimers();
    this.cleanupActive?.();
    this.cleanupActive = null;
    for (const img of this.root.querySelectorAll('img')) img.onerror = null;
    this.root.replaceChildren();
    this.root.hidden = true;
    this.root.className = 'moment';
    delete this.root.dataset.moment;
    const previous = this.previousFocus;
    this.previousFocus = null;
    if (wasActive && ownsFocus && previous?.isConnected) previous.focus?.();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.hide();
    this.root.remove();
  }

  private schedule(ms: number, callback: () => void): void {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      callback();
    }, ms);
    this.timers.add(id);
  }

  private animateValue(
    from: number,
    to: number,
    durationMs: number,
    onUpdate: (value: number) => void,
  ): void {
    if (prefersReducedMotion() || typeof window.requestAnimationFrame !== 'function' || durationMs <= 0) {
      onUpdate(to);
      return;
    }
    const start = performance.now();
    const step = (now: number): void => {
      const progress = Math.min(1, Math.max(0, (now - start) / durationMs));
      const eased = 1 - Math.pow(1 - progress, 3);
      onUpdate(from + (to - from) * eased);
      if (progress < 1) {
        const frameId = window.requestAnimationFrame(step);
        this.frames.add(frameId);
      }
    };
    const initial = window.requestAnimationFrame(step);
    this.frames.add(initial);
  }

  private clearTimers(): void {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
    if (typeof window.cancelAnimationFrame === 'function') {
      for (const frame of this.frames) window.cancelAnimationFrame(frame);
    }
    this.frames.clear();
  }

  private finish(session: { stepId: string }, outcome: MomentOutcome): void {
    if (this.disposed || this.session !== session) return;
    this.hide();
    this.onEnd(session.stepId, outcome);
  }

  /** 追加 A：旅馆电视早间新闻（支持自动轮播，也支持右下角「下一条」手动翻页与随时关闭） */
  private renderOpeningNews(session: { stepId: string }, lines: string[]): void {
    this.root.setAttribute('aria-label', '旅馆电视早间新闻');
    const total = Math.max(1, lines.length);
    const card = createElement('div', 'moment-news');

    const bar = createElement('div', 'moment-news__bar');
    const badge = createElement('span', 'moment-news__badge');
    const dot = createElement('span', 'moment-news__dot');
    dot.setAttribute('aria-hidden', 'true');
    badge.append(dot, createElement('span', 'moment-news__channel', '早间新闻 · 旅馆电视'));
    const close = createButton('moment-news__close', '关闭电视');
    close.setAttribute('data-moment-action', 'close');
    bar.append(badge, close);

    const screen = createElement('div', 'moment-news__screen');
    const anchor = createElement('p', 'moment-news__tag', '校园提醒 · 早间播报');
    const ticker = createElement('p', 'moment-news__subtitle', lines[0] ?? '');
    ticker.setAttribute('aria-live', 'polite');
    screen.append(anchor, ticker);

    const footer = createElement('div', 'moment-news__footer');
    const progress = createElement('div', 'moment-news__progress');
    const dots = createElement('span', 'moment-news__dots');
    dots.setAttribute('aria-hidden', 'true');
    const dotNodes = Array.from({ length: total }, (_, index) => {
      const node = createElement('span', `moment-news__dot-item${index === 0 ? ' is-active' : ''}`);
      dots.append(node);
      return node;
    });
    const counter = createElement('span', 'moment-news__counter', `第 1 / ${total} 条`);
    progress.append(dots, counter);

    const nextBtn = createButton('moment-news__next', total > 1 ? '下一条' : '结束播报');
    nextBtn.setAttribute('data-moment-action', 'next');
    footer.append(progress, nextBtn);

    card.append(bar, screen, footer);
    this.root.append(card);

    let currentIndex = 0;
    let manualMode = false;
    const durations = [3800, 4200, 4500];

    const renderIndex = (index: number): void => {
      currentIndex = index;
      ticker.textContent = lines[index] ?? '';
      counter.textContent = `第 ${index + 1} / ${total} 条`;
      dotNodes.forEach((node, i) => node.classList.toggle('is-active', i === index));
      nextBtn.textContent = index >= total - 1 ? '结束播报' : '下一条';
    };

    const scheduleAutoStep = (): void => {
      this.clearTimers();
      if (manualMode) return;
      const waitMs = durations[currentIndex] ?? 4200;
      this.schedule(waitMs, () => {
        if (this.session !== session || manualMode) return;
        if (currentIndex < total - 1) {
          renderIndex(currentIndex + 1);
          scheduleAutoStep();
        } else {
          this.finish(session, 'completed');
        }
      });
    };

    const onClose = (): void => this.finish(session, 'completed');
    const onNext = (): void => {
      if (this.session !== session) return;
      // 玩家主动点击翻页后取消自动关闭倒计时，将阅读节奏与关闭权交还给玩家
      manualMode = true;
      this.clearTimers();
      if (currentIndex < total - 1) {
        renderIndex(currentIndex + 1);
      } else {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (this.session !== session) return;
      if (!isShortcutKey(event, 'Escape')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };

    close.addEventListener('click', onClose);
    nextBtn.addEventListener('click', onNext);
    window.addEventListener('keydown', onKeyDown, true);
    this.cleanupActive = () => {
      close.removeEventListener('click', onClose);
      nextBtn.removeEventListener('click', onNext);
      window.removeEventListener('keydown', onKeyDown, true);
    };

    scheduleAutoStep();
    nextBtn.focus();
  }

  /** 追加 D - 最好结局：送画前林夏犹豫三次，等待完成送画；急着点击/追问则收回 */
  private renderBestHesitation(session: { stepId: string }, lines: string[]): void {
    this.root.setAttribute('aria-label', '她似乎在犹豫');
    const stage = createElement('div', 'moment-hesitation');
    const beat = createElement('p', 'moment-hesitation__text', lines[0] ?? '');
    beat.setAttribute('aria-live', 'polite');
    const dots = createElement('div', 'moment-hesitation__dots');
    dots.setAttribute('aria-hidden', 'true');
    const dotNodes = [0, 1, 2].map((index) => {
      const node = createElement('span', `moment-hesitation__dot${index === 0 ? ' is-active' : ''}`);
      dots.append(node);
      return node;
    });
    const ask = createButton('moment-hesitation__ask', '……怎么了？要给我看吗？');
    ask.setAttribute('data-moment-action', 'interrupt');
    stage.append(dots, beat, ask);
    this.root.append(stage);

    // 防误触窗口：避免上一句对话点击尾音直接打断犹豫。
    const guardUntil = performance.now() + 350;
    const interrupt = (bypassGuard = false): void => {
      if (this.session !== session) return;
      if (!bypassGuard && performance.now() < guardUntil) return;
      this.finish(session, 'interrupted');
    };
    const onRootClick = (event: Event): void => {
      if (event.target === ask) return;
      interrupt(false);
    };
    const onAskClick = (event: Event): void => {
      event.stopPropagation();
      interrupt(true);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (this.session !== session) return;
      if (!['Space', 'Enter'].some((code) => isShortcutKey(event, code))) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) interrupt(false);
    };

    this.root.addEventListener('click', onRootClick);
    ask.addEventListener('click', onAskClick);
    window.addEventListener('keydown', onKeyDown, true);
    this.cleanupActive = () => {
      this.root.removeEventListener('click', onRootClick);
      ask.removeEventListener('click', onAskClick);
      window.removeEventListener('keydown', onKeyDown, true);
    };

    const stepMs = 2400;
    for (let index = 1; index < 3; index += 1) {
      this.schedule(stepMs * index, () => {
        if (this.session !== session) return;
        beat.textContent = lines[index] ?? lines[lines.length - 1] ?? '';
        dotNodes.forEach((node, i) => node.classList.toggle('is-active', i <= index));
      });
    }
    this.schedule(stepMs * 3, () => this.finish(session, 'completed'));
    this.root.focus();
  }

  /** 追加 D - 中间结局：“……没事。”画面静静停三秒，再进入速写本 CG */
  private renderMiddlePause(session: { stepId: string }, echoLine: string): void {
    this.root.setAttribute('aria-label', '静默的三秒');
    const card = createElement('div', 'moment-pause');
    const text = createElement('p', 'moment-pause__line', echoLine);
    text.setAttribute('aria-live', 'polite');
    card.append(text);
    this.root.append(card);

    const onKeyDown = (event: KeyboardEvent): void => {
      if (this.session !== session) return;
      if (!['Space', 'Enter', 'Escape'].some((code) => isShortcutKey(event, code))) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKeyDown, true);
    this.cleanupActive = () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };

    this.schedule(3000, () => this.finish(session, 'completed'));
    this.root.focus();
  }

  /** 追加 D - 最差结局：手机通知越来越密、暗角逐渐收紧，最后同时熄灭只剩一行字幕 */
  private renderWorstFlood(session: { stepId: string }, finalLine: string): void {
    this.root.setAttribute('aria-label', '通知不断涌来');
    const vignette = createElement('div', 'moment-flood__vignette');
    vignette.setAttribute('aria-hidden', 'true');
    const feed = createElement('div', 'moment-flood__feed');
    const finalWrap = createElement('div', 'moment-flood__final');
    finalWrap.hidden = true;
    const finalText = createElement('p', 'moment-flood__subtitle', finalLine);
    finalText.setAttribute('aria-live', 'polite');
    finalWrap.append(finalText);
    this.root.append(vignette, feed, finalWrap);

    let canContinue = false;
    const finishIfReady = (): void => {
      if (canContinue) this.finish(session, 'completed');
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (this.session !== session) return;
      if (!['Space', 'Enter', 'Escape'].some((code) => isShortcutKey(event, code))) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) finishIfReady();
    };
    this.root.addEventListener('click', finishIfReady);
    window.addEventListener('keydown', onKeyDown, true);
    this.cleanupActive = () => {
      this.root.removeEventListener('click', finishIfReady);
      window.removeEventListener('keydown', onKeyDown, true);
    };

    // 使用低差异黄金角散点 + 轻量随机扰动，让弹窗先落满屏幕各处，随后层叠无规则堆积
    const seed = Math.floor(Math.random() * 1000);
    let elapsed = 160;
    for (let index = 0; index < WORST_FLOOD_COUNT; index += 1) {
      const item = WORST_NOTIFICATIONS[(index + (index >= WORST_NOTIFICATIONS.length ? seed % 7 : 0)) % WORST_NOTIFICATIONS.length];
      const scheduledAt = elapsed;
      this.schedule(scheduledAt, () => {
        if (this.session !== session) return;
        const tighten = (index + 1) / WORST_FLOOD_COUNT;
        const card = createElement('article', `moment-flood__toast moment-flood__toast--${item.tone}`);
        const head = createElement('div', 'moment-flood__head');
        head.append(
          createElement('span', 'moment-flood__source', item.source),
          createElement('span', 'moment-flood__time', index > 32 ? '刚刚' : `${Math.max(1, Math.round((1 - tighten) * 5))}秒前`),
        );
        card.append(head, createElement('span', 'moment-flood__text', item.text));

        // 使用二维 R2 低差异序列（塑胶常数倒数，X/Y 独立无对角关联）+ 随机扰动，覆盖全屏四角与中央并无规则堆叠
        const h1 = (((index + 1) * 0.7548776662 + seed * 0.137) % 1 + 1) % 1;
        const h2 = (((index + 1) * 0.569840291 + seed * 0.293) % 1 + 1) % 1;
        const jitterX = (Math.random() - 0.5) * 14;
        const jitterY = (Math.random() - 0.5) * 12;
        const leftPct = Math.max(2, Math.min(96, 4 + h1 * 90 + jitterX));
        const topPct = Math.max(4, Math.min(90, 5 + h2 * 82 + jitterY));
        const tiltDeg = ((index % 2 === 0 ? 1 : -1) * (0.8 + ((index * 17 + seed) % 38) / 10)).toFixed(2);
        card.style.left = `clamp(10px, calc(${leftPct.toFixed(1)}% - 155px), calc(100vw - 320px))`;
        card.style.top = `clamp(14px, calc(${topPct.toFixed(1)}% - 38px), calc(100vh - 118px))`;
        card.style.zIndex = String(index + 1);
        card.style.setProperty('--toast-rot', `${tiltDeg}deg`);

        feed.append(card);
        vignette.style.opacity = String(0.24 + tighten * 0.76);
        vignette.style.setProperty('--moment-tighten', String(tighten));
        if (tighten >= 0.48) this.root.classList.add('is-pressured');
        this.onMessagePop?.(0.22 + tighten * 0.78);
      });
      elapsed += WORST_INTERVALS_MS[index] ?? 40;
    }

    // 所有通知同一瞬间全部熄灭
    const extinguishAt = elapsed + 650;
    this.schedule(extinguishAt, () => {
      if (this.session !== session) return;
      feed.replaceChildren();
      this.root.classList.remove('is-pressured');
      this.root.classList.add('is-extinguished');
    });

    // 沉寂后只剩唯一一行字幕
    const subtitleAt = extinguishAt + 650;
    this.schedule(subtitleAt, () => {
      if (this.session !== session) return;
      finalWrap.hidden = false;
      canContinue = true;
    });

    this.schedule(subtitleAt + 2600, () => this.finish(session, 'completed'));
    this.root.focus();
  }

  /** 追加 D - 旁观结局：旧帖评论框光标闪烁，无论输入或退出，字幕都是“你什么都没做。”光标一直闪到最后 */
  private renderBystanderCursor(session: { stepId: string }, resultLine: string): void {
    this.root.setAttribute('aria-label', '沉底的旧帖');
    const wrap = createElement('div', 'moment-bystander');
    const card = createElement('div', 'moment-bystander__card');
    card.append(
      createElement('p', 'moment-bystander__meta', '校园墙 · 一个月前'),
      createElement('h3', 'moment-bystander__title', '新生报到名场面'),
      createElement('p', 'moment-bystander__body', '这条帖子早就沉了下去，最后一条评论停在几周前。'),
    );

    const composer = createElement('div', 'moment-bystander__composer');
    const input = createElement('p', 'moment-bystander__input', '写点什么……');
    input.setAttribute('aria-label', '旧帖评论框');
    const cursor = createElement('span', 'moment-bystander__cursor');
    cursor.setAttribute('aria-hidden', 'true');
    composer.append(input, cursor);

    const actions = createElement('div', 'moment-bystander__actions');
    const submitBtn = createButton('moment-bystander__btn moment-bystander__btn--primary', '发送');
    submitBtn.setAttribute('data-bystander-action', 'submit');
    const exitBtn = createButton('moment-bystander__btn', '退出');
    exitBtn.setAttribute('data-bystander-action', 'exit');
    actions.append(submitBtn, exitBtn);
    card.append(composer, actions);

    const verdict = createElement('div', 'moment-bystander__verdict');
    verdict.hidden = true;
    const verdictText = createElement('p', 'moment-bystander__subtitle', resultLine);
    verdictText.setAttribute('aria-live', 'polite');
    const continueBtn = createButton('moment-bystander__continue', '继续');
    continueBtn.setAttribute('data-bystander-action', 'continue');
    verdict.append(verdictText, continueBtn);

    wrap.append(card, verdict);
    this.root.append(wrap);

    let resolved = false;
    const resolveChoice = (): void => {
      if (this.session !== session || resolved) return;
      resolved = true;
      // 无论点发送还是退出，都不允许真实编辑输入，光标始终继续闪烁到最后。
      input.textContent = '';
      input.classList.add('is-resolved');
      submitBtn.disabled = true;
      exitBtn.disabled = true;
      card.classList.add('is-dimmed');
      verdict.hidden = false;
      continueBtn.focus();
      this.schedule(3200, () => this.finish(session, 'completed'));
    };

    const onSubmit = (): void => resolveChoice();
    const onExit = (): void => resolveChoice();
    const onContinue = (): void => this.finish(session, 'completed');
    const onKeyDown = (event: KeyboardEvent): void => {
      if (this.session !== session) return;
      if (!resolved) {
        if (event.key === 'Enter' || event.key === 'Escape') {
          event.preventDefault();
          event.stopImmediatePropagation();
          resolveChoice();
        }
        return;
      }
      if (['Space', 'Enter', 'Escape'].some((code) => isShortcutKey(event, code))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) this.finish(session, 'completed');
      }
    };

    submitBtn.addEventListener('click', onSubmit);
    exitBtn.addEventListener('click', onExit);
    continueBtn.addEventListener('click', onContinue);
    window.addEventListener('keydown', onKeyDown, true);
    this.cleanupActive = () => {
      submitBtn.removeEventListener('click', onSubmit);
      exitBtn.removeEventListener('click', onExit);
      continueBtn.removeEventListener('click', onContinue);
      window.removeEventListener('keydown', onKeyDown, true);
    };
    submitBtn.focus();
  }

  /** 追加 D - 参与者结局：黑幕浏览数上滚 → 林夏座位 → 回到发玩笑时刻 → 归零再滚一遍 */
  private renderJoinedRewind(session: { stepId: string }, jokeText: string): void {
    this.root.setAttribute('aria-label', '浏览数回放');
    const stage = createElement('div', 'moment-rewind');

    const counterBlock = createElement('div', 'moment-rewind__counter');
    const counterLabel = createElement('p', 'moment-rewind__label', '校园墙 · 浏览');
    const counterValue = createElement('p', 'moment-rewind__number', formatNumber(4820));
    counterValue.setAttribute('aria-live', 'polite');
    counterBlock.append(counterLabel, counterValue);

    const seatBlock = createElement('figure', 'moment-rewind__seat');
    seatBlock.hidden = true;
    const seatImage = renderAssetImage('cg_ending_bystander_seat', seatBlock);
    seatImage.draggable = false;
    seatBlock.append(createElement('figcaption', 'moment-rewind__caption', '教室最后一排，座位空着。'));

    const jokeBlock = createElement('div', 'moment-rewind__joke');
    jokeBlock.hidden = true;
    jokeBlock.append(
      createElement('p', 'moment-rewind__label', '你发出的那条评论'),
      createElement('blockquote', 'moment-rewind__quote', `“${jokeText}”`),
    );

    const skip = createButton('moment-rewind__skip', '跳过');
    skip.setAttribute('data-moment-action', 'skip');

    stage.append(counterBlock, seatBlock, jokeBlock);
    this.root.append(stage, skip);

    const onSkip = (): void => this.finish(session, 'completed');
    const onKeyDown = (event: KeyboardEvent): void => {
      if (this.session !== session) return;
      if (!isShortcutKey(event, 'Escape')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onSkip();
    };
    skip.addEventListener('click', onSkip);
    window.addEventListener('keydown', onKeyDown, true);
    this.cleanupActive = () => {
      skip.removeEventListener('click', onSkip);
      window.removeEventListener('keydown', onKeyDown, true);
    };

    // 阶段 1：黑幕上浏览数往上滚（4,820 -> 128,400）
    this.root.dataset.phase = 'roll-1';
    this.animateValue(4820, 128400, 1900, (value) => {
      if (this.session === session) counterValue.textContent = formatNumber(value);
    });

    // 阶段 2：切到林夏座位的画面
    this.schedule(2200, () => {
      if (this.session !== session) return;
      this.root.dataset.phase = 'seat';
      counterBlock.hidden = true;
      seatBlock.hidden = false;
    });

    // 阶段 3：回到你发那条玩笑的时刻，数字归零
    this.schedule(4200, () => {
      if (this.session !== session) return;
      this.root.dataset.phase = 'joke-zero';
      seatBlock.hidden = true;
      jokeBlock.hidden = false;
      counterBlock.hidden = false;
      counterValue.textContent = '0';
    });

    // 阶段 4：数字归零后再滚一遍（0 -> 128,400）
    this.schedule(6200, () => {
      if (this.session !== session) return;
      this.root.dataset.phase = 'roll-2';
      jokeBlock.hidden = true;
      this.animateValue(0, 128400, 2100, (value) => {
        if (this.session === session) counterValue.textContent = formatNumber(value);
      });
    });

    this.schedule(8800, () => this.finish(session, 'completed'));
    skip.focus();
  }
}
