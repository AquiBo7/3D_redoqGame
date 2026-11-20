// core/sceneMachine.ts —— 数据驱动的 S1–S9 场景状态机
// 只消费 story 数据与事件，不直接操作 DOM / localStorage；存档由 onPersist 回调交给 engine。
// 本模块属于 core，严格禁止 import three.js。

import type {
  ChapterStory,
  PhonePanel,
  PhoneReplyOption,
  Role,
  SceneDef,
  SceneId,
  SceneTrigger,
  StoryEffect,
  StoryStep,
} from '../data/storySchema';
import type { EventBus } from './eventBus';
import type { ChapterSave } from './saveStore';
import { applyStoryEffect, createInitialStoryState, evaluateCondition } from './state';
import type { StoryState } from './state';

export interface MachineSnapshot {
  sceneId: SceneId;
  role: Role;
  state: StoryState;
  stepIndex: number;
  firedTriggerIds: string[];
  ended: boolean;
}

export interface SceneMachineOptions {
  chapter: ChapterStory;
  bus: EventBus;
  now?: () => number;
  onPersist?: (snapshot: MachineSnapshot, completed: boolean) => void;
}

function cloneState(state: StoryState): StoryState {
  return { ...state, clues: [...state.clues], yuanKeys: [...state.yuanKeys], log: state.log.map((entry) => ({ ...entry })) };
}

function findReplyOption(panel: PhonePanel, optionId: string): PhoneReplyOption | undefined {
  for (const section of panel.sections) {
    const options = section.kind === 'chat' ? section.replyOptions : section.kind === 'post' ? section.actions : undefined;
    const found = options?.find((option) => option.id === optionId);
    if (found) return found;
  }
  return undefined;
}

export class SceneMachine {
  private readonly chapter: ChapterStory;
  private readonly bus: EventBus;
  private readonly now: () => number;
  private readonly onPersist: SceneMachineOptions['onPersist'];
  private readonly speakerNames: Record<string, string>;

  private state: StoryState;
  private sceneId: SceneId;
  private role: Role = 'bystander';
  private stepIndex = 0;
  private firedTriggers = new Set<string>();
  private repliedOptions = new Set<string>();
  private ended = false;
  private started = false;
  private hasEntered = false;

  constructor(options: SceneMachineOptions) {
    this.chapter = options.chapter;
    this.bus = options.bus;
    this.now = options.now ?? (() => Date.now());
    this.onPersist = options.onPersist;
    this.speakerNames = Object.fromEntries(
      (Object.entries(options.chapter.characters) as Array<[string, { name: string }]>).map(
        ([id, character]) => [id, character.name],
      ),
    );
    this.state = createInitialStoryState();
    this.sceneId = options.chapter.startScene;
  }

  startNew(entryScene: SceneId, role: Role): void {
    const sceneId = this.chapter.scenes[entryScene] ? entryScene : this.chapter.startScene;
    this.started = true;
    this.hasEntered = false;
    this.state = createInitialStoryState();
    this.role = role;
    this.enterScene(sceneId, role, true);
  }

  continueFrom(save: ChapterSave): void {
    this.started = true;
    this.state = cloneState(save.state);
    this.role = save.role;
    this.enterScene(save.sceneId, save.role, false, save.completed);
  }

  /** 调试跳关：保留当前状态，进入目标场景并执行 onEnter */
  jumpTo(sceneId: SceneId): void {
    if (!this.started) {
      this.startNew(sceneId, this.role);
      return;
    }
    this.enterScene(sceneId, this.role, true);
  }

  onEnterZone(sceneId: SceneId, zoneId: string): void {
    if (!this.acceptSceneEvent(sceneId)) return;

    const triggered = this.fireTriggers(
      (trigger) => trigger.event === 'scene:enterZone' && trigger.target === zoneId,
    );
    this.emitStateChanged(triggered);

    const step = this.currentStep();
    if (step?.kind === 'wait' && 'zoneId' in step.waitFor && step.waitFor.zoneId === zoneId) {
      const changed = new Set<keyof StoryState>();
      this.applyInto(changed, step.effects);
      this.emitStateChanged(changed);
      this.advance();
    }
  }

