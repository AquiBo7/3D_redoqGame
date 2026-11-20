// ui/phonePanel.ts —— 2D 居中手机界面
// 纯展示：所有内容来自 PhonePanel 数据；交互只通过回调交给 gameUi 转发事件总线。

import type { PhonePanel, PhoneReplyOption, PhoneSection, PhoneTab } from '../data/storySchema';
import type { AssetId } from '../data/assetManifest';
import { renderAssetImage } from './assetImage';
import { createButton, createElement, isShortcutKey } from './uiDom';
import './phonePanel.css';

type ChatSection = Extract<PhoneSection, { kind: 'chat' }>;
type AlarmSection = Extract<PhoneSection, { kind: 'alarm' }>;
type PhotoSection = Extract<PhoneSection, { kind: 'photo' }>;
type PostSection = Extract<PhoneSection, { kind: 'post' }>;

export interface PhonePanelCallbacks {
  onAction: (panelId: string, action: 'close' | 'reply', optionId?: string) => void;
}

function findAlarm(panel: PhonePanel): AlarmSection | null {
  for (const section of panel.sections) {
    if (section.kind === 'alarm') return section;
  }
  return null;
}

function firstCharacter(text: string, fallback: string): string {
  const chars = Array.from(text.trim());
  return chars.length > 0 ? chars[0] : fallback;
}

const SVG_ICONS = {
  chat: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  wall: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 8h10"/><path d="M7 12h10"/><path d="M7 16h6"/></svg>',
  notes: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>',
  me: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
} as const;

const TABS: ReadonlyArray<{ id: PhoneTab; label: string; icon: string }> = [
  { id: 'messages', label: '消息', icon: SVG_ICONS.chat },
  { id: 'wall', label: '校园墙', icon: SVG_ICONS.wall },
  { id: 'notes', label: '备忘录', icon: SVG_ICONS.notes },
  { id: 'me', label: '我', icon: SVG_ICONS.me },
];

export interface PhoneLightboxModel { zoom: number; x: number; y: number }

/** 以图片未缩放尺寸夹紧平移；缩回原尺寸时自动居中。 */
export function clampPhoneLightbox(
  model: PhoneLightboxModel, width: number, height: number,
): PhoneLightboxModel {
  const zoom = Math.max(1, Math.min(3.2, Math.round(model.zoom * 100) / 100));
  const maxX = Math.max(0, width * (zoom - 1) / 2);
  const maxY = Math.max(0, height * (zoom - 1) / 2);
  return { zoom, x: Math.max(-maxX, Math.min(maxX, model.x)), y: Math.max(-maxY, Math.min(maxY, model.y)) };
}

export class PhonePanelView {
  private readonly root: HTMLDivElement;
  private readonly frame: HTMLDivElement;
  private readonly photoModal: HTMLDivElement;
  private photo: PhotoSection | PostSection | null = null;
  private readonly shell: HTMLDivElement;
  private readonly tabs: HTMLElement;
  private readonly banner: HTMLButtonElement;
  private activeTab: PhoneTab = 'messages';
  private notificationTimer: ReturnType<typeof setTimeout> | null = null;
  private returnFocus: HTMLElement | null = null;
  private cleanupPhoto: (() => void) | null = null;
  private photoOpener: HTMLButtonElement | null = null;
  private readonly photoActions = new Set<string>();
  private readonly body: HTMLDivElement;
  private readonly clock: HTMLSpanElement;
  private readonly callbacks: PhonePanelCallbacks;

