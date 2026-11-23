// data/expressionPortraits.ts —— 角色差分表情立绘纯数据映射（源自《台词对照表.csv》与角色情绪档位）
// 纯数据配置，不含 DOM 或业务逻辑；所有文件位于 public/art/portraits/expressions/，按对话按需懒加载。

import type { DialogueEmotion, SpeakerId } from './storySchema';

const BASE = './art/portraits/expressions/';

export const EXPRESSION_PORTRAITS = {
  linxiaCalm1: `${BASE}linxia_calm_1.png`,
  linxiaSmile1: `${BASE}linxia_smile_1.png`,
  linxiaSmile2: `${BASE}linxia_smile_2.png`,
  linxiaJoy2: `${BASE}linxia_joy_2.png`,
  linxiaCare2: `${BASE}linxia_care_2.png`,
  linxiaGuilty2: `${BASE}linxia_guilty_2.png`,
  linxiaLow2: `${BASE}linxia_low_2.png`,
  linxiaLow3: `${BASE}linxia_low_3.png`,
  linxiaUpset2: `${BASE}linxia_upset_2.png`,

  ayuanCare2: `${BASE}ayuan_care_2.png`,
  ayuanLow2: `${BASE}ayuan_low_2.png`,
  ayuanHesitate2: `${BASE}ayuan_hesitate_2.png`,
  ayuanSurprise2: `${BASE}ayuan_surprise_2.png`,
  ayuanGuilty2: `${BASE}ayuan_guilty_2.png`,
  ayuanGuilty3: `${BASE}ayuan_guilty_3.png`,
  ayuanUpset2: `${BASE}ayuan_upset_2.png`,
  ayuanSmirk2: `${BASE}ayuan_smirk_2.png`,
  ayuanSmirk3: `${BASE}ayuan_smirk_3.png`,

  xiaochenCare2: `${BASE}xiaochen_care_2.png`,
  xiaochenGuilty2: `${BASE}xiaochen_guilty_2.png`,
  xiaochenSurprise2: `${BASE}xiaochen_surprise_2.png`,
  xiaochenAwkward1: `${BASE}xiaochen_awkward_1.png`,
  xiaochenTease2: `${BASE}xiaochen_tease_2.png`,

  teacherSerious2: `${BASE}teacher_serious_2.png`,
  teacherCare2: `${BASE}teacher_care_2.png`,
  teacherLow1: `${BASE}teacher_low_1.png`,

  protagonistCalm1: `${BASE}protagonist_calm_1.png`,
  protagonistCare2: `${BASE}protagonist_care_2.png`,
  protagonistSerious2: `${BASE}protagonist_serious_2.png`,

  male2Smirk2: `${BASE}male2_smirk_2.png`,
} as const;

export type ExpressionPortraitKey = keyof typeof EXPRESSION_PORTRAITS;

export interface ExpressionLineRule {
  speaker: SpeakerId;
  /** 台词需包含的关键片段（与原稿一致，避免标点微调失配） */
  contains: string;
  url: string;
}

