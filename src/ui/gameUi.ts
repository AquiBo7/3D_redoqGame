// ui/gameUi.ts —— 2D 界面总装配
// 只订阅 core 事件并渲染；所有交互通过事件总线回传，阻塞式界面交由 uiLock 统一锁定控制器。

import { playMessagePop, playPhoneChime, playUiClick } from '../audio/audioManager';
import type { EventBus, GameEvents } from '../core/eventBus';
import { eventBus as defaultEventBus } from '../core/eventBus';
import type { SpeakerId } from '../data/storySchema';
import { CaptionView } from './captions';
import { initObjectivePrompt } from './objectivePrompt';
import { ChoicesPanel } from './choicesPanel';
import { DialogueBox } from './dialogueBox';
import { IntertitleView } from './intertitle';
import { MomentView } from './momentView';
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
  // 手机弹窗 / 看图放大 / 黑幕过场要压在静音按钮与各全屏页之上，
  // 而 #ui-root 与 .game-ui 都会封闭内部 z-index，所以单独挂到 body 顶层模态层。
  const modalLayer = createElement('div', 'ui-modal-layer');
  document.body.append(modalLayer);

  const lock = createUiLockCoordinator(options.getControls);
  const disposeObjective = initObjectivePrompt(root, bus);
  const disposeVignette = initVignette(host, bus);
  const stage = new Stage2D(host, bus);
  let artStepId: string | null = null;
  let latestPaintingState: {
    outcome?: string | null;
    joined?: boolean;
    guardWilling?: boolean;
    trust?: number;
  } | null = null;
  const art = new ArtView(modalLayer, (stepId) => {
    closeArt();
    bus.emit('ui:dialogueEnd', { stepId });
  });

  let minigameStepId: string | null = null;
  let minigame: { show(): void; dispose(): void } | null = null;
  let minigameGeneration = 0;
  let intertitleBlockerId: string | null = null;
  let momentBlockerId: string | null = null;
  let phoneBlockerId: string | null = null;
  let dialogueBlockerId: string | null = null;
  let choicesBlockerId: string | null = null;
  let vibrationBlockerId: string | null = null;

  const phone = new PhonePanelView(modalLayer, {
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

  const intertitle = new IntertitleView(modalLayer, (stepId) => {
    closeIntertitle();
    bus.emit('ui:dialogueEnd', { stepId });
  });

  const moment = new MomentView(modalLayer, (stepId, outcome) => {
    closeMoment();
    bus.emit('ui:momentEnd', { stepId, outcome });
  }, (intensity) => playMessagePop(intensity));

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
    isWorldActive: () => options.getControls() !== null,
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

  function closeMoment(): void {
    moment.hide();
    if (momentBlockerId) lock.release(momentBlockerId);
    momentBlockerId = null;
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

  let c2EntryActive = false;
  let c2SequenceStarted = false;
  let c2FallbackTimer: number | null = null;
  let c2HideObjectiveTimer: number | null = null;
  let c2UnlockSeatsTimer: number | null = null;
  let pendingC2Choices: GameEvents['ui:showChoices'] | null = null;
  let pendingC2Caption: GameEvents['ui:showCaption'] | null = null;

  function clearC2EntrySequence(): void {
    if (c2FallbackTimer !== null) { window.clearTimeout(c2FallbackTimer); c2FallbackTimer = null; }
    if (c2HideObjectiveTimer !== null) { window.clearTimeout(c2HideObjectiveTimer); c2HideObjectiveTimer = null; }
    if (c2UnlockSeatsTimer !== null) { window.clearTimeout(c2UnlockSeatsTimer); c2UnlockSeatsTimer = null; }
    c2EntryActive = false;
    c2SequenceStarted = false;
    pendingC2Choices = null;
    pendingC2Caption = null;
  }

  function presentChoices(payload: GameEvents['ui:showChoices']): void {
    closeMinigame();
    closeIntertitle();
    closeMoment();
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
  }

  function startC2EntrySequence(): void {
    if (!c2EntryActive || c2SequenceStarted) return;
    c2SequenceStarted = true;
    if (c2FallbackTimer !== null) { window.clearTimeout(c2FallbackTimer); c2FallbackTimer = null; }
    // 进入教室先显示 1 秒“林夏正在教室里”，随后隐藏提示留出 2 秒无遮挡观察，满 3 秒后再出现选座与放开交互。
    c2HideObjectiveTimer = window.setTimeout(() => {
      c2HideObjectiveTimer = null;
      if (!c2EntryActive) return;
      bus.emit('ui:hideObjective');
    }, 1000);
    c2UnlockSeatsTimer = window.setTimeout(() => {
      c2UnlockSeatsTimer = null;
      if (!c2EntryActive) return;
      c2EntryActive = false;
      bus.emit('ui:c2SeatReady', { sceneId: 'C2' });
      const pendingCaption = pendingC2Caption;
      pendingC2Caption = null;
      if (pendingCaption) captions.show(pendingCaption);
      const pendingChoices = pendingC2Choices;
      pendingC2Choices = null;
      if (pendingChoices) presentChoices(pendingChoices);
    }, 3000);
  }

  function cleanupAll(): void {
    clearC2EntrySequence();
    closeMinigame();
    closeIntertitle();
    closeMoment();
    closePhone();
    closeDialogue();
    closeChoices();
    captions.clear();
    closeVibrationMessage();
    lock.releaseAll();
  }

  const unsubscribers = [
    bus.on('state:changed', ({ state }) => {
      latestPaintingState = {
        joined: state.joined,
        guardWilling: state.guardWilling,
        trust: state.trust,
      };
    }),
    bus.on('ui:showArt', (payload) => {
      cleanupAll();
      artStepId = payload.stepId;
      lock.acquire(`art:${payload.stepId}`);
      art.show(payload, latestPaintingState ?? undefined);
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
        }, { onSpawn: (intensity) => playMessagePop(intensity) });
        minigame.show();
      } else {
        const { CrystalGame } = await import('./minigame/crystalGame');
        if (generation !== minigameGeneration) return;
        minigame = new CrystalGame(root, (result) => {
          closeMinigame();
          bus.emit('ui:minigameEnd', { stepId, ...result });
        }, { joined, tries, onSpawn: (intensity) => playMessagePop(intensity) });
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

    bus.on('ui:showMoment', (payload) => {
      cleanupAll();
      momentBlockerId = `moment:${payload.stepId}`;
      lock.acquire(momentBlockerId);
      moment.show(payload);
    }),

    bus.on('ui:showPhone', ({ stepId, panel }) => {
      closeMinigame();
      closeIntertitle();
      closeMoment();
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
      closeMoment();
      closePhone();
      closeChoices();
      closeDialogue();

      dialogue.show(payload);
      dialogueBlockerId = `dialogue:${payload.stepId}`;
      lock.acquire(dialogueBlockerId);
    }),

    bus.on('ui:showChoices', (payload) => {
      if (c2EntryActive && payload.stepId === 'c2-seat') {
        pendingC2Choices = payload;
        return;
      }
      presentChoices(payload);
    }),

    bus.on('ui:showCaption', (payload) => {
      if (c2EntryActive && payload.stepId === 'c2-whispers') {
        pendingC2Caption = payload;
        return;
      }
      captions.show(payload);
      if (payload.stepId === 's1-news-thought-1') {
        bus.emit('ui:showObjective', { sceneId: 'S1', persistent: true });
      }
    }),

    bus.on('ui:phoneVibrate', (payload) => {
      vibration.show(payload);
      playPhoneChime();
    }),

    bus.on('world:scenePresented', ({ sceneId }) => {
      if (sceneId === 'C2' && c2EntryActive) startC2EntrySequence();
    }),

    bus.on('scene:transition', ({ toSceneId }) => {
      cleanupAll();
      if (toSceneId === 'C2') {
        c2EntryActive = true;
        c2SequenceStarted = false;
        bus.emit('ui:showObjective', { sceneId: 'C2', persistent: true });
        // 3D 世界在 scene:transition 后微任务/同期挂载 .scene-fade；100ms 后若仍无 .scene-fade 则按 2D 降级走本地定时
        c2FallbackTimer = window.setTimeout(() => {
          c2FallbackTimer = null;
          if (typeof document !== 'undefined' && document.querySelector('.scene-fade') !== null) return;
          startC2EntrySequence();
        }, 100);
        return;
      }
      if (['S3', 'S12', 'C3', 'C4', 'C5', 'C6', 'D1', 'D6'].includes(toSceneId)) {
        bus.emit('ui:showObjective', { sceneId: toSceneId });
      }
    }),

    bus.on('game:chapterEnd', () => {
      cleanupAll();
      lock.acquire('ending');
    }),
    bus.on('game:title', () => {
      latestPaintingState = null;
      cleanupAll();
      lock.acquire('title');
    }),
  ];

  return {
    syncControls(): void {
      lock.sync();
    },

    dispose(): void {
      clearC2EntrySequence();
      for (const unsubscribe of unsubscribers) unsubscribe();
      closeMinigame();
      lock.releaseAll();
      lock.sync();
      lock.dispose();
      intertitle.dispose();
      moment.dispose();
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
      modalLayer.remove();
    },
  };
}
