// data/storySchema.ts —— 剧本数据结构与字面量常量
// 纯类型 / 常量，不包含剧情推进逻辑；core 与 data 共用。

export const SCENE_IDS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9'] as const;
export type SceneId = (typeof SCENE_IDS)[number];

export const ROLES = ['bystander', 'victim', 'perpetrator'] as const;
export type Role = (typeof ROLES)[number];

export function isSceneId(value: unknown): value is SceneId {
  return typeof value === 'string' && (SCENE_IDS as readonly string[]).includes(value);
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** 3D 场景 key，与 src/scenes3d 的独立场景文件对应 */
export type SceneKey = 'room' | 'street' | 'gate' | 'desk' | 'building';

export type SpeakerId = 'linxia' | 'father' | 'volunteer' | 'mom';

export type LogType = 'choice' | 'observe' | 'ignore' | 'system';

export interface LogSpec {
  type: LogType;
  summary: string;
}

export type BooleanStateKey =
  | 'seenBag'
  | 'seenHandoff'
  | 'noticedTyper'
  | 'handedPen'
  | 'seenCrossedOut'
  | 'picked'
  | 'seenFatherWatching';

export type StringStateKey = 'momReply' | 'reasonText';

export type NumericStateKey = 'trust' | 'phoneIgnored' | 'harm';

/** 可直接赋值的状态字段（数值字段只允许通过 add 增减） */
export interface StateSet {
  momReply?: string | null;
  reasonText?: string | null;
  seenBag?: boolean;
  seenHandoff?: boolean;
  noticedTyper?: boolean;
  handedPen?: boolean;
  seenCrossedOut?: boolean;
  picked?: boolean;
  seenFatherWatching?: boolean;
}

export interface StoryEffect {
  set?: StateSet;
  add?: Partial<Record<NumericStateKey, number>>;
  log?: LogSpec | LogSpec[];
}

export type ComparisonOp = '>' | '>=' | '==' | '!=' | '<=' | '<';

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { role: Role | Role[] }
  | { key: BooleanStateKey; equals: boolean }
  | { key: NumericStateKey; op: ComparisonOp; value: number }
  | { key: StringStateKey; op: '==' | '!='; value: string | null };

export interface DialogueLine {
  /** null 表示旁白 / 舞台指示 */
  speaker: SpeakerId | null;
  text: string;
}

export interface PhoneChatMessage {
  id: string;
  from: string;
  time?: string;
  text: string;
  unread?: boolean;
}

export interface PhoneReplyOption {
  id: string;
  text: string;
  effects?: StoryEffect;
}

export type PhoneSection =
  | { kind: 'alarm'; id: string; label: string; dismissed: boolean }
  | {
      kind: 'chat';
      id: string;
      title: string;
      unread: number;
      messages: PhoneChatMessage[];
      replyOptions?: PhoneReplyOption[];
    }
  | { kind: 'memo'; id: string; title: string; updatedAt: string; items: string[] }
  | { kind: 'notice'; id: string; text: string };

export interface PhonePanel {
  id: string;
  lockTime?: string;
  sections: PhoneSection[];
  closeActionId: string;
}

export interface StoryChoice {
  id: string;
  text: string;
  when?: Condition;
  effects?: StoryEffect;
  /** 跳转到本场景内的步骤 id；缺省进入下一步 */
  goto?: string;
}

export type WaitTarget = { zoneId: string } | { interactId: string };

export type StoryStep =
  | {
      kind: 'dialogue';
      id: string;
      when?: Condition;
      lines: DialogueLine[];
      effects?: StoryEffect;
    }
  | {
      kind: 'caption';
      id: string;
      when?: Condition;
      text: string;
      durationMs?: number;
      effects?: StoryEffect;
    }
  | {
      kind: 'phone';
      id: string;
      when?: Condition;
      panel: PhonePanel;
      effects?: StoryEffect;
    }
  | {
      kind: 'choice';
      id: string;
      when?: Condition;
      prompt?: string;
      options: StoryChoice[];
      effects?: StoryEffect;
    }
  | {
      kind: 'cutscene';
      id: string;
      when?: Condition;
      key: string;
      durationMs: number;
      skippable: boolean;
      effects?: StoryEffect;
    }
  | {
      kind: 'wait';
      id: string;
      when?: Condition;
      waitFor: WaitTarget;
      effects?: StoryEffect;
    }
  | { kind: 'system'; id: string; when?: Condition; effects: StoryEffect }
  | { kind: 'end'; id: string; when?: Condition; effects?: StoryEffect };

export type TriggerEvent =
  | 'scene:enterZone'
  | 'scene:gazeHotspot'
  | 'scene:interact'
  | 'ui:phoneAction';

export interface SceneTrigger {
  id: string;
  event: TriggerEvent;
  /** zoneId / hotspotId / targetId / phoneId */
  target?: string;
  /** 仅 ui:phoneAction 使用 */
  action?: string;
  when?: Condition;
  /** 默认 true，只在本场景内触发一次 */
  once?: boolean;
  effects?: StoryEffect;
  /** 客观观察字幕（不占心声字幕名额） */
  reveal?: { text: string; durationMs?: number };
}

export interface TransitionRule {
  when?: Condition;
  to: SceneId;
}

export interface SceneDef {
  id: SceneId;
  sceneKey: SceneKey;
  title: string;
  onEnter?: StoryEffect;
  steps: StoryStep[];
  triggers?: SceneTrigger[];
  transitions: TransitionRule[];
  /** 给 3D / 美术 / 音频的舞台说明，不参与状态逻辑 */
  stageNotes?: string[];
}

export interface ChapterStory {
  id: 'ch1';
  title: string;
  startScene: SceneId;
  characters: Record<SpeakerId, { name: string }>;
  scenes: Record<SceneId, SceneDef>;
}