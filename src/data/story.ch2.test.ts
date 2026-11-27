import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/eventBus';
import { SceneMachine } from '../core/sceneMachine';
import { chapter1 } from './story.ch1';
import { chapter2Scenes } from './story.ch2';
import type { ChapterStory, SceneId, StateSet } from './storySchema';

function harness(entry: SceneId = 'S14', seed: StateSet = {}) {
  const scene = chapter2Scenes[entry];
  if (!scene) throw new Error(`缺少测试入口 ${entry}`);
  const chapter: ChapterStory = {
    ...chapter1, startScene: entry,
    scenes: {
      ...chapter2Scenes,
      [entry]: { ...scene, onEnter: { set: seed } },
      C1: { id: 'C1', title: '下一章测试终点', sceneKey: 'stage2d', steps: [{ kind: 'end', id: 'c1-end' }], transitions: [] },
      E1: { id: 'E1', title: '结局测试终点', sceneKey: 'stage2d', steps: [{ kind: 'end', id: 'e1-end' }], transitions: [] },
    },
  };
  const bus = new EventBus();
  const captions: GameEvents['ui:showCaption'][] = [];
  const dialogues: GameEvents['ui:showDialogue'][] = [];
  const choices: GameEvents['ui:showChoices'][] = [];
  const intertitles: GameEvents['ui:showIntertitle'][] = [];
  bus.on('ui:showCaption', (event) => captions.push(event));
  bus.on('ui:showDialogue', (event) => dialogues.push(event));
  bus.on('ui:showChoices', (event) => choices.push(event));
  bus.on('ui:showIntertitle', (event) => intertitles.push(event));
  const machine = new SceneMachine({ chapter, bus, now: () => 1000 });
  const current = () => chapter.scenes[machine.getSceneId()]?.steps[machine.getSnapshot().stepIndex];
  // 仅代替读完台词/关手机，不自动选择或伪造小游戏结果。
  const readThrough = () => {
    for (let i = 0; i < 50; i++) {
      if (machine.isEnded()) return;
      const step = current();
      if (!step) throw new Error('状态机停在不存在的步骤');
      if (step.kind === 'phone') machine.onPhoneAction(step.panel.id, 'close');
      else if (['dialogue', 'caption', 'intertitle', 'cutscene'].includes(step.kind)) machine.onDialogueEnd(step.id);
      else return;
    }
    throw new Error('剧情疑似循环');
  };
  const choose = (stepId: string, optionId: string) => {
    expect(current()?.id).toBe(stepId);
    machine.onChooseOption(stepId, optionId);
    readThrough();
  };
  machine.startNew(entry, 'bystander');
  return { machine, captions, dialogues, choices, intertitles, current, readThrough, choose };
}

function finishBubble(h: ReturnType<typeof harness>) {
  expect(h.current()).toMatchObject({ id: 's14-bubble', kind: 'minigame', game: 'bubble' });
  h.machine.onMinigameEnd('s14-bubble', 0, 0);
  expect(h.machine.getSceneId()).toBe('C1');
  expect(h.machine.isEnded()).toBe(true);
}

