// ui/startPage.ts —— 合规开始页
// 职责：标题与合规提示、竖屏温和提示、继续 / 开始 / 退出按钮、淡出后通知 core 进入 3D 场景。
// 边界：纯展示，不含剧情逻辑；跨模块通信走 core 事件总线。

import { playUiClick, unlockAudio } from '../audio/audioManager';
import { eventBus } from '../core/eventBus';
import { openCredits } from './credits';
import { installFilmGrain } from './filmGrain';
import './startPage.css';

/** 与 startPage.css 的淡出过渡时长保持一致 */
const FADE_DURATION_MS = 700;

export interface StartPageOptions {
  /** 是否存在可继续的单局章节存档 */
  hasSave?: boolean;
  /** URL 直达场景等调试入口：直接隐藏开始页，由 core 自行启动 */
  autoStart?: boolean;
}

export function initStartPage(options: StartPageOptions = {}): void {
  const startPage = document.querySelector<HTMLElement>('#start-page');
  const continueButton = document.querySelector<HTMLButtonElement>('#btn-continue');
  const startButton = document.querySelector<HTMLButtonElement>('#btn-start');
  const exitButton = document.querySelector<HTMLButtonElement>('#btn-exit');
  const exitScreen = document.querySelector<HTMLElement>('#exit-screen');
  const portraitHint = document.querySelector<HTMLElement>('#portrait-hint');
  const portraitHintClose = document.querySelector<HTMLButtonElement>('#portrait-hint-close');

  if (!startPage || !continueButton || !startButton || !exitButton || !exitScreen) {
    throw new Error('开始页 DOM 结构缺失，请检查 index.html');
  }

  // 颗粒与纸纹变量必须在 ?scene 直达隐藏开始页之前安装
  installFilmGrain();
  document.querySelector<HTMLButtonElement>('#btn-credits')?.addEventListener('click', (event) => {
    event.stopPropagation();
    openCredits(document.querySelector<HTMLButtonElement>('#btn-credits') ?? undefined);
  });

  if (options.autoStart) {
    startPage.hidden = true;
    return;
  }

  // 有存档时突出“继续体验”，开始按钮改为“重新开始”（会清空单局存档）
  if (options.hasSave) {
    continueButton.hidden = false;
    startButton.textContent = '重新开始';
    startButton.classList.remove('btn--primary');
    startButton.classList.add('btn--ghost');
  } else {
    continueButton.hidden = true;
  }

  setupPortraitHint(portraitHint, portraitHintClose);

  let leaving = false;

  const leaveWith = (event: 'game:start' | 'ui:continueGame'): void => {
    if (leaving) return;
    leaving = true;
    // 必须在用户手势回调内解锁音频（iOS Safari 的自动播放限制）
    unlockAudio();
    playUiClick();

    startPage.classList.add('is-leaving');
    window.setTimeout(() => {
      startPage.hidden = true;
      eventBus.emit(event);
    }, FADE_DURATION_MS);
  };

  continueButton.addEventListener('click', () => leaveWith('ui:continueGame'));
  startButton.addEventListener('click', () => leaveWith('game:start'));

  exitButton.addEventListener('click', () => {
    // 浏览器通常只允许关闭由脚本打开的窗口；未关闭时展示收尾画面
    window.close();
    window.setTimeout(() => {
      startPage.hidden = true;
      exitScreen.hidden = false;
    }, 150);
  });
}

/** 手机竖屏时显示可关闭的温和提示；关闭后本次会话不再出现 */
function setupPortraitHint(hint: HTMLElement | null, closeButton: HTMLButtonElement | null): void {
  if (!hint || !closeButton) return;

  const media = window.matchMedia('(orientation: portrait) and (pointer: coarse)');
  let dismissed = false;

  const update = (): void => {
    hint.hidden = dismissed || !media.matches;
  };

  media.addEventListener('change', update);
  closeButton.addEventListener('click', () => {
    dismissed = true;
    update();
  });
  update();
}
