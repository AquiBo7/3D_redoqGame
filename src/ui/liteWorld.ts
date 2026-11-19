// ui/liteWorld.ts —— ?lite=1 2D 降级体验层
// 无 WebGL 时用低饱和清晨文字场景卡承载完整第一章：等待目标 / 交互点 / 观察点均为可点卡片，
// 点击后通过事件总线发出 scene:interact / scene:gazeHotspot / scene:enterZone；
// 过场以轻量文字渐显呈现，结束时回发 ui:dialogueEnd。
// 边界：纯展示层，不 import three、不修改 core 逻辑。

import { playUiClick } from '../audio/audioManager';
import type { EventBus, GameEvents } from '../core/eventBus';
import { eventBus as defaultEventBus } from '../core/eventBus';
import type { SceneId } from '../data/storySchema';
import type { StoryState } from '../core/state';
import { buildLiteSceneModel, getLiteCutscene } from './liteWorldModel';
import type { LiteAction } from './liteWorldModel';
import { createButton, createElement } from './uiDom';
import './liteWorld.css';

export interface LiteWorldOptions {
  bus?: EventBus;
  /** 启动即生效（?lite=1）；为 false 时仅待命，供 3D 初始化失败后激活 */
  active?: boolean;
}

export interface LiteWorldHandle {
  /** 激活降级界面；可选传入当前场景，用于兜底接管已开始的流程 */
  activate(sceneId?: SceneId): void;
  isActive(): boolean;
  dispose(): void;
}

type CutscenePayload = GameEvents['scene:cutscene'];

/** 与 street 场景一致的两次震动（原文案保持一致，不影响剧情状态） */
const VIBRATION_PREVIEWS: Record<string, string> = {
  'street-vibration-1': '迎新群：@所有人 新生报到 9:00 截止，请抓紧～',
  'street-vibration-2': '迎新群：有人@你，快看群消息。',
};
const VIBRATION_SCHEDULE: Array<{ id: string; delayMs: number }> = [
  { id: 'street-vibration-1', delayMs: 4000 },
  { id: 'street-vibration-2', delayMs: 26000 },
];

