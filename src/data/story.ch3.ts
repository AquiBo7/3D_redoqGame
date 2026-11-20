import type { Condition, SceneDef, SceneId } from './storySchema';

const maySkipStairs: Condition = { all: [
  { key: 'seat', op: '==', value: 'far' },
  { key: 'tellTeacher', op: '==', value: 'think' },
] };
const canSaveEvidence: Condition = { all: [
  { key: 'picked', equals: true }, { key: 'evidence', equals: false },
] };
const canAskWrong: Condition = { key: 'wrongAsks', op: '<', value: 3 };
const baseClues = ['帖子发布时间 8:52', '校园墙管理员：可以帮忙转达'];
const orangeClue = '台阶旁低头打字的男生：橙色手机壳';

export const chapter3Scenes: Partial<Record<SceneId, SceneDef>> = {
  C1: {
    id: 'C1', sceneKey: 'stage2d', title: '第二天 · 清晨',
    stageNotes: ['宿舍的水声停了。小陈把手机扣在桌上，晨光穿过窗帘。'],
    steps: [
      { kind: 'intertitle', id: 'c1-morning', lines: ['第二天'], lineDurationMs: 2000 },
      { kind: 'phone', id: 'c1-post', panel: { id: 'c1-post', closeActionId: 'close', sections: [
        { kind: 'post', id: 'c1-wall', title: '校园墙', publishedAt: '昨天 8:52', assetIds: ['cg_s13_walk_together'],
          views: 48200, commentCount: 1360, previousStats: { views: 4820, commentCount: 136 }, text: '一夜过去，转发和评论还在增加。', comments: [] },
      ] } },
      { kind: 'dialogue', id: 'c1-guilt', when: { key: 'pointedOut', equals: true }, lines: [
        { speaker: 'xiaochen', text: '那个……我好像跟别人提过她是咱班的。' },
      ] },
      { kind: 'dialogue', id: 'c1-comfort', when: { key: 'pointedOut', equals: false }, lines: [
        { speaker: 'xiaochen', text: '你别理那些评论。' },
      ] },
      { kind: 'choice', id: 'c1-reply', options: [
        { id: 'c1-stop-spreading', text: '先别再往外说了。', effects: { log: { type: 'choice', summary: '请小陈不要继续传播。' } } },
        { id: 'c1-go-class', text: '……先去上课吧。', effects: { log: { type: 'choice', summary: '和小陈一起去上课。' } } },
      ] },
    ],
    transitions: [{ to: 'C2' }],
  },
  C2: {
    id: 'C2', sceneKey: 'interior', title: '上午 · 教室',
    stageNotes: ['走廊里有目光和低语，视野边缘有暗角。林夏在最后一排画窗外，指尖有铅笔灰，笔袋里有一支铅笔。'],
    steps: [
      { kind: 'caption', id: 'c2-whispers', text: '“就是那个……”话音停了。林夏低头画着速写本。' },
      { kind: 'choice', id: 'c2-seat', allowMovement: true, prompt: '你打算坐在哪里？', options: [
        { id: 'seat-beside', interactId: 'seat-beside', text: '坐她旁边', effects: {
          set: { seat: 'beside' }, add: { trust: 1 }, log: { type: 'choice', summary: '坐在林夏旁边。' },
        } },
        { id: 'seat-front', interactId: 'seat-front', text: '坐前面', effects: {
          set: { seat: 'front' }, log: { type: 'choice', summary: '坐在教室前面。' },
        } },
        { id: 'seat-far', interactId: 'seat-far', text: '坐远处看手机', effects: {
          set: { seat: 'far' }, add: { phoneIgnored: 1 }, log: { type: 'choice', summary: '坐在远处看手机。' },
        } },
      ] },
      { kind: 'dialogue', id: 'c2-sketch', when: { key: 'seat', op: '==', value: 'beside' }, lines: [
        { speaker: null, text: '速写本上是窗外的树。她指尖沾着铅笔灰，笔袋里露出一支铅笔。' },
      ] },
      { kind: 'dialogue', id: 'c2-nod', when: { all: [
        { key: 'seat', op: '==', value: 'beside' }, { key: 'postChoice', op: '==', value: 'explain' },
      ] }, lines: [{ speaker: null, text: '她抬眼，对你轻轻点了一下头。' }] },
      { kind: 'dialogue', id: 'c2-relax', when: { all: [
        { key: 'seat', op: '==', value: 'beside' }, { key: 'postChoice', op: '==', value: 'wait' },
      ] }, lines: [{ speaker: null, text: '她没有回头，神情却松了一点。' }] },
    ],
    transitions: [{ to: 'C3' }],
  },
  C3: {
    id: 'C3', sceneKey: 'stage2d', title: '午后 · 周老师',
    stageNotes: ['辅导员办公室，午后逆光。'],
    steps: [
      { kind: 'dialogue', id: 'c3-teacher', lines: [
        { speaker: 'teacher', text: '林夏同意吗？' },
        { speaker: 'teacher', text: '我可以联系校园墙管理员下架，也可以提醒班里的同学。联系家长，要先得到她的同意。' },
        { speaker: 'teacher', text: '已经转出去的，我没办法。' },
      ] },
      { kind: 'choice', id: 'c3-response', options: [
        { id: 'c3-told', text: '说出你看到的经过', effects: { set: { teacherTalked: true, tellTeacher: 'told' } } },
        { id: 'c3-ask-her', text: '我先去问问林夏。', effects: { set: { teacherTalked: true, tellTeacher: 'ask_her' } } },
        { id: 'c3-think', text: '没事，我再想想。', effects: { set: { teacherTalked: false, tellTeacher: 'think' } } },
      ] },
      { kind: 'choice', id: 'c3-stairs', when: maySkipStairs, prompt: '楼梯间方向有动静。', options: [
        { id: 'c3-go-stairs', text: '去楼梯间看看', goto: 'c3-done' },
        { id: 'c3-skip-stairs', text: '算了，直接回班', when: maySkipStairs,
          effects: { set: { ending: 'bystander', visitedStairwell: false },
            log: { type: 'choice', summary: '听见楼梯间的动静，仍选择直接回班。' } }, goto: 'c3-done' },
      ] },
      { kind: 'system', id: 'c3-done', effects: {} },
    ],
    transitions: [
      { when: { all: [maySkipStairs, { key: 'visitedStairwell', equals: false },
        { key: 'ending', op: '==', value: 'bystander' }] }, to: 'E1' },
      { to: 'C4' },
    ],
  },
  C4: {
    id: 'C4', sceneKey: 'interior', title: '楼梯间 · 她的决定',
    stageNotes: ['楼梯间没人，脚步声有回声。抵达拐角后才听见电话。'],
    steps: [
      { kind: 'wait', id: 'c4-arrive', waitFor: { zoneId: 'stairwell-corner' },
        effects: { set: { visitedStairwell: true, fatherKnows: false } } },
      { kind: 'dialogue', id: 'c4-father-call', lines: [
        { speaker: 'linxia', text: '……嗯。没事。' },
        { speaker: 'linxia', text: '学校挺好的。' },
        { speaker: 'linxia', text: '我自己能走，你别担心。' },
        { speaker: null, text: '她挂了电话，看见了你。' },
      ] },
      { kind: 'choice', id: 'c4-father-question', options: [
        { id: 'c4-father-witness', text: '要不要让你爸爸出来说一下？他当时在场。', effects: { set: { askedAboutFather: true, fatherKnows: false } } },
        { id: 'c4-father-teacher', text: '老师说，如果你同意，可以联系家长。', effects: { set: { askedAboutFather: true, fatherKnows: false } } },
        { id: 'c4-father-knows', text: '……你爸爸知道吗？', effects: { set: { askedAboutFather: true, fatherKnows: false } } },
      ] },
      { kind: 'dialogue', id: 'c4-refusal', lines: [
        { speaker: 'linxia', text: '……不要。' },
        { speaker: null, text: '她沉默了一会儿。' },
        { speaker: 'linxia', text: '他们不会信的。……只会去找他。' },
      ] },
      { kind: 'choice', id: 'c4-response', options: [
        { id: 'c4-respect', text: '好，听你的。', effects: { add: { trust: 2 },
          log: { type: 'choice', summary: '尊重林夏不联系爸爸的决定。' } }, goto: 'c4-evidence-consent' },
        { id: 'c4-insist', text: '可是他说清楚了，大家就信了。', effects: { add: { trust: -1 },
          log: { type: 'choice', summary: '仍坚持让她爸爸出面。' } }, goto: 'c4-insist-reply' },
        { id: 'c4-other-way', text: '那我再想别的办法。', effects: { add: { trust: 1 },
          log: { type: 'choice', summary: '答应另想办法，不让她爸爸出面。' } }, goto: 'c4-evidence-consent' },
      ] },
      // 授权必须先读完，下一步才留证；坚持路线直接绕过这两步。
      { kind: 'dialogue', id: 'c4-evidence-consent', when: canSaveEvidence, lines: [
        { speaker: null, text: '你想起帮她捡起药袋时见过的小票，问她是否愿意留一份。' },
        { speaker: 'linxia', text: '可以，你留一份小票的照片吧。但是先不要发出去，要用的时候先问我。' },
        { speaker: null, text: '你答应：“好，不会擅自发，用之前先问你。”她把照片发了过来。' },
      ] },
      { kind: 'system', id: 'c4-evidence-save', when: canSaveEvidence, effects: {
        set: { evidence: true }, log: { type: 'choice', summary: '征得林夏同意后留存小票，答应使用前先询问。' },
      } },
      { kind: 'goto', id: 'c4-consent-done', target: 'c4-done' },
      { kind: 'dialogue', id: 'c4-insist-reply', lines: [
        { speaker: null, text: '她低下头。' }, { speaker: 'linxia', text: '……你不懂。' },
      ] },
      { kind: 'system', id: 'c4-done', effects: {} },
    ],
    transitions: [{ to: 'C5' }],
  },
  C5: {
    id: 'C5', sceneKey: 'interior', title: '下午 · 找到发布者',
    stageNotes: ['二楼别班走廊有六位同学，student-4 拿橙色手机壳；noticedTyper 为真时壳上有微光。',
      '三种方法可以反复尝试；只有主动选择继续才离开。'],
    steps: [
      { kind: 'system', id: 'c5-clues', effects: { pushClue: baseClues } },
      { kind: 'system', id: 'c5-orange-clue', when: { key: 'noticedTyper', equals: true }, effects: { pushClue: orangeClue } },
      { kind: 'phone', id: 'c5-memo-known', when: { key: 'noticedTyper', equals: true }, panel: {
        id: 'c5-memo-known', closeActionId: 'close', sections: [
          { kind: 'memo', id: 'c5-known-clues', title: '备忘录 · 找到发布者', updatedAt: '今天 下午', items: [...baseClues, orangeClue] },
        ],
      } },
      { kind: 'phone', id: 'c5-memo-unknown', when: { key: 'noticedTyper', equals: false }, panel: {
        id: 'c5-memo-unknown', closeActionId: 'close', sections: [
          { kind: 'memo', id: 'c5-unknown-clues', title: '备忘录 · 找到发布者', updatedAt: '今天 下午', items: baseClues },
        ],
      } },
      { kind: 'choice', id: 'c5-find-path', prompt: '你想怎么找到发布者？', options: [
        { id: 'recognize', text: '去二楼走廊辨认', goto: 'c5-recognize' },
        { id: 'relay', text: '联系校园墙管理员转达', goto: 'c5-admin' },
        { id: 'shout', text: '在校园墙公开留言：“发图的同学出来聊一下”', goto: 'c5-shout-effect' },
        { id: 'c5-memo', text: '再看看备忘录', goto: 'c5-clues' },
        { id: 'c5-proceed', text: '先到这里，晚些时候再去看看',
          when: { key: 'foundAyuanWay', op: '!=', value: null }, goto: 'c5-done' },
      ] },
      { kind: 'choice', id: 'c5-recognize', allowMovement: true, prompt: '靠近观察，再问一句：“请问你是……”', options: [
        { id: 'student-1', interactId: 'student-1', text: '询问靠窗的同学', when: canAskWrong, goto: 'c5-wrong-effect' },
        { id: 'student-2', interactId: 'student-2', text: '询问抱书的同学', when: canAskWrong, goto: 'c5-wrong-effect' },
        { id: 'student-3', interactId: 'student-3', text: '询问背着书包的同学', when: canAskWrong, goto: 'c5-wrong-effect' },
        { id: 'student-4', interactId: 'student-4', text: '询问拿橙色手机壳的同学', goto: 'c5-recognized' },
        { id: 'student-5', interactId: 'student-5', text: '询问站在门边的同学', when: canAskWrong, goto: 'c5-wrong-effect' },
        { id: 'student-6', interactId: 'student-6', text: '询问靠着栏杆的同学', when: canAskWrong, goto: 'c5-wrong-effect' },
        { id: 'back-menu', text: '先不问，换个办法', goto: 'c5-find-path' },
      ] },
      { kind: 'system', id: 'c5-wrong-effect', when: canAskWrong, effects: { add: { wrongAsks: 1, harm: 2 },
        log: { type: 'choice', summary: '询问了一位无关的同学。' } } },
      { kind: 'dialogue', id: 'c5-wrong-person', lines: [
        { speaker: 'passerby', text: '你认错人了吧？' },
        { speaker: null, text: '对方皱起眉头。你差点把一个无关的人拉进来。' },
      ] },
      { kind: 'caption', id: 'c5-wrong-limit', when: { key: 'wrongAsks', op: '>=', value: 3 },
        text: '先别继续打扰无关的人了。再看看线索，或者换个办法。' },
      { kind: 'goto', id: 'c5-wrong-retry', target: 'c5-recognize' },
      { kind: 'dialogue', id: 'c5-recognized', lines: [
        { speaker: 'ayuan', text: '……我是阿远。你找我？' },
      ] },
      { kind: 'system', id: 'c5-recognize-effect', when: { key: 'foundAyuanWay', op: '!=', value: 'shout' },
        effects: { set: { foundAyuanWay: 'recognize', yuanState: 'unprepared' },
          log: { type: 'choice', summary: '在走廊认出了拿橙色手机壳的阿远。' } } },
      { kind: 'goto', id: 'c5-recognize-return', target: 'c5-find-path' },
      { kind: 'phone', id: 'c5-admin', panel: { id: 'c5-admin', closeActionId: 'close', sections: [
        { kind: 'chat', id: 'c5-admin-chat', title: '校园墙管理员', unread: 1, messages: [
          { id: 'c5-admin-message', from: '校园墙管理员', text: '投稿人信息我不能给你。但可以帮你转达。' },
        ] },
      ] } },
      { kind: 'choice', id: 'c5-relay-confirm', options: [
        { id: 'c5-relay-send', text: '那麻烦帮我转达，就说有人想聊聊。', goto: 'c5-relay-effect' },
        { id: 'back-menu', text: '暂时不转达', goto: 'c5-find-path' },
      ] },
      { kind: 'system', id: 'c5-relay-effect', when: { key: 'foundAyuanWay', op: '==', value: null },
        effects: { set: { foundAyuanWay: 'relay', yuanState: 'guarded' },
          log: { type: 'choice', summary: '请校园墙管理员向投稿人转达想聊聊的请求。' } } },
      { kind: 'dialogue', id: 'c5-relay-sent', lines: [{ speaker: 'admin', text: '好，我会帮你转达。' }] },
      { kind: 'goto', id: 'c5-relay-return', target: 'c5-find-path' },
      // 只用已选路径守卫：公开喊话后其余方法不降级，也不能重复增加伤害。
      { kind: 'system', id: 'c5-shout-effect', when: { key: 'foundAyuanWay', op: '!=', value: 'shout' },
        effects: { set: { foundAyuanWay: 'shout', yuanState: 'hostile' }, add: { harm: 10 },
          log: { type: 'choice', summary: '在校园墙公开喊话，要求发图的同学出来聊聊。' } } },
      { kind: 'caption', id: 'c5-shout-warning', text: '你刚才的做法，也把一个人推到了大家面前。' },
      { kind: 'goto', id: 'c5-shout-return', target: 'c5-find-path' },
      { kind: 'system', id: 'c5-done', effects: {} },
    ],
    transitions: [{ when: { key: 'foundAyuanWay', op: '!=', value: null }, to: 'C6' }],
  },
  C6: {
    id: 'C6', sceneKey: 'interior', title: '夜晚 · 钩子',
    stageNotes: ['教学楼楼梯间，夜色里一个橙色手机壳亮了一下。'],
    steps: [
      { kind: 'wait', id: 'c6-arrive', waitFor: { zoneId: 'night-phone' } },
      { kind: 'intertitle', id: 'c6-orange-phone', lines: ['楼梯间，一个橙色手机壳亮了一下。'],
        lineDurationMs: 3000, skippable: false },
    ],
    transitions: [{ to: 'D1' }],
  },
};
