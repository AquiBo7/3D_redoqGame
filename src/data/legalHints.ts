// data/legalHints.ts —— 关键分岔口的现实做法与法治参考
// 纯数据：只给客观坐标，不评判选项对错，不出现量化数值。文案风格对齐 endingContent.ts。

import type { SceneId } from './storySchema';

export type LegalHintId = 'N1' | 'N2' | 'N3' | 'N4' | 'N5' | 'N6';

export interface LegalHintPerspectives {
  victim: string;
  bystander: string;
  perpetrator: string;
}

export interface LegalHint {
  id: LegalHintId;
  title: string;
  /** 结局页标注「本局经历」时对应的场景 */
  scenes: SceneId[];
  /** 命中这些选项步骤时亮起 [Y] 提示 */
  stepIds: string[];
  lawRef: string;
  /** ≤ 60 字的大白话法治解读 */
  lawSummary: string;
  /** ≤ 65 字的现实常规做法 */
  hintPractice: string;
  /** ≤ 55 字的镜头外处境提醒 */
  hintBeyondFrame: string;
  perspectives: LegalHintPerspectives;
}

export const LEGAL_HINTS: readonly LegalHint[] = [
  {
    id: 'N1',
    title: '帖子刚发出来的那几分钟',
    scenes: ['S14'],
    stepIds: ['s14-choice'],
    lawRef: '《中华人民共和国民法典》第一千零二十四条',
    lawSummary: '名誉权受法律保护。断章取义的转发和跟着起哄，也可能成为侵权的一环。',
    hintPractice: '先停几秒：不随手玩梗，把看到的完整经过说清楚，再私下陪一句“我在”。',
    hintBeyondFrame: '发帖的人觉得只是玩笑，被拍的人正盯着不断跳出来的红点。',
    perspectives: {
      victim: '先退出这条消息流，截图留底，告诉一个可信的人，不必当场回应。',
      bystander: '不转、不玩梗，把“前面发生了什么”补上一句，私下陪她。',
      perpetrator: '删掉自己那句起哄，也不再喊别人来看；玩笑不构成对别人的处置。',
    },
  },
  {
    id: 'N2',
    title: '要不要把证据留下来',
    scenes: ['S14', 'C4'],
    stepIds: ['s14-evidence', 'c4-response'],
    lawRef: '《中华人民共和国民法典》第一千零三十二条、第一千零三十三条',
    lawSummary: '私密信息由本人决定怎么处理。帮忙留证之前先问过她，要不要公开也一样。',
    hintPractice: '完整录屏要含页面地址、账号、发布时间和浏览转发量；先存证，再拉黑。',
    hintBeyondFrame: '她怕的不是留证据，是这些证据哪天被当众念一遍。',
    perspectives: {
      victim: '自己录屏留底，先存证再拉黑；要不要公开，由你说了算。',
      bystander: '先把“要不要留、给谁看”问清楚再动手，不替她决定。',
      perpetrator: '别再截第二遍，也不要把聊天放进新的群；扩散本身就是越界。',
    },
  },
  {
    id: 'N3',
    title: '把这件事交给能管事的人',
    scenes: ['C3'],
    stepIds: ['c3-response'],
    lawRef: '《中华人民共和国民法典》第一千一百九十五条',
    lawSummary: '权利人可以通知平台删除侵权内容，平台接到初步证据后应及时采取必要措施。',
    hintPractice: '三条路一起走：找辅导员、约学校心理咨询、在平台提交侵权投诉，都留记录。',
    hintBeyondFrame: '她怕事情闹大，你怕她什么都不说。求助不等于告发。',
    perspectives: {
      victim: '挑一个愿意听的人说完整经过，投诉和求助都可以先匿名问一遍。',
      bystander: '陪她走到办公室门口，剩下的话让她自己说，不替她描述。',
      perpetrator: '被找去说明时如实说清来源，不删记录，也不打听是谁提的。',
    },
  },
  {
    id: 'N4',
    title: '想找出是谁发的那条',
    scenes: ['C5'],
    stepIds: ['c5-find-path'],
    lawRef: '最高人民法院、最高人民检察院、公安部《关于依法惩治网络暴力违法犯罪的指导意见》',
    lawSummary: '借“讨公道”的名义人肉开盒、公开隐私、引导新一轮围猎，同样可能被依法惩治。',
    hintPractice: '把辨认和举报交给可信的师长与平台，不公开追问、不比对头像、不翻别人手机。',
    hintBeyondFrame: '你想替她讨回公道，而每一次“扒一扒”都给她多加一层新的风险。',
    perspectives: {
      victim: '不必自己去找那个人。把线索交给老师或平台，让他们按流程处理。',
      bystander: '不在墙上公开喊话，不晒疑似的头像和班级，拦住“一起扒”。',
      perpetrator: '如果被认出来，正面回应比躲起来更省事，也别再开新号。',
    },
  },
  {
    id: 'N5',
    title: '当面遇到发那条的人',
    scenes: ['D2'],
    stepIds: ['d2-round-1', 'd2-round-2', 'd2-round-3'],
    lawRef: '《中华人民共和国民法典》第一千零二十四条；《中华人民共和国治安管理处罚法》第五十条',
    lawSummary: '没写名字也可能被认出来。断章取义引发侮辱、诽谤的要担民事责任，情节较重的可拘留罚款。',
    hintPractice: '只说事实和影响，不威胁、不替他定性；让他知道现在停下来还来得及。',
    hintBeyondFrame: '他发的那条已经删了，传开的截图却停不下来，他也没想到会是这样。',
    perspectives: {
      victim: '不必当面和解。要谈就约在有人的地方，或者请老师一起听。',
      bystander: '把“后来发生了什么”说给他听，不逼他当场认错。',
      perpetrator: '承认随手发的那条，停下转发，再补一句完整的澄清。',
    },
  },
  {
    id: 'N6',
    title: '原帖删了，截图还在传',
    scenes: ['D4', 'D6'],
    stepIds: ['d4-team-phrase', 'd4-solo-phrase', 'd6-team-response', 'd6-solo-response'],
    lawRef: '《中华人民共和国民法典》第一千一百九十五条',
    lawSummary: '对每一个搬运的账号都可以分别通知删除，平台接到初步证据后应采取必要措施。',
    hintPractice: '逐个搬运链接继续投诉并留底；发帖人补一条完整澄清；陪伴的人按需给求助渠道。',
    hintBeyondFrame: '删帖只是他那边结束了。她第二天还是会在新的转发里被看见。',
    perspectives: {
      victim: '继续对新的搬运发投诉，不必再解释一遍；需要时约一次心理门诊。',
      bystander: '温和地陪着，正常同行；要帮忙维权时先问她想走到哪一步。',
      perpetrator: '偷偷删帖不等于结束：留好原始记录，再发一条客观完整的澄清。',
    },
  },
];

export const PERSPECTIVE_LABELS: LegalHintPerspectives = {
  victim: '如果你是受害者',
  bystander: '如果你是旁观者',
  perpetrator: '如果你是发布与转发者',
};

export const PERSPECTIVE_TABS: Array<{ key: 'all' | keyof LegalHintPerspectives; label: string }> = [
  { key: 'all', label: '全部三视角' },
  { key: 'victim', label: '受害者自护' },
  { key: 'bystander', label: '旁观者抵制' },
  { key: 'perpetrator', label: '推手止损' },
];

const HINT_BY_STEP_ID = new Map<string, LegalHint>();
for (const hint of LEGAL_HINTS) {
  for (const stepId of hint.stepIds) HINT_BY_STEP_ID.set(stepId, hint);
}

/** 命中的节点返回该节点，普通选项返回 undefined。 */
export function getLegalHintByStepId(stepId: string): LegalHint | undefined {
  return HINT_BY_STEP_ID.get(stepId);
}