export function initLiteWorld(options: LiteWorldOptions = {}): LiteWorldHandle {
  const bus = options.bus ?? defaultEventBus;
  const host = document.querySelector<HTMLElement>('#ui-root') ?? document.body;

  let active = options.active ?? false;
  let currentSceneId: SceneId = 'S1';
  let blocked = false;
  let pendingCutscene: CutscenePayload | null = null;
  let cutsceneStepId = '';
  let cutsceneTimer = 0;
  const vibrationTimers: number[] = [];

  const root = createElement('section', 'lite-world');
  root.hidden = !active;
  root.setAttribute('aria-label', '2D 降级体验');

  const backdrop = createElement('div', 'lite-world__backdrop');
  backdrop.setAttribute('aria-hidden', 'true');

  const panel = createElement('div', 'lite-world__panel');

  const badges = createElement('div', 'lite-world__badges');
  badges.append(
    createElement('span', 'lite-world__eyebrow', '第一章 · 到校段'),
    createElement('span', 'lite-world__chip', '轻量 2D 体验'),
  );

  const title = createElement('h2', 'lite-world__title', '');
  const stage = createElement('p', 'lite-world__stage', '');
  stage.setAttribute('aria-live', 'polite');
  const memory = createElement('p', 'lite-world__memory', '');
  memory.hidden = true;

  const actionsLabel = createElement('h3', 'lite-world__actions-label', '此刻可以');
  const actionList = createElement('div', 'lite-world__actions');
  actionList.setAttribute('role', 'group');
  actionList.setAttribute('aria-label', '可交互对象');

  const onward = createButton('lite-world__onward', '');
  onward.hidden = true;

  const hint = createElement(
    'p',
    'lite-world__hint',
    '轻量模式不需要第一人称操作，按提示依次轻点即可。',
  );

  panel.append(badges, title, stage, memory, actionsLabel, actionList, onward, hint);
  root.append(backdrop, panel);

  const cutscene = createElement('div', 'lite-cutscene');
  cutscene.hidden = true;
  cutscene.setAttribute('role', 'dialog');
  cutscene.setAttribute('aria-label', '过场');
  const cutsceneCard = createElement('div', 'lite-cutscene__card');
  const cutsceneEyebrow = createElement('p', 'lite-cutscene__eyebrow', '过场');
  const cutsceneTitle = createElement('h3', 'lite-cutscene__title', '');
  const cutsceneText = createElement('p', 'lite-cutscene__text', '');
  const cutsceneSkip = createButton('lite-cutscene__skip', '跳过');
  cutsceneSkip.hidden = true;
  cutsceneCard.append(cutsceneEyebrow, cutsceneTitle, cutsceneText, cutsceneSkip);
  cutscene.append(cutsceneCard);
  root.append(cutscene);

  host.append(root);

  function setBlocked(value: boolean): void {
    blocked = value;
    root.classList.toggle('is-blocked', value);
  }

  function emitAction(action: LiteAction): void {
    if (blocked || !active) return;
    playUiClick();
    if (action.kind === 'hotspot') {
      bus.emit('scene:gazeHotspot', { sceneId: currentSceneId, hotspotId: action.id });
      return;
    }
    if (action.kind === 'zone') {
      bus.emit('scene:enterZone', { sceneId: currentSceneId, zoneId: action.id });
      return;
    }
    bus.emit('scene:interact', { sceneId: currentSceneId, targetId: action.id });
  }

  function renderScene(): void {
    const model = buildLiteSceneModel(currentSceneId);
    title.textContent = model.title;
    stage.textContent = model.stage;

    actionList.replaceChildren();
    for (const action of model.actions) {
      const button = createButton(`lite-world__action lite-world__action--${action.kind}`, '');
      button.setAttribute('aria-label', `${action.label}，${action.hint}`);
      button.append(
        createElement('span', 'lite-world__action-label', action.label),
        createElement('span', 'lite-world__action-hint', action.hint),
      );
      button.addEventListener('click', () => emitAction(action));
      actionList.append(button);
    }
    actionsLabel.hidden = model.actions.length === 0;

    if (model.onward) {
      onward.hidden = false;
      onward.textContent = `${model.onward.label}（下一区域）`;
      onward.setAttribute('aria-label', model.onward.label);
    } else {
      onward.hidden = true;
      onward.textContent = '';
    }
  }

  function updateMemory(state: Readonly<StoryState>): void {
    let latest: string | null = null;
    for (let index = state.log.length - 1; index >= 0; index -= 1) {
      const entry = state.log[index];
      if (entry.type === 'system') continue;
      latest = entry.summary;
      break;
    }
    if (latest) {
      memory.textContent = `记下：${latest}`;
      memory.hidden = false;
    } else {
      memory.hidden = true;
      memory.textContent = '';
    }
  }

  function clearVibrations(): void {
    for (const timer of vibrationTimers) window.clearTimeout(timer);
    vibrationTimers.length = 0;
  }

  function scheduleVibrations(): void {
    clearVibrations();
    if (!active || currentSceneId !== 'S4') return;
    for (const item of VIBRATION_SCHEDULE) {
      vibrationTimers.push(
        window.setTimeout(() => {
          bus.emit('ui:phoneVibrate', {
            vibrationId: item.id,
            preview: VIBRATION_PREVIEWS[item.id],
          });
        }, item.delayMs),
      );
    }
  }

  function clearCutscene(): void {
    if (cutsceneTimer !== 0) window.clearTimeout(cutsceneTimer);
    cutsceneTimer = 0;
    cutsceneStepId = '';
    cutscene.classList.remove('is-visible');
    cutscene.hidden = true;
    cutsceneSkip.hidden = true;
    root.classList.remove('is-cutscene');
  }

  function finishCutscene(): void {
    if (!cutsceneStepId) return;
    const stepId = cutsceneStepId;
    clearCutscene();
    setBlocked(false);
    bus.emit('ui:dialogueEnd', { stepId });
  }

  function showCutscene(payload: CutscenePayload): void {
    const info = getLiteCutscene(payload.key);
    cutsceneStepId = payload.stepId;
    cutsceneTitle.textContent = info.title;
    cutsceneText.textContent = info.text;
    cutsceneSkip.hidden = !payload.skippable;
    cutscene.hidden = false;
    cutscene.classList.remove('is-visible');
    root.classList.add('is-cutscene');
    void cutscene.offsetWidth;
    cutscene.classList.add('is-visible');

    if (cutsceneTimer !== 0) window.clearTimeout(cutsceneTimer);
    cutsceneTimer = window.setTimeout(finishCutscene, Math.max(600, payload.durationMs));
  }

  cutsceneSkip.addEventListener('click', () => {
    playUiClick();
    finishCutscene();
  });
  onward.addEventListener('click', () => {
    if (!active) return;
    const model = buildLiteSceneModel(currentSceneId);
    if (model.onward) emitAction(model.onward);
  });

  const unsubscribers = [
    bus.on('scene:transition', (payload) => {
      currentSceneId = payload.toSceneId;
      clearCutscene();
      clearVibrations();
      setBlocked(false);
      if (!active) return;
      root.hidden = false;
      renderScene();
      scheduleVibrations();
    }),

    bus.on('scene:cutscene', (payload) => {
      if (!active) {
        pendingCutscene = payload;
        return;
      }
      showCutscene(payload);
    }),

    bus.on('state:changed', ({ state }) => {
      if (!active) return;
      updateMemory(state);
    }),

    bus.on('ui:showDialogue', () => setBlocked(true)),
    bus.on('ui:showPhone', () => setBlocked(true)),
    bus.on('ui:showChoices', () => setBlocked(true)),
    bus.on('ui:dialogueEnd', () => setBlocked(false)),
    bus.on('ui:chooseOption', () => setBlocked(false)),
    bus.on('ui:phoneAction', ({ action }) => {
      if (action === 'close' || action === 'ignore') setBlocked(false);
    }),

    bus.on('game:chapterEnd', () => {
      clearCutscene();
      clearVibrations();
      pendingCutscene = null;
      root.hidden = true;
    }),
  ];

  function activate(sceneId?: SceneId): void {
    if (sceneId) currentSceneId = sceneId;
    if (active) {
      if (!root.hidden) renderScene();
      return;
    }
    active = true;
    root.hidden = false;
    renderScene();
    scheduleVibrations();
    if (pendingCutscene) {
      const payload = pendingCutscene;
      pendingCutscene = null;
      showCutscene(payload);
    }
  }

  if (active) {
    // 等待首次 scene:transition 再展示场景卡，避免开始页背后出现无关内容
    root.hidden = true;
  }

  return {
    activate,
    isActive(): boolean {
      return active;
    },
    dispose(): void {
      clearCutscene();
      clearVibrations();
      for (const unsubscribe of unsubscribers) unsubscribe();
      root.remove();
    },
  };
}