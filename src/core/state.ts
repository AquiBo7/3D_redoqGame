// core/state.ts —— 单局状态、多周目元数据、纯效果与条件计算
// 本模块属于 core，严格禁止 import three.js。

import type {
  Condition,
  LogSpec,
  LogType,
  Role,
  SceneId,
  StoryEffect,
} from '../data/storySchema';

export interface LogEntry {
  /** Date.now() 毫秒时间戳 */
  timestamp: number;
  sceneId: SceneId;
  type: LogType;
  summary: string;
}

export interface StoryState {
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
  trust: number;
  harm: number;
  log: LogEntry[];
}

export interface MetaProgress {
  unlockedRoles: Role[];
  unlockedEndings: string[];
}

export function createInitialStoryState(): StoryState {
  return {
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
    trust: 0,
    harm: 20,
    log: [],
  };
}

export function createInitialMetaProgress(): MetaProgress {
  return {
    unlockedRoles: ['bystander'],
    unlockedEndings: [],
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

  const next: StoryState = { ...state, log: [...state.log] };
  const changed = new Set<keyof StoryState>();
  const set = effect.set;

  if (set) {
    if (set.momReply !== undefined && next.momReply !== set.momReply) {
      next.momReply = set.momReply;
      changed.add('momReply');
    }
    if (set.reasonText !== undefined && next.reasonText !== set.reasonText) {
      next.reasonText = set.reasonText;
      changed.add('reasonText');
    }
    if (set.seenBag !== undefined && next.seenBag !== set.seenBag) {
      next.seenBag = set.seenBag;
      changed.add('seenBag');
    }
    if (set.seenHandoff !== undefined && next.seenHandoff !== set.seenHandoff) {
      next.seenHandoff = set.seenHandoff;
      changed.add('seenHandoff');
    }
    if (set.noticedTyper !== undefined && next.noticedTyper !== set.noticedTyper) {
      next.noticedTyper = set.noticedTyper;
      changed.add('noticedTyper');
    }
    if (set.handedPen !== undefined && next.handedPen !== set.handedPen) {
      next.handedPen = set.handedPen;
      changed.add('handedPen');
    }
    if (set.seenCrossedOut !== undefined && next.seenCrossedOut !== set.seenCrossedOut) {
      next.seenCrossedOut = set.seenCrossedOut;
      changed.add('seenCrossedOut');
    }
    if (set.picked !== undefined && next.picked !== set.picked) {
      next.picked = set.picked;
      changed.add('picked');
    }
    if (set.seenFatherWatching !== undefined && next.seenFatherWatching !== set.seenFatherWatching) {
      next.seenFatherWatching = set.seenFatherWatching;
      changed.add('seenFatherWatching');
    }
  }

  const add = effect.add;
  if (add) {
    if (add.trust !== undefined && add.trust !== 0) {
      next.trust += add.trust;
      changed.add('trust');
    }
    if (add.phoneIgnored !== undefined && add.phoneIgnored !== 0) {
      next.phoneIgnored += add.phoneIgnored;
      changed.add('phoneIgnored');
    }
    if (add.harm !== undefined && add.harm !== 0) {
      next.harm += add.harm;
      changed.add('harm');
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

  switch (condition.key) {
    case 'seenBag':
      return state.seenBag === condition.equals;
    case 'seenHandoff':
      return state.seenHandoff === condition.equals;
    case 'noticedTyper':
      return state.noticedTyper === condition.equals;
    case 'handedPen':
      return state.handedPen === condition.equals;
    case 'seenCrossedOut':
      return state.seenCrossedOut === condition.equals;
    case 'picked':
      return state.picked === condition.equals;
    case 'seenFatherWatching':
      return state.seenFatherWatching === condition.equals;
    case 'trust':
      return compareNumber(state.trust, condition.op, condition.value);
    case 'phoneIgnored':
      return compareNumber(state.phoneIgnored, condition.op, condition.value);
    case 'harm':
      return compareNumber(state.harm, condition.op, condition.value);
    case 'momReply':
      return compareString(state.momReply, condition.op, condition.value);
    case 'reasonText':
      return compareString(state.reasonText, condition.op, condition.value);
    default:
      return false;
  }
}