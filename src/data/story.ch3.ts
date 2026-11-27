import { DRAFT_REACTIONS } from './endingContent';
import type { Condition, SceneDef, SceneId, SceneTrigger } from './storySchema';

const viewLinxiaAvatarTrigger: SceneTrigger = {
  id: 'view-linxia-avatar',
  event: 'ui:phoneAction',
  action: 'reply',
  effects: {
    pushDraftReaction: DRAFT_REACTIONS.viewedAvatar,
    log: { type: 'observe', summary: '点开了林夏的头像。' },
  },
};

const maySkipStairs: Condition = { all: [
  { key: 'seat', op: '==', value: 'far' },
  { key: 'tellTeacher', op: '==', value: 'think' },
] };
const canSaveEvidence: Condition = { all: [
  { key: 'picked', equals: true }, { key: 'evidence', equals: false },
] };
const canAskWrong: Condition = { key: 'wrongAsks', op: '<', value: 3 };
const hasOrangeClue: Condition = { any: [{ key: 'noticedTyper', equals: true }, { key: 'orangeClue', equals: true }] };
const guardClue = '保安大叔：校门口台阶旁那个拿橙色手机壳的男生蹲着按过手机';
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
          views: 48200, commentCount: 1360, previousStats: { views: 4820, commentCount: 136 }, text: '一夜过去，转发和评论还在增加。', comments: [],
          actions: [{ id: 'c1-forward-roommate', text: '转给室友' }] },
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
    triggers: [
      { id: 'c1-forward-roommate', event: 'ui:phoneAction', target: 'c1-post', action: 'reply',
        effects: { pushDraftReaction: DRAFT_REACTIONS.forwardedRoommate,
          log: { type: 'choice', summary: '把校园墙帖子转给了室友。' } },
        reveal: { text: '你把帖子转给了室友。' } },
      viewLinxiaAvatarTrigger,
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
    id: 'C3', sceneKey: 'interior', title: '午后 · 周老师',
    stageNotes: ['沿着教学楼走廊找到辅导员办公室，推门进入与周老师谈话。'],
    steps: [
      { kind: 'wait', id: 'c3-find-office', waitFor: { interactId: 'teacher-office-door' } },
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
        { speaker: null, text: '她挂了电话，转过身看见了你。刚才还强撑着的肩膀一下子垮了下来。' },
      ] },
      { kind: 'dialogue', id: 'c4-break-down', lines: [
        { speaker: 'linxia', emotion: 'cry', text: '……他们还在转。' },
        { speaker: 'linxia', emotion: 'cry', text: '连我怎么走路都要被拍下来……我明明只是脚崴了，为什么要一直解释，好像怎么说都是我的错……' },
        { speaker: 'linxia', emotion: 'despair', text: '我不敢看手机，可它一直在震……走到哪儿都觉得有人在背后指着我。' },
      ] },
      { kind: 'choice', id: 'c4-comfort', prompt: '她低着头，眼泪顺着指缝滴在地上。', options: [
        { id: 'c4-comfort-tissue', text: '递给她一张纸巾：“先擦擦眼泪，我在这儿。”', effects: { add: { trust: 1 }, log: { type: 'choice', summary: '在楼梯间递纸巾安慰哭泣的林夏。' } } },
        { id: 'c4-comfort-stay', text: '安静地陪她站了一会儿，等她呼吸缓过来。', effects: { add: { trust: 1 }, log: { type: 'choice', summary: '在楼梯间安静陪着情绪崩溃的林夏。' } } },
        { id: 'c4-comfort-phone', text: '“先把手机扣过去，别看那些评论了。”', effects: { add: { trust: 1 }, log: { type: 'choice', summary: '劝林夏先别看手机评论，陪她缓和情绪。' } } },
      ] },
      { kind: 'dialogue', id: 'c4-after-comfort', lines: [
        { speaker: 'linxia', emotion: 'sad', text: '……谢谢。我不想让家里人看见我这样。' },
      ] },
      { kind: 'choice', id: 'c4-father-question', options: [
        { id: 'c4-father-witness', text: '要不要让你爸爸出来说一下？他当时在场。', effects: { set: { askedAboutFather: true, fatherKnows: false } } },
        { id: 'c4-father-teacher', text: '老师说，如果你同意，可以联系家长。', effects: { set: { askedAboutFather: true, fatherKnows: false } } },
        { id: 'c4-father-knows', text: '……你爸爸知道吗？', effects: { set: { askedAboutFather: true, fatherKnows: false } } },
      ] },
      { kind: 'dialogue', id: 'c4-refusal', lines: [
        { speaker: 'linxia', emotion: 'sad', text: '……不要。' },
        { speaker: null, text: '她沉默了一会儿。' },
        { speaker: 'linxia', emotion: 'despair', text: '他们不会信的。……只会去找他。' },
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
        set: { evidence: true },
        pushDraftReaction: DRAFT_REACTIONS.askedBeforeEvidence,
        log: { type: 'choice', summary: '征得林夏同意后留存小票，答应使用前先询问。' },
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
      { kind: 'system', id: 'c5-orange-clue', when: hasOrangeClue, effects: { pushClue: orangeClue } },
      { kind: 'phone', id: 'c5-memo-known', when: hasOrangeClue, panel: {
        id: 'c5-memo-known', closeActionId: 'close', sections: [
          { kind: 'memo', id: 'c5-known-clues', title: '备忘录 · 找到发布者', updatedAt: '今天 下午', items: [...baseClues, orangeClue] },
        ],
      } },
      { kind: 'phone', id: 'c5-memo-unknown', when: { not: hasOrangeClue }, panel: {
        id: 'c5-memo-unknown', closeActionId: 'close', sections: [
          { kind: 'memo', id: 'c5-unknown-clues', title: '备忘录 · 找到发布者', updatedAt: '今天 下午', items: baseClues },
        ],
      } },
      { kind: 'choice', id: 'c5-find-path', prompt: '你想怎么找到发布者？', options: [
        { id: 'recognize', text: '去二楼走廊辨认', goto: 'c5-recognize' },
        { id: 'ask-guard', text: '去校门问问值班的保安大叔', when: { key: 'talkedGuard', equals: false }, goto: 'c5-guard' },
        { id: 'relay', text: '联系校园墙管理员转达', goto: 'c5-admin' },
        { id: 'shout', text: '在校园墙公开留言：“发图的同学出来聊一下”', goto: 'c5-shout-effect' },
        { id: 'c5-memo', text: '再看看备忘录', goto: 'c5-clues' },
        { id: 'c5-proceed', text: '先到这里，晚些时候再去看看',
          when: { key: 'foundAyuanWay', op: '!=', value: null }, goto: 'c5-done' },
      ] },
      { kind: 'dialogue', id: 'c5-guard',
        effects: {
          set: { talkedGuard: true, orangeClue: true },
          pushClue: guardClue,
          log: { type: 'observe', summary: '去校门口询问值班保安大叔，记起台阶旁蹲着按橙色手机壳的男生。' },
        },
        lines: [
          { speaker: 'guard', text: '小姑娘爸爸那会儿刚从门岗过去没多久，我喊了一声台阶有露水，她爸还跟我道谢呢。' },
          { speaker: 'guard', text: '我就记得旁边台阶墩儿上有个穿蓝白校服、拿橙色手机壳的小伙子，蹲在那儿一直低头按手机。' },
        ] },
      { kind: 'choice', id: 'c5-guard-ask', options: [
        { id: 'c5-guard-willing-yes', text: '“师傅，如果老师来问起那天早上的事，您愿意说一下吗？”',
          effects: {
            set: { guardWilling: true },
            log: { type: 'choice', summary: '请保安大叔必要时如实向老师说明那天早晨校门前的经过。' },
          },
          goto: 'c5-guard-willing-reply' },
        { id: 'c5-guard-willing-no', text: '“谢谢师傅，那我先去走廊看看。”', goto: 'c5-guard-return' },
      ] },
      { kind: 'dialogue', id: 'c5-guard-willing-reply', lines: [
        { speaker: 'guard', text: '这有啥不能说的，本来就是人家爸送了一小段、人家姑娘自己进的校门嘛。' },
        { speaker: 'guard', text: '老师来问我，我就说实话。……可大伙儿传照片那阵，也没人来问我一句啊。' },
      ] },
      { kind: 'caption', id: 'c5-guard-caption', tone: 'subtle', text: '……是啊，谁听呢。', durationMs: 2600 },
      { kind: 'goto', id: 'c5-guard-return', target: 'c5-find-path' },
      { kind: 'choice', id: 'c5-recognize', allowMovement: true, prompt: '在走廊走近同学，按 E 或点击询问：“请问你是……”', options: [
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
    triggers: [viewLinxiaAvatarTrigger],
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
