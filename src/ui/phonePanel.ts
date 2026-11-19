// ui/phonePanel.ts —— 2D 居中手机界面
// 纯展示：所有内容来自 PhonePanel 数据；交互只通过回调交给 gameUi 转发事件总线。

import type { PhonePanel, PhoneReplyOption, PhoneSection } from '../data/storySchema';
import { createButton, createElement } from './uiDom';
import './phonePanel.css';

type ChatSection = Extract<PhoneSection, { kind: 'chat' }>;
type AlarmSection = Extract<PhoneSection, { kind: 'alarm' }>;

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
  private readonly body: HTMLDivElement;
  private readonly clock: HTMLSpanElement;
  private readonly callbacks: PhonePanelCallbacks;

  private panel: PhonePanel | null = null;
  private view: 'lock' | 'home' | 'section' = 'home';
  private openSectionId: string | null = null;
  private readonly readSections = new Set<string>();
  private readonly answeredSections = new Set<string>();
  private readonly outgoing = new Map<string, string>();

  constructor(container: HTMLElement, callbacks: PhonePanelCallbacks) {
    this.callbacks = callbacks;

    this.root = createElement('div', 'phone-overlay');
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', '手机');

    const frame = createElement('div', 'phone-frame');

    const status = createElement('div', 'phone__status');
    this.clock = createElement('span', 'phone__clock', '8:47');
    const statusMark = createElement('span', 'phone__status-mark', '● ● ●');
    statusMark.setAttribute('aria-hidden', 'true');
    status.append(this.clock, statusMark);

    this.body = createElement('div', 'phone__body');

    const footer = createElement('div', 'phone__footer');
    const closeButton = createButton('phone__close', '收起手机');
    closeButton.addEventListener('click', () => this.requestClose());
    footer.append(closeButton);

    frame.append(status, this.body, footer);
    this.root.append(frame);
    container.append(this.root);
  }

  open(panel: PhonePanel): void {
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
    this.root.hidden = true;
    this.panel = null;
    this.openSectionId = null;
    this.view = 'home';
  }

  isOpen(): boolean {
    return !this.root.hidden;
  }

  dispose(): void {
    this.root.remove();
  }

  private requestClose(): void {
    const panel = this.panel;
    if (!panel) return;
    this.hide();
    this.callbacks.onAction(panel.id, 'close');
  }

  private render(scrollToEnd = false): void {
    const panel = this.panel;
    if (!panel) return;

    this.clock.textContent = panel.lockTime ?? '手机';
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
      createElement('span', 'phone__lock-time', panel.lockTime ?? '手机'),
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
    lockScreen.addEventListener('click', () => {
      this.view = 'home';
      this.render();
    });

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

  private createSectionRow(section: Exclude<PhoneSection, { kind: 'alarm' | 'notice' }>): HTMLButtonElement {
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
    }
  }

  private sectionTitle(section: PhoneSection): string {
    if (section.kind === 'notice') return '通知';
    if (section.kind === 'alarm') return '闹钟';
    return section.title;
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

    this.answeredSections.add(section.id);
    const replyText = option.effects?.set?.momReply;
    if (typeof replyText === 'string' && replyText.trim().length > 0) {
      this.outgoing.set(section.id, replyText);
    }

    this.render(true);
    this.callbacks.onAction(panel.id, 'reply', option.id);
  }
}
