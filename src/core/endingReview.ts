import type { AssetId } from '../data/assetManifest';
import {
  BEST_WITHDRAWN_DRAWING, BEST_WITHOUT_DRAWING, CHAPTER_REVIEW_CONTENT, DRAWING_WITHDRAWN_LOG,
  ENDING_ACTION_CARDS, ENDING_CONTENT, ENDING_DRAFTS, FINAL_ANSWER_DRAFTS, FINAL_ANSWER_LABELS,
  FOOTPRINT_GROUPS, REVIEW_LABELS,
  type EndingCopy, type EndingId,
} from '../data/endingContent';
import { LEGAL_HINTS, PERSPECTIVE_LABELS } from '../data/legalHints';
import type { StoryState } from './state';

export interface ReviewFootprint {
  id: string;
  title: string;
  lines: string[];
  /** 保留日志先后顺序和重复记录，不按时间戳重排或猜测漏掉的选择。 */
  records: string[];
}

export type ReviewPerspectiveKey = 'victim' | 'bystander' | 'perpetrator';

export interface ReviewPerspective {
  key: ReviewPerspectiveKey;
  label: string;
  text: string;
}

export interface ReviewNodeGuide {
  id: string;
  title: string;
  /** 本局日志是否走过该节点关联的场景，只作标记，不评价当时的选择。 */
  experienced: boolean;
  lawRef: string;
  lawSummary: string;
  perspectives: ReviewPerspective[];
}

export interface EndingReview extends EndingCopy {
  ending: EndingId | null;
  footprints: ReviewFootprint[];
  drafts: Array<{ id: string; unlocked: boolean; text: string; assetId?: AssetId }>;
  actions: Array<{ title: string; text: string }>;
  nodeGuides: ReviewNodeGuide[];
  /** 仅最好结局携带：用于在画作展示与对照屏渲染橙点、保安亭与翻面标记。 */
  painting?: { hasOrangeDot: boolean; hasGuardBooth: boolean; canFlip: boolean };
}