describe('第二章剧本', () => {
  it('只提供四个场景，所有本地跳转有目标且不回跳重放效果', () => {
    expect(Object.keys(chapter2Scenes)).toEqual(['S11', 'S12', 'S13', 'S14']);
    for (const scene of Object.values(chapter2Scenes)) {
      const ids = scene.steps.map((step) => step.id);
      expect(new Set(ids).size).toBe(ids.length);
      scene.steps.forEach((step, index) => {
        expect(step.kind).not.toBe('end');
        const targets = step.kind === 'goto' ? [step.target]
          : step.kind === 'choice' ? step.options.flatMap((option) => option.goto ? [option.goto] : []) : [];
        for (const target of targets) expect(ids.indexOf(target)).toBeGreaterThan(index);
      });
    }
  });

  it.each([true, false])('S11 合照心声取决于 noticedPhoto=%s，低热帖数据完整', (noticedPhoto) => {
    const h = harness('S11', { noticedPhoto });
    h.readThrough();
    expect(h.captions.some((event) => event.stepId === 's11-recognize')).toBe(noticedPhoto);
    const step = chapter2Scenes.S11?.steps.find((item) => item.kind === 'phone');
    expect(step?.kind === 'phone' && step.panel.sections[0]).toMatchObject({
      kind: 'post', publishedAt: '8:52', views: 68, commentCount: 3, assetIds: ['cg_s11_post_crop'],
    });
  });

  it.each([
    ['s11-laugh', '哈哈。', 0, null],
    ['s11-injury', '她好像是脚崴了。', 0, 's11-injury-reply'],
    ['s11-return', '（看一眼还给他）', 0, null],
    ['s11-classmate', '这是我们班的吧。', 3, 's11-classmate-reply'],
  ] as const)('S11 回应 %s 不串线且只加一次伤害', (option, reply, harm, response) => {
    const h = harness('S11');
    h.readThrough();
    h.choose('s11-reply', option);
    h.machine.onChooseOption('s11-reply', option);
    expect(h.machine.getState()).toMatchObject({ roommateReply: reply, pointedOut: harm === 3, harm: 20 + harm });
    expect(h.machine.getSceneId()).toBe('S12');
    expect(h.dialogues.filter((event) => event.stepId !== 's11-roommate').map((event) => event.stepId))
      .toEqual(response ? [response] : []);
  });

  it('S12 三处旁听各加一次，错误事件不能代替打饭', () => {
    const h = harness('S12');
    h.machine.onEnterZone('S11', 'canteen-whisper-1');
    for (const id of ['canteen-whisper-1', 'canteen-whisper-2', 'canteen-whisper-3']) {
      h.machine.onEnterZone('S12', id);
      h.machine.onEnterZone('S12', id);
    }
    expect(h.machine.getState().canteenSeen).toBe(3);
    expect(h.captions).toHaveLength(3);
    expect(h.captions.every((event) => event.kind === 'observation')).toBe(true);
    h.machine.onInteract('S12', 'window-two');
    expect(h.current()?.id).toBe('s12-window');
    h.machine.onInteract('S12', 'window-three');
    expect(h.current()?.id).toBe('s12-auntie');
    h.readThrough();
    h.machine.onChooseOption('s12-auntie-choice', 's12-auntie-wait');
    h.machine.onDialogueEnd('s12-auntie-story');
    h.machine.onDialogueEnd('s12-auntie-caption');
    h.machine.onDialogueEnd('s12-vibration');
    expect(h.machine.getState()).toMatchObject({ talkedAunt: true });
    expect(h.machine.getState().draftReactions).toContain('有位阿姨多给了我一个蛋。');
    expect(h.machine.getSceneId()).toBe('S13');
  });

  it('S13 A/C 评论各触发一次独立心声，关手机后进入三选一', () => {
    const h = harness('S13');
    h.machine.onPhoneAction('s13-phone', 'reply', 's13-comment-a');
    expect(h.captions).toHaveLength(0);
    h.machine.onDialogueEnd('s13-message');
    const step = h.current();
    if (step?.kind !== 'phone') throw new Error('未显示帖子');
    const post = step.panel.sections.find((section) => section.kind === 'post');
    expect(post).toMatchObject({ views: 4820, commentCount: 136, assetIds: ['cg_s11_post_crop', 'cg_s13_walk_together'] });
    expect(post?.comments.map((comment) => comment.likes)).toEqual([142, 89, 318, 246]);
    h.machine.onPhoneAction('wrong-phone', 'reply', 's13-comment-a');
    h.machine.onPhoneAction('s13-phone', 'reply', 's13-comment-b');
    for (const id of ['s13-comment-a', 's13-comment-c']) {
      h.machine.onPhoneAction('s13-phone', 'reply', id);
      h.machine.onPhoneAction('s13-phone', 'reply', id);
    }
    expect(h.captions.map((event) => event.text)).toEqual([
      '……他们只看见了她走路的那一张。', '……原来，站出来是要被一起算进去的。',
    ]);
    expect(h.captions.every((event) => event.kind === 'inner')).toBe(true);
    h.machine.onPhoneAction('s13-phone', 'close');
    expect(h.captions[h.captions.length - 1].text).toBe('……那是你。');
    h.readThrough();
    expect(h.current()?.id).toBe('s14-choice');
  });

  it('解释→倾听→同意留证→气泡→C1，每项效果仅一次且留证晚于同意', () => {
    const h = harness('S14', { picked: true });
    h.choose('s14-choice', 's14-explain');
    expect(h.machine.getState()).toMatchObject({ harm: 23, trust: 2, addedHer: false });
    h.choose('s14-listen', 's14-listen-yes');
    expect(h.machine.getState()).toMatchObject({ trust: 4, listened: true, evidence: false });
    h.machine.onChooseOption('s14-evidence', 's14-evidence-ask');
    expect(h.current()?.id).toBe('s14-evidence-consent');
    expect(h.machine.getState().evidence).toBe(false);
    h.readThrough();
    expect(h.machine.getState()).toMatchObject({ evidence: true, trust: 5, harm: 23 });
    h.machine.onChooseOption('s14-evidence', 's14-evidence-ask');
    finishBubble(h);
    expect(h.machine.getState()).toMatchObject({ evidence: true, trust: 5, harm: 23, ending: null });
    expect(h.dialogues.some((event) => event.stepId === 's14-distant-chat')).toBe(false);
    expect(h.intertitles).toHaveLength(0);
  });

  it('解释可不倾听且不留证，仍然进入气泡', () => {
    const h = harness('S14', { picked: true });
    h.choose('s14-choice', 's14-explain');
    h.choose('s14-listen', 's14-listen-later');
    h.choose('s14-evidence', 's14-evidence-skip');
    finishBubble(h);
    expect(h.machine.getState()).toMatchObject({ trust: 2, listened: false, evidence: false });
    expect(h.dialogues.some((event) => event.stepId === 's14-evidence-consent')).toBe(false);
  });

  it.each([
    { picked: false, trust: 1 }, { picked: true, trust: 0 }, { picked: true, trust: -1 },
  ])('等等加她：不满足条件 %j 时不能留证，也没有气泡', (seed) => {
    const h = harness('S14', seed);
    h.choose('s14-choice', 's14-wait');
    h.choose('s14-add-her', 's14-add-yes');
    expect(h.machine.getSceneId()).toBe('C1');
    expect(h.machine.getState()).toMatchObject({ addedHer: true, evidence: false, listened: false, trust: seed.trust, harm: 20 });
    expect(h.choices.some((event) => event.stepId === 's14-evidence')).toBe(false);
  });

  it('解释未捡药袋不能因倾听提高信任而凭空留证', () => {
    const h = harness();
    h.choose('s14-choice', 's14-explain');
    h.choose('s14-listen', 's14-listen-yes');
    expect(h.choices.some((event) => event.stepId === 's14-evidence')).toBe(false);
    finishBubble(h);
    expect(h.machine.getState()).toMatchObject({ evidence: false, trust: 4 });
  });

  it.each([true, false])('等等加她后可选择是否留证：%s', (save) => {
    const h = harness('S14', { picked: true, trust: 1 });
    h.choose('s14-choice', 's14-wait');
    h.choose('s14-add-her', 's14-add-yes');
    h.choose('s14-evidence', save ? 's14-evidence-ask' : 's14-evidence-skip');
    expect(h.machine.getSceneId()).toBe('C1');
    expect(h.machine.getState()).toMatchObject({ addedHer: true, evidence: save, trust: save ? 2 : 1, harm: 20, listened: false });
    expect(h.dialogues.some((event) => event.lines.some((line) => line.text === '……你不用特意告诉我。'))).toBe(true);
    expect(h.dialogues.some((event) => event.stepId === 's14-linxia-adds')).toBe(false);
  });

  it('等等不加她直接 C1，即便具备小票条件也不进入聊天或留证', () => {
    const h = harness('S14', { picked: true, trust: 3 });
    h.choose('s14-choice', 's14-wait');
    h.choose('s14-add-her', 's14-add-no');
    expect(h.machine.getSceneId()).toBe('C1');
    expect(h.machine.getState()).toMatchObject({ addedHer: false, evidence: false, trust: 3, harm: 20 });
    expect(h.dialogues).toHaveLength(0);
  });

  it('玩笑只播放五行黑幕并进入 E1，不混入聊天、留证或气泡', () => {
    const h = harness('S14', { picked: true, trust: 3 });
    h.choose('s14-choice', 's14-joke');
    expect(h.machine.getSceneId()).toBe('E1');
    expect(h.machine.getState()).toMatchObject({ postChoice: 'joke', ending: 'joined', trust: 3, harm: 20, evidence: false });
    expect(h.dialogues).toHaveLength(0);
    expect(h.choices).toHaveLength(1);
    expect(h.intertitles).toHaveLength(1);
    expect(h.intertitles[0].lines).toEqual([
      '你只是想把话题从自己身上挪开。', '那条玩笑得了很多赞。', '第二天，帖子的浏览数多了一个零。',
      '林夏的座位，空了几天。', '没有人记得，是谁先笑的。',
    ]);
  });

  it('追加 F：S11 指认室友、S14 点开加好友与先征求同意留证会记入 draftReactions', () => {
    const h1 = harness('S11');
    h1.readThrough();
    h1.choose('s11-reply', 's11-classmate');
    expect(h1.machine.getState().draftReactions).toContain('我不知道是谁，但我猜得到。');

    const h2 = harness('S14', { picked: true, trust: 1 });
    h2.choose('s14-choice', 's14-wait');
    h2.choose('s14-add-her', 's14-add-yes');
    h2.choose('s14-evidence', 's14-evidence-ask');
    expect(h2.machine.getState().draftReactions).toEqual([
      '那天，我看到有人点开了我的头像。',
      '你先问了我。谢谢。',
    ]);
  });
});
