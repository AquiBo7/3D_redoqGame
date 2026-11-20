// ui/phonePanel.ts —— 2D 居中手机界面
// 纯展示：所有内容来自 PhonePanel 数据；交互只通过回调交给 gameUi 转发事件总线。

import type { PhonePanel, PhoneReplyOption, PhoneSection } from '../data/storySchema';
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

export class PhonePanelView {
  private readonly root: HTMLDivElement;
  private readonly frame: HTMLDivElement;
  private readonly photoModal: HTMLDivElement;
  private photo: PhotoSection | null = null;
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

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.isOpen()) return;
    if (this.photo && event.code === 'Tab') {
      const buttons = Array.from(this.photoModal.querySelectorAll<HTMLButtonElement>('button'))
        .filter((button) => !button.disabled);
      const edge = event.shiftKey ? buttons[0] : buttons[buttons.length - 1];
      if (document.activeElement === edge || !this.photoModal.contains(document.activeElement)) {
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
    else this.requestClose();
  };

  private refreshShortcutCooldown(): void {
    this.shortcutCooldownUntil = performance.now() + 180;
  }

  private unlock(): void {
    this.refreshShortcutCooldown();
    this.view = 'home';
    this.render();
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

    const footer = createElement('div', 'phone__footer');
    const closeButton = createButton('phone__close', '收起手机');
    closeButton.addEventListener('click', () => this.requestClose());
    footer.append(closeButton);

    this.frame.append(status, this.body, footer);
    this.root.append(this.frame, this.photoModal);
    container.append(this.root);
    window.addEventListener('keydown', this.handleKeyDown, true);
  }

  open(panel: PhonePanel): void {
    this.closePhoto(false);
    this.refreshShortcutCooldown();
    this.photoActions.clear();
    this.panel = panel;
    this.view = panel.lockTime ? 'lock' : 'home';
    this.openSectionId = null;
    this.readSections.clear();
    this.answeredSections.clear();
    this.outgoing.clear();
    this.root.hidden = false;
    this.render();
  }

  hide(): void {
    this.closePhoto(false);
    this.refreshShortcutCooldown();
    this.root.hidden = true;
    this.panel = null;
    this.openSectionId = null;
    this.view = 'home';
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

  private render(scrollToEnd = false): void {
    const panel = this.panel;
    if (!panel) return;

    this.clock.textContent = panel.lockTime ?? '8:40';
    this.body.replaceChildren();

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
    lockScreen.addEventListener('click', () => this.unlock());

    this.body.append(lockScreen);
  }

  private renderHome(panel: PhonePanel): void {
    const header = createElement('div', 'phone__home-head');
    header.append(
      createElement('h3', 'phone__home-title', '今天'),
      createElement('p', 'phone__home-sub', '需要看的内容都在这里'),
    );

    const list = createElement('div', 'phone__list');
    for (const section of panel.sections) {
      if (section.kind === 'alarm') {
        list.append(this.createAlarmRow(section));
        continue;
      }
      if (section.kind === 'notice') {
        list.append(this.createNoticeCard(section.text));
        continue;
      }
      if (section.kind === 'photo') {
        list.append(this.createPhotoCard(section));
        continue;
      }
      if (section.kind === 'post') {
        list.append(this.createPostCard(section));
        continue;
      }
      list.append(this.createSectionRow(section));
    }

    this.body.append(header, list);
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

    row.addEventListener('click', () => this.openSection(section.id));
    return row;
  }

  private openSection(sectionId: string): void {
    this.refreshShortcutCooldown();
    this.openSectionId = sectionId;
    this.readSections.add(sectionId);
    this.view = 'section';
    this.render();
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
      this.refreshShortcutCooldown();
      this.view = 'home';
      this.openSectionId = null;
      this.render();
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
      card.append(createElement('p', 'phone__post-placeholder', '该帖子已删除'));
      return card;
    }

    card.append(createElement('p', 'phone__post-text', section.text));
    const images = createElement('div', 'phone__post-images');
    for (const assetId of section.assetIds) {
      const image = renderAssetImage(assetId as AssetId, images);
      image.draggable = false;
    }
    if (section.assetIds.length > 0) card.append(images);
    card.append(createElement('p', 'phone__post-stats', `浏览 ${section.views} · 评论 ${section.commentCount}`));

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
    button.addEventListener('click', () => this.handlePhotoAction(section, actionId));
    return button;
  }

  private updateLikeButton(button: HTMLButtonElement, actionId: string): void {
    const liked = this.photoActions.has(actionId);
    button.textContent = liked ? '已赞' : '点赞';
    button.setAttribute('aria-pressed', String(liked));
    button.setAttribute('aria-disabled', String(liked));
  }

  private openPhoto(section: PhotoSection, opener: HTMLButtonElement): void {
    if (!this.panel?.sections.includes(section)) return;
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
    back.addEventListener('click', () => this.closePhoto());
    header.append(back, createElement('h3', 'phone__photo-title', section.title));

    const viewport = createElement('div', 'phone__photo-viewport');
    const stage = createElement('div', 'phone__photo-stage');
    this.renderPhotoImage(section, stage);
    if (section.hotspot && section.noticeActionId) {
      const { x, y, width, height } = section.hotspot;
      const hotspot = createButton('phone__photo-hotspot', '');
      hotspot.setAttribute('aria-label', '看看台阶上的浅黄色背影');
      // 以实际图片盒子而非屏幕定位；中心锚定保证最小触控尺寸不会偏移热区。
      hotspot.style.left = `${x + width / 2}%`;
      hotspot.style.top = `${y + height / 2}%`;
      hotspot.style.width = `${width}%`;
      hotspot.style.height = `${height}%`;
      hotspot.addEventListener('click', () => this.handlePhotoAction(section, section.noticeActionId!));
      stage.append(hotspot);
    }
    viewport.append(stage);
    const footer = createElement('div', 'phone__photo-toolbar phone__photo-toolbar--footer');
    footer.append(createElement('p', 'phone__photo-hint', '轻点图片细节 · Esc 返回'));
    if (section.likeActionId) footer.append(this.createLikeButton(section));
    this.photoModal.append(header, viewport, footer);
    this.photoModal.hidden = false;
    back.focus();
  }

  private closePhoto(restoreFocus = true): void {
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
    button.addEventListener('click', () => this.handleReply(section, option));
    return button;
  }

  private handleReply(section: ChatSection, option: PhoneReplyOption): void {
    if (this.answeredSections.has(section.id)) return;
    const panel = this.panel;
    if (!panel) return;

    this.refreshShortcutCooldown();
    this.answeredSections.add(section.id);
    const replyText = option.effects?.set?.momReply;
    if (typeof replyText === 'string' && replyText.trim().length > 0) {
      this.outgoing.set(section.id, replyText);
    }

    this.render(true);
    this.callbacks.onAction(panel.id, 'reply', option.id);
  }
}
