// core/state.ts —— 单局状态、多周目元数据、纯效果与条件计算
// 本模块属于 core，严格禁止 import three.js。

import type {
  Condition,
  LogSpec,
  LogType,
  NumericStateKey,
  Role,
  SceneId,
  StoryEffect,
  StoryVariables,
} from '../data/storySchema';

export interface LogEntry {
  /** Date.now() 毫秒时间戳 */
  timestamp: number;
  sceneId: SceneId;
  type: LogType;
  summary: string;
}

export interface StoryState extends StoryVariables {
  log: LogEntry[];
}

export interface MetaProgress {
  unlockedRoles: Role[];
  unlockedEndings: string[];
  achievements: string[];
}

export function createInitialStoryState(): StoryState {
  return {
    newsSeen: false,
    helpedPasserby: false,
    momReply: null,
    phoneIgnored: 0,
    seenBag: false,
    seenHandoff: false,
    noticedTyper: false,
    handedPen: false,
    reasonText: null,
    seenCrossedOut: false,
    picked: false,
    seenFatherWatching: false,
    noticedPhoneBehind: false,
    noticedPhoto: false,
    likedPhoto: false,
    roommateReply: null,
    pointedOut: false,
    canteenSeen: 0,
    postChoice: null,
    addedHer: false,
    listened: false,
    evidence: false,
    seat: null,
    teacherTalked: false,
    tellTeacher: null,
    visitedStairwell: false,
    askedAboutFather: false,
    fatherKnows: false,
    clues: [],
    wrongAsks: 0,
    foundAyuanWay: null,
    yuanState: null,
    yuanScore: 0,
    yuanKeys: [],
    route: null,
    postDeleted: false,
    joined: false,
    phrase: null,
    stage1Tries: 0,
    crystalHits: 0,
    kills: 0,
    helpedByAyuan: false,
    apologized: false,
    soloRepair: false,
    trust: 0,
    harm: 20,
    ending: null,
    finalAnswer: null,
    draftReactions: [],
    log: [],
  };
}

export function createInitialMetaProgress(): MetaProgress {
  return {
    unlockedRoles: ['bystander'],
    unlockedEndings: [],
    achievements: [],
  };
}

export interface EffectApplication {
  state: StoryState;
  changedKeys: (keyof StoryState)[];
}

/** 纯函数：应用剧本效果，返回新状态与被修改字段 */
export function applyStoryEffect(
  state: StoryState,
  effect: StoryEffect | undefined,
  sceneId: SceneId,
  timestamp: number,
): EffectApplication {
  if (!effect) return { state, changedKeys: [] };

  const next: StoryState = { ...state, log: state.log.map((entry) => ({ ...entry })) };
  const changed = new Set<keyof StoryState>();
  const set = effect.set;

  if (set) {
    const variables: StoryVariables = next;
    const assign = <K extends keyof StoryVariables>(key: K): void => {
      const value = set[key];
      if (value !== undefined && next[key] !== value) {
        variables[key] = value;
        changed.add(key);
      }
    };
    for (const key of Object.keys(set) as (keyof StoryVariables)[]) assign(key);
  }

  // set 也允许赋数组；必须在追加前复制，不能共享输入状态或效果数据的数组。
  next.clues = [...next.clues];
  next.yuanKeys = [...next.yuanKeys];
  next.draftReactions = [...next.draftReactions];

  const add = effect.add;
  if (add) {
    for (const key of Object.keys(add) as NumericStateKey[]) {
      const amount = add[key];
      if (amount !== undefined && amount !== 0) {
        next[key] += amount;
        changed.add(key);
      }
    }
  }

  if (effect.pushClue !== undefined) {
    const clues = typeof effect.pushClue === 'string' ? [effect.pushClue] : effect.pushClue;
    for (const clue of clues) {
      if (next.clues.includes(clue)) continue;
      next.clues.push(clue);
      changed.add('clues');
    }
  }
  if (effect.pushYuanKey !== undefined) {
    next.yuanKeys.push(effect.pushYuanKey);
    changed.add('yuanKeys');
  }
  if (effect.pushDraftReaction !== undefined) {
    const reactions = typeof effect.pushDraftReaction === 'string'
      ? [effect.pushDraftReaction]
      : effect.pushDraftReaction;
    for (const reaction of reactions) {
      if (next.draftReactions.includes(reaction)) continue;
      next.draftReactions.push(reaction);
      changed.add('draftReactions');
    }
  }

  if (effect.log) {
    const specs: LogSpec[] = Array.isArray(effect.log) ? effect.log : [effect.log];
    for (const spec of specs) {
      next.log.push({
        timestamp,
        sceneId,
        type: spec.type,
        summary: spec.summary,
      });
    }
    if (specs.length > 0) changed.add('log');
  }

  if (changed.size === 0) return { state, changedKeys: [] };
  return { state: next, changedKeys: [...changed] };
}

function compareNumber(actual: number, op: '>' | '>=' | '==' | '!=' | '<=' | '<', expected: number): boolean {
  switch (op) {
    case '>':
      return actual > expected;
    case '>=':
      return actual >= expected;
    case '==':
      return actual === expected;
    case '!=':
      return actual !== expected;
    case '<=':
      return actual <= expected;
    case '<':
      return actual < expected;
  }
}

function compareString(actual: string | null, op: '==' | '!=', expected: string | null): boolean {
  return op === '==' ? actual === expected : actual !== expected;
}

/** 纯函数：求值剧本条件；未配置条件视为通过 */
export function evaluateCondition(
  condition: Condition | undefined,
  state: StoryState,
  role: Role,
): boolean {
  if (!condition) return true;

  if ('all' in condition) {
    return condition.all.every((item) => evaluateCondition(item, state, role));
  }
  if ('any' in condition) {
    return condition.any.some((item) => evaluateCondition(item, state, role));
  }
  if ('not' in condition) {
    return !evaluateCondition(condition.not, state, role);
  }
  if ('role' in condition) {
    return typeof condition.role === 'string'
      ? condition.role === role
      : condition.role.includes(role);
  }

  if ('matches' in condition) {
    const actual = state[condition.key];
    return actual.length === condition.matches.length && actual.every((value, index) => value === condition.matches[index]);
  }
  if ('only' in condition) return state[condition.key].every((value) => condition.only.includes(value));
  if ('equals' in condition) return state[condition.key] === condition.equals;

  const actual = state[condition.key];
  if (typeof condition.value === 'number') {
    return typeof actual === 'number' && compareNumber(actual, condition.op, condition.value);
  }
  return (actual === null || typeof actual === 'string') &&
    compareString(actual, condition.op, condition.value);
}