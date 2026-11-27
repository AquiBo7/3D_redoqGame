import { DRAWING_WITHDRAWN_LOG } from './endingContent';
import type { Condition, SceneDef, StoryChoice } from './storySchema';

// 保留 S14 / C3 / D2 已写入的早期结局；E1 也可由原始选择归一。
// 不用 !joined 等默认值推断旁观，必须有明确结局或完整三条件。
const participant: Condition = { any: [
  { key: 'postChoice', op: '==', value: 'joke' },
  { key: 'ending', op: '==', value: 'joined' },
] };
const bystander: Condition = { any: [
  { key: 'ending', op: '==', value: 'bystander' },
  { all: [
    { key: 'seat', op: '==', value: 'far' },
    { key: 'tellTeacher', op: '==', value: 'think' },
    { key: 'visitedStairwell', equals: false },
  ] },
] };
const worst: Condition = { any: [
  { key: 'ending', op: '==', value: 'worst' },
  // D2 的五类键中，排除四种非逼迫键即表示任意轮出现 force。
  { not: { key: 'yuanKeys', only: ['fact', 'empathy', 'company', 'noise'] } },
] };
const best: Condition = { all: [
  { key: 'joined', equals: true }, { key: 'apologized', equals: true },
] };
const middle: Condition = { any: [
  { key: 'ending', op: '==', value: 'middle' },
  { all: [{ key: 'postDeleted', equals: true }, { key: 'joined', equals: false }] },
] };

/** 中间结局判定：玩家是否曾明确帮助过林夏 */
const explicitlyHelped: Condition = { any: [
  { key: 'handedPen', equals: true },
  { key: 'picked', equals: true },
  { key: 'postChoice', op: '==', value: 'explain' },
  { key: 'listened', equals: true },
  { key: 'evidence', equals: true },
  { key: 'seat', op: '==', value: 'beside' },
] };

const FINAL_ANSWER_OPTIONS: StoryChoice[] = [
  {
    id: 'final-wrong',
    text: '我也不知道。就是觉得不对。',
    effects: {
      set: { finalAnswer: 'wrong' },
      log: { type: 'choice', summary: '回答林夏：“我也不知道。就是觉得不对。”' },
    },
  },
  {
    id: 'final-tired',
    text: '你那天看起来很累。',
    effects: {
      set: { finalAnswer: 'tired' },
      log: { type: 'choice', summary: '回答林夏：“你那天看起来很累。”' },
    },
  },
  {
    id: 'final-silent',
    text: '（沉默）',
    effects: {
      set: { finalAnswer: 'silent' },
      log: { type: 'choice', summary: '面对林夏的提问，选择了沉默。' },
    },
  },
];

