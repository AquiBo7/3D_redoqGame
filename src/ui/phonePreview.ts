// ui/phonePreview.ts —— ?phonePreview=1 手机界面独立调试入口
// 跳过 3D 世界与剧情状态机，直接复用 S2 / S9 的真实手机数据挂载 PhonePanelView，
// 便于单独开发手机 UI：顶部切换面板，左下角实时打印回传的 ui:phoneAction 参数。
// 边界：纯展示层，不 import three、不修改 core 逻辑。

import { chapter1 } from '../data/story';
import type { PhonePanel, SceneId } from '../data/storySchema';
import type { EventBus } from '../core/eventBus';
import { eventBus as defaultEventBus } from '../core/eventBus';
import { PhonePanelView } from './phonePanel';
import { PhoneVibrationView } from './phoneVibrate';
import { createButton, createElement } from './uiDom';
import './phonePreview.css';

function findPhonePanel(sceneId: SceneId, stepId: string): PhonePanel {
  for (const step of chapter1.scenes[sceneId]?.steps ?? []) {
    if (step.kind === 'phone' && step.id === stepId) return step.panel;
  }
  throw new Error(`缺少手机面板数据：${sceneId}/${stepId}`);
}

const S2_PANEL = findPhonePanel('S2', 's2-phone');
const S9_PANEL = findPhonePanel('S9', 's9-phone');
const S4_VIBRATION = {
  vibrationId: 'street-vibration-1',
  preview: '迎新群：@所有人 新生报到 9:00 截止，请抓紧～',
};

export interface PhonePreviewOptions {
  bus?: EventBus;
}

export function initPhonePreview(options: PhonePreviewOptions = {}): () => void {
  const bus = options.bus ?? defaultEventBus;

  const root = createElement('div', 'phone-preview');
  root.setAttribute('aria-label', '手机界面独立调试');

  const stage = createElement('div', 'phone-preview__stage');

  const bar = createElement('header', 'phone-preview__bar');
  const barTitle = createElement('span', 'phone-preview__title', '手机 UI 调试');
  const s2Button = createButton('phone-preview__tab', 'S2 手机面板');
  const s9Button = createButton('phone-preview__tab', 'S9 未读提示');
  const vibrateButton = createButton('phone-preview__tab', '模拟 S4 震动');
  bar.append(barTitle, s2Button, s9Button, vibrateButton);

  const log = createElement('aside', 'phone-preview__log');
  log.setAttribute('aria-live', 'polite');
  const logTitle = createElement('p', 'phone-preview__log-title', 'ui:phoneAction 回传');
  const logList = createElement('ol', 'phone-preview__log-list');
  log.append(logTitle, logList);

  root.append(stage, bar, log);
  document.body.append(root);

  const phone = new PhonePanelView(stage, {
    onAction: (panelId, action, optionId) => {
      bus.emit('ui:phoneAction', { phoneId: panelId, action, optionId });
    },
  });

  const vibration = new PhoneVibrationView(stage, {
    onView: (vibrationId) => {
      bus.emit('ui:phoneAction', { phoneId: vibrationId, action: 'open' });
    },
    onIgnore: (vibrationId) => {
      bus.emit('ui:phoneAction', { phoneId: vibrationId, action: 'ignore' });
    },
    onMessageClose: () => {
      // 消息卡关闭不产生 ui:phoneAction，保持与正式流程一致
    },
  });

  function setActiveTab(button: HTMLButtonElement): void {
    for (const tab of [s2Button, s9Button]) {
      tab.classList.toggle('is-active', tab === button);
      tab.setAttribute('aria-pressed', tab === button ? 'true' : 'false');
    }
  }

  function openPanel(button: HTMLButtonElement, panel: PhonePanel): void {
    vibration.hideAll();
    setActiveTab(button);
    phone.open(panel);
  }

  s2Button.addEventListener('click', () => openPanel(s2Button, S2_PANEL));
  s9Button.addEventListener('click', () => openPanel(s9Button, S9_PANEL));
  vibrateButton.addEventListener('click', () => {
    vibration.show(S4_VIBRATION);
  });

  function appendLog(payload: {
    phoneId: string;
    action: string;
    optionId?: string;
  }): void {
    const parts = [payload.phoneId, payload.action];
    if (payload.optionId) parts.push(payload.optionId);
    const item = createElement('li', 'phone-preview__log-item', parts.join(' · '));
    logList.append(item);
    while (logList.childElementCount > 8) {
      logList.firstElementChild?.remove();
    }
    logList.scrollTop = logList.scrollHeight;
  }

  const unsubscribe = bus.on('ui:phoneAction', (payload) => appendLog(payload));

  setActiveTab(s2Button);
  s2Button.classList.add('is-active');
  s2Button.setAttribute('aria-pressed', 'true');
  phone.open(S2_PANEL);

  return () => {
    unsubscribe();
    phone.dispose();
    vibration.dispose();
    root.remove();
  };
}