  onGazeHotspot(sceneId: SceneId, hotspotId: string): void {
    if (!this.acceptSceneEvent(sceneId)) return;
    const changed = this.fireTriggers(
      (trigger) => trigger.event === 'scene:gazeHotspot' && trigger.target === hotspotId,
    );
    this.emitStateChanged(changed);
  }

  onInteract(sceneId: SceneId, targetId: string): void {
    if (!this.acceptSceneEvent(sceneId)) return;

    const triggered = this.fireTriggers(
      (trigger) => trigger.event === 'scene:interact' && trigger.target === targetId,
    );
    this.emitStateChanged(triggered);

    const step = this.currentStep();
    if (step?.kind === 'choice' && step.allowMovement) {
      const option = step.options.find((item) => item.interactId === targetId && evaluateCondition(item.when, this.state, this.role));
      if (option) this.onChooseOption(step.id, option.id);
      return;
    }
    if (
      step?.kind === 'wait' &&
      'interactId' in step.waitFor &&
      step.waitFor.interactId === targetId
    ) {
      const changed = new Set<keyof StoryState>();
      this.applyInto(changed, step.effects);
      this.emitStateChanged(changed);
      this.advance();
    }
  }

  onMinigameEnd(stepId: string, hits: number, kills: number, tries = 0): void {
    const step = this.currentStep();
    if (this.ended || step?.kind !== 'minigame' || step.id !== stepId) return;
    if (![hits, kills, tries].every((value) => Number.isSafeInteger(value) && value >= 0)) return;
    const changed = new Set<keyof StoryState>();
    this.applyInto(changed, {
      add: { harm: Math.min(hits, 8) - Math.min(Math.floor(kills / 5), 4) },
      ...(step.game === 'crystal' ? { set: { crystalHits: hits, kills, stage1Tries: tries, helpedByAyuan: this.state.joined } } : {}),
      log: { type: 'choice', summary: step.game === 'bubble' ? '尝试挡住不断涌来的评论。' : '守在浅黄色水晶旁。' },
    });
    this.emitStateChanged(changed);
    this.advance();
  }

  onDialogueEnd(stepId: string): void {
    const step = this.currentStep();
    if (!step || this.ended) return;
    const waiting =
      step.kind === 'dialogue' || step.kind === 'caption' || step.kind === 'cutscene' || step.kind === 'intertitle' || step.kind === 'art';
    if (!waiting || step.id !== stepId) return;
    this.advance();
  }

  onChooseOption(stepId: string, choiceId: string): void {
    const step = this.currentStep();
    if (this.ended || step?.kind !== 'choice' || step.id !== stepId) return;

    const option = step.options.find(
      (item) =>
        item.id === choiceId && evaluateCondition(item.when, this.state, this.role),
    );
    if (!option) return;

    const changed = new Set<keyof StoryState>();
    this.applyInto(changed, option.effects);
    this.emitStateChanged(changed);

    if (option.goto) {
      this.gotoStep(option.goto);
      return;
    }
    this.advance();
  }

  onPhoneAction(
    phoneId: string,
    action: 'close' | 'ignore' | 'open' | 'reply',
    optionId?: string,
  ): void {
    if (!this.started || this.ended) return;
    const activeStep = this.currentStep();
    if (action === 'reply' && (activeStep?.kind !== 'phone' || activeStep.panel.id !== phoneId)) return;
    const replyKey = `${phoneId}:${optionId ?? ''}`;
    if (action === 'reply' && this.repliedOptions.has(replyKey)) return;

    const triggered = this.fireTriggers(
      (trigger) =>
        trigger.event === 'ui:phoneAction' &&
        (trigger.target === undefined || trigger.target === phoneId) &&
        (trigger.action === undefined || trigger.action === action) &&
        (action !== 'reply' || trigger.id === optionId),
    );
    this.emitStateChanged(triggered);

    const step = this.currentStep();
    if (step?.kind !== 'phone' || step.panel.id !== phoneId) return;

    if (action === 'close') {
      this.bus.emit('ui:hidePhone', { phoneId });
      this.advance();
      return;
    }

    if (action === 'reply' && optionId) {
      const option = findReplyOption(step.panel, optionId);
      if (!option) return;
      this.repliedOptions.add(replyKey);
      const changed = new Set<keyof StoryState>();
      this.applyInto(changed, option.effects);
      this.emitStateChanged(changed);
    }
  }

