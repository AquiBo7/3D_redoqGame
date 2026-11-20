import {
  BEST_WITHOUT_DRAWING, CHAPTER_REVIEW_CONTENT, ENDING_ACTION_CARDS, ENDING_CONTENT,
  ENDING_DRAFTS, FOOTPRINT_GROUPS, REVIEW_LABELS,
  type EndingCopy, type EndingId,
} from '../data/endingContent';
import type { StoryState } from './state';

export interface ReviewFootprint {
  id: string;
  title: string;
  lines: string[];
  /** 保留日志先后顺序和重复记录，不按时间戳重排或猜测漏掉的选择。 */
  records: string[];
}

export interface EndingReview extends EndingCopy {
  ending: EndingId | null;
  footprints: ReviewFootprint[];
  drafts: Array<{ id: string; unlocked: boolean; text: string }>;
  actions: Array<{ title: string; text: string }>;
}

/** 计次只接受非负有限整数展示；旧存档中的负值不改变剧情，也不显示为负次数。 */
function count(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** 日志与旧存档文本不能把调试量带到正式页面。 */
function publicText(text: string): boolean {
  return text.trim().length > 0 && !/harm|trust|yuanScore|伤害值?|信任值|信任度|分数|得分/i.test(text);
}

/** 纯投影：不读写存档、不访问 DOM、不重新判定结局，不修改或共享输入数组。 */
export function createEndingReview(state: Readonly<StoryState>): EndingReview {
  const copy = state.ending ? ENDING_CONTENT[state.ending] : CHAPTER_REVIEW_CONTENT;
  const withoutDrawing = state.ending === 'best' && !(state.trust >= 5);
  const lines: Record<string, string[]> = {};
  const add = (id: string, text: string): void => {
    if (publicText(text)) (lines[id] ??= []).push(text);
  };
  const hasScene = (...scenes: string[]): boolean => state.log.some((entry) => scenes.includes(entry.sceneId));

  if (state.seenBag) add('steps', '你看见了爸爸提着的两个大袋子。');
  if (state.seenHandoff) add('steps', '你看见了爸爸把林夏放下的瞬间。');
  if (state.noticedTyper) add('steps', '你留意到台阶旁低头打字的男生。');
  if (state.handedPen) add('registration', '你把笔递给了林夏。');
  if (state.seenCrossedOut) add('registration', '你看见了被划掉的“脚崴了”。');
  if (state.picked) add('registration', '你捡起了药袋。');
  if (state.seenFatherWatching) add('registration', '你回头看见爸爸站在校门口。');
  if (state.noticedPhoneBehind) add('registration', '你留意到路边举手机拍摄的同学。');

  if (state.noticedPhoto || state.likedPhoto || hasScene('S9')) {
    add('photo', state.noticedPhoto ? '你在合照的台阶上找到了浅黄色的小背影。' : '本局未记录找到合照里的小背影。');
    add('photo', state.likedPhoto ? '你给群里合照点了赞。' : '本局未记录给合照点赞。');
  }
  if (state.roommateReply) add('roommate', `你对小陈的回应：“${state.roommateReply}”`);
  if (state.pointedOut) add('roommate', '你说过：“这是我们班的吧。”');
  if (count(state.canteenSeen) > 0 || hasScene('S12')) {
    add('canteen', `你留意到了 ${count(state.canteenSeen)} 处低语与目光。`);
  }
  if (state.postChoice) add('post', `帖子爆发时，你选择了“${REVIEW_LABELS.post[state.postChoice]}”。`);

  if (state.foundAyuanWay) add('finding', `你通过这种方式找人：${REVIEW_LABELS.finding[state.foundAyuanWay]}。`);
  if (state.foundAyuanWay || count(state.wrongAsks) > 0 || hasScene('C5')) {
    add('finding', `在走廊，你认错了 ${count(state.wrongAsks)} 次人。`);
  }
  // 只呈现实际留下的轮次；提前走向围观结局时不补足三轮。
  state.yuanKeys.forEach((key, index) => {
    const label = REVIEW_LABELS.dialogue[key as keyof typeof REVIEW_LABELS.dialogue] ?? '未识别的选择';
    add('platform', `第 ${index + 1} 轮：${label}。`);
  });
  if (state.phrase) add('platform', `你说过：“${state.phrase}”`);
  if (state.postDeleted) add('platform', '原帖被删除了。');

  // joined 表示说服入队，不代表已经玩过 D5；结局也不能作为游玩证据。
  const guarded = state.log.some((entry) => entry.sceneId === 'D5' && entry.type === 'choice' && entry.summary === '守在浅黄色水晶旁。')
    || count(state.kills) > 0 || count(state.crystalHits) > 0 || count(state.stage1Tries) > 0 || state.helpedByAyuan;
  if (guarded) {
    add('guardian', `你击退了 ${count(state.kills)} 个气泡，水晶被击中了 ${count(state.crystalHits)} 次。`);
    add('guardian', state.helpedByAyuan ? '阿远与你并肩守护。' : '本次守护没有阿远协助。');
  }
  if (state.apologized) add('afterwards', '阿远当面向林夏道了歉。');
  if (state.soloRepair) add('afterwards', '你独自向林夏询问、说明。');

  const footprints = FOOTPRINT_GROUPS.map((group): ReviewFootprint => ({
    id: group.id,
    title: group.title,
    lines: lines[group.id] ?? [],
    records: state.log
      .filter((entry) => group.scenes.includes(entry.sceneId) && entry.type !== 'system' && publicText(entry.summary))
      .map((entry) => entry.summary),
  })).filter((group) => group.lines.length > 0 || group.records.length > 0);

  return {
    ending: state.ending,
    title: copy.title,
    lead: copy.lead,
    epilogue: [copy.epilogue[0], withoutDrawing ? BEST_WITHOUT_DRAWING.impact : copy.epilogue[1]],
    insight: copy.insight,
    cg: { ...(withoutDrawing ? BEST_WITHOUT_DRAWING.cg : copy.cg) },
    ...(copy.retry ? { retry: { ...copy.retry } } : {}),
    footprints,
    drafts: ENDING_DRAFTS.map((draft) => ({
      id: draft.id,
      unlocked: state.trust >= draft.threshold,
      text: state.trust >= draft.threshold ? draft.text : draft.lockedText,
    })),
    actions: ENDING_ACTION_CARDS.map((action) => ({ ...action })),
  };
}
