// ui/gameUi.ts —— 2D 界面总装配
// 只订阅 core 事件并渲染；所有交互通过事件总线回传，阻塞式界面交由 uiLock 统一锁定控制器。

import { playPhoneChime, playUiClick } from '../audio/audioManager';
import type { EventBus } from '../core/eventBus';
import { eventBus as defaultEventBus } from '../core/eventBus';
import type { SpeakerId } from '../data/storySchema';
import { CaptionView } from './captions';
import { ChoicesPanel } from './choicesPanel';
import { DialogueBox } from './dialogueBox';
import { PhonePanelView } from './phonePanel';
import { PhoneVibrationView } from './phoneVibrate';
import { createUiLockCoordinator } from './uiLock';
import type { ControlPort } from './uiLock';
import { createElement } from './uiDom';
import './gameUi.css';

export interface GameUiOptions {
  bus?: EventBus;
  /** 3D 世界可能延迟创建；未就绪时返回 null，创建后由 syncControls 补锁定 */
  getControls: () => ControlPort | null;
  /** 可选说话人头像 / 立绘 URL 映射，未配置或加载失败时降级首字圆标 */
  speakerPortraits?: Partial<Record<SpeakerId, string>>;
}

export interface GameUiHandle {
  syncControls(): void;
  dispose(): void;
}

export function initGameUi(options: GameUiOptions): GameUiHandle {
  const bus = options.bus ?? defaultEventBus;
  const host = document.querySelector<HTMLElement>('#ui-root') ?? document.body;
  const root = createElement('div', 'game-ui');
  host.append(root);

  const lock = createUiLockCoordinator(options.getControls);

  let phoneBlockerId: string | null = null;
  let dialogueBlockerId: string | null = null;
  let choicesBlockerId: string | null = null;
  let vibrationBlockerId: string | null = null;

  const phone = new PhonePanelView(root, {
    onAction: (panelId, action, optionId) => {
      playUiClick();
      if (action === 'close') {
        closePhone();
        bus.emit('ui:phoneAction', { phoneId: panelId, action: 'close' });
        return;
      }
      bus.emit('ui:phoneAction', { phoneId: panelId, action: 'reply', optionId });
    },
  });

  const dialogue = new DialogueBox({
    container: root,
    portraits: options.speakerPortraits,
    onEnd: (stepId) => {
      playUiClick();
      releaseDialogueLock();
      bus.emit('ui:dialogueEnd', { stepId });
    },
  });

  const choices = new ChoicesPanel(root, {
    onChoose: (stepId, choiceId) => {
      playUiClick();
      releaseChoicesLock();
      bus.emit('ui:chooseOption', { stepId, choiceId });
    },
  });

  const captions = new CaptionView({
    container: root,
    onInnerEnd: (stepId) => {
      bus.emit('ui:dialogueEnd', { stepId });
    },
  });

  const vibration = new PhoneVibrationView(root, {
    onView: (vibrationId) => {
      playUiClick();
      vibrationBlockerId = `vibration-message:${vibrationId}`;
      lock.acquire(vibrationBlockerId);
      bus.emit('ui:phoneAction', { phoneId: vibrationId, action: 'open' });
    },
    onIgnore: (vibrationId) => {
      playUiClick();
      bus.emit('ui:phoneAction', { phoneId: vibrationId, action: 'ignore' });
    },
    onMessageClose: (vibrationId) => {
      const blockerId = `vibration-message:${vibrationId}`;
      if (vibrationBlockerId !== blockerId) return;
      lock.release(blockerId);
      vibrationBlockerId = null;
    },
  });

  function releasePhoneLock(): void {
    if (!phoneBlockerId) return;
    lock.release(phoneBlockerId);
    phoneBlockerId = null;
  }

  function releaseDialogueLock(): void {
    if (!dialogueBlockerId) return;
    lock.release(dialogueBlockerId);
    dialogueBlockerId = null;
  }

  function releaseChoicesLock(): void {
    if (!choicesBlockerId) return;
    lock.release(choicesBlockerId);
    choicesBlockerId = null;
  }

  function closePhone(): void {
    phone.hide();
    releasePhoneLock();
  }

  function closeDialogue(): void {
    dialogue.hide();
    releaseDialogueLock();
  }

  function closeChoices(): void {
    choices.hide();
    releaseChoicesLock();
  }

  function closeVibrationMessage(): void {
    const blockerId = vibrationBlockerId;
    vibration.hideAll();
    if (blockerId) lock.release(blockerId);
    vibrationBlockerId = null;
  }

  function cleanupAll(): void {
    closePhone();
    closeDialogue();
    closeChoices();
    captions.clear();
    closeVibrationMessage();
    lock.releaseAll();
  }

  const unsubscribers = [
    bus.on('ui:showPhone', ({ stepId, panel }) => {
      closePhone();
      closeDialogue();
      closeChoices();
      closeVibrationMessage();

      phone.open(panel);
      phoneBlockerId = `phone:${stepId}`;
      lock.acquire(phoneBlockerId);
    }),

    bus.on('ui:hidePhone', () => {
      closePhone();
    }),

    bus.on('ui:showDialogue', (payload) => {
      closePhone();
      closeChoices();
      closeDialogue();

      dialogue.show(payload);
      dialogueBlockerId = `dialogue:${payload.stepId}`;
      lock.acquire(dialogueBlockerId);
    }),

    bus.on('ui:showChoices', (payload) => {
      closePhone();
      closeDialogue();
      closeChoices();

      choices.show(payload);
      choicesBlockerId = `choices:${payload.stepId}`;
      lock.acquire(choicesBlockerId);
    }),

    bus.on('ui:showCaption', (payload) => {
      captions.show(payload);
    }),

    bus.on('ui:phoneVibrate', (payload) => {
      vibration.show(payload);
      playPhoneChime();
    }),

    bus.on('scene:transition', () => {
      cleanupAll();
    }),

    bus.on('game:chapterEnd', () => {
      cleanupAll();
    }),
  ];

  return {
    syncControls(): void {
      lock.sync();
    },

    dispose(): void {
      for (const unsubscribe of unsubscribers) unsubscribe();
      lock.releaseAll();
      lock.sync();
      lock.dispose();
      phone.dispose();
      dialogue.dispose();
      choices.dispose();
      captions.dispose();
      vibration.dispose();
      root.remove();
    },
  };
}
