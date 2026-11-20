
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
  eyebrow.textContent = '这一段，到这里';

  const title = document.createElement('h2');
  title.className = 'chapter-end__title';
  title.textContent = '把看见的，留在心里';

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

  const rewind = document.createElement('button');
  rewind.className = 'chapter-end__restart';
  rewind.type = 'button';
  rewind.textContent = '回到食堂，再试一次';
  rewind.hidden = true;
  rewind.addEventListener('click', () => eventBus.emit('ui:restoreCheckpoint', { key: 'ch2_canteen' }));
  const footprint = document.createElement('details');
  const footprintTitle = document.createElement('summary');
  footprintTitle.textContent = '查看足迹';
  const log = document.createElement('div');
  footprint.append(footprintTitle, log);
  card.append(eyebrow, title, note, footprint, rewind, restart, credits);
  overlay.append(card);
  host.append(overlay);

  const unsubscribeEnd = eventBus.on('game:chapterEnd', ({ state }) => {
    const participated = state.ending === 'joined';
    eyebrow.textContent = participated ? '随手一笑 · 已记录' : '这一段，到这里';
    title.textContent = participated ? '一句玩笑，也是在场。' : '把看见的，留在心里';
    note.textContent = participated ? '没有人记得，是谁先笑的。转发或评论之前，先停一下，确认自己知道多少。' : '感谢体验本次试玩版本。';
    rewind.hidden = !participated;
    log.replaceChildren();
    for (const entry of state.log.filter((item) => item.type !== 'system')) {
      const line = document.createElement('p');
      line.textContent = entry.summary;
      log.append(line);
    }
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