/** 按说话人 + 台词内容精确匹配的差分表情表（覆盖《台词对照表.csv》全 42 句与追加剧情关键句） */
export const DIALOGUE_EXPRESSION_RULES: readonly ExpressionLineRule[] = [
  // ── 林夏 ──
  { speaker: 'linxia', contains: '放我下来', url: EXPRESSION_PORTRAITS.linxiaLow2 },
  { speaker: 'linxia', contains: '我自己能走', url: EXPRESSION_PORTRAITS.linxiaLow2 },
  { speaker: 'linxia', contains: '爸爸担心我', url: EXPRESSION_PORTRAITS.linxiaLow2 },
  { speaker: 'linxia', contains: '没想到，照片会变成这样', url: EXPRESSION_PORTRAITS.linxiaLow2 },
  { speaker: 'linxia', contains: '都有人觉得不是那样', url: EXPRESSION_PORTRAITS.linxiaLow3 },
  { speaker: 'linxia', contains: '先不要发出去', url: EXPRESSION_PORTRAITS.linxiaCare2 },
  { speaker: 'linxia', contains: '你不用特意告诉我', url: EXPRESSION_PORTRAITS.linxiaGuilty2 },
  { speaker: 'linxia', contains: '谢谢你听我说', url: EXPRESSION_PORTRAITS.linxiaSmile2 },
  { speaker: 'linxia', contains: '我是林夏', url: EXPRESSION_PORTRAITS.linxiaSmile1 },
  { speaker: 'linxia', contains: '你不懂', url: EXPRESSION_PORTRAITS.linxiaUpset2 },
  { speaker: 'linxia', contains: '嗯。没事', url: EXPRESSION_PORTRAITS.linxiaLow2 },
  { speaker: 'linxia', contains: '……不要', url: EXPRESSION_PORTRAITS.linxiaLow3 },
  { speaker: 'linxia', contains: '只会去找他', url: EXPRESSION_PORTRAITS.linxiaLow3 },
  { speaker: 'linxia', contains: '学校挺好的', url: EXPRESSION_PORTRAITS.linxiaSmile1 },
  { speaker: 'linxia', contains: '他们还在转', url: EXPRESSION_PORTRAITS.linxiaLow3 },
  { speaker: 'linxia', contains: '不敢看手机', url: EXPRESSION_PORTRAITS.linxiaLow3 },
  { speaker: 'linxia', contains: '我不想让家里人看见', url: EXPRESSION_PORTRAITS.linxiaLow2 },
  { speaker: 'linxia', contains: '我需要时间', url: EXPRESSION_PORTRAITS.linxiaLow2 },
  { speaker: 'linxia', contains: '那天，你为什么帮我', url: EXPRESSION_PORTRAITS.linxiaCare2 },
  { speaker: 'linxia', contains: '那天，你为什么没走开', url: EXPRESSION_PORTRAITS.linxiaLow2 },
  { speaker: 'linxia', contains: '……没事。', url: EXPRESSION_PORTRAITS.linxiaLow2 },
  { speaker: 'linxia', contains: '……没什么', url: EXPRESSION_PORTRAITS.linxiaGuilty2 },
  { speaker: 'linxia', contains: '……给你', url: EXPRESSION_PORTRAITS.linxiaSmile2 },
  { speaker: 'linxia', contains: '我自己画的', url: EXPRESSION_PORTRAITS.linxiaJoy2 },
  { speaker: 'linxia', contains: '……谢谢。', url: EXPRESSION_PORTRAITS.linxiaSmile1 },
  { speaker: 'linxia', contains: '嗯。', url: EXPRESSION_PORTRAITS.linxiaCalm1 },

  // ── 小陈 ──
  { speaker: 'xiaochen', contains: '真的？哪个', url: EXPRESSION_PORTRAITS.xiaochenSurprise2 },
  { speaker: 'xiaochen', contains: '那也挺不容易的', url: EXPRESSION_PORTRAITS.xiaochenAwkward1 },
  { speaker: 'xiaochen', contains: '被爸爸背着来报到', url: EXPRESSION_PORTRAITS.xiaochenTease2 },
  { speaker: 'xiaochen', contains: '你快看帖子', url: EXPRESSION_PORTRAITS.xiaochenSurprise2 },
  { speaker: 'xiaochen', contains: '别理那些评论', url: EXPRESSION_PORTRAITS.xiaochenCare2 },
  { speaker: 'xiaochen', contains: '跟别人提过她是咱班的', url: EXPRESSION_PORTRAITS.xiaochenGuilty2 },

  // ── 周老师 ──
  { speaker: 'teacher', contains: '林夏同意吗', url: EXPRESSION_PORTRAITS.teacherSerious2 },
  { speaker: 'teacher', contains: '联系校园墙管理员下架', url: EXPRESSION_PORTRAITS.teacherCare2 },
  { speaker: 'teacher', contains: '已经转出去的，我没办法', url: EXPRESSION_PORTRAITS.teacherLow1 },

  // ── 阿远 ──
  { speaker: 'ayuan', contains: '我是阿远', url: EXPRESSION_PORTRAITS.ayuanGuilty2 },
  { speaker: 'ayuan', contains: '别在墙上喊了', url: EXPRESSION_PORTRAITS.ayuanUpset2 },
  { speaker: 'ayuan', contains: '让管理员转达的', url: EXPRESSION_PORTRAITS.ayuanGuilty2 },
  { speaker: 'ayuan', contains: '啊？你是', url: EXPRESSION_PORTRAITS.ayuanSurprise2 },
  { speaker: 'ayuan', contains: '别什么都算我头上', url: EXPRESSION_PORTRAITS.ayuanUpset2 },
  { speaker: 'ayuan', contains: '随手发的', url: EXPRESSION_PORTRAITS.ayuanGuilty2 },
  { speaker: 'ayuan', contains: '这是我们班的', url: EXPRESSION_PORTRAITS.ayuanSmirk2 },
  { speaker: 'ayuan', contains: '我也截下来了', url: EXPRESSION_PORTRAITS.ayuanSmirk3 },
  { speaker: 'ayuan', contains: '我跟你一起', url: EXPRESSION_PORTRAITS.ayuanCare2 },
  { speaker: 'ayuan', contains: '我删了。别的', url: EXPRESSION_PORTRAITS.ayuanGuilty2 },
  { speaker: 'ayuan', contains: '真的没人看啊', url: EXPRESSION_PORTRAITS.ayuanLow2 },
  { speaker: 'ayuan', contains: '以为删了就没了', url: EXPRESSION_PORTRAITS.ayuanHesitate2 },
  { speaker: 'ayuan', contains: '对不起', url: EXPRESSION_PORTRAITS.ayuanGuilty3 },
];

/** 情绪标签兜底映射：当剧本台词带显式 emotion（非 normal）且未命中特定台词时使用 */
export const SPEAKER_EMOTION_PORTRAITS: Partial<Record<SpeakerId, Partial<Record<DialogueEmotion, string>>>> = {
  linxia: {
    smile: EXPRESSION_PORTRAITS.linxiaSmile2,
    sad: EXPRESSION_PORTRAITS.linxiaLow2,
    cry: EXPRESSION_PORTRAITS.linxiaLow3,
    despair: EXPRESSION_PORTRAITS.linxiaLow3,
  },
  ayuan: {
    smile: EXPRESSION_PORTRAITS.ayuanSmirk2,
    sad: EXPRESSION_PORTRAITS.ayuanLow2,
    cry: EXPRESSION_PORTRAITS.ayuanGuilty3,
    despair: EXPRESSION_PORTRAITS.ayuanGuilty3,
  },
  xiaochen: {
    smile: EXPRESSION_PORTRAITS.xiaochenTease2,
    sad: EXPRESSION_PORTRAITS.xiaochenGuilty2,
  },
  teacher: {
    smile: EXPRESSION_PORTRAITS.teacherCare2,
    sad: EXPRESSION_PORTRAITS.teacherLow1,
  },
};

/** 按说话人 + 台词文本 + 情绪解析最匹配的差分表情 URL，未命中返回 null（由调用方降级默认半身立绘） */
export function resolveExpressionPortrait(
  speaker: SpeakerId,
  text: string,
  emotion?: DialogueEmotion,
): string | null {
  for (const rule of DIALOGUE_EXPRESSION_RULES) {
    if (rule.speaker === speaker && text.includes(rule.contains)) return rule.url;
  }
  if (emotion && emotion !== 'normal') {
    return SPEAKER_EMOTION_PORTRAITS[speaker]?.[emotion] ?? null;
  }
  return null;
}
