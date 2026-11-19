// ui/phoneVibrate.ts —— 手机震动浮动提示与轻量消息卡
// 提示条本身不阻塞控制；点击“查看”打开消息卡时由 gameUi 获取锁定。

import type { GameEvents } from '../core/eventBus';
import { createButton, createElement, isShortcutKey } from './uiDom';
import './phoneVibrate.css';

type VibrationPayload = GameEvents['ui:phoneVibrate'];

const AUTO_HIDE_MS = 8000;

export interface PhoneVibrationCallbacks {
  onView: (vibrationId: string) => void;
  onIgnore: (vibrationId: string) => void;
  onMessageClose: (vibrationId: string) => void;
}

export class PhoneVibrationView {
  private readonly snackbar: HTMLDivElement;
  private readonly previewText: HTMLParagraphElement;
  private readonly messageOverlay: HTMLDivElement;
  private readonly messageDetail: HTMLParagraphElement;
  private readonly callbacks: PhoneVibrationCallbacks;

  private current: VibrationPayload | null = null;
  private autoHideTimer = 0;
  private shortcutCooldownUntil = 0;

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!isShortcutKey(event, 'KeyE')) return;
    const messageOpen = !this.messageOverlay.hidden;
    if (!messageOpen && (this.snackbar.hidden || this.hasOtherModal())) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const coolingDown = performance.now() < this.shortcutCooldownUntil;
    this.refreshShortcutCooldown();
    if (coolingDown) return;

    if (messageOpen) this.closeMessage();
    else this.handleView();
  };

  private refreshShortcutCooldown(): void {
    this.shortcutCooldownUntil = performance.now() + 180;
  }

  private hasOtherModal(): boolean {
    // 通过 DOM 展示状态让位于手机、对话、选择和指南，不耦合其他 UI 模块。
    return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"]'))
      .some((element) => element !== this.messageOverlay && !element.closest('[hidden]'));
  }

  constructor(container: HTMLElement, callbacks: PhoneVibrationCallbacks) {
    this.callbacks = callbacks;

    this.snackbar = createElement('div', 'phone-vibrate');
    this.snackbar.hidden = true;
    this.snackbar.setAttribute('role', 'status');
    this.snackbar.setAttribute('aria-live', 'polite');

    const head = createElement('div', 'phone-vibrate__head');
    head.append(
      createElement('span', 'phone-vibrate__dot'),
      createElement('span', 'phone-vibrate__title', '手机震动了'),
    );

    this.previewText = createElement('p', 'phone-vibrate__preview', '');

    const actions = createElement('div', 'phone-vibrate__actions');
    const viewButton = createButton('phone-vibrate__button phone-vibrate__button--primary', '查看');
    const ignoreButton = createButton('phone-vibrate__button', '忽略');
    viewButton.addEventListener('click', () => this.handleView());
    ignoreButton.addEventListener('click', () => this.handleIgnore());
    actions.append(viewButton, ignoreButton);

    this.snackbar.append(head, this.previewText, actions);

    this.messageOverlay = createElement('div', 'vibration-message');
    this.messageOverlay.hidden = true;
    this.messageOverlay.setAttribute('role', 'dialog');
    this.messageOverlay.setAttribute('aria-modal', 'true');
    this.messageOverlay.setAttribute('aria-label', '新消息');

    const card = createElement('div', 'vibration-message__card');
    const cardHead = createElement('div', 'vibration-message__head');
    cardHead.append(
      createElement('span', 'vibration-message__dot'),
      createElement('span', 'vibration-message__title', '新消息'),
    );
    this.messageDetail = createElement('p', 'vibration-message__text', '');
    const closeButton = createButton('vibration-message__close', '收起');
    closeButton.addEventListener('click', () => this.closeMessage());
    card.append(cardHead, this.messageDetail, closeButton);
    this.messageOverlay.append(card);

    container.append(this.snackbar, this.messageOverlay);
    window.addEventListener('keydown', this.handleKeyDown, true);
  }

  show(payload: VibrationPayload): void {
    if (!this.messageOverlay.hidden) this.closeMessage();
    this.refreshShortcutCooldown();

    this.current = payload;
    this.previewText.textContent = payload.preview;
    this.snackbar.hidden = false;

    window.clearTimeout(this.autoHideTimer);
    this.autoHideTimer = window.setTimeout(() => this.handleIgnore(), AUTO_HIDE_MS);
  }

  hideSnackbar(): void {
    window.clearTimeout(this.autoHideTimer);
    this.snackbar.hidden = true;
  }

  hideAll(): void {
    this.hideSnackbar();
    if (!this.messageOverlay.hidden) this.closeMessage();
    this.current = null;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown, true);
    window.clearTimeout(this.autoHideTimer);
    this.snackbar.remove();
    this.messageOverlay.remove();
  }

  private handleView(): void {
    const current = this.current;
    if (!current) return;

    this.refreshShortcutCooldown();
    window.clearTimeout(this.autoHideTimer);
    this.snackbar.hidden = true;
    this.messageDetail.textContent = current.preview;
    this.messageOverlay.hidden = false;
    this.callbacks.onView(current.vibrationId);
  }

  private handleIgnore(): void {
    const current = this.current;
    if (!current) return;

    this.refreshShortcutCooldown();
    window.clearTimeout(this.autoHideTimer);
    this.snackbar.hidden = true;
    this.current = null;
    this.callbacks.onIgnore(current.vibrationId);
  }

  private closeMessage(): void {
    this.refreshShortcutCooldown();
    const current = this.current;
    this.messageOverlay.hidden = true;
    this.current = null;
    if (current) this.callbacks.onMessageClose(current.vibrationId);
  }
}