/** 计次只接受非负有限整数展示；旧存档中的负值不改变剧情，也不显示为负次数。 */
function count(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** 日志与旧存档文本不能把调试量带到正式页面。 */
function publicText(text: string): boolean {
  return text.trim().length > 0 && !/harm|trust|yuanScore|伤害值?|信任值|信任度|分数|得分/i.test(text);
}

/** 数据层文案同样过一遍校验，避免新增提示语绕过红线。 */
function safeText(text: string): string {
  return publicText(text) ? text : '';
}

/** 纯投影：不读写存档、不访问 DOM、不重新判定结局，不修改或共享输入数组。 */
export function createEndingReview(state: Readonly<StoryState>): EndingReview {
  const copy = state.ending ? ENDING_CONTENT[state.ending] : CHAPTER_REVIEW_CONTENT;
  const drawingWithdrawn = state.ending === 'best'
    && state.trust >= 5
    && state.log.some((entry) => entry.sceneId === 'E1' && entry.summary === DRAWING_WITHDRAWN_LOG);
  const withoutDrawing = state.ending === 'best' && (!(state.trust >= 5) || drawingWithdrawn);
  const lines: Record<string, string[]> = {};
  const add = (id: string, text: string): void => {
    if (publicText(text)) (lines[id] ??= []).push(text);
  };
  const hasScene = (...scenes: string[]): boolean => state.log.some((entry) => scenes.includes(entry.sceneId));

  if (state.newsSeen) {
    add('arrival', '清晨起床时看到早间新闻，你心想：“……跟我没关系。”');
    if (state.ending === 'bystander') add('arrival', '你曾经说过，这件事跟你没关系。');
  }
  if (state.helpedPasserby) add('arrival', '上学路上，你走过去帮忙扶起了摔倒的自行车。');

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
  if (state.talkedAunt) add('canteen', '打饭阿姨说起前几天给一个脚崴了的女娃娃多打了个蛋。');
  if (state.postChoice) add('post', `帖子爆发时，你选择了“${REVIEW_LABELS.post[state.postChoice]}”。`);

  if (state.foundAyuanWay) add('finding', `你通过这种方式找人：${REVIEW_LABELS.finding[state.foundAyuanWay]}。`);
  if (state.talkedGuard) {
    add('finding', state.guardWilling
      ? '你去校门口问了保安大叔，他记起了橙色手机壳并表示愿意如实作证。'
      : '你去校门口问了保安大叔，想起了那个拿橙色手机壳的男生。');
  }
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
  if (state.finalAnswer) add('afterwards', `面对林夏最后的提问，你的回应：“${FINAL_ANSWER_LABELS[state.finalAnswer]}”`);

  const footprints = FOOTPRINT_GROUPS.map((group): ReviewFootprint => ({
    id: group.id,
    title: group.title,
    lines: lines[group.id] ?? [],
    records: state.log
      .filter((entry) => group.scenes.includes(entry.sceneId) && entry.type !== 'system' && publicText(entry.summary))
      .map((entry) => entry.summary),
  })).filter((group) => group.lines.length > 0 || group.records.length > 0);

  const perspectiveKeys: ReviewPerspectiveKey[] = ['victim', 'bystander', 'perpetrator'];
  const nodeGuides: ReviewNodeGuide[] = LEGAL_HINTS.map((hint): ReviewNodeGuide => ({
    id: hint.id,
    title: safeText(hint.title),
    experienced: hint.scenes.some((scene) => hasScene(scene)),
    lawRef: safeText(hint.lawRef),
    lawSummary: safeText(hint.lawSummary),
    perspectives: perspectiveKeys.map((key): ReviewPerspective => ({
      key,
      label: safeText(PERSPECTIVE_LABELS[key]),
      text: safeText(hint.perspectives[key]),
    })),
  }));

  const bestFallback = drawingWithdrawn ? BEST_WITHDRAWN_DRAWING : BEST_WITHOUT_DRAWING;
  const drafts: EndingReview['drafts'] = ENDING_DRAFTS.map((draft) => {
    const unlocked = state.trust >= draft.threshold;
    if (draft.id === 'draft-3' && drawingWithdrawn) {
      return {
        id: draft.id,
        unlocked: true,
        text: BEST_WITHDRAWN_DRAWING.draftText,
        assetId: 'cg_ending_best_drawing' as AssetId,
      };
    }
    return {
      id: draft.id,
      unlocked,
      text: unlocked ? draft.text : draft.lockedText,
    };
  });
  const seenReactions = new Set<string>();
  state.draftReactions.forEach((reaction, index) => {
    if (!publicText(reaction) || seenReactions.has(reaction)) return;
    seenReactions.add(reaction);
    drafts.push({ id: `reaction-${index + 1}`, unlocked: true, text: reaction });
  });
  if (state.finalAnswer) {
    drafts.push({
      id: 'draft-final',
      unlocked: true,
      text: FINAL_ANSWER_DRAFTS[state.finalAnswer],
    });
  }

  const painting = state.ending === 'best'
    ? {
        hasOrangeDot: state.joined,
        hasGuardBooth: state.guardWilling,
        canFlip: state.trust >= 7,
      }
    : undefined;

  return {
    ending: state.ending,
    title: copy.title,
    lead: copy.lead,
    epilogue: [copy.epilogue[0], withoutDrawing ? bestFallback.impact : copy.epilogue[1]],
    insight: copy.insight,
    cg: { ...(withoutDrawing ? bestFallback.cg : copy.cg) },
    ...(painting ? { painting } : {}),
    ...(copy.retry ? { retry: { ...copy.retry } } : {}),
    footprints,
    drafts,
    actions: ENDING_ACTION_CARDS.map((action) => ({ ...action })),
    nodeGuides,
  };
}