  getState(): StoryState {
    return cloneState(this.state);
  }

  getSceneId(): SceneId {
    return this.sceneId;
  }

  getRole(): Role {
    return this.role;
  }

  isStarted(): boolean {
    return this.started;
  }

  isEnded(): boolean {
    return this.ended;
  }

  getSnapshot(): MachineSnapshot {
    return {
      sceneId: this.sceneId,
      role: this.role,
      state: cloneState(this.state),
      stepIndex: this.stepIndex,
      firedTriggerIds: [...this.firedTriggers],
      ended: this.ended,
    };
  }

  private enterScene(
    sceneId: SceneId,
    role: Role,
    applyOnEnter: boolean,
    showEnding = false,
  ): void {
    const fromSceneId = this.hasEntered ? this.sceneId : null;
    const scene = this.chapter.scenes[sceneId];
    if (!scene) throw new Error(`未配置场景 ${sceneId}`);

    this.sceneId = sceneId;
    this.role = role;
    this.stepIndex = 0;
    this.firedTriggers = new Set();
    this.repliedOptions.clear();
    this.ended = false;
    this.started = true;
    this.hasEntered = true;

    const changed = new Set<keyof StoryState>();
    if (applyOnEnter) {
      this.applyInto(changed, scene.onEnter);
      this.applyInto(changed, {
        log: { type: 'system', summary: `进入 ${scene.id} ${scene.title}` },
      });
    }

    this.onPersist?.(this.getSnapshot(), false);
    this.bus.emit('scene:transition', {
      fromSceneId,
      toSceneId: sceneId,
      sceneKey: scene.sceneKey,
      role,
      title: scene.title,
    });
    this.emitStateChanged(changed, true);

    if (showEnding) {
      this.ended = true;
      this.onPersist?.(this.getSnapshot(), true);
      this.emitChapterEnd();
      return;
    }

    this.executeCurrentStep();
  }

  private executeCurrentStep(): void {
    if (!this.started || this.ended) return;
    const scene = this.currentScene();

    while (this.stepIndex < scene.steps.length) {
      const step = scene.steps[this.stepIndex];

      if (!evaluateCondition(step.when, this.state, this.role)) {
        this.stepIndex += 1;
        continue;
      }

      const changed = new Set<keyof StoryState>();
      if (step.kind !== 'wait') this.applyInto(changed, step.effects);
      this.emitStateChanged(changed);

      this.bus.emit('ui:worldBlocked', {
        blocked: !['system', 'goto', 'wait', 'caption'].includes(step.kind) && !(step.kind === 'choice' && step.allowMovement === true),
      });
      switch (step.kind) {
        case 'minigame':
          this.bus.emit('ui:showMinigame', { stepId: step.id, game: step.game, joined: this.state.joined, tries: this.state.stage1Tries });
          return;

        case 'art':
          this.bus.emit('ui:showArt', { stepId: step.id, assetId: step.assetId });
          return;
        case 'system':
          this.stepIndex += 1;
          continue;

        case 'goto':
          this.gotoStep(step.target);
          return;

        case 'end':
          this.finishChapter();
          return;

        case 'dialogue':
          this.bus.emit('ui:showDialogue', {
            stepId: step.id,
            lines: step.lines,
            speakerNames: this.speakerNames,
          });
          return;

        case 'caption':
          this.bus.emit('ui:showCaption', {
            stepId: step.id,
            text: step.text,
            durationMs: step.durationMs ?? 2400,
            kind: 'inner',
          });
          return;

        case 'intertitle':
          this.bus.emit('ui:showIntertitle', {
            stepId: step.id, lines: step.lines,
            lineDurationMs: step.lineDurationMs ?? 2000, skippable: step.skippable !== false,
          });
          return;

        case 'phone':
          this.bus.emit('ui:showPhone', { stepId: step.id, panel: step.panel });
          return;

        case 'choice': {
          const options = step.options.filter((option) =>
            evaluateCondition(option.when, this.state, this.role),
          );
          if (options.length === 0) {
            this.stepIndex += 1;
            continue;
          }
          this.bus.emit('ui:showChoices', {
            stepId: step.id,
            prompt: step.prompt,
            ...(step.allowMovement ? { allowMovement: true } : {}),
            options: options.map((option) => ({ id: option.id, text: option.text })),
          });
          return;
        }

        case 'cutscene':
          this.bus.emit('scene:cutscene', {
            stepId: step.id,
            key: step.key,
            durationMs: step.durationMs,
            skippable: step.skippable,
          });
          return;

        case 'wait':
          return;
      }
    }

    this.finishScene();
  }

