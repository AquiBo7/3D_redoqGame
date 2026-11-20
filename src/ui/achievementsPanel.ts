import { eventBus, type EventBus } from '../core/eventBus';
import type { MetaProgress } from '../core/state';
import { ACHIEVEMENTS } from '../data/achievements';
import { playUiClick } from '../audio/audioManager';
import { renderAssetImage } from './assetImage';
import './achievementsPanel.css';

type Achievement = typeof ACHIEVEMENTS[number];
const TOAST_DURATION = 3200;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function clearContent(node: HTMLElement): void {
  node.querySelectorAll('img').forEach((image) => { image.onerror = null; });
  node.replaceChildren();
}

function renderEntry(achievement: Achievement, unlocked: boolean, toast = false): HTMLElement {
  const row = element(toast ? 'div' : 'li', `achievements__entry${unlocked ? '' : ' achievements__entry--locked'}`);
  row.dataset.achievementId = achievement.id;
  const icon = element('div', 'achievements__icon');
  renderAssetImage(achievement.color === 'gold' ? 'trophy_gold' : 'trophy_silver', icon).draggable = false;
  const copy = element('div', 'achievements__copy');
  copy.append(
    element(toast ? 'p' : 'h3', 'achievements__name', unlocked ? achievement.title : '？？？'),
    element('p', 'achievements__description', unlocked ? achievement.description
      : achievement.id === 'A6' ? '？？？' : '尚未完成的结局'),
  );
  if (unlocked) copy.append(element('p', 'achievements__status', achievement.status));
  row.append(icon, copy);
  return row;
}

/** 只消费 core 的展示协议；不读写存档、不根据结局推导解锁。 */
export function initAchievementsPanel(bus: EventBus = eventBus): () => void {
  const overlay = element('section', 'achievements');
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '成就');
  const sheet = element('div', 'achievements__sheet');
  const header = element('header', 'achievements__header');
  const closeButton = element('button', 'achievements__close', '关闭');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', '关闭成就');
  header.append(element('h2', 'achievements__title', '成就'), closeButton);
  const list = element('ul', 'achievements__list');
  // 列表可聚焦，使键盘用户也能在短横屏内滚动完整六项。
  list.tabIndex = 0;
  list.setAttribute('aria-label', '成就列表');
  sheet.append(header, list);
  overlay.append(sheet);

  // 常驻空 live region：只有收到新增 ID 后才插入提示内容。
  const toast = element('aside', 'achievements-toast');
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.setAttribute('aria-atomic', 'true');
  document.body.append(overlay, toast);

  let achievements: Readonly<MetaProgress>['achievements'] = [];
  let returnFocus: HTMLElement | null = null;
  let inertSiblings: Array<{ node: HTMLElement; inert: boolean }> = [];
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const queue: Achievement[] = [];
  // 生命周期清理只丢弃待显示内容，不清空去重集合。
  const announced = new Set<string>();

  function renderList(): void {
    clearContent(list);
    for (const achievement of ACHIEVEMENTS) {
      list.append(renderEntry(achievement, achievements.includes(achievement.id)));
    }
  }

  function showNext(): void {
    if (disposed || timer !== null) return;
    const next = queue.shift();
    if (!next) return;
    clearContent(toast);
    toast.append(renderEntry(next, true, true));
    // 复用最轻的现有 UI 反馈；它尊重静音且从不主动解锁或恢复音频。
    playUiClick();
    timer = setTimeout(() => {
      timer = null;
      clearContent(toast);
      showNext();
    }, TOAST_DURATION);
  }

  function clearToasts(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    queue.length = 0;
    clearContent(toast);
  }

  function close(): void {
    if (overlay.hidden) return;
    overlay.hidden = true;
    window.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('focusin', onFocusIn, true);
    for (const { node, inert } of inertSiblings) node.inert = inert;
    inertSiblings = [];
    const target = returnFocus;
    returnFocus = null;
    if (target?.isConnected && !target.closest('[hidden], [inert]')) target.focus();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (overlay.hidden) return;
    // 不把弹窗键盘动作传给下层第一人称控制器与快捷键。
    event.stopImmediatePropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      const focus = document.activeElement;
      if (focus === closeButton) list.focus();
      else if (focus === list) closeButton.focus();
      else (event.shiftKey ? list : closeButton).focus();
    }
  }

  function onFocusIn(event: FocusEvent): void {
    if (!overlay.hidden && !overlay.contains(event.target as Node | null)) closeButton.focus();
  }

  function open(): void {
    if (disposed) return;
    // EventBus 同步派发：先获取最新元数据，再展示列表；重复打开也会刷新。
    bus.emit('ui:requestMeta');
    if (disposed) return;
    renderList();
    if (!overlay.hidden) return;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inertSiblings = Array.from(document.body.children)
      .filter((node): node is HTMLElement => node instanceof HTMLElement && node !== overlay && node !== toast)
      .map((node) => ({ node, inert: node.inert }));
    for (const { node } of inertSiblings) node.inert = true;
    overlay.hidden = false;
    list.scrollTop = 0;
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    closeButton.focus();
  }

  function onBackdrop(event: MouseEvent): void {
    event.stopPropagation();
    if (event.target === overlay) close();
  }

  function resetPresentation(): void {
    close();
    clearToasts();
  }

  closeButton.addEventListener('click', close);
  overlay.addEventListener('click', onBackdrop);
  const unsubscribe = [
    bus.on('ui:openAchievements', open),
    bus.on('meta:changed', ({ meta, newlyUnlocked }) => {
      if (disposed) return;
      achievements = [...meta.achievements];
      if (!overlay.hidden) renderList();
      // 只整理显示顺序，A6 在本批普通成就之后；未知 ID 静默忽略。
      const ordered = [...newlyUnlocked.filter((id) => id !== 'A6'), ...newlyUnlocked.filter((id) => id === 'A6')];
      for (const id of ordered) {
        if (announced.has(id)) continue;
        const achievement = ACHIEVEMENTS.find((entry) => entry.id === id);
        if (!achievement) continue;
        announced.add(id);
        queue.push(achievement);
      }
      showNext();
    }),
    bus.on('game:title', resetPresentation),
    bus.on('scene:transition', resetPresentation),
  ];

  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe.forEach((off) => off());
    resetPresentation();
    closeButton.removeEventListener('click', close);
    overlay.removeEventListener('click', onBackdrop);
    clearContent(list);
    achievements = [];
    announced.clear();
    overlay.remove();
    toast.remove();
  };
}
