// data/storySchema.ts —— 剧本数据结构与字面量常量
// 纯类型 / 常量，不包含剧情推进逻辑；core 与 data 共用。

export const SCENE_IDS = [
  'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12', 'S13', 'S14',
  'C1', 'C2', 'C3', 'C4', 'C5', 'C6',
  'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'E1',
] as const;
export type SceneId = (typeof SCENE_IDS)[number];

export const ROLES = ['bystander', 'victim', 'perpetrator'] as const;
export type Role = (typeof ROLES)[number];

export function isSceneId(value: unknown): value is SceneId {
  return typeof value === 'string' && (SCENE_IDS as readonly string[]).includes(value);
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** 场景 key，包含独立 3D 场景与 2D 叙事舞台 */
export type SceneKey = 'room' | 'street' | 'gate' | 'desk' | 'building' | 'canteen' | 'interior' | 'stage2d';

export type SpeakerId = 'linxia' | 'father' | 'volunteer' | 'mom' | 'xiaochen' | 'ayuan' | 'teacher' | 'admin' | 'passerby';

export type LogType = 'choice' | 'observe' | 'ignore' | 'system';

export interface LogSpec {
  type: LogType;
  summary: string;
}

/** 全五章共享变量；日志由 core 扩展，data 不反向依赖 core。 */
export interface StoryVariables {
  momReply: string | null;
  phoneIgnored: number;
  seenBag: boolean;
  seenHandoff: boolean;
  noticedTyper: boolean;
  handedPen: boolean;
  reasonText: string | null;
  seenCrossedOut: boolean;
  picked: boolean;
  seenFatherWatching: boolean;
  noticedPhoneBehind: boolean;
  noticedPhoto: boolean;
  likedPhoto: boolean;
  roommateReply: string | null;
  pointedOut: boolean;
  canteenSeen: number;
  postChoice: 'explain' | 'wait' | 'joke' | null;
  addedHer: boolean;
  listened: boolean;
  evidence: boolean;
  seat: 'beside' | 'front' | 'far' | null;
  teacherTalked: boolean;
  tellTeacher: 'told' | 'ask_her' | 'think' | null;
  visitedStairwell: boolean;
  askedAboutFather: boolean;
  fatherKnows: boolean;
  clues: string[];
  wrongAsks: number;
  foundAyuanWay: 'recognize' | 'relay' | 'shout' | null;
  yuanState: 'unprepared' | 'guarded' | 'hostile' | null;
  yuanScore: number;
  yuanKeys: string[];
  route: 'team' | 'deleteOnly' | 'breakdown' | null;
  postDeleted: boolean;
  joined: boolean;
  phrase: string | null;
  stage1Tries: number;
  crystalHits: number;
  kills: number;
  helpedByAyuan: boolean;
  apologized: boolean;
  soloRepair: boolean;
  trust: number;
  harm: number;
  ending: 'joined' | 'bystander' | 'worst' | 'best' | 'middle' | null;
}

type StateKeysOfType<T> = {
  [K in keyof StoryVariables]: StoryVariables[K] extends T ? K : never;
}[keyof StoryVariables];

export type BooleanStateKey = StateKeysOfType<boolean>;
export type StringStateKey = StateKeysOfType<string | null>;
export type NumericStateKey = StateKeysOfType<number>;

/** 所有非 log 变量均可初始化 / 重置；数值的增减统一使用 add。 */
export type StateSet = Partial<StoryVariables>;

export interface StoryEffect {
  set?: StateSet;
  add?: Partial<Record<NumericStateKey, number>>;
  /** 去重记录线索，保留首次出现的顺序。 */
  pushClue?: string | string[];
  /** 按选择顺序追加，允许重复类型。 */
  pushYuanKey?: string;
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
  | { [K in StringStateKey]: { key: K; op: '==' | '!='; value: StoryVariables[K] } }[StringStateKey];

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
  | {
      kind: 'photo';
      id: string;
      title: string;
      assetId: string;
      hotspot?: { x: number; y: number; width: number; height: number };
      likeActionId?: string;
      noticeActionId?: string;
    }
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
  interactId?: string;
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
      allowMovement?: boolean;
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
  | {
      kind: 'intertitle';
      id: string;
      when?: Condition;
      lines: string[];
      lineDurationMs?: number;
      skippable?: boolean;
      effects?: StoryEffect;
    }
  | {
      kind: 'minigame';
      id: string;
      when?: Condition;
      game: 'bubble' | 'crystal';
      effects?: StoryEffect;
    }
  | { kind: 'art'; id: string; when?: Condition; assetId: string; effects?: StoryEffect }
  | { kind: 'goto'; id: string; when?: Condition; target: string; effects?: StoryEffect }
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
  /** 分阶段提供节点；状态机负责检查实际进入的场景是否存在。 */
  scenes: Partial<Record<SceneId, SceneDef>>;
}