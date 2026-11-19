// ui/muteButton.ts —— 右上角低调静音开关（44×44 触控热区，状态写入 localStorage）
// 边界：只操作音频模块的静音状态，不触碰剧情；避开调试面板与手机安全区。

import { isMuted, playUiClick, setMuted, unlockAudio } from '../audio/audioManager';
import { isShortcutKey } from './uiDom';
import './muteButton.css';

const ICON_ON = `
<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
  <path d="M4 9.5h3.2L12 5.8v12.4L7.2 14.5H4z" fill="currentColor" />
  <path d="M15.2 9.1a4.1 4.1 0 0 1 0 5.8M17.6 6.7a7.5 7.5 0 0 1 0 10.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
</svg>`;

const ICON_OFF = `
<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
  <path d="M4 9.5h3.2L12 5.8v12.4L7.2 14.5H4z" fill="currentColor" />
  <path d="M15.4 9.6l4.6 4.8M20 9.6l-4.6 4.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
</svg>`;

/** 挂载静音开关；返回清理函数 */
export function initMuteButton(): () => void {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mute-toggle';
  button.innerHTML = `<span class="mute-toggle__icon mute-toggle__icon--on">${ICON_ON}</span><span class="mute-toggle__icon mute-toggle__icon--off">${ICON_OFF}</span>`;

  const sync = (): void => {
    const muted = isMuted();
    button.classList.toggle('is-muted', muted);
    button.setAttribute('aria-pressed', muted ? 'true' : 'false');
    button.setAttribute('aria-label', muted ? '取消静音' : '静音');
    const shortcutHint = window.matchMedia('(pointer: coarse)').matches ? '' : ' (O)';
    button.title = `${muted ? '取消静音' : '静音'}${shortcutHint}`;
  };

  const toggle = (): void => {
    const next = !isMuted();
    setMuted(next);
    sync();
    if (!next) {
      // 点击和键盘都是用户手势，可顺便解锁音频并给一声轻反馈
      unlockAudio();
      playUiClick();
    }
  };

  const handleClick = (event: MouseEvent): void => {
    event.stopPropagation();
    toggle();
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (!isShortcutKey(event, 'KeyO')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    toggle();
  };

  button.addEventListener('click', handleClick);
  window.addEventListener('keydown', handleKeyDown, true);
  sync();
  document.body.appendChild(button);

  return () => {
    window.removeEventListener('keydown', handleKeyDown, true);
    button.removeEventListener('click', handleClick);
    button.remove();
  };
}