import { eventBus } from '../core/eventBus';
import { createEndingReview, type EndingReview } from '../core/endingReview';
import { renderAssetImage } from './assetImage';
import './chapterEnd.css';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

/** 只消费复盘投影与事件；不在展示层推断剧情或访问存档。 */
export function initChapterEnd(): () => void {
  const host = document.querySelector<HTMLElement>('#ui-root') ?? document.body;
  const overlay = element('section', 'chapter-end');
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'chapter-end-title');
  const card = element('div', 'chapter-end__card');
  overlay.append(card);
  host.append(overlay);

  let returnFocus: HTMLElement | null = null;
  let title: HTMLHeadingElement | null = null;
  let disposed = false;

  function clear(): void {
    card.querySelectorAll('img').forEach((image) => { image.onerror = null; });
    card.replaceChildren();
  }

  function hide(): void {
    if (overlay.hidden) return;
    const ownsFocus = overlay.contains(document.activeElement);
    overlay.hidden = true;
    const target = returnFocus;
    returnFocus = null;
    if (ownsFocus && target?.isConnected && !target.closest('[hidden], [inert]')) target.focus();
  }

  function button(label: string, action: () => void, className = ''): HTMLButtonElement {
    const node = element('button', `chapter-end__button ${className}`, label);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  }

  function section(label: string): HTMLElement {
    const node = element('section', 'chapter-end__section');
    node.append(element('h3', 'chapter-end__heading', label));
    return node;
  }

  function render(review: EndingReview): void {
    clear();
    const hero = element('header', 'chapter-end__hero');
    const figure = element('figure', 'chapter-end__figure');
    renderAssetImage(review.cg.assetId, figure).draggable = false;
    figure.append(element('figcaption', 'chapter-end__caption', review.cg.caption));
    const copy = element('div', 'chapter-end__hero-copy');
    title = element('h2', 'chapter-end__title', review.title);
    title.id = 'chapter-end-title';
    title.tabIndex = -1;
    copy.append(element('p', 'chapter-end__eyebrow', '一条截图 / 回望'), title,
      element('p', 'chapter-end__note', review.lead));
    hero.append(figure, copy);

    const epilogue = section('01 / 后来');
    const columns = element('div', 'chapter-end__columns');
    ['林夏后来', '对你的影响'].forEach((label, index) => {
      const column = element('div', 'chapter-end__epilogue');
      column.append(element('h4', 'chapter-end__subheading', label), element('p', '', review.epilogue[index]));
      columns.append(column);
    });
    epilogue.append(columns, element('blockquote', 'chapter-end__insight', review.insight));

    // 保留旧浏览器验收脚本使用的 summary 文案与原生 details 交互。
    const footprint = element('details', 'chapter-end__section chapter-end__footprints');
    footprint.append(element('summary', 'chapter-end__heading', '查看足迹'));
    footprint.append(element('p', 'chapter-end__caption', '只回放本局留下的状态与记录；没有记录的地方，不替你补写。'));
    const footprints = element('ol', 'chapter-end__footprint-list');
    for (const entry of review.footprints) {
      const item = element('li', 'chapter-end__footprint');
      item.append(element('h4', 'chapter-end__subheading', entry.title));
      for (const line of entry.lines) item.append(element('p', '', line));
      if (entry.records.length) {
        const records = element('ul', 'chapter-end__records');
        for (const record of entry.records) records.append(element('li', '', record));
        item.append(records);
      }
      footprints.append(item);
    }
    footprint.append(footprints);
    if (!review.footprints.length) footprint.append(element('p', '', '这一段还没有留下可回放的足迹。'));

    const drafts = section('03 / 林夏的草稿箱');
    const draftList = element('ol', 'chapter-end__drafts');
    review.drafts.forEach((draft, index) => {
      const item = element('li', `chapter-end__draft${draft.unlocked ? '' : ' chapter-end__draft--locked'}`);
      item.dataset.draftId = draft.id;
      item.append(element('h4', 'chapter-end__subheading', `草稿 ${index + 1} · ${draft.unlocked ? '已展开' : '未解锁'}`),
        element('p', '', draft.text));
      draftList.append(item);
    });
    drafts.append(draftList);

    const actions = section('04 / 把这一刻带回生活');
    const actionList = element('ol', 'chapter-end__actions');
    for (const action of review.actions) {
      const item = element('li', 'chapter-end__action');
      item.append(element('h4', 'chapter-end__subheading', action.title), element('p', '', action.text));
      actionList.append(item);
    }
    actions.append(actionList);

    const footer = element('footer', 'chapter-end__footer');
    const retry = review.retry;
    if (retry) footer.append(button(retry.label, () => {
      // 由 core 确认检查点可用后触发 transition；读档失败时保留复盘页。
      eventBus.emit('ui:restoreCheckpoint', { key: retry.key });
    }, 'chapter-end__retry'));
    const navigation = element('nav', 'chapter-end__navigation');
    navigation.setAttribute('aria-label', '复盘页操作');
    navigation.append(
      button('章节选择', () => eventBus.emit('ui:openChapters')),
      button('查看成就', () => eventBus.emit('ui:openAchievements')),
      button('手机 · 草稿箱', () => { hide(); eventBus.emit('ui:openPhoneArchive'); }),
      button('返回标题', () => { hide(); eventBus.emit('ui:returnTitle'); }),
      button('从头开始', () => { hide(); eventBus.emit('game:start'); }, 'chapter-end__restart'),
    );
    footer.append(navigation, element('p', 'chapter-end__caption', '本故事及人物均为虚构。谢谢你停下来，看见截图以外。'));
    card.append(hero, epilogue, footprint, drafts, actions, footer);
  }

  function onKeyDown(event: KeyboardEvent): void {
    // 成就/章节弹层拥有自己的焦点；不截获那些弹层的事件。
    if (overlay.hidden || overlay.closest('[inert]') || !overlay.contains(event.target as Node | null)) return;
    event.stopPropagation();
    if (event.key !== 'Tab') return;
    const focusable = Array.from(overlay.querySelectorAll<HTMLElement>('button, summary'))
      .filter((node) => !node.closest('[hidden], [inert]'));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === title)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || active === title)) {
      event.preventDefault();
      first.focus();
    }
  }

  overlay.addEventListener('keydown', onKeyDown);
  const unsubscribe = [
    eventBus.on('game:chapterEnd', ({ state }) => {
      if (overlay.hidden) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      render(createEndingReview(state));
      overlay.hidden = false;
      overlay.scrollTop = 0;
      title?.focus({ preventScroll: true });
    }),
    eventBus.on('scene:transition', hide),
    eventBus.on('game:title', hide),
  ];

  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe.forEach((off) => off());
    hide();
    overlay.removeEventListener('keydown', onKeyDown);
    clear();
    overlay.remove();
  };
}
