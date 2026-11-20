// core/eventBus.ts —— 全局事件总线与跨模块事件协议
// 跨模块通信唯一通道：3D 场景 / UI 只通过事件通知 core，禁止模块间直接 import 调用。
// 本模块属于 core，严格禁止 import three.js。

import type {
  DialogueLine,
  PhonePanel,
  Role,
  SceneId,
  SceneKey,
} from '../data/storySchema';
import type { StoryState } from './state';

export interface GameEvents {
  // 生命周期 / 开始页
  'game:start': void;
  'ui:continueGame': void;

  // 3D / 降级层 → Core
  'scene:enterZone': { sceneId: SceneId; zoneId: string };
  'scene:gazeHotspot': { sceneId: SceneId; hotspotId: string; dwellMs?: number };
  'scene:interact': { sceneId: SceneId; targetId: string };

  // 3D → 音频（由入口接线）
  'audio:motion': {
    sourceId: string;
    distance: number;
    allow: boolean;
    gain: number;
    surface: 'wood' | 'stone';
  };
  'audio:reset': void;
  'audio:alarm': void;

  // UI → Core
  'ui:chooseOption': { stepId: string; choiceId: string };
  'ui:phoneAction': {
    phoneId: string;
    action: 'close' | 'ignore' | 'open' | 'reply';
    optionId?: string;
  };
  'ui:dialogueEnd': { stepId: string };

  // Core → 外部
  'scene:transition': {
    fromSceneId: SceneId | null;
    toSceneId: SceneId;
    sceneKey: SceneKey;
    role: Role;
    title: string;
  };
  'state:changed': {
    sceneId: SceneId;
    role: Role;
    state: Readonly<StoryState>;
    changedKeys: (keyof StoryState)[];
  };
  'ui:showDialogue': {
    stepId: string;
    lines: DialogueLine[];
    speakerNames: Record<string, string>;
  };
  'ui:showIntertitle': { stepId: string; lines: string[]; lineDurationMs: number; skippable: boolean };
  'ui:showPhone': { stepId: string; panel: PhonePanel };
  'ui:hidePhone': { phoneId: string };
  'ui:showCaption': {
    stepId: string;
    text: string;
    durationMs: number;
    kind: 'inner' | 'observation';
  };
  'ui:showChoices': {
    stepId: string;
    prompt?: string;
    allowMovement?: boolean;
    options: Array<{ id: string; text: string }>;
  };
  'ui:phoneVibrate': { vibrationId: string; preview: string };
  'ui:showObjective': { sceneId: SceneId };
  'scene:cutscene': {
    stepId: string;
    key: string;
    durationMs: number;
    skippable: boolean;
  };
  'game:chapterEnd': {
    chapterId: 'ch1';
    sceneId: SceneId;
    state: Readonly<StoryState>;
  };
}

type EventName = keyof GameEvents;
type Handler<K extends EventName> = (payload: GameEvents[K]) => void;

export class EventBus {
  private listeners = new Map<EventName, Set<(payload: unknown) => void>>();

  /** 订阅事件，返回取消订阅函数 */
  on<K extends EventName>(event: K, handler: Handler<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as (payload: unknown) => void);
    return () => this.off(event, handler);
  }

  off<K extends EventName>(event: K, handler: Handler<K>): void {
    this.listeners.get(event)?.delete(handler as (payload: unknown) => void);
  }

  /** 触发事件；payload 为 void 的事件可省略第二个参数 */
  emit<K extends EventName>(
    event: K,
    ...rest: GameEvents[K] extends void ? [] : [payload: GameEvents[K]]
  ): void {
    const set = this.listeners.get(event);
    if (!set) return;
    const payload = rest[0] as GameEvents[K] | undefined;
    for (const handler of set) {
      (handler as (payload: GameEvents[K] | undefined) => void)(payload);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const eventBus = new EventBus();