  private finishScene(): void {
    const scene = this.currentScene();
    const rule = scene.transitions.find((item) =>
      evaluateCondition(item.when, this.state, this.role),
    );
    if (rule) {
      this.enterScene(rule.to, this.role, true);
      return;
    }
    this.finishChapter();
  }

  private finishChapter(): void {
    if (this.ended) return;
    this.ended = true;
    this.onPersist?.(this.getSnapshot(), true);
    this.emitChapterEnd();
  }

  private emitChapterEnd(): void {
    this.bus.emit('game:chapterEnd', {
      chapterId: 'ch1',
      sceneId: this.sceneId,
      state: this.getState(),
    });
  }

  private advance(): void {
    this.stepIndex += 1;
    this.executeCurrentStep();
  }

  private gotoStep(stepId: string): void {
    const index = this.currentScene().steps.findIndex((step) => step.id === stepId);
    if (index < 0) {
      console.warn(`[sceneMachine] 未找到步骤 ${stepId}，按顺序继续。`);
      this.advance();
      return;
    }
    this.stepIndex = index;
    this.executeCurrentStep();
  }

  private fireTriggers(match: (trigger: SceneTrigger) => boolean): Set<keyof StoryState> {
    const changed = new Set<keyof StoryState>();
    if (this.ended) return changed;

    for (const trigger of this.currentScene().triggers ?? []) {
      const once = trigger.once !== false;
      if (once && this.firedTriggers.has(trigger.id)) continue;
      if (!match(trigger)) continue;
      if (!evaluateCondition(trigger.when, this.state, this.role)) continue;

      if (once) this.firedTriggers.add(trigger.id);
      this.applyInto(changed, trigger.effects);

      if (trigger.reveal) {
        this.bus.emit('ui:showCaption', {
          stepId: trigger.id,
          text: trigger.reveal.text,
          durationMs: trigger.reveal.durationMs ?? 2600,
          kind: trigger.reveal.kind ?? 'observation',
        });
      }
    }
    return changed;
  }

  private applyInto(changed: Set<keyof StoryState>, effect: StoryEffect | undefined): void {
    if (!effect) return;
    const result = applyStoryEffect(this.state, effect, this.sceneId, this.now());
    this.state = result.state;
    for (const key of result.changedKeys) changed.add(key);
  }

  private emitStateChanged(changed: Set<keyof StoryState>, force = false): void {
    if (!force && changed.size === 0) return;
    this.bus.emit('state:changed', {
      sceneId: this.sceneId,
      role: this.role,
      state: this.getState(),
      changedKeys: [...changed],
    });
  }

  private currentScene(): SceneDef {
    const scene = this.chapter.scenes[this.sceneId];
    if (!scene) throw new Error(`未配置场景 ${this.sceneId}`);
    return scene;
  }

  private currentStep(): StoryStep | null {
    const steps = this.currentScene().steps;
    return this.stepIndex >= 0 && this.stepIndex < steps.length ? steps[this.stepIndex] : null;
  }

  private acceptSceneEvent(sceneId: SceneId): boolean {
    return this.started && !this.ended && sceneId === this.sceneId;
  }
}