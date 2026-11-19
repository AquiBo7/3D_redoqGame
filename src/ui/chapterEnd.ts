// ui/chapterEnd.ts —— 章节结尾占位画面
// 职责：订阅 game:chapterEnd，展示“第二章 敬请期待”，保证 S9 结尾不会出现无反馈的卡死感。
// 边界：纯展示，不含剧情逻辑；跨模块通信走 core 事件总线。

import { playUiClick } from '../audio/audioManager';
import { eventBus } from '../core/eventBus';
import { createCreditsLink } from './credits';
import './chapterEnd.css';

export function initChapterEnd(): () => void {
  const host = document.querySelector<HTMLElement>('#ui-root') ?? document.body;

  const overlay = document.createElement('section');
  overlay.className = 'chapter-end';
  overlay.hidden = true;
  overlay.setAttribute('aria-live', 'polite');

  const card = document.createElement('div');
  card.className = 'chapter-end__card';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'chapter-end__eyebrow';
  eyebrow.textContent = '第一章 到校段结束';

  const title = document.createElement('h2');
  title.className = 'chapter-end__title';
  title.textContent = '第二章 敬请期待';

  const note = document.createElement('p');
  note.className = 'chapter-end__note';
  note.textContent = '感谢体验本次试玩版本。';

  const restart = document.createElement('button');
  restart.className = 'chapter-end__restart';
  restart.type = 'button';
  restart.textContent = '重新体验第一章';
  restart.addEventListener('click', () => {
    playUiClick();
    overlay.hidden = true;
    eventBus.emit('game:start');
  });

  const credits = createCreditsLink('chapter-end__credits');
  credits.style.marginTop = '6px';

  card.append(eyebrow, title, note, restart, credits);
  overlay.append(card);
  host.append(overlay);

  const unsubscribeEnd = eventBus.on('game:chapterEnd', () => {
    overlay.hidden = false;
  });
  // 新开一局 / 调试跳关时隐藏结尾画面
  const unsubscribeTransition = eventBus.on('scene:transition', () => {
    overlay.hidden = true;
  });

  return () => {
    unsubscribeEnd();
    unsubscribeTransition();
    overlay.remove();
  };
}