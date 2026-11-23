import type { AssetId } from './assetManifest';
import type { SceneId, StoryVariables } from './storySchema';

export type EndingId = NonNullable<StoryVariables['ending']>;
export type ReviewCheckpoint = 'ch2_canteen' | 'ch3_morning' | 'ch4_platform';
export interface EndingCopy {
  title: string;
  lead: string;
  epilogue: readonly [string, string];
  insight: string;
  cg: { assetId: AssetId; caption: string };
  retry?: { key: ReviewCheckpoint; label: string };
}

// 结局页文案与素材契约；阈值求值、足迹整理在 core 中完成。
export const ENDING_CONTENT: Record<EndingId, EndingCopy> = {
  best: {
    title: '完整的那一天',
    lead: '一张截图以外，还有一个完整的早晨。',
    epilogue: [
      '脚好了，林夏开始在校园里画画，有时在最后一排，有时在台阶上。她仍然话少，但会主动回你一句完整的话。爸爸送她到校门口后只站在原地，看着她自己走进去。阿远在班群里发了一条澄清和道歉，没有多少人回应，他没有删。',
      '你把那幅画夹在笔记本里。以后看到别人被拍、被议论，你会先想一想“前面发生了什么”。',
    ],
    insight: '外界依然各说各话。但有人记得完整的那一天。',
    cg: { assetId: 'cg_ending_best_drawing', caption: '林夏的画 · 完整的早晨' },
  },
  middle: {
    title: '未完成的画',
    lead: '帖子消失了，留下的空白还在。',
    epilogue: [
      '帖子没了，话题散了。林夏照常上课，更少举手，也更少在走廊停留。阿远再也没发过什么。',
      '你有时会想起那天的台阶，想起自己只做了一半。你开始分得清“删了”和“处理好了”不是一回事。',
    ],
    insight: '删了，不等于说完整了。',
    cg: { assetId: 'cg_ending_middle_sketch', caption: '速写本 · 还没有画完的台阶' },
  },
  worst: {
    title: '另一种围观',
    lead: '话题换了一个名字，围观并没有停下。',
    epilogue: [
      '对话截图传开，阿远成了新的话题。林夏请了几天假，回来后座位没变，只是更久地低着头。',
      '你以为自己在讨公道，用的却是同样的方式。之后每次想“揪出”谁，你都会停一下。',
    ],
    insight: '为她出头，不等于把另一个人推出来。',
    cg: { assetId: 'cg_ending_bystander_seat', caption: '最后一排 · 留在教室里的沉默' },
    retry: { key: 'ch4_platform', label: '回到侧楼梯平台，再试一次' },
  },
  bystander: {
    title: '沉默的席位',
    lead: '一个月后，话题沉了下去。',
    epilogue: [
      '一个月后没人再提。她仍坐在最后一排，脚好了，话更少。走廊里遇见，你们互相点点头。',
      '你记得自己看过的每一条，却说不出自己做过什么。后来你偶尔点开那条沉底的帖子，什么也没有改变。——“……跟我没关系。”你曾经说过，这件事跟你没关系。',
    ],
    insight: '你什么都没做。她那天，也什么都没等到。',
    cg: { assetId: 'cg_ending_bystander_seat', caption: '最后一排 · 沉默的席位' },
    retry: { key: 'ch3_morning', label: '回到第二天，再试一次' },
  },
  joined: {
    title: '随手一笑',
    lead: '没有人记得，是谁先笑的。',
    epilogue: [
      '帖子的浏览数多了一个零。林夏的座位空了几天，回来后没有再提那天的事。',
      '你没想到那句玩笑会被截图，被放进另一个话题里。你把它删了，但别人早已存下。',
    ],
    insight: '笑一下，也是在场。',
    cg: { assetId: 'cg_s11_post_crop', caption: '被截取的一角 · 看不见完整的那一天' },
    retry: { key: 'ch2_canteen', label: '回到食堂，再试一次' },
  },
};

export const BEST_WITHOUT_DRAWING = {
  impact: '她对你点点头，合上速写本走出教室。以后看到别人被拍、被议论，你会先想一想“前面发生了什么”。',
  cg: { assetId: 'cg_ending_middle_sketch', caption: '合上的速写本之外 · 尚未送出的画意' },
} as const;

export const BEST_WITHDRAWN_DRAWING = {
  impact: '你急着开了口，她的手僵了一下，把折了一半的纸赶紧收回本子里。以后看到别人被拍、被议论，你会先想一想“前面发生了什么”。',
  cg: { assetId: 'cg_ending_middle_sketch', caption: '收回本子里的画 · 只留在草稿箱中' },
  draftText: '想把那天早上的台阶画下来。画成完整的。刚撕下来，手心里全是汗——他一开口问，我又不敢递出去了，只能折起来收进本子里。',
} as const;

export const DRAWING_WITHDRAWN_LOG = '在林夏犹豫时催促，她把纸收了回去。';

