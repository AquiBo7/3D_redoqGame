import { playUiClick, unlockAudio } from '../audio/audioManager';
import { eventBus } from '../core/eventBus';
import { CHAPTER_PRESETS } from '../data/chapterPresets';
import { openCredits } from './credits';
import { installFilmGrain } from './filmGrain';
import { showControlsGuide } from './controlsGuide';
import './startPage.css';

const FADE_DURATION_MS = 700;

export interface StartPageOptions {
  hasSave?: boolean;
  autoStart?: boolean;
}

export function initStartPage(options: StartPageOptions = {}): () => void {
  const startPage = document.querySelector<HTMLElement>('#start-page');
  const continueButton = document.querySelector<HTMLButtonElement>('#btn-continue');
  const startButton = document.querySelector<HTMLButtonElement>('#btn-start');
  const exitButton = document.querySelector<HTMLButtonElement>('#btn-exit');
  const exitScreen = document.querySelector<HTMLElement>('#exit-screen');
  if (!startPage || !continueButton || !startButton || !exitButton || !exitScreen) {
    throw new Error('开始页 DOM 结构缺失，请检查 index.html');
  }

  installFilmGrain();
  const controller = new AbortController();
  const listenOptions = { signal: controller.signal };
  document.querySelector<HTMLButtonElement>('#btn-credits')?.addEventListener('click', () => {
    openCredits(document.querySelector<HTMLButtonElement>('#btn-credits') ?? undefined);
  }, listenOptions);
  document.querySelector<HTMLButtonElement>('#btn-achievements')?.addEventListener('click', () => eventBus.emit('ui:openAchievements'), listenOptions);
  document.querySelector<HTMLButtonElement>('#btn-chapters')?.addEventListener('click', () => eventBus.emit('ui:openChapters'), listenOptions);

  const chapters = document.createElement('section');
  chapters.className = 'chapter-select';
  chapters.hidden = true;
  chapters.setAttribute('role', 'dialog');
  chapters.setAttribute('aria-modal', 'true');
  chapters.setAttribute('aria-label', '章节选择');
  const card = document.createElement('div');
  card.className = 'chapter-select__card';
  const title = document.createElement('h2');
  title.textContent = '从这里，重新看见';
  const note = document.createElement('p');
  note.textContent = '第一至四章会以说明中的预设开启新一局并覆盖当前进度，成就保留。第五章仅预览，不覆盖进度。定向回档请使用结局页的“再试一次”。';
  const close = document.createElement('button');
  close.className = 'btn btn--ghost';
  close.textContent = '返回';
  close.type = 'button';
  card.append(title, note);
  chapters.append(card);
  (document.querySelector('#ui-root') ?? document.body).append(chapters);

  let previousFocus: HTMLElement | null = null;
  let leaving = false;
  let generation = 0;
  let fadeTimer = 0;
  const closeChapters = (): void => {
    chapters.hidden = true;
    if (previousFocus?.isConnected) previousFocus.focus();
  };
  close.addEventListener('click', closeChapters, listenOptions);

  const leaveWith = (action: () => void): void => {
    if (leaving) return;
    leaving = true;
    const token = ++generation;
    unlockAudio();
    playUiClick();
    chapters.hidden = true;
    startPage.classList.add('is-leaving');
    fadeTimer = window.setTimeout(() => {
      startPage.hidden = true;
      void showControlsGuide().then(() => {
        if (token !== generation) return;
        leaving = false;
        action();
      });
    }, startPage.hidden ? 0 : FADE_DURATION_MS);
  };
  const chapterNumerals = ['壹', '贰', '叁', '肆', '伍'];
  for (const [index, preset] of CHAPTER_PRESETS.entries()) {
    const button = document.createElement('button');
    button.className = 'chapter-select__item';
    button.type = 'button';
    button.dataset.chapterId = preset.id;
    const numeral = document.createElement('span');
    numeral.className = 'chapter-select__num';
    numeral.setAttribute('aria-hidden', 'true');
    numeral.textContent = chapterNumerals[index] ?? String(index + 1);
    const heading = document.createElement('strong');
    heading.textContent = preset.title;
    const description = document.createElement('span');
    description.textContent = preset.description;
    button.append(numeral, heading, description);
    button.addEventListener('click', () => leaveWith(() => eventBus.emit('ui:selectChapter', { chapterId: preset.id })), listenOptions);
    card.append(button);
  }
  card.append(close);
  chapters.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeChapters();
    }
    if (event.key !== 'Tab') return;
    const buttons = Array.from(card.querySelectorAll<HTMLButtonElement>('button'));
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }, listenOptions);

  const chapterStrip = startPage.querySelector<HTMLElement>('#start-chapters-strip');
  if (chapterStrip) {
    chapterStrip.replaceChildren();
    CHAPTER_PRESETS.forEach((preset, index) => {
      const pill = document.createElement('span');
      pill.className = 'start-page__chapter-pill';
      const num = document.createElement('strong');
      num.textContent = String(index + 1).padStart(2, '0');
      const label = document.createElement('span');
      label.textContent = preset.title.replace(/^第[一二三四五]章\s*·\s*/, '');
      pill.append(num, label);
      chapterStrip.append(pill);
    });
  }

  const updateSaveButton = (hasSave: boolean): void => {
    continueButton.hidden = !hasSave;
    continueButton.classList.toggle('btn--diamond', hasSave);
    startButton.textContent = hasSave ? '重新开始' : '开始体验';
    startButton.classList.toggle('btn--primary', !hasSave);
    startButton.classList.toggle('btn--diamond', !hasSave);
    startButton.classList.toggle('btn--ghost', hasSave);
    startButton.classList.toggle('btn--link', hasSave);
    const archiveLine = startPage.querySelector<HTMLElement>('#start-archive-line');
    if (archiveLine) {
      archiveLine.textContent = hasSave
        ? '已保存上次行迹 · 点击「继续体验」接着游玩，或随时切换章节'
        : '清晨 08:47 · 看见完整的那一天 · 点击开始后启用背景音乐';
    }
  };
  updateSaveButton(options.hasSave ?? false);
  startPage.hidden = options.autoStart ?? false;

  // 桌面端鼠标轻度视差驱动左侧“悬浮短信取景框”立体漂浮感（仅细指针且非减少动态偏好时启用）
  const hero = startPage.querySelector<HTMLElement>('.start-hero');
  let rafParallax = 0;
  let targetX = 0;
  let targetY = 0;
  const allowParallax = hero !== null
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: fine)').matches
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (allowParallax) {
    startPage.addEventListener('pointermove', (event) => {
      if (startPage.hidden || leaving) return;
      targetX = Math.max(-1, Math.min(1, (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1));
      targetY = Math.max(-1, Math.min(1, (event.clientY / Math.max(1, window.innerHeight)) * 2 - 1));
      if (rafParallax !== 0) return;
      rafParallax = window.requestAnimationFrame(() => {
        rafParallax = 0;
        hero?.style.setProperty('--px', targetX.toFixed(3));
        hero?.style.setProperty('--py', targetY.toFixed(3));
      });
    }, listenOptions);
    startPage.addEventListener('pointerleave', () => {
      hero?.style.setProperty('--px', '0');
      hero?.style.setProperty('--py', '0');
    }, listenOptions);
  }
  const unsubscribers = [
    eventBus.on('ui:openChapters', () => {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      chapters.hidden = false;
      card.querySelector<HTMLButtonElement>('button')?.focus();
    }),
    eventBus.on('scene:transition', () => {
      startPage.hidden = true;
      chapters.hidden = true;
    }),
    eventBus.on('game:title', ({ hasSave }) => {
      generation += 1;
      window.clearTimeout(fadeTimer);
      leaving = false;
      chapters.hidden = true;
      exitScreen.hidden = true;
      startPage.hidden = false;
      startPage.classList.remove('is-leaving');
      updateSaveButton(hasSave);
      (hasSave ? continueButton : startButton).focus();
    }),
  ];
  continueButton.addEventListener('click', () => leaveWith(() => eventBus.emit('ui:continueGame')), listenOptions);
  startButton.addEventListener('click', () => leaveWith(() => eventBus.emit('game:start')), listenOptions);
  exitButton.addEventListener('click', () => {
    startPage.hidden = true;
    exitScreen.hidden = false;
  }, listenOptions);

  const portraitHint = document.querySelector<HTMLElement>('#portrait-hint');
  const media = window.matchMedia('(orientation: portrait) and (pointer: coarse)');
  let dismissed = false;
  const updateHint = (): void => { if (portraitHint) portraitHint.hidden = dismissed || !media.matches; };
  media.addEventListener('change', updateHint);
  document.querySelector('#portrait-hint-close')?.addEventListener('click', () => { dismissed = true; updateHint(); }, listenOptions);
  updateHint();
  return () => {
    generation += 1;
    window.clearTimeout(fadeTimer);
    if (rafParallax !== 0) window.cancelAnimationFrame(rafParallax);
    controller.abort();
    for (const unsubscribe of unsubscribers) unsubscribe();
    media.removeEventListener('change', updateHint);
    chapters.remove();
  };
}
