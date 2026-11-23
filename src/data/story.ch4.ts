import { DRAFT_REACTIONS } from './endingContent';
import type { Condition, SceneDef, SceneId, SceneTrigger, StoryEffect } from './storySchema';

const viewLinxiaAvatarTrigger: SceneTrigger = {
  id: 'view-linxia-avatar',
  event: 'ui:phoneAction',
  action: 'reply',
  effects: {
    pushDraftReaction: DRAFT_REACTIONS.viewedAvatar,
    log: { type: 'observe', summary: '点开了林夏的头像。' },
  },
};

const hasProof: Condition = { any: [
  { key: 'evidence', equals: true },
  { all: [{ key: 'picked', equals: true }, { key: 'trust', op: '>=', value: 1 }] },
] };
const heardHer: Condition = { any: [
  { key: 'listened', equals: true }, { key: 'seenCrossedOut', equals: true },
] };
const team: Condition = { key: 'route', op: '==', value: 'team' };
const deleteOnly: Condition = { key: 'route', op: '==', value: 'deleteOnly' };
const earnsTeam: Condition = { any: [
  { key: 'yuanKeys', matches: ['fact', 'empathy', 'company'] },
  { all: [
    { key: 'yuanKeys', only: ['fact', 'empathy', 'company'] },
    { key: 'yuanScore', op: '>=', value: 2 },
  ] },
] };
// 每轮逼迫共用同一即时效果与前向出口，不会继续后续轮次。
const breakdown: StoryEffect = {
  pushYuanKey: 'force', add: { harm: 15 },
  set: { route: 'breakdown', ending: 'worst', joined: false, postDeleted: false },
};