/** 草稿箱里的行为反应（只陈述，不责备） */
export const DRAFT_REACTIONS = {
  viewedAvatar: '那天，我看到有人点开了我的头像。',
  forwardedRoommate: '我不知道是谁，但我猜得到。',
  askedBeforeEvidence: '你先问了我。谢谢。',
} as const;

export type FinalAnswerId = NonNullable<StoryVariables['finalAnswer']>;

/** 最后一问的回答对应草稿箱最后一条 */
export const FINAL_ANSWER_DRAFTS: Record<FinalAnswerId, string> = {
  wrong: '他说不出为什么，只说觉得不对。那天手机响到后半夜，屏幕扣在枕头下都觉得发烫。至少，还有一个人停下来说了一句不对。',
  tired: '原来那天有人看出来我快撑不住了。被那么多人盯着议论的时候，连呼吸都发紧。后来再走过那段台阶，我还是会下意识低头，但脚步比那天稳了一点。',
  silent: '他什么都没说，只是安安静静地站在旁边。那几天到处都是议论和震动，吵得人喘不过气，反而只有这阵沉默让我稍微缓了一点。',
};

export const FINAL_ANSWER_LABELS: Record<FinalAnswerId, string> = {
  wrong: '我也不知道。就是觉得不对。',
  tired: '你那天看起来很累。',
  silent: '（沉默）',
};

export const CHAPTER_REVIEW_CONTENT: EndingCopy = {
  title: '把看见的，留在心里', lead: '这一段，到这里。',
  epilogue: ['故事还没有走到结局。', '这里仅保留这一段已经发生的记录。'],
  insight: '一张截图之外，还有尚未看见的部分。',
  cg: { assetId: 'cg_s6_gate_panorama', caption: '回望 · 校门前的早晨' },
};

export const ENDING_DRAFTS = [
  { id: 'draft-1', threshold: 1, text: '今天是不是该告诉爸爸？……还是算了。我不想麻烦大家。', lockedText: '尚未解锁的草稿。' },
  { id: 'draft-2', threshold: 3, text: '那个人替我说了一句话。原来有人看见了。', lockedText: '尚未解锁的草稿。' },
  { id: 'draft-3', threshold: 5, text: '想把那天早上的台阶画下来。画成完整的。', lockedText: '想画给他，但……' },
  { id: 'draft-4', threshold: 7, text: '我不能让爸爸出来。他那么笨嘴拙舌的人，要是看到那些话……他会以为，是他的错。', lockedText: '尚未解锁的草稿。' },
] as const;

export const ENDING_ACTION_CARDS = [
  { title: '先停一秒', text: '转发或评论前先停一秒：我看到的是一整件事，还只是一张被截取的图？' },
  { title: '先问意愿', text: '保存证据前先询问当事人意愿，不替受害者做公开决定。' },
  { title: '寻找可靠的帮助', text: '遇到校园网络暴力，优先通过平台举报、联系可信任的老师或家长处理，不以暴制暴、不发动新的围猎。' },
  { title: '温和地在场', text: '私下一句温和的“我在”或正常的同行，比在评论区对骂更能托住当事人。' },
  { title: '也照顾自己', text: '如感到持续心理压力，可随时向学校心理咨询中心或青少年心理援助热线求助。' },
] as const;

export const REVIEW_LABELS = {
  post: { explain: '解释', wait: '等等', joke: '玩笑' },
  finding: { recognize: '在走廊辨认出拿橙色手机壳的阿远', relay: '请校园墙管理员转达', shout: '在校园墙公开喊话' },
  dialogue: { fact: '说明事实', empathy: '换位询问', company: '提出陪伴', noise: '淡化或不作表态', force: '施压公开' },
} as const;

export const FOOTPRINT_GROUPS: ReadonlyArray<{ id: string; title: string; scenes: readonly SceneId[] }> = [
  { id: 'arrival', title: '出门与到校', scenes: ['S1', 'S2', 'S3', 'S4'] },
  { id: 'steps', title: '台阶一幕', scenes: ['S5', 'S6'] },
  { id: 'registration', title: '登记与同行', scenes: ['S7', 'S8'] },
  { id: 'photo', title: '群里合照', scenes: ['S9', 'S10'] },
  { id: 'roommate', title: '宿舍递手机', scenes: ['S11'] },
  { id: 'canteen', title: '食堂打饭', scenes: ['S12', 'S13'] },
  { id: 'post', title: '帖子爆发', scenes: ['S14'] },
  { id: 'morning', title: '第二天', scenes: ['C1', 'C2', 'C3', 'C4'] },
  { id: 'finding', title: '寻找发布者', scenes: ['C5', 'C6'] },
  { id: 'platform', title: '侧楼梯平台', scenes: ['D1', 'D2', 'D3', 'D4'] },
  { id: 'guardian', title: '守护记录', scenes: ['D5'] },
  { id: 'afterwards', title: '道歉与补救', scenes: ['D6', 'E1'] },
];
