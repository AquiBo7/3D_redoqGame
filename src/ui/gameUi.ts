// ui/gameUi.ts —— 2D 界面总装配
// 只订阅 core 事件并渲染；所有交互通过事件总线回传，阻塞式界面交由 uiLock 统一锁定控制器。

import { playPhoneChime, playUiClick } from '../audio/audioManager';
import type { EventBus } from '../core/eventBus';
import { eventBus as defaultEventBus } from '../core/eventBus';
import type { SpeakerId } from '../data/storySchema';
import { CaptionView } from './captions';
import { initObjectivePrompt } from './objectivePrompt';
import { ChoicesPanel } from './choicesPanel';
import { DialogueBox } from './dialogueBox';
import { IntertitleView } from './intertitle';
import { initVignette } from './vignette';
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
  const disposeObjective = initObjectivePrompt(root, bus);
  const disposeVignette = initVignette(host, bus);

  let intertitleBlockerId: string | null = null;
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

  const intertitle = new IntertitleView(root, (stepId) => {
    closeIntertitle();
    bus.emit('ui:dialogueEnd', { stepId });
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
      if (stepId === 's8-walk') bus.emit('ui:showObjective', { sceneId: 'S8' });
    },
  });

  const captions = new CaptionView({
    container: root,
    onInnerEnd: (stepId) => {
      bus.emit('ui:dialogueEnd', { stepId });
      if (stepId === 's1-caption') bus.emit('ui:showObjective', { sceneId: 'S1' });
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

  function closeIntertitle(): void {
    intertitle.hide();
    if (intertitleBlockerId) lock.release(intertitleBlockerId);
    intertitleBlockerId = null;
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
    closeIntertitle();
    closePhone();
    closeDialogue();
    closeChoices();
    captions.clear();
    closeVibrationMessage();
    lock.releaseAll();
  }

  const unsubscribers = [
    bus.on('ui:showIntertitle', (payload) => {
      cleanupAll();
      intertitleBlockerId = `intertitle:${payload.stepId}`;
      // 空字幕也可能同步结束，必须先获取锁再调用 show。
      lock.acquire(intertitleBlockerId);
      intertitle.show(payload);
    }),

    bus.on('ui:showPhone', ({ stepId, panel }) => {
      closeIntertitle();
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
      closeIntertitle();
      closePhone();
      closeChoices();
      closeDialogue();

      dialogue.show(payload);
      dialogueBlockerId = `dialogue:${payload.stepId}`;
      lock.acquire(dialogueBlockerId);
    }),

    bus.on('ui:showChoices', (payload) => {
      closeIntertitle();
      closePhone();
      closeDialogue();
      closeChoices();

      choices.show(payload);
      if (payload.allowMovement) {
        if (payload.stepId === 's7-bag') bus.emit('ui:showObjective', { sceneId: 'S7' });
      } else {
        choicesBlockerId = `choices:${payload.stepId}`;
        lock.acquire(choicesBlockerId);
      }
    }),

    bus.on('ui:showCaption', (payload) => {
      captions.show(payload);
    }),

    bus.on('ui:phoneVibrate', (payload) => {
      vibration.show(payload);
      playPhoneChime();
    }),

    bus.on('scene:transition', ({ toSceneId }) => {
      cleanupAll();
      if (toSceneId === 'S3') bus.emit('ui:showObjective', { sceneId: 'S3' });
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
      intertitle.dispose();
      disposeVignette();
      phone.dispose();
      dialogue.dispose();
      choices.dispose();
      captions.dispose();
      vibration.dispose();
      disposeObjective();
      root.remove();
    },
  };
}
