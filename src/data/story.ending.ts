import type { Condition, SceneDef } from './storySchema';

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

export const endingScene: SceneDef = {
  id: 'E1', sceneKey: 'stage2d', title: '回望',
  stageNotes: [
    '最好结局：夕阳教室，林夏在最后一排画画。高信任递画，回应后才第一次轻轻笑。',
    'cg_ending_best_drawing：晨光中的校门台阶，两个人影并肩，远处提袋的人，画角很小的橙色点。',
    'cg_ending_middle_sketch：傍晚课桌，半幅台阶线稿空无一人，纸角有擦痕和铅笔。',
    '最好与中间结局在定格句之间停一拍，再进入回望。低信任的未赠画念头留给草稿箱。',
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

    { kind: 'intertitle', id: 'e1-joined-close', lines: [
      '那条玩笑留在了截图里。', '你想把话题从自己身上挪开，却也成了转发的一部分。', '已被转发，无法收回。',
    ] },
    { kind: 'goto', id: 'e1-joined-done', target: 'e1-summary' },
    { kind: 'intertitle', id: 'e1-bystander-close', lines: [
      '你回到了自己的座位。', '楼梯间的声音渐渐远了，那张截图还在流传。', '那一天，仍没有被说完整。',
    ] },
    { kind: 'goto', id: 'e1-bystander-done', target: 'e1-summary' },
    { kind: 'intertitle', id: 'e1-worst-close', lines: [
      '谈话停在了逼迫里。', '新的对话截图被转了出去，原来的事又被盖住一层。', '已被转发，无法收回。',
    ] },
    { kind: 'goto', id: 'e1-worst-done', target: 'e1-summary' },

    { kind: 'intertitle', id: 'e1-best-month', lines: ['一个月后。'] },
    { kind: 'dialogue', id: 'e1-best-classroom', lines: [
      { speaker: null, text: '夕阳照进教室。林夏坐在最后一排画画，你走近。' },
    ] },
    { kind: 'goto', id: 'e1-best-low-trust', when: { key: 'trust', op: '<', value: 5 }, target: 'e1-best-nod' },
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
    { kind: 'dialogue', id: 'e1-best-smile', lines: [
      { speaker: null, text: '她轻轻笑了一下。这是你第一次看见她笑。' },
      { speaker: null, text: '她走出教室，脚步很稳。' },
    ] },
    { kind: 'dialogue', id: 'e1-best-father', lines: [
      { speaker: null, text: '远处，爸爸站在校门外稍远的地方。这一次，是她自己走向他。' },
    ] },
    { kind: 'phone', id: 'e1-best-message', panel: { id: 'e1-best-phone', closeActionId: 'close', sections: [
      { kind: 'chat', id: 'e1-best-chat', title: '林夏', unread: 1, messages: [
        { id: 'e1-best-arrived', from: '林夏', text: '今天我自己走进教室了。', unread: true },
      ] },
    ] } },
    { kind: 'goto', id: 'e1-best-gift-done', target: 'e1-best-freeze' },
    { kind: 'dialogue', id: 'e1-best-nod', lines: [
      { speaker: null, text: '她对你点点头，合上速写本，走出教室。' },
    ] },
    { kind: 'intertitle', id: 'e1-best-freeze', lineDurationMs: 2800, skippable: false, lines: [
      '已被转发，无法收回。', '外界依然各说各话。但这一幅是完整的。',
    ] },
    { kind: 'goto', id: 'e1-best-done', target: 'e1-summary' },

    { kind: 'intertitle', id: 'e1-middle-month', lines: [
      '一个月后。', '帖子早就删了。', '阿远再也没有发过任何东西。', '林夏的脚好了，走路很稳。',
      '她仍坐在最后一排，话比开学那天更少。', '走廊里遇见，你点点头，她也点点头。', '没有人再提起那天台阶上的事。',
    ] },
    { kind: 'art', id: 'e1-middle-sketch', assetId: 'cg_ending_middle_sketch' },
    { kind: 'intertitle', id: 'e1-middle-freeze', lineDurationMs: 2800, skippable: false, lines: [
      '已被转发，无法收回。', '没有人，把那一天说完整。',
    ] },
    { kind: 'end', id: 'e1-summary' },
  ],
  transitions: [],
};
