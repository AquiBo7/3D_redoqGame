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
import { Stage2D, ArtView } from './stage2d';
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
  const stage = new Stage2D(host, bus);
  let artStepId: string | null = null;
  const art = new ArtView(root, (stepId) => {
    closeArt();
    bus.emit('ui:dialogueEnd', { stepId });
  });

  let minigameStepId: string | null = null;
  let minigame: { show(): void; dispose(): void } | null = null;
  let minigameGeneration = 0;
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

  function closeArt(): void {
    art.hide();
    if (artStepId) lock.release(`art:${artStepId}`);
    artStepId = null;
  }

  function closeMinigame(): void {
    closeArt();
    minigameGeneration += 1;
    minigame?.dispose();
    minigame = null;
    if (minigameStepId) lock.release(`minigame:${minigameStepId}`);
    minigameStepId = null;
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
    closeMinigame();
    closeIntertitle();
    closePhone();
    closeDialogue();
    closeChoices();
    captions.clear();
    closeVibrationMessage();
    lock.releaseAll();
  }

  const unsubscribers = [
    bus.on('ui:showArt', (payload) => {
      cleanupAll();
      artStepId = payload.stepId;
      lock.acquire(`art:${payload.stepId}`);
      art.show(payload);
    }),
    bus.on('ui:showMinigame', async ({ stepId, game, joined, tries }) => {
      cleanupAll();
      minigameStepId = stepId;
      lock.acquire(`minigame:${stepId}`);
      const generation = minigameGeneration;
      if (game === 'bubble') {
        const { BubbleGame } = await import('./minigame/bubbleGame');
        if (generation !== minigameGeneration) return;
        minigame = new BubbleGame(root, (result) => {
          closeMinigame();
          bus.emit('ui:minigameEnd', { stepId, ...result });
        });
        minigame.show();
      } else {
        const { CrystalGame } = await import('./minigame/crystalGame');
        if (generation !== minigameGeneration) return;
        minigame = new CrystalGame(root, (result) => {
          closeMinigame();
          bus.emit('ui:minigameEnd', { stepId, ...result });
        }, { joined, tries });
        minigame.show();
      }
    }),
    bus.on('ui:showIntertitle', (payload) => {
      cleanupAll();
      intertitleBlockerId = `intertitle:${payload.stepId}`;
      // 空字幕也可能同步结束，必须先获取锁再调用 show。
      lock.acquire(intertitleBlockerId);
      intertitle.show(payload);
    }),

    bus.on('ui:showPhone', ({ stepId, panel }) => {
      closeMinigame();
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
      closeMinigame();
      closeIntertitle();
      closePhone();
      closeChoices();
      closeDialogue();

      dialogue.show(payload);
      dialogueBlockerId = `dialogue:${payload.stepId}`;
      lock.acquire(dialogueBlockerId);
    }),

    bus.on('ui:showChoices', (payload) => {
      closeMinigame();
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
      closeMinigame();
      lock.releaseAll();
      lock.sync();
      lock.dispose();
      intertitle.dispose();
      art.dispose();
      stage.dispose();
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