export const chapter4Scenes: Partial<Record<SceneId, SceneDef>> = {
  D1: {
    id: 'D1', title: '侧楼梯平台 · 遇到阿远', sceneKey: 'interior',
    onEnter: { set: {
      yuanKeys: [], yuanScore: 0, route: null, joined: false, postDeleted: false,
      phrase: null, stage1Tries: 0, crystalHits: 0, kills: 0, helpedByAyuan: false,
      apologized: false, soloRepair: false, ending: null, finalAnswer: null,
    } },
    stageNotes: ['第三天放学后的侧楼梯平台。阿远握着橙色手机壳的手机，夕阳越过栏杆。'],
    steps: [
      { kind: 'intertitle', id: 'd1-after-school', lines: ['第三天，放学后'], lineDurationMs: 2000 },
      { kind: 'system', id: 'd1-default-guarded', when: { key: 'yuanState', op: '==', value: null },
        effects: { set: { yuanState: 'guarded' } } },
      { kind: 'wait', id: 'd1-approach', waitFor: { zoneId: 'platform-ayuan' } },
      { kind: 'cutscene', id: 'd1-platform-approach', key: 'platform-approach', durationMs: 1500, skippable: true },
      { kind: 'dialogue', id: 'd1-unprepared', when: { key: 'yuanState', op: '==', value: 'unprepared' },
        effects: { set: { yuanScore: 1 } }, lines: [
          { speaker: 'ayuan', text: '啊？你是……' }, { speaker: null, text: '手机一晃，屏幕黑了。' },
        ] },
      { kind: 'dialogue', id: 'd1-guarded', when: { key: 'yuanState', op: '==', value: 'guarded' },
        effects: { set: { yuanScore: 0 } }, lines: [{ speaker: 'ayuan', text: '是你让管理员转达的？……有事吗。' }] },
      { kind: 'dialogue', id: 'd1-hostile', when: { key: 'yuanState', op: '==', value: 'hostile' },
        effects: { set: { yuanScore: -1 } }, lines: [{ speaker: 'ayuan', text: '又是你。别在墙上喊了行吗。' }] },
    ],
    transitions: [{ to: 'D2' }],
  },
  D2: {
    id: 'D2', title: '说服阿远', sceneKey: 'stage2d',
    steps: [
      { kind: 'dialogue', id: 'd2-opening', lines: [{ speaker: 'ayuan', text: '我就是看着好玩，随手发的。又没写她名字。' }] },
      { kind: 'choice', id: 'd2-round-1', options: [
        { id: 'd2-r1-fact', text: '我知道。后来很多人转了，她的名字也被人翻出来了。', effects: { pushYuanKey: 'fact', add: { yuanScore: 1 } } },
        { id: 'd2-r1-empathy', text: '你发之前，有看到她后来是自己走的吗？', effects: { pushYuanKey: 'empathy', add: { yuanScore: 1 } } },
        { id: 'd2-r1-law', text: '没写名字、随手发的，传成这样也算侵害名誉权了，现在停下来还来得及。',
          effects: { pushYuanKey: 'fact', add: { yuanScore: 1 },
            log: { type: 'choice', summary: '从事实与名誉权边界劝解阿远，提醒他现在停下来还来得及。' } } },
        { id: 'd2-r1-force', text: '我不想闹大，但老师那边已经有人在问了。', effects: breakdown, goto: 'd2-breakdown-caption' },
        { id: 'd2-r1-noise', text: '嗯，一张照片而已。', effects: { pushYuanKey: 'noise', add: { yuanScore: 0 } } },
      ] },
      { kind: 'dialogue', id: 'd2-doubt', lines: [{ speaker: 'ayuan', text: '后面那张同行的又不是我发的，别什么都算我头上。……而且你说的，我怎么信？' }] },
      { kind: 'choice', id: 'd2-round-2', options: [
        { id: 'd2-r2-fact', when: hasProof, text: '我这儿有她当天的药店小票和照片，你看时间。',
          effects: { pushYuanKey: 'fact', add: { yuanScore: 2 } }, goto: 'd2-proof-receipt' },
        { id: 'd2-r2-fact', when: { not: hasProof }, text: '我知道不是你一个人。但最先传开的是你那条。',
          effects: { pushYuanKey: 'fact', add: { yuanScore: 1 } }, goto: 'd2-mirror-pointed' },
        { id: 'd2-r2-empathy', when: heardHer, text: '她那天也没想麻烦谁。',
          effects: { pushYuanKey: 'empathy', add: { yuanScore: 1 } }, goto: 'd2-mirror-pointed' },
        { id: 'd2-r2-empathy', when: { not: heardHer }, text: '她那天好像挺累的。',
          effects: { pushYuanKey: 'empathy', add: { yuanScore: 1 } }, goto: 'd2-mirror-pointed' },
        { id: 'd2-r2-force', text: '你想让大家都知道是你发的吗？', effects: breakdown, goto: 'd2-breakdown-caption' },
        { id: 'd2-r2-noise', text: '也许吧。我也不太清楚。',
          effects: { pushYuanKey: 'noise', add: { yuanScore: 0 } }, goto: 'd2-mirror-pointed' },
      ] },
      { kind: 'art', id: 'd2-proof-receipt', assetId: 'prop_pharmacy_receipt' },
      { kind: 'dialogue', id: 'd2-mirror-pointed', when: { key: 'pointedOut', equals: true },
        lines: [{ speaker: 'ayuan', text: '你不是还说过‘这是我们班的’吗？' }] },
      { kind: 'dialogue', id: 'd2-mirror-witness', when: { key: 'pointedOut', equals: false },
        lines: [{ speaker: 'ayuan', text: '你当时不也在台阶那儿吗？你不也看见了？' }] },
      { kind: 'choice', id: 'd2-round-3', options: [
        { id: 'd2-r3-company', text: '我当时也看到了，也没出声。你要去的话，我在旁边。', effects: { pushYuanKey: 'company', add: { yuanScore: 1 } } },
        { id: 'd2-r3-fact', text: '删了，至少不会再从你这里传出去。', effects: { pushYuanKey: 'fact', add: { yuanScore: 1 } } },
        { id: 'd2-r3-force', text: '那你就继续让它挂着吧。', effects: breakdown, goto: 'd2-breakdown-caption' },
        { id: 'd2-r3-noise', text: '你想怎么做都行。', effects: { pushYuanKey: 'noise', add: { yuanScore: 0 } } },
      ] },
      { kind: 'system', id: 'd2-team', when: earnsTeam,
        effects: { set: { route: 'team', joined: true, postDeleted: true } } },
      { kind: 'system', id: 'd2-delete-only', when: { not: earnsTeam },
        effects: { set: { route: 'deleteOnly', joined: false, postDeleted: true } } },
      { kind: 'goto', id: 'd2-resolved', target: 'd2-exit' },
      { kind: 'caption', id: 'd2-breakdown-caption', text: '你刚才的做法，和他发帖时一样。' },
      { kind: 'dialogue', id: 'd2-breakdown-forwarded', lines: [
        { speaker: 'ayuan', text: '你说的这些话，我也截下来了。' },
        { speaker: null, text: '他把刚才的对话截图发进群里。新的转发提示亮了起来。' },
      ] },
      { kind: 'system', id: 'd2-exit', effects: {} },
    ],
    transitions: [{ when: { key: 'route', op: '==', value: 'breakdown' }, to: 'E1' }, { to: 'D3' }],
  },
  D3: {
    id: 'D3', title: '删帖结果', sceneKey: 'stage2d',
    steps: [
      { kind: 'dialogue', id: 'd3-delete', lines: [{ speaker: null, text: '阿远打开手机，在你面前按下了删除。' }] },
      { kind: 'phone', id: 'd3-deleted-post', panel: { id: 'd3-phone', closeActionId: 'close', sections: [
        { kind: 'post', id: 'd3-original-post', title: '校园墙', publishedAt: '第一天 8:52',
          assetIds: [], views: 48200, commentCount: 0, text: '该内容已删除', deleted: true, comments: [] },
      ] } },
      { kind: 'dialogue', id: 'd3-team', when: team, lines: [{ speaker: 'ayuan', text: '……我跟你一起。' }] },
      { kind: 'dialogue', id: 'd3-delete-only', when: deleteOnly, lines: [
        { speaker: 'ayuan', text: '我删了。别的，我不管了。' }, { speaker: null, text: '他收起手机，沿着楼梯走开。' },
      ] },
    ],
    triggers: [viewLinxiaAvatarTrigger],
    transitions: [{ to: 'D4' }],
  },
  D4: {
    id: 'D4', title: '删不回', sceneKey: 'stage2d',
    steps: [
      { kind: 'phone', id: 'd4-forwarded-posts', panel: { id: 'd4-phone', closeActionId: 'close', sections: [
        { kind: 'chat', id: 'd4-class-screenshots', title: '班群', unread: 2, messages: [
          { id: 'd4-screenshot', from: '同学', text: '群里还有之前那条帖子的截图。' },
          { id: 'd4-forward', from: '同学', text: '别的校园号也搬运了，转发还在继续。' },
        ] },
        { kind: 'post', id: 'd4-repost', title: '校园见闻 · 搬运帖', publishedAt: '今天 16:42',
          assetIds: ['cg_s11_post_crop', 'cg_s13_walk_together'], views: 52680, commentCount: 218,
          text: '【搬运】刚才那条怎么秒删了？还好提前截了图，大家自己看吧…（转发 326 次）', comments: [
            { id: 'd4-comment-1', author: '路过的同学', text: '原来是脚崴了？可是我还是觉得……', likes: 37 },
            { id: 'd4-comment-2', author: '匿名同学', text: '删了就想没事？', likes: 64 },
          ] },
      ] } },
      { kind: 'dialogue', id: 'd4-team-realization', when: team, lines: [
        { speaker: 'ayuan', text: '我以为删了就没了……' }, { speaker: 'ayuan', text: '我发的时候，真的没人看啊。' },
      ] },
      { kind: 'choice', id: 'd4-team-phrase', when: team, options: [
        { id: 'd4-team-act', text: '我们该做点什么了。', effects: { set: { phrase: '我们该做点什么了。' } } },
        { id: 'd4-team-explain', text: '删了不够，我们去把话说清楚。', effects: { set: { phrase: '删了不够，我们去把话说清楚。' } } },
      ] },
      { kind: 'caption', id: 'd4-alone', when: deleteOnly, text: '你独自看着手机。原帖消失的位置，被新的截图填满了。' },
      { kind: 'choice', id: 'd4-solo-phrase', when: deleteOnly, options: [
        { id: 'd4-solo-more', text: '或许我还可以做得更多。', effects: { set: { phrase: '或许我还可以做得更多。' } } },
        { id: 'd4-solo-start', text: '至少，我能做的我先做。', effects: { set: { phrase: '至少，我能做的我先做。' } } },
      ] },
    ],
    triggers: [viewLinxiaAvatarTrigger],
    transitions: [{ to: 'D5' }],
  },
  D5: {
    id: 'D5', title: '保护水晶', sceneKey: 'stage2d',
    stageNotes: ['手机屏幕溶解，气泡涌出，变成道路与中央浅黄色水晶。',
      '入队线由橙色小人阿远自动协防；两阶段难度、重试、简化和跳过由 crystal 小游戏管理。'],
    steps: [
      { kind: 'minigame', id: 'd5-crystal', game: 'crystal' },
      { kind: 'caption', id: 'd5-together', when: team, text: '挡不住所有的，但不是一个人。' },
      { kind: 'caption', id: 'd5-alone', when: deleteOnly, text: '一个人很难挡住所有人。' },
    ],
    transitions: [{ to: 'D6' }],
  },
  D6: {
    id: 'D6', title: '道歉与补救', sceneKey: 'interior',
    stageNotes: ['傍晚教室外走廊。林夏站在窗边，夕阳把影子拉长。'],
    steps: [
      { kind: 'wait', id: 'd6-approach', waitFor: { zoneId: 'corridor-linxia' } },
      { kind: 'dialogue', id: 'd6-apology', when: team, lines: [
        { speaker: 'ayuan', text: '对不起。我就是随手……' },
        { speaker: null, text: '林夏靠在窗边，眼圈还是红的，沉默了一会儿。' },
        { speaker: 'linxia', emotion: 'cry', text: '……帖子删了，可别人截过的话还是收不回来。我现在听到手机震动就心慌……我需要时间。' },
      ] },
      { kind: 'choice', id: 'd6-team-response', when: team, options: [
        { id: 'd6-team-speak', text: '你想说什么就说。' },
        { id: 'd6-team-silent', text: '（不说话）' },
        { id: 'd6-team-support', text: '后面要是还有人乱转，我陪你把录屏证据留好，一起找周老师或向平台投诉。',
          effects: { log: { type: 'choice', summary: '告诉林夏，若再有转发会陪她留存证据并通过正规渠道处理。' } } },
      ] },
      { kind: 'system', id: 'd6-team-repair', when: team,
        effects: { set: { apologized: true, soloRepair: false, ending: 'best' }, add: { harm: -10 } } },
      { kind: 'choice', id: 'd6-solo-response', when: deleteOnly, options: [
        { id: 'd6-solo-deleted', text: '帖子已经删了。' },
        { id: 'd6-solo-tell-me', text: '之后如果有人再说什么，告诉我。' },
        { id: 'd6-solo-okay', text: '你还好吗？' },
        { id: 'd6-solo-support', text: '后面要是还有人乱转，我陪你把录屏证据留好，一起找周老师或向平台投诉。',
          effects: { log: { type: 'choice', summary: '告诉林夏，若再有转发会陪她留存证据并通过正规渠道处理。' } } },
      ] },
      { kind: 'dialogue', id: 'd6-solo-answer', when: deleteOnly, lines: [
        { speaker: 'linxia', emotion: 'sad', text: '嗯。谢谢你帮我跑这一趟……只是，好像还是有点怕明天走进教室。' },
      ] },
      { kind: 'system', id: 'd6-solo-repair', when: deleteOnly,
        effects: { set: { soloRepair: true, apologized: false, ending: 'middle' } } },
      { kind: 'intertitle', id: 'd6-one-month-later', lines: ['一个月后'], lineDurationMs: 2000 },
    ],
    transitions: [{ to: 'E1' }],
  },
};