export const endingScene: SceneDef = {
  id: 'E1', sceneKey: 'stage2d', title: '回望',
  stageNotes: [
    '最好结局：夕阳教室，林夏在最后一排画画。高信任送画前犹豫三次，安静等待后递画，回应后第一次轻轻笑；同一字幕位置呼应“……跟我有关系。”',
    'cg_ending_best_drawing：晨光中的校门台阶，两个人影并肩，远处提袋的人，画角很小的橙色点。',
    'cg_ending_middle_sketch：傍晚课桌，半幅台阶线稿空无一人，纸角有擦痕和铅笔。',
    '五个结局各自保留张力演出与定格句，再进入回望；未赠出的画与行为反应留给草稿箱。',
  ],
  steps: [
    // 按优先级前向跳转，只写入一次最终结局，不改前章的选择与数值。
    { kind: 'goto', id: 'e1-resolve-joined', when: participant, target: 'e1-joined-close', effects: { set: { ending: 'joined' } } },
    { kind: 'goto', id: 'e1-resolve-bystander', when: bystander, target: 'e1-bystander-close', effects: { set: { ending: 'bystander' } } },
    { kind: 'goto', id: 'e1-resolve-worst', when: worst, target: 'e1-worst-close', effects: { set: { ending: 'worst' } } },
    { kind: 'goto', id: 'e1-resolve-best', when: best, target: 'e1-best-month', effects: { set: { ending: 'best' } } },
    { kind: 'goto', id: 'e1-resolve-middle', when: middle, target: 'e1-middle-month', effects: { set: { ending: 'middle' } } },
    // 无流程证据的调试默认状态不伪造任何结局。
    { kind: 'goto', id: 'e1-unresolved', target: 'e1-summary' },

    // 参与者结局
    { kind: 'intertitle', id: 'e1-joined-close', lines: [
      '那条玩笑留在了截图里。', '你想把话题从自己身上挪开，却也成了转发的一部分。', '已被转发，无法收回。',
    ] },
    { kind: 'moment', id: 'e1-joined-rewind', moment: 'joined-rewind', lines: [
      '那天我俩都迟到，被拍惨了哈哈。',
    ] },
    { kind: 'goto', id: 'e1-joined-done', target: 'e1-summary' },

    // 旁观结局
    { kind: 'intertitle', id: 'e1-bystander-close', lines: [
      '你回到了自己的座位。', '楼梯间的声音渐渐远了，那张截图还在流传。', '那一天，仍没有被说完整。',
    ] },
    { kind: 'moment', id: 'e1-bystander-cursor', moment: 'bystander-cursor', lines: [
      '你什么都没做。',
    ] },
    { kind: 'goto', id: 'e1-bystander-done', target: 'e1-summary' },

    // 最差结局
    { kind: 'intertitle', id: 'e1-worst-close', lines: [
      '谈话停在了逼迫里。', '新的对话截图被转了出去，原来的事又被盖住一层。', '已被转发，无法收回。',
    ] },
    { kind: 'moment', id: 'e1-worst-flood', moment: 'worst-flood', lines: [
      '屏幕暗了下来。但那些截图还在所有人手里传着。',
    ] },
    { kind: 'goto', id: 'e1-worst-done', target: 'e1-summary' },

    // 最好结局
    { kind: 'intertitle', id: 'e1-best-month', lines: ['一个月后。'] },
    { kind: 'dialogue', id: 'e1-best-classroom', lines: [
      { speaker: null, text: '夕阳照进教室。林夏坐在最后一排画画，你走近。' },
    ] },
    { kind: 'goto', id: 'e1-best-low-trust', when: { key: 'trust', op: '<', value: 5 }, target: 'e1-best-nod' },
    {
      kind: 'moment',
      id: 'e1-best-hesitation',
      moment: 'best-hesitation',
      lines: [
        '她从速写本上撕下一页纸，指尖微微发紧，停在纸边。',
        '她看了一眼桌面，又把纸轻轻塞回本子里。',
        '沉默压在课桌之间。过了好一会儿，她才重新把那张纸拿了起来。',
      ],
      onInterrupt: {
        effects: { log: { type: 'choice', summary: DRAWING_WITHDRAWN_LOG } },
        goto: 'e1-best-withdrawn',
      },
    },
    { kind: 'dialogue', id: 'e1-best-gift', lines: [
      { speaker: null, text: '她合上本子，又打开，撕下一页，折好放在你桌上。' },
      { speaker: 'linxia', text: '……给你。' }, { speaker: 'linxia', text: '我自己画的。' },
    ] },
    { kind: 'art', id: 'e1-best-drawing', assetId: 'cg_ending_best_drawing' },
    { kind: 'choice', id: 'e1-best-response', options: [
      { id: 'e1-best-thanks', text: '谢谢，我会好好收着。' },
      { id: 'e1-best-praise', text: '……画得很好。' },
      { id: 'e1-best-keep', text: '（什么都没说，把画夹进笔记本里）' },
    ] },
    { kind: 'dialogue', id: 'e1-best-question', lines: [
      { speaker: 'linxia', text: '……那天，你为什么帮我？' },
    ] },
    { kind: 'choice', id: 'e1-best-answer', prompt: '夕阳落在课桌边，她轻声问你。', options: FINAL_ANSWER_OPTIONS },
    { kind: 'dialogue', id: 'e1-best-smile', lines: [
      { speaker: null, text: '她轻轻笑了一下。这是你第一次看见她笑。' },
      { speaker: null, text: '她走出教室，脚步很稳。' },
    ] },
    { kind: 'dialogue', id: 'e1-best-father', lines: [
      { speaker: null, text: '远处，爸爸站在校门外稍远的地方。这一次，是她自己走向他。' },
    ] },
    { kind: 'dialogue', id: 'e1-best-guard', when: { key: 'guardWilling', equals: true }, lines: [
      { speaker: null, text: '周老师后来专门找校门口那位保安师傅聊了一次，把那天早上发生的每一段都问清了。' },
    ] },
    { kind: 'phone', id: 'e1-best-message', panel: { id: 'e1-best-phone', closeActionId: 'close', sections: [
      { kind: 'chat', id: 'e1-best-chat', title: '林夏', unread: 1, messages: [
        { id: 'e1-best-arrived', from: '林夏', text: '今天我自己走进教室了。', unread: true },
      ] },
    ] } },
    { kind: 'goto', id: 'e1-best-gift-done', target: 'e1-best-arc' },

    // 犹豫被打断：她把纸收回去，画只会在草稿箱里出现
    { kind: 'dialogue', id: 'e1-best-withdrawn', lines: [
      { speaker: null, text: '你刚一开口，她的手停住了。她把折了一半的纸重新放回速写本里，合上封面。' },
      { speaker: 'linxia', text: '……没什么。' },
    ] },
    { kind: 'goto', id: 'e1-best-withdrawn-ask', target: 'e1-best-low-question' },

    { kind: 'dialogue', id: 'e1-best-nod', lines: [
      { speaker: null, text: '她对你点点头，合上速写本，走出教室。' },
    ] },
    { kind: 'dialogue', id: 'e1-best-low-question', lines: [
      { speaker: 'linxia', text: '……那天，你为什么帮我？' },
    ] },
    { kind: 'choice', id: 'e1-best-low-answer', prompt: '走廊的风吹过来，她轻声问你。', options: FINAL_ANSWER_OPTIONS },
    { kind: 'caption', id: 'e1-best-arc', text: '……跟我有关系。', durationMs: 3000, tone: 'subtle' },
    { kind: 'intertitle', id: 'e1-best-freeze-wrong', when: { key: 'finalAnswer', op: '==', value: 'wrong' }, lineDurationMs: 2800, skippable: false, lines: [
      '已被转发，无法收回。', '外界依然各说各话。但有人停下来，说了声不对。',
    ] },
    { kind: 'intertitle', id: 'e1-best-freeze-tired', when: { key: 'finalAnswer', op: '==', value: 'tired' }, lineDurationMs: 2800, skippable: false, lines: [
      '已被转发，无法收回。', '外界依然各说各话。但有人看见了那天的疲惫。',
    ] },
    { kind: 'intertitle', id: 'e1-best-freeze-silent', when: { key: 'finalAnswer', op: '==', value: 'silent' }, lineDurationMs: 2800, skippable: false, lines: [
      '已被转发，无法收回。', '外界依然各说各话。但那天的安静里，多了一个人。',
    ] },
    { kind: 'intertitle', id: 'e1-best-freeze', when: { key: 'finalAnswer', op: '==', value: null }, lineDurationMs: 2800, skippable: false, lines: [
      '已被转发，无法收回。', '外界依然各说各话。但这一幅是完整的。',
    ] },
    { kind: 'goto', id: 'e1-best-done', target: 'e1-summary' },

    // 中间结局
    { kind: 'intertitle', id: 'e1-middle-month', lines: [
      '一个月后。', '帖子早就删了。', '阿远再也没有发过任何东西。', '林夏的脚好了，走路很稳。',
      '她仍坐在最后一排，话比开学那天更少。', '走廊里遇见，你点点头，她也点点头。', '没有人再提起那天台阶上的事。',
    ] },
    { kind: 'dialogue', id: 'e1-middle-approach', lines: [
      { speaker: null, text: '傍晚的教室里，林夏走到你桌前，手指攥着书包带，嘴唇动了一下。' },
      { speaker: 'linxia', emotion: 'sad', text: '……没事。' },
    ] },
    { kind: 'moment', id: 'e1-middle-pause', moment: 'middle-pause', lines: ['……没事。'] },
    { kind: 'intertitle', id: 'e1-middle-sketch-intro', lines: [
      '那天放学后的教室早就空了。',
      '你收拾书包经过最后一排她的空座位时，偶然看见桌上还摊着那本没画完的速写本。',
    ], lineDurationMs: 2400 },
    { kind: 'art', id: 'e1-middle-sketch', assetId: 'cg_ending_middle_sketch' },
    { kind: 'dialogue', id: 'e1-middle-question-helped', when: explicitlyHelped, lines: [
      { speaker: 'linxia', emotion: 'sad', text: '……那天，你为什么帮我？' },
    ] },
    { kind: 'dialogue', id: 'e1-middle-question-stayed', when: { not: explicitlyHelped }, lines: [
      { speaker: 'linxia', emotion: 'sad', text: '……那天，你为什么没走开？' },
    ] },
    { kind: 'choice', id: 'e1-middle-answer', prompt: '教室安静下来，她轻声问你。', options: FINAL_ANSWER_OPTIONS },
    { kind: 'intertitle', id: 'e1-middle-freeze-wrong', when: { key: 'finalAnswer', op: '==', value: 'wrong' }, lineDurationMs: 2800, skippable: false, lines: [
      '已被转发，无法收回。', '你知道那不对，只是那一天，仍没来得及说完整。',
    ] },
    { kind: 'intertitle', id: 'e1-middle-freeze-tired', when: { key: 'finalAnswer', op: '==', value: 'tired' }, lineDurationMs: 2800, skippable: false, lines: [
      '已被转发，无法收回。', '你看见了她的累，只是那一天，仍只说到了一半。',
    ] },
    { kind: 'intertitle', id: 'e1-middle-freeze-silent', when: { key: 'finalAnswer', op: '==', value: 'silent' }, lineDurationMs: 2800, skippable: false, lines: [
      '已被转发，无法收回。', '你没有走开，但也什么都没说出口。',
    ] },
    { kind: 'intertitle', id: 'e1-middle-freeze', when: { key: 'finalAnswer', op: '==', value: null }, lineDurationMs: 2800, skippable: false, lines: [
      '已被转发，无法收回。', '没有人，把那一天说完整。',
    ] },
    { kind: 'end', id: 'e1-summary' },
  ],
  transitions: [],
};