  private panel: PhonePanel | null = null;
  private view: 'lock' | 'home' | 'section' = 'home';
  private openSectionId: string | null = null;
  private readonly readSections = new Set<string>();
  private readonly answeredSections = new Set<string>();
  private readonly outgoing = new Map<string, string>();
  private shortcutCooldownUntil = 0;
  private statsFrames = new Set<number>();

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.isOpen()) return;
    if (event.code === 'Tab') {
      const scope = this.photo ? this.photoModal : this.frame;
      const buttons = Array.from(scope.querySelectorAll<HTMLButtonElement>('button'))
        .filter((button) => !button.disabled && !button.hidden && !button.closest('[hidden]'));
      const edge = event.shiftKey ? buttons[0] : buttons[buttons.length - 1];
      if (document.activeElement === edge || !scope.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? buttons[buttons.length - 1] : buttons[0])?.focus();
      }
      event.stopImmediatePropagation();
      return;
    }
    if (this.photo && isShortcutKey(event, 'Escape')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.closePhoto();
      return;
    }
    if (!isShortcutKey(event, 'KeyE')) return;

    // 冷却中的 E 也要消费，不能穿透到 World 交互或其他手机视图。
    event.preventDefault();
    event.stopImmediatePropagation();
    const coolingDown = performance.now() < this.shortcutCooldownUntil;
    this.refreshShortcutCooldown();
    if (coolingDown) return;

    if (this.view === 'lock') this.unlock();
    // Lightbox 打开时 E 与 Esc 一致：只返回图片；未打开时才收起手机。
    else this.requestClose();
  };

  private refreshShortcutCooldown(): void {
    this.shortcutCooldownUntil = performance.now() + 180;
  }

  private unlock(): void {
    this.refreshShortcutCooldown();
    this.view = 'home';
    this.render();
    this.focusContent();
  }

  constructor(container: HTMLElement, callbacks: PhonePanelCallbacks) {
    this.callbacks = callbacks;

    this.root = createElement('div', 'phone-overlay');
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', '手机');

    this.frame = createElement('div', 'phone-frame');
    this.photoModal = createElement('div', 'phone__photo-modal');
    this.photoModal.hidden = true;
    this.photoModal.setAttribute('role', 'dialog');
    this.photoModal.setAttribute('aria-modal', 'true');
    this.photoModal.addEventListener('click', (event) => {
      if (event.target === this.photoModal) this.closePhoto();
    });

    const status = createElement('div', 'phone__status');
    this.clock = createElement('span', 'phone__clock', '8:40');
    const statusMark = createElement('span', 'phone__status-mark', '● ● ●');
    statusMark.setAttribute('aria-hidden', 'true');
    status.append(this.clock, statusMark);

    this.body = createElement('div', 'phone__body');
    this.shell = createElement('div', 'phone__shell');
    this.tabs = createElement('nav', 'phone__tabs');
    this.tabs.setAttribute('aria-label', '手机应用');
    this.shell.append(this.body, this.tabs);
    this.banner = createButton('phone__push-banner', '');
    this.banner.hidden = true;
    this.banner.setAttribute('aria-live', 'polite');
    this.banner.addEventListener('click', () => {
      const panel = this.panel;
      if (!panel || this.banner.hidden || this.photo) return;
      const section = panel.sections.find((item) => item.id === panel.notification?.sectionId);
      this.clearNotification();
      if (this.view === 'lock') this.unlock();
      if (section) {
        this.activeTab = this.tabFor(section);
        this.openSection(section.id);
      }
    });

    const footer = createElement('div', 'phone__footer');
    const closeButton = createButton('phone__close', '收起手机');
    closeButton.addEventListener('click', () => this.requestClose());
    footer.append(closeButton);

    this.frame.append(status, this.shell, footer, this.banner);
    this.root.append(this.frame, this.photoModal);
    container.append(this.root);
    window.addEventListener('keydown', this.handleKeyDown, true);
  }

  open(panel: PhonePanel): void {
    if (!this.isOpen()) this.returnFocus = document.activeElement as HTMLElement | null;
    this.clearNotification();
    this.closePhoto(false);
    this.refreshShortcutCooldown();
    this.photoActions.clear();
    this.panel = panel;
    this.activeTab = panel.defaultTab ?? (panel.sections.some((section) => section.kind === 'post')
      ? 'wall' : panel.sections.length > 0 && panel.sections.every((section) => section.kind === 'memo')
        ? 'notes' : 'messages');
    for (const section of panel.sections) {
      if (section.kind !== 'photo') continue;
      if (panel.likedPhoto && section.likeActionId) this.photoActions.add(section.likeActionId);
      if (panel.noticedPhoto && section.noticeActionId) this.photoActions.add(section.noticeActionId);
    }
    this.view = panel.lockTime ? 'lock' : 'home';
    this.openSectionId = null;
    this.readSections.clear();
    this.answeredSections.clear();
    this.outgoing.clear();
    this.root.hidden = false;
    this.render();
    this.focusContent();
    if (panel.notification) {
      this.banner.replaceChildren(
        createElement('span', 'phone__push-icon', '消息'),
        createElement('strong', 'phone__push-title', panel.notification.title),
        createElement('span', 'phone__push-text', panel.notification.text),
      );
      this.banner.hidden = false;
      this.notificationTimer = setTimeout(() => this.clearNotification(), 3000);
    }
  }

  private clearNotification(): void {
    if (this.notificationTimer !== null) clearTimeout(this.notificationTimer);
    this.notificationTimer = null;
    if (document.activeElement === this.banner) this.focusContent();
    this.banner.hidden = true;
  }

  private focusContent(): void {
    (this.body.querySelector<HTMLButtonElement>('button') ?? this.tabs.querySelector<HTMLButtonElement>('button'))?.focus();
  }

  private isLive(button: HTMLElement): boolean {
    return this.isOpen() && (this.photo ? this.photoModal.contains(button) : this.frame.contains(button));
  }

  hide(): void {
    this.clearNotification();
    this.cancelStatsAnimation();
    this.closePhoto(false);
    this.refreshShortcutCooldown();
    this.root.hidden = true;
    this.panel = null;
    this.openSectionId = null;
    this.view = 'home';
    this.returnFocus?.focus();
    this.returnFocus = null;
  }

  isOpen(): boolean {
    return !this.root.hidden;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown, true);
    this.hide();
    this.root.remove();
  }

  private requestClose(): void {
    if (this.photo) {
      this.closePhoto();
      return;
    }
    const panel = this.panel;
    if (!panel) return;
    this.hide();
    this.callbacks.onAction(panel.id, 'close');
  }

  private cancelStatsAnimation(): void {
    for (const frame of this.statsFrames) cancelAnimationFrame(frame);
    this.statsFrames.clear();
  }

  private render(scrollToEnd = false): void {
    this.cancelStatsAnimation();
    const panel = this.panel;
    if (!panel) return;

    this.clock.textContent = panel.lockTime ?? '8:40';
    this.body.replaceChildren();
    this.body.setAttribute('data-phone-tab', this.activeTab);
    this.shell.setAttribute('data-locked', String(this.view === 'lock'));
    this.renderTabs();

    if (this.view === 'lock') this.renderLockScreen(panel);
    else if (this.view === 'section' && this.openSectionId) this.renderSection(panel);
    else this.renderHome(panel);

    this.body.scrollTop = scrollToEnd ? this.body.scrollHeight : 0;
  }

  private renderLockScreen(panel: PhonePanel): void {
    const lockScreen = createElement('button', 'phone__lockscreen');
    lockScreen.type = 'button';
    lockScreen.setAttribute('aria-label', '轻点进入手机主界面');

    lockScreen.append(
      createElement('span', 'phone__lock-day', '今天'),
      createElement('span', 'phone__lock-time', panel.lockTime ?? '8:40'),
    );

    const alarm = findAlarm(panel);
    if (alarm) {
      const chip = createElement('span', 'phone__lock-alarm');
      chip.append(
        createElement('span', 'phone__lock-alarm-label', '闹钟'),
        createElement('span', 'phone__lock-alarm-text', alarm.label),
      );
      lockScreen.append(chip);
    }

    lockScreen.append(createElement('span', 'phone__lock-hint', '轻点进入'));
    lockScreen.addEventListener('click', () => { if (this.isLive(lockScreen)) this.unlock(); });

    this.body.append(lockScreen);
  }

  private tabFor(section: PhoneSection): PhoneTab {
    return section.kind === 'post' ? 'wall' : section.kind === 'memo' ? 'notes' : 'messages';
  }

  private switchTab(tab: PhoneTab): void {
    this.activeTab = tab;
    this.view = 'home';
    this.openSectionId = null;
    this.refreshShortcutCooldown();
    this.render();
    this.tabs.querySelector<HTMLButtonElement>(`[data-phone-tab="${tab}"]`)?.focus();
  }

  private renderTabs(): void {
    this.tabs.replaceChildren();
    this.tabs.hidden = this.view === 'lock';
    for (const tab of TABS) {
      const button = createButton('phone__tab', '');
      button.setAttribute('data-phone-tab', tab.id);
      button.setAttribute('aria-current', this.activeTab === tab.id ? 'page' : 'false');
      const icon = createElement('span', 'phone__tab-icon');
      icon.setAttribute('aria-hidden', 'true');
      // 图标为静态内联 SVG，不含用户输入，也不依赖字体子集覆盖。
      icon.innerHTML = tab.icon;
      button.append(icon, createElement('span', 'phone__tab-label', tab.label));
      const unread = tab.id === 'messages' ? this.panel?.sections.reduce((total, section) =>
        total + (section.kind === 'chat' && !this.readSections.has(section.id) ? section.unread : 0), 0) : 0;
      if (unread) button.append(createElement('span', 'phone__badge', String(unread)));
      button.addEventListener('click', () => {
        if (this.isLive(button) && this.view !== 'lock') this.switchTab(tab.id);
      });
      this.tabs.append(button);
    }
  }

  private renderHome(panel: PhonePanel): void {
    const header = createElement('div', 'phone__home-head');
    header.append(createElement('h3', 'phone__home-title', TABS.find((tab) => tab.id === this.activeTab)!.label));
    const list = createElement('div', 'phone__list');
    if (this.activeTab === 'me') {
      const profile = createElement('section', 'phone__profile');
      profile.append(
        createElement('span', 'phone__row-icon', firstCharacter(panel.profile?.name ?? '我', '我')),
        createElement('h3', 'phone__profile-name', panel.profile?.name ?? '我'),
        createElement('p', 'phone__profile-account', panel.profile?.account ?? '校园生活记录'),
      );
      list.append(profile, createElement('h4', 'phone__drafts-title', '未发送的草稿'));
      if (panel.profile?.drafts) {
        for (const draft of panel.profile.drafts) {
          const card = createElement('p', `phone__draft${draft.unlocked ? '' : ' phone__draft--locked'}`,
            draft.unlocked ? draft.text : '未发送的草稿');
          list.append(card);
        }
      } else {
        list.append(createElement('p', 'phone__empty', '故事结束后，可以在这里慢慢回望。'));
      }
      list.append(createElement('p', 'phone__safety', '本作品中的人物与事件均为虚构。可以随时收起手机，稍作休息。'));
    } else {
      const attached = new Set(panel.sections.flatMap((section) => section.kind === 'chat' ? section.attachments ?? [] : []));
      const sections = panel.sections.filter((section) => this.tabFor(section) === this.activeTab
        && !(section.kind === 'photo' && attached.has(section.id)));
      sections.sort((a, b) => Number(b.kind === 'chat' && !!b.pinned) - Number(a.kind === 'chat' && !!a.pinned));
      for (const section of sections) {
        switch (section.kind) {
          case 'alarm': list.append(this.createAlarmRow(section)); break;
          case 'notice': list.append(this.createNoticeCard(section.text)); break;
          case 'photo': list.append(this.createPhotoCard(section)); break;
          case 'post': list.append(this.createPostCard(section)); break;
          case 'memo': list.append(this.createMemoCard(section)); break;
          case 'chat': list.append(this.createSectionRow(section)); break;
        }
      }
      if (sections.length === 0) list.append(createElement('p', 'phone__empty',
        this.activeTab === 'wall' ? '校园墙还没有新动态。' : this.activeTab === 'notes' ? '暂时没有备忘。' : '暂时没有新消息。'));
    }
    this.body.append(header, list);
  }

  private createMemoCard(section: Extract<PhoneSection, { kind: 'memo' }>): HTMLElement {
    const card = createElement('article', 'phone__memo-card');
    const title = this.createSectionRow(section);
    const items = createElement('ol', 'phone__memo-list');
    for (const item of section.items) items.append(createElement('li', 'phone__memo-item', item));
    card.append(title, items);
    return card;
  }

  private createAlarmRow(section: AlarmSection): HTMLDivElement {
    const row = createElement('div', 'phone__row phone__row--alarm');
    const icon = createElement('span', 'phone__row-icon phone__row-icon--alarm', '闹');
    const main = createElement('span', 'phone__row-main');
    main.append(
      createElement('span', 'phone__row-title', section.label),
      createElement('span', 'phone__row-sub', section.dismissed ? '闹钟已按掉' : '闹钟已开启'),
    );
    const tag = createElement(
      'span',
      'phone__tag',
      section.dismissed ? '已按掉' : '已开启',
    );
    row.append(icon, main, tag);
    return row;
  }

  private createNoticeCard(text: string): HTMLDivElement {
    const card = createElement('div', 'phone__notice-card');
    const head = createElement('div', 'phone__notice-head');
    head.append(
      createElement('span', 'phone__notice-dot'),
      createElement('span', 'phone__notice-title', '通知'),
    );
    card.append(head, createElement('p', 'phone__notice-text', text));
    return card;
  }

  private createSectionRow(section: Exclude<PhoneSection, { kind: 'alarm' | 'notice' | 'photo' | 'post' }>): HTMLButtonElement {
    const row = createButton('phone__row', '');
    const isChat = section.kind === 'chat';
    const icon = createElement(
      'span',
      `phone__row-icon phone__row-icon--${isChat ? 'chat' : 'memo'}`,
      firstCharacter(section.title, isChat ? '聊' : '备'),
    );

    const main = createElement('span', 'phone__row-main');
    main.append(createElement('span', 'phone__row-title', section.title));

    if (section.kind === 'chat') {
      const last = section.messages[section.messages.length - 1];
      main.append(createElement('span', 'phone__row-sub', last ? last.text : '暂无消息'));
    } else {
      const firstItem = section.items.length > 0 ? ` · ${section.items[0]}` : '';
      main.append(
        createElement('span', 'phone__row-sub', `${section.updatedAt}${firstItem}`),
      );
    }

    row.append(icon, main);

    if (section.kind === 'chat' && !this.readSections.has(section.id) && section.unread > 0) {
      row.append(createElement('span', 'phone__badge', String(section.unread)));
    }

    row.setAttribute('data-section-id', section.id);
    if (section.kind === 'chat' && section.pinned) {
      row.className += ' phone__row--pinned';
      row.append(createElement('span', 'phone__tag', '置顶'));
    }
    row.addEventListener('click', () => { if (this.isLive(row)) this.openSection(section.id); });
    return row;
  }

  private openSection(sectionId: string): void {
    this.refreshShortcutCooldown();
    this.openSectionId = sectionId;
    this.readSections.add(sectionId);
    this.view = 'section';
    this.render();
    this.focusContent();
  }

  private renderSection(panel: PhonePanel): void {
    const section = panel.sections.find((item) => item.id === this.openSectionId);
    if (!section) {
      this.view = 'home';
      this.render();
      return;
    }

    const header = createElement('div', 'phone__section-head');
    const back = createButton('phone__back', '‹ 返回');
    back.setAttribute('aria-label', '返回手机主页');
    back.addEventListener('click', () => {
      if (!this.isLive(back)) return;
      this.refreshShortcutCooldown();
      this.view = 'home';
      this.openSectionId = null;
      this.render();
      this.focusContent();
    });
    header.append(back, createElement('h3', 'phone__section-title', this.sectionTitle(section)));

    this.body.append(header);

    switch (section.kind) {
      case 'alarm': {
        const card = createElement('div', 'phone__alarm-card');
        card.append(
          createElement('p', 'phone__alarm-label', section.label),
          createElement('p', 'phone__alarm-state', section.dismissed ? '已按掉' : '已开启'),
        );
        this.body.append(card);
        break;
      }
      case 'memo': {
        this.body.append(createElement('p', 'phone__memo-meta', `最后编辑：${section.updatedAt}`));
        const list = createElement('ol', 'phone__memo-list');
        for (const item of section.items) {
          list.append(createElement('li', 'phone__memo-item', item));
        }
        this.body.append(list);
        break;
      }
      case 'notice': {
        const card = createElement('div', 'phone__notice-card phone__notice-card--detail');
        const head = createElement('div', 'phone__notice-head');
        head.append(
          createElement('span', 'phone__notice-dot'),
          createElement('span', 'phone__notice-title', '通知'),
        );
        card.append(head, createElement('p', 'phone__notice-text', section.text));
        this.body.append(card);
        break;
      }
      case 'chat':
        this.renderChat(section);
        break;
      case 'photo':
        this.body.append(this.createPhotoCard(section));
        break;
      case 'post':
        this.body.append(this.createPostCard(section));
        break;
    }
  }

  private sectionTitle(section: PhoneSection): string {
    if (section.kind === 'notice') return '通知';
    if (section.kind === 'alarm') return '闹钟';
    return section.title;
  }

  private createPostCard(section: PostSection): HTMLElement {
    const card = createElement('article', 'phone__post');
    card.append(
      createElement('h3', 'phone__post-title', section.title),
      createElement('p', 'phone__post-time', section.publishedAt),
    );
    if (section.deleted) {
      card.className += ' phone__post--deleted';
      card.append(createElement('p', 'phone__post-placeholder', '该内容已删除'));
      if (section.historicalTransfers !== undefined) {
        card.append(createElement('p', 'phone__post-stats', `历史转发 ${section.historicalTransfers}（未归零）`));
      }
      return card;
    }

    card.append(createElement('p', 'phone__post-text', section.text));
    const images = createElement('div', 'phone__post-images');
    for (const assetId of section.assetIds) {
      const thumbnail = createButton('phone__post-image', '');
      thumbnail.setAttribute('aria-label', `放大查看：${section.title}`);
      const image = renderAssetImage(assetId as AssetId, thumbnail);
      image.draggable = false;
      thumbnail.addEventListener('click', () => this.openPhoto(section, thumbnail, assetId));
      images.append(thumbnail);
    }
    if (section.assetIds.length > 0) card.append(images);
    const stats = createElement('p', 'phone__post-stats', `浏览 ${section.views} · 评论 ${section.commentCount}`);
    card.append(stats);
    if (section.previousStats && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const previous = section.previousStats;
      const start = performance.now();
      let frame = 0;
      const animate = (now: number): void => {
        this.statsFrames.delete(frame);
        const progress = Math.min(1, Math.max(0, (now - start) / 1800));
        const eased = 1 - Math.pow(1 - progress, 3);
        stats.textContent = `浏览 ${Math.round(previous.views + (section.views - previous.views) * eased)} · 评论 ${Math.round(previous.commentCount + (section.commentCount - previous.commentCount) * eased)}`;
        if (progress < 1) {
          frame = requestAnimationFrame(animate);
          this.statsFrames.add(frame);
        }
      };
      animate(start);
    }

    const comments = createElement('ol', 'phone__post-comments');
    comments.setAttribute('aria-label', '跟评');
    const byId = new Map(section.comments.map((comment) => [comment.id, comment]));
    const rendered = new Set<string>();
    const appendComment = (comment: PostSection['comments'][number], container: HTMLElement): void => {
      if (rendered.has(comment.id)) return;
      rendered.add(comment.id);
      const item = createElement('li', 'phone__post-comment');
      item.setAttribute('data-comment-id', comment.id);
      item.append(createElement('span', 'phone__post-author', comment.author));
      const parent = comment.replyTo ? byId.get(comment.replyTo) : undefined;
      if (parent) item.append(createElement('span', 'phone__post-reply-to', `回复 ${parent.author}`));
      if (comment.actionId) {
        const button = this.createPostAction(section, comment.actionId, comment.text);
        button.setAttribute('aria-label', `查看${comment.author}的跟评：${comment.text}`);
        item.append(button);
      } else {
        item.append(createElement('p', 'phone__post-text', comment.text));
      }
      item.append(createElement('span', 'phone__post-likes', `赞 ${comment.likes}`));
      const replies = createElement('ol', 'phone__post-comments phone__post-comments--nested');
      for (const reply of section.comments) {
        if (reply.replyTo === comment.id) appendComment(reply, replies);
      }
      if (replies.children.length > 0) item.append(replies);
      container.append(item);
    };
    for (const comment of section.comments) {
      if (!comment.replyTo || !byId.has(comment.replyTo)) appendComment(comment, comments);
    }
    // 缺失父评论或循环引用不应吞掉内容，也不能无限递归。
    for (const comment of section.comments) appendComment(comment, comments);
    card.append(comments);

    if (section.actions?.length) {
      const actions = createElement('div', 'phone__post-actions');
      for (const option of section.actions) {
        actions.append(this.createPostAction(section, option.id, option.text));
      }
      card.append(actions);
    }
    return card;
  }

  private createPostAction(section: PostSection, actionId: string, text: string): HTMLButtonElement {
    const button = createButton('phone__post-action', text);
    button.setAttribute('data-post-action', actionId);
    button.addEventListener('click', () => {
      const panel = this.panel;
      // 关闭、重开或切页后，旧节点不得把动作发给当前面板。
      if (!panel?.sections.includes(section) || section.deleted || !this.isOpen()
        || this.photo || !this.body.contains(button)) return;
      this.refreshShortcutCooldown();
      // 不应用 effects、不增改赞数、不发心声；全部交给 core trigger。
      this.callbacks.onAction(panel.id, 'reply', actionId);
    });
    return button;
  }

  private createPhotoCard(section: PhotoSection): HTMLElement {
    const card = createElement('section', 'phone__photo-card');
    card.append(createElement('h3', 'phone__photo-title', section.title));
    const thumbnail = createButton('phone__photo-thumbnail', '');
    thumbnail.setAttribute('aria-label', `放大查看：${section.title}`);
    this.renderPhotoImage(section, thumbnail);
    thumbnail.addEventListener('click', () => this.openPhoto(section, thumbnail));
    card.append(thumbnail, createElement('p', 'phone__photo-hint', '轻点照片，放大查看'));
    if (section.likeActionId) card.append(this.createLikeButton(section));
    return card;
  }

  private renderPhotoImage(section: PhotoSection, container: HTMLElement): void {
    // 资源与兜底都由统一美术渲染入口提供，不直接请求固定文件路径。
    const image = renderAssetImage(section.assetId as AssetId, container);
    image.draggable = false;
  }

  private createLikeButton(section: PhotoSection): HTMLButtonElement {
    const actionId = section.likeActionId!;
    const button = createButton('phone__photo-like', '点赞');
    button.setAttribute('data-photo-like', actionId);
    this.updateLikeButton(button, actionId);
    button.addEventListener('click', () => {
      if (this.isLive(button)) this.handlePhotoAction(section, actionId);
    });
    return button;
  }

  private updateLikeButton(button: HTMLButtonElement, actionId: string): void {
    const liked = this.photoActions.has(actionId);
    button.textContent = liked ? '已赞' : '点赞';
    button.setAttribute('aria-pressed', String(liked));
    button.setAttribute('aria-disabled', String(liked));
  }

  private openPhoto(section: PhotoSection | PostSection, opener: HTMLButtonElement, assetId?: string): void {
    if (!this.panel?.sections.includes(section) || !this.isLive(opener) || this.photo) return;
    this.closePhoto(false);
    this.refreshShortcutCooldown();
    this.photo = section;
    this.photoOpener = opener;
    this.frame.inert = true;
    this.frame.setAttribute('aria-hidden', 'true');
    this.photoModal.replaceChildren();
    this.photoModal.setAttribute('aria-label', section.title);

    const header = createElement('div', 'phone__photo-toolbar');
    const back = createButton('phone__photo-back', '‹ 返回图片');
    back.setAttribute('aria-label', '关闭放大，返回手机图片');
    back.addEventListener('click', () => { if (this.isLive(back)) this.closePhoto(); });
    header.append(back, createElement('h3', 'phone__photo-title', section.title));

    const viewport = createElement('div', 'phone__photo-viewport');
    const stage = createElement('div', 'phone__photo-stage');
    const image = renderAssetImage((section.kind === 'photo' ? section.assetId : assetId!) as AssetId, stage);
    image.draggable = false;
    let model: PhoneLightboxModel = { zoom: 1, x: 0, y: 0 };
    let drag: { id: number; startX: number; startY: number; x: number; y: number } | null = null;
    let suppressClick = false;
    const percent = createElement('output', 'phone__photo-percent', '100%');
    percent.setAttribute('aria-live', 'polite');
    const apply = (): void => {
      model = clampPhoneLightbox(model, stage.offsetWidth, stage.offsetHeight);
      stage.style.transform = `translate(${model.x}px, ${model.y}px) scale(${model.zoom})`;
      percent.textContent = `${Math.round(model.zoom * 100)}%`;
    };
    const endDrag = (): void => {
      const id = drag?.id;
      drag = null;
      if (id !== undefined && viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id);
    };
    const down = (event: PointerEvent): void => {
      if (drag || event.button !== 0) return;
      suppressClick = false;
      drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: model.x, y: model.y };
    };
    const move = (event: PointerEvent): void => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (Math.hypot(dx, dy) > 5) {
        suppressClick = true;
        if (!viewport.hasPointerCapture(event.pointerId)) viewport.setPointerCapture(event.pointerId);
      }
      if (!suppressClick) return;
      event.preventDefault();
      model = { ...model, x: drag.x + dx, y: drag.y + dy };
      apply();
    };
    const up = (event: PointerEvent): void => {
      if (drag?.id === event.pointerId) endDrag();
    };
    const cancel = (event: PointerEvent): void => {
      if (drag?.id !== event.pointerId) return;
      suppressClick = true;
      endDrag();
    };
    viewport.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    viewport.addEventListener('lostpointercapture', cancel);
    image.addEventListener('load', apply);
    window.addEventListener('resize', apply);
    this.cleanupPhoto = () => {
      endDrag();
      viewport.removeEventListener('pointerdown', down);
      viewport.removeEventListener('lostpointercapture', cancel);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('resize', apply);
      image.removeEventListener('load', apply);
    };
    if (section.kind === 'photo' && section.hotspot && section.noticeActionId) {
      const { x, y, width, height } = section.hotspot;
      const hotspot = createButton('phone__photo-hotspot', '');
      hotspot.setAttribute('aria-label', '看看台阶上的浅黄色背影');
      // 以实际图片盒子而非屏幕定位；中心锚定保证最小触控尺寸不会偏移热区。
      hotspot.style.left = `${x + width / 2}%`;
      hotspot.style.top = `${y + height / 2}%`;
      hotspot.style.width = `${width}%`;
      hotspot.style.height = `${height}%`;
      hotspot.addEventListener('click', () => {
        if (!suppressClick && this.isLive(hotspot)) this.handlePhotoAction(section, section.noticeActionId!);
      });
      hotspot.addEventListener('keydown', (event) => {
        if (event.code === 'Enter' || event.code === 'Space') suppressClick = false;
      });
      stage.append(hotspot);
    }
    viewport.append(stage);
    const footer = createElement('div', 'phone__photo-toolbar phone__photo-toolbar--footer');
    const controls = createElement('div', 'phone__photo-controls');
    for (const [action, text, delta] of [['out', '－ 缩小', -0.55], ['in', '＋ 放大', 0.55], ['reset', '还原', 0]] as const) {
      const button = createButton('phone__photo-zoom', text);
      button.setAttribute('data-photo-zoom', action);
      button.addEventListener('click', () => {
        if (!this.isLive(button)) return;
        endDrag();
        model = action === 'reset' ? { zoom: 1, x: 0, y: 0 } : { ...model, zoom: model.zoom + delta };
        apply();
      });
      controls.append(button);
    }
    controls.append(percent);
    footer.append(controls, createElement('p', 'phone__photo-hint', '拖动查看 · Esc 返回'));
    if (section.kind === 'photo' && section.likeActionId) footer.append(this.createLikeButton(section));
    this.photoModal.append(header, viewport, footer);
    this.photoModal.hidden = false;
    back.focus();
  }

  private closePhoto(restoreFocus = true): void {
    this.cleanupPhoto?.();
    this.cleanupPhoto = null;
    const opener = this.photoOpener;
    this.photo = null;
    this.photoOpener = null;
    this.photoModal.hidden = true;
    this.photoModal.replaceChildren();
    this.frame.inert = false;
    this.frame.setAttribute('aria-hidden', 'false');
    if (restoreFocus && opener) {
      this.refreshShortcutCooldown();
      opener.focus();
    }
  }

  private handlePhotoAction(section: PhotoSection, actionId: string): void {
    const panel = this.panel;
    if (!panel?.sections.includes(section) || this.photoActions.has(actionId)) return;
    // 先去重再通知 core；观察不弹奖励、不切换页面，点赞只更新按钮状态。
    this.photoActions.add(actionId);
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-photo-like]')) {
      this.updateLikeButton(button, button.getAttribute('data-photo-like')!);
    }
    this.callbacks.onAction(panel.id, 'reply', actionId);
  }

  private renderChat(section: ChatSection): void {
    const chat = createElement('div', 'phone__chat');

    for (const message of section.messages) {
      const bubble = createElement('div', 'phone__message phone__message--in');
      const metaParts = [message.from];
      if (message.time) metaParts.push(message.time);
      bubble.append(
        createElement('span', 'phone__message-meta', metaParts.join(' · ')),
        createElement('p', 'phone__message-text', message.text),
      );
      chat.append(bubble);
    }

    for (const id of section.attachments ?? []) {
      const attachment = this.panel?.sections.find((item) => item.id === id);
      if (attachment?.kind === 'photo') chat.append(this.createPhotoCard(attachment));
      if (attachment?.kind === 'post') {
        const share = createButton('phone__share-card', '');
        share.setAttribute('data-open-wall', attachment.id);
        share.append(
          createElement('strong', 'phone__share-title', attachment.title),
          createElement('span', 'phone__share-desc', attachment.deleted ? '该内容已删除' : attachment.text),
          createElement('span', 'phone__share-foot', '校园墙 · 点击查看'),
        );
        if (!attachment.deleted && attachment.assetIds[0]) {
          const thumb = createElement('span', 'phone__share-thumb');
          renderAssetImage(attachment.assetIds[0] as AssetId, thumb);
          share.append(thumb);
        }
        share.addEventListener('click', () => {
          if (this.isLive(share)) this.switchTab('wall');
        });
        chat.append(share);
      }
    }

    const outgoing = this.outgoing.get(section.id);
    if (outgoing) {
      const bubble = createElement('div', 'phone__message phone__message--out');
      bubble.append(
        createElement('span', 'phone__message-meta', '我'),
        createElement('p', 'phone__message-text', outgoing),
      );
      chat.append(bubble);
    }

    this.body.append(chat);

    if (!section.replyOptions || section.replyOptions.length === 0) return;

    if (this.answeredSections.has(section.id)) {
      const status = createElement(
        'p',
        'phone__read-status',
        this.outgoing.has(section.id) ? '已回复' : '已读',
      );
      this.body.append(status);
      return;
    }

    const replies = createElement('div', 'phone__replies');
    replies.append(createElement('p', 'phone__replies-label', '回复'));
    const grid = createElement('div', 'phone__reply-grid');
    for (const option of section.replyOptions) {
      grid.append(this.createReplyButton(section, option));
    }
    replies.append(grid);
    this.body.append(replies);
  }

  private createReplyButton(section: ChatSection, option: PhoneReplyOption): HTMLButtonElement {
    const button = createButton('phone__reply', option.text);
    button.addEventListener('click', () => {
      if (this.isLive(button) && this.panel?.sections.includes(section)) this.handleReply(section, option);
    });
    return button;
  }

  private handleReply(section: ChatSection, option: PhoneReplyOption): void {
    if (this.answeredSections.has(section.id)) return;
    const panel = this.panel;
    if (!panel) return;

    this.refreshShortcutCooldown();
    this.answeredSections.add(section.id);
    // 仅回显选项文案，不读取或执行剧情 effects。
    this.outgoing.set(section.id, option.text);

    this.render(true);
    this.focusContent();
    this.callbacks.onAction(panel.id, 'reply', option.id);
  }
}
