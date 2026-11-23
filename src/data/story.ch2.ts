import { DRAFT_REACTIONS } from './endingContent';
import type { Condition, SceneDef, SceneId, SceneTrigger } from './storySchema';

const explain: Condition = { key: 'postChoice', op: '==', value: 'explain' };
const wait: Condition = { key: 'postChoice', op: '==', value: 'wait' };
const joke: Condition = { key: 'postChoice', op: '==', value: 'joke' };
const canAskEvidence: Condition = { all: [
  { key: 'picked', equals: true },
  { key: 'trust', op: '>=', value: 1 },
  { any: [explain, { all: [wait, { key: 'addedHer', equals: true }] }] },
] };

// 评论点击走触发器心声，不推进当前手机步骤。
const commentAThought: NonNullable<SceneTrigger['reveal']> = {
  kind: 'inner', text: '……他们只看见了她走路的那一张。',
};
const commentCThought: NonNullable<SceneTrigger['reveal']> = {
  kind: 'inner', text: '……原来，站出来是要被一起算进去的。',
};

export const chapter2Scenes: Partial<Record<SceneId, SceneDef>> = {
  S11: {
    id: 'S11', sceneKey: 'stage2d', title: '宿舍 · 室友递来手机',
    stageNotes: ['宿舍里，小陈从椅子上转过身，把手机递到你面前。'],
    steps: [
      { kind: 'dialogue', id: 's11-roommate', lines: [
        { speaker: 'xiaochen', text: '你看，有人被爸爸背着来报到。' },
      ] },
      { kind: 'caption', id: 's11-recognize', when: { key: 'noticedPhoto', equals: true },
        text: '这是那张合照的一角。' },
      { kind: 'phone', id: 's11-phone', panel: {
        id: 's11-phone', closeActionId: 'close', sections: [
          { kind: 'post', id: 's11-post', title: '校园墙', publishedAt: '8:52',
            assetIds: ['cg_s11_post_crop'], views: 68, commentCount: 3,
            text: '新生报到名场面', comments: [
              { id: 's11-comment-a', author: '匿名用户', text: '哈哈有点可爱，爸爸辛苦了～', likes: 5 },
              { id: 's11-comment-b', author: '匿名用户', text: '开学日校门口人好多啊，看着就累。', likes: 2 },
            ] },
        ],
      } },
      { kind: 'choice', id: 's11-reply', prompt: '小陈等着你的反应。', options: [
        { id: 's11-laugh', text: '哈哈。',
          effects: { set: { roommateReply: '哈哈。' }, log: { type: 'choice', summary: '看了小陈递来的帖子，回了一句“哈哈。”' } },
          goto: 's11-done' },
        { id: 's11-injury', text: '她好像是脚崴了。',
          effects: { set: { roommateReply: '她好像是脚崴了。' }, log: { type: 'choice', summary: '告诉小陈，她好像是脚崴了。' } },
          goto: 's11-injury-reply' },
        { id: 's11-return', text: '（看一眼，把手机还给他）',
          effects: { set: { roommateReply: '（看一眼还给他）' }, log: { type: 'choice', summary: '看了一眼帖子，把手机还给小陈。' } },
          goto: 's11-done' },
        { id: 's11-classmate', text: '这是我们班的吧。',
          effects: { set: { roommateReply: '这是我们班的吧。', pointedOut: true }, add: { harm: 3 },
            pushDraftReaction: DRAFT_REACTIONS.forwardedRoommate,
            log: { type: 'choice', summary: '对小陈说：“这是我们班的吧。”' } },
          goto: 's11-classmate-reply' },
      ] },
      { kind: 'dialogue', id: 's11-injury-reply',
        when: { key: 'roommateReply', op: '==', value: '她好像是脚崴了。' },
        lines: [{ speaker: 'xiaochen', text: '哦，那也挺不容易的。' }] },
      { kind: 'dialogue', id: 's11-classmate-reply',
        when: { key: 'roommateReply', op: '==', value: '这是我们班的吧。' },
        lines: [{ speaker: 'xiaochen', text: '真的？哪个？' }] },
      { kind: 'system', id: 's11-done', effects: { log: { type: 'system', summary: '到了吃饭的时候，你离开宿舍。' } } },
    ],
    transitions: [{ to: 'S12' }],
  },
  S12: {
    id: 'S12', sceneKey: 'canteen', title: '食堂 · 找窗口打饭',
    stageNotes: ['找到三号窗口打饭，不设时间限制。', '沿途有人低头看手机，三五个人凑在一起低声交谈。'],
    steps: [
      { kind: 'wait', id: 's12-window', waitFor: { interactId: 'window-three' } },
      { kind: 'dialogue', id: 's12-vibration', lines: [
        { speaker: null, text: '你端起餐盘，口袋里的手机震动了一下。' },
      ] },
    ],
    triggers: [
      { id: 's12-whisper-1', event: 'scene:enterZone', target: 'canteen-whisper-1', once: true,
        effects: { add: { canteenSeen: 1 }, log: { type: 'observe', summary: '走近一桌低声议论照片的人，他们停住了话头。' } },
        reveal: { text: '有人低声议论照片里她走路的样子。你走近时，话音停了一下，目光移开。' } },
      { id: 's12-whisper-2', event: 'scene:enterZone', target: 'canteen-whisper-2', once: true,
        effects: { add: { canteenSeen: 1 }, log: { type: 'observe', summary: '听见有人提起与她同行的人，随后移开目光。' } },
        reveal: { text: '几个人提起与她同行的人。看见你走近，他们收住了声音，转开目光。' } },
      { id: 's12-whisper-3', event: 'scene:enterZone', target: 'canteen-whisper-3', once: true,
        effects: { add: { canteenSeen: 1 }, log: { type: 'observe', summary: '窗口前的人看了看手机，又抬头打量你。' } },
        reveal: { text: '窗口前的人抬头对比了一眼你，又低下头看手机。' } },
    ],
    transitions: [{ to: 'S13' }],
  },
  S13: {
    id: 'S13', sceneKey: 'canteen', title: '同行照片',
    steps: [
      { kind: 'dialogue', id: 's13-message', lines: [
        { speaker: 'xiaochen', text: '你快看帖子。' },
      ] },
      { kind: 'phone', id: 's13-phone', panel: {
        id: 's13-phone', closeActionId: 'close', sections: [
          { kind: 'notice', id: 's13-mention', text: '有人在帖子里 @ 了你。' },
          { kind: 'post', id: 's13-post', title: '校园墙', publishedAt: '8:52',
            assetIds: ['cg_s11_post_crop', 'cg_s13_walk_together'], views: 4820, commentCount: 136,
            text: '刚又收到同学投稿：进校门后明明自己走得好好的，之前台阶上是不是有点夸大了？顺便问一下旁边这位同学 @你',
            comments: [
              { id: 's13-comment-a', author: '匿名用户 A', likes: 142,
                text: '这个女生既然可以自己走路，为什么还要被背着？', actionId: 's13-comment-a' },
              { id: 's13-comment-b', author: '匿名用户 B', likes: 89, replyTo: 's13-comment-a',
                text: '是啊，这也太不体谅父母了。' },
              { id: 's13-comment-c', author: '匿名用户 C', likes: 318,
                text: '这个男生跟她一起玩，是不是也是这样的人？', actionId: 's13-comment-c' },
              { id: 's13-comment-d', author: '匿名用户 D', likes: 246, replyTo: 's13-comment-c',
                text: '肯定是，毕竟臭味相投哈哈哈。' },
            ] },
        ],
      } },
      { kind: 'caption', id: 's13-that-is-you', text: '……那是你。' },
    ],
    triggers: [
      { id: 's13-comment-a', event: 'ui:phoneAction', target: 's13-phone', action: 'reply', once: true, reveal: commentAThought },
      { id: 's13-comment-c', event: 'ui:phoneAction', target: 's13-phone', action: 'reply', once: true, reveal: commentCThought },
    ],
    transitions: [{ to: 'S14' }],
  },
  S14: {
    id: 'S14', sceneKey: 'stage2d', title: '三个选择',
    stageNotes: ['解释和等等路线中的对话发生在手机聊天里。', '只有解释路线进入清气泡小游戏；玩笑路线以黑幕进入 E1。'],
    steps: [
      { kind: 'choice', id: 's14-choice', prompt: '输入框里的光标闪着。', options: [
        { id: 's14-explain', text: '回一句：“她那天脚崴了。”',
          effects: { set: { postChoice: 'explain' }, add: { harm: 3 },
            log: { type: 'choice', summary: '在帖子下解释：“她那天脚崴了。”随后收到质疑解释的回评。' } },
          goto: 's14-backlash' },
        { id: 's14-wait', text: '先不回，等热度过去。',
          effects: { set: { postChoice: 'wait' }, log: { type: 'choice', summary: '没有回复帖子，想等热度过去。' } },
          goto: 's14-add-her' },
        { id: 's14-joke', text: '发一条：“那天我俩都迟到，被拍惨了哈哈。”',
          effects: { set: { postChoice: 'joke', ending: 'joined' },
            log: { type: 'choice', summary: '在帖子下发了一条关于两人迟到的玩笑。' } },
          goto: 's14-joke-blackout' },
      ] },
      { kind: 'dialogue', id: 's14-backlash', when: explain, lines: [
        { speaker: null, text: '你发出：“她那天脚崴了。”' },
        { speaker: null, text: '匿名用户 E 回复了你：“脚崴了还能走那么稳？别洗了行吗。”' },
      ] },
      { kind: 'dialogue', id: 's14-linxia-adds', when: explain, effects: { add: { trust: 2 } }, lines: [
        { speaker: null, text: '一条好友申请弹出来。通过后，对方发来两句话。' },
        { speaker: 'linxia', text: '……谢谢。' },
        { speaker: 'linxia', text: '我是林夏。' },
        { speaker: null, text: '你回复：“我记得。那天我们一起去登记的。”' },
        { speaker: 'linxia', text: '嗯。我没想到，照片会变成这样。' },
      ] },
      { kind: 'choice', id: 's14-listen', when: explain, prompt: '她的输入状态亮了又灭。', options: [
        { id: 's14-listen-yes', text: '想说的话，我听着。不想说也没事。',
          effects: { set: { listened: true }, add: { trust: 2 }, log: { type: 'choice', summary: '告诉林夏，愿意听她说，也可以安静陪着。' } },
          goto: 's14-listen-reply' },
        { id: 's14-listen-later', text: '你先歇一会儿。',
          effects: { log: { type: 'choice', summary: '让林夏先休息，没有继续追问。' } }, goto: 's14-evidence' },
      ] },
      { kind: 'dialogue', id: 's14-listen-reply', when: { all: [explain, { key: 'listened', equals: true }] }, lines: [
        { speaker: 'linxia', text: '我那天只是走得慢一点。爸爸担心我，就背了那一段台阶。' },
        { speaker: 'linxia', text: '现在好像怎么说，都有人觉得不是那样。' },
        { speaker: null, text: '你回复：“嗯，我在。你慢慢说。”' },
        { speaker: 'linxia', text: '……谢谢你听我说。' },
      ] },
      { kind: 'goto', id: 's14-explain-to-evidence', when: explain, target: 's14-evidence' },
      { kind: 'choice', id: 's14-add-her', when: wait, prompt: '你找到林夏的头像。要不要加她，说明一下？',
        effects: { pushDraftReaction: DRAFT_REACTIONS.viewedAvatar }, options: [
        { id: 's14-add-yes', text: '加她，说一声。',
          effects: { set: { addedHer: true }, log: { type: 'choice', summary: '主动加了林夏，想说明帖子的事。' } }, goto: 's14-distant-chat' },
        { id: 's14-add-no', text: '算了，先不加了。',
          effects: { set: { addedHer: false }, log: { type: 'choice', summary: '没有加林夏，也没有回复帖子。' } }, goto: 's14-done' },
      ] },
      { kind: 'dialogue', id: 's14-distant-chat', when: { all: [wait, { key: 'addedHer', equals: true }] }, lines: [
        { speaker: null, text: '很晚，好友申请才被通过。你发去一句：“我是那天一起登记的同学。”' },
        { speaker: 'linxia', text: '嗯。' },
        { speaker: null, text: '你回复：“帖子不是我转的。”' },
        { speaker: null, text: '对话框安静了一会儿。' },
        { speaker: 'linxia', text: '……你不用特意告诉我。' },
      ] },
      { kind: 'goto', id: 's14-wait-to-evidence', when: wait, target: 's14-evidence' },
      { kind: 'intertitle', id: 's14-joke-blackout', when: joke, lineDurationMs: 2400, skippable: true, lines: [
        '你只是想把话题从自己身上挪开。',
        '那条玩笑得了很多赞。',
        '第二天，帖子的浏览数多了一个零。',
        '林夏的座位，空了几天。',
        '没有人记得，是谁先笑的。',
      ] },
      { kind: 'goto', id: 's14-joke-to-end', when: joke, target: 's14-done' },
      // 两条聊天线在此汇合，只有满足前置条件才显示询问；不从这里回跳任何加值步骤。
      { kind: 'choice', id: 's14-evidence', when: canAskEvidence, prompt: '你想起那天药袋里的小票。', options: [
        { id: 's14-evidence-ask', text: '那天药店的小票还在吗？你愿意的话，我想留一份，之后需要时先问你。',
          goto: 's14-evidence-consent' },
        { id: 's14-evidence-skip', text: '（先不提小票的事）',
          effects: { log: { type: 'choice', summary: '没有询问保存药店小票。' } }, goto: 's14-after-evidence' },
      ] },
      { kind: 'dialogue', id: 's14-evidence-consent', when: canAskEvidence, lines: [
        { speaker: 'linxia', text: '还在。可以，你留一份吧。' },
        { speaker: 'linxia', text: '不过，先不要发出去。要用的时候，先跟我说，好吗？' },
        { speaker: null, text: '你回复：“好，我先留着，不会擅自发。”她随后发来了小票的照片。' },
      ] },
      { kind: 'system', id: 's14-evidence-save', when: canAskEvidence,
        effects: { set: { evidence: true }, add: { trust: 1 },
          pushDraftReaction: DRAFT_REACTIONS.askedBeforeEvidence,
          log: { type: 'choice', summary: '征得林夏明确同意后，保存了药店小票，并答应使用前先问她。' } } },
      { kind: 'system', id: 's14-after-evidence', effects: {} },
      { kind: 'minigame', id: 's14-bubble', when: explain, game: 'bubble' },
      { kind: 'system', id: 's14-done', effects: { log: { type: 'system', summary: '第二章结束。' } } },
    ],
    transitions: [{ when: joke, to: 'E1' }, { to: 'C1' }],
  },
};
