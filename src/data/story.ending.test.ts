import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/eventBus';
import { SceneMachine } from '../core/sceneMachine';
import { ASSET_MANIFEST } from './assetManifest';
import { chapter1 } from './story.ch1';
import { chapter2Scenes } from './story.ch2';
import { chapter3Scenes } from './story.ch3';
import { chapter4Scenes } from './story.ch4';
import { endingScene } from './story.ending';
import type { ChapterStory, SceneId, StateSet } from './storySchema';

function harness(seed: StateSet = {}, entry: SceneId = 'E1') {
  const chapter: ChapterStory = {
    ...chapter1, startScene: 'S10', scenes: {
      ...chapter2Scenes, ...chapter3Scenes, ...chapter4Scenes, E1: endingScene,
      S10: { id: 'S10', title: '测试播种入口', sceneKey: 'stage2d', onEnter: { set: seed }, steps: [], transitions: [{ to: entry }] },
    },
  };
  const bus = new EventBus();
  const order: string[] = [];
  const dialogues: GameEvents['ui:showDialogue'][] = [];
  const intertitles: GameEvents['ui:showIntertitle'][] = [];
  const arts: GameEvents['ui:showArt'][] = [];
  const choices: GameEvents['ui:showChoices'][] = [];
  const phones: GameEvents['ui:showPhone'][] = [];
  const endings: GameEvents['game:chapterEnd'][] = [];
  const transitions: SceneId[] = [];
  const completed: string[] = [];
  bus.on('ui:showDialogue', (event) => { dialogues.push(event); order.push(event.stepId); });
  bus.on('ui:showIntertitle', (event) => { intertitles.push(event); order.push(event.stepId); });
  bus.on('ui:showArt', (event) => { arts.push(event); order.push(event.stepId); });
  bus.on('ui:showChoices', (event) => { choices.push(event); order.push(event.stepId); });
  bus.on('ui:showPhone', (event) => { phones.push(event); order.push(event.stepId); });
  bus.on('ui:showCaption', (event) => order.push(event.stepId));
  bus.on('scene:transition', (event) => transitions.push(event.toSceneId));
  bus.on('game:chapterEnd', (event) => { endings.push(event); order.push('end'); });
  const machine = new SceneMachine({
    chapter, bus, now: () => 1000,
    onPersist: (snapshot, done) => { if (done) completed.push(snapshot.sceneId); },
  });
  const current = () => chapter.scenes[machine.getSceneId()]?.steps[machine.getSnapshot().stepIndex];
  const readThrough = () => {
    for (let i = 0; i < 80; i++) {
      if (machine.isEnded()) return;
      const step = current();
      if (!step) throw new Error('剧情停在不存在的步骤');
      if (step.kind === 'phone') machine.onPhoneAction(step.panel.id, 'close');
      else if (['dialogue', 'caption', 'intertitle', 'cutscene', 'art'].includes(step.kind)) machine.onDialogueEnd(step.id);
      else return;
    }
    throw new Error('结局剧情疑似循环');
  };
  const choose = (stepId: string, optionId: string) => {
    expect(current()?.id).toBe(stepId);
    machine.onChooseOption(stepId, optionId);
    readThrough();
  };
  const finish = () => {
    readThrough();
    if (current()?.id === 'e1-best-response') choose('e1-best-response', 'e1-best-thanks');
    expect(machine.isEnded()).toBe(true);
  };
  const assertEndedOnce = () => {
    expect(current()).toMatchObject({ kind: 'end', id: 'e1-summary' });
    expect(endings).toHaveLength(1);
    expect(endings[0]).toMatchObject({ sceneId: 'E1', state: { ending: machine.getState().ending } });
    expect(completed).toEqual(['E1']);
    const snapshot = machine.getSnapshot();
    const seen = [...order];
    for (const step of endingScene.steps) {
      machine.onDialogueEnd(step.id);
      if (step.kind === 'choice') {
        for (const option of step.options) machine.onChooseOption(step.id, option.id);
      }
      if (step.kind === 'phone') machine.onPhoneAction(step.panel.id, 'close');
    }
    machine.onEnterZone('E1', 'corridor-linxia');
    machine.onInteract('E1', 'anything');
    expect(machine.getSnapshot()).toEqual(snapshot);
    expect(order).toEqual(seen);
    expect(endings).toHaveLength(1);
    expect(completed).toEqual(['E1']);
  };
  machine.startNew('S10', 'bystander');
  return { machine, current, readThrough, choose, finish, assertEndedOnce, order, dialogues, intertitles, arts, choices, phones, endings, transitions };
}

const bestSeed: StateSet = { joined: true, apologized: true, postDeleted: true };
const priorityCases = Array.from({ length: 32 }, (_, mask) => {
  const joke = Boolean(mask & 16);
  const bystander = Boolean(mask & 8);
  const force = Boolean(mask & 4);
  const best = Boolean(mask & 2);
  const middle = Boolean(mask & 1);
  const seed: StateSet = {
    postChoice: joke ? 'joke' : 'wait', seat: bystander ? 'far' : 'beside', tellTeacher: bystander ? 'think' : 'told',
    visitedStairwell: !bystander, yuanKeys: force ? ['fact', 'force', 'company'] : ['fact', 'empathy', 'company'],
    joined: best, apologized: best, postDeleted: middle, trust: 5,
  };
  const expected = joke ? 'joined' : bystander ? 'bystander' : force ? 'worst' : best ? 'best' : middle ? 'middle' : null;
  return { mask, seed, expected };
});

describe('E1 剧情数据与真实 SceneMachine', () => {
  it('仅有一个兼容旧入口的 end，步骤唯一，所有跳转向前且 CG 已登记', () => {
    const ids = endingScene.steps.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(endingScene.steps.filter((step) => step.kind === 'end')).toEqual([{ kind: 'end', id: 'e1-summary' }]);
    expect(endingScene.transitions).toEqual([]);
    for (const [index, step] of endingScene.steps.entries()) {
      if (step.kind === 'goto') expect(ids.indexOf(step.target)).toBeGreaterThan(index);
      if (step.kind === 'art') expect(ASSET_MANIFEST).toHaveProperty(step.assetId);
    }
  });

  it.each(priorityCases)('五档优先级组合 $mask → $expected，互斥演出且只结束一次', ({ seed, expected }) => {
    const h = harness(seed);
    expect(h.machine.getState().ending).toBe(expected);
    h.finish();
    const branches = h.order.filter((id) => [
      'e1-joined-close', 'e1-bystander-close', 'e1-worst-close', 'e1-best-month', 'e1-middle-month',
    ].includes(id));
    expect(branches).toEqual(expected === null ? [] : [
      expected === 'best' || expected === 'middle' ? `e1-${expected}-month` : `e1-${expected}-close`,
    ]);
    // 结局演出不回写信任、伤害或前章选择。
    expect(h.machine.getState()).toMatchObject({ ...seed, ending: expected, harm: 20 });
    h.assertEndedOnce();
  });

  it.each(['joined', 'bystander', 'worst', 'middle'] as const)('保留早期已写入的 %s 结局，不依赖默认变量重推', (ending) => {
    const h = harness({ ending });
    expect(h.machine.getState().ending).toBe(ending);
    h.finish();
    expect(h.order[0]).toBe(ending === 'middle' ? 'e1-middle-month' : `e1-${ending}-close`);
    h.assertEndedOnce();
  });

  it.each([
    { seed: { ending: 'middle', ...bestSeed }, expected: 'best' },
    { seed: { ending: 'best', ...bestSeed, yuanKeys: ['force'] }, expected: 'worst' },
    { seed: { ending: 'worst', seat: 'far', tellTeacher: 'think' }, expected: 'bystander' },
    { seed: { ending: 'bystander', postChoice: 'joke' }, expected: 'joined' },
  ] satisfies { seed: StateSet; expected: string }[])('高优先级原始选择覆盖低优先级旧标记：$expected', ({ seed, expected }) => {
    const h = harness(seed);
    h.finish();
    expect(h.machine.getState().ending).toBe(expected);
    h.assertEndedOnce();
  });

  it.each([
    {}, { seat: 'far' }, { tellTeacher: 'think' }, { visitedStairwell: false },
    { seat: 'far', tellTeacher: 'told' }, { seat: 'front', tellTeacher: 'think' },
    { seat: 'far', tellTeacher: 'think', visitedStairwell: true },
    { joined: true, apologized: false }, { joined: false, apologized: true },
  ] satisfies StateSet[])('默认或不完整流程不会因 false/null 被判为旁观或最好：%j', (seed) => {
    const h = harness(seed);
    expect(h.machine.getState().ending).toBeNull();
    expect(h.order).toEqual(['end']);
    h.assertEndedOnce();
  });

  it.each([['force'], ['fact', 'force'], ['fact', 'empathy', 'force']])('任意位置 force %j 优先于入队道歉', (...yuanKeys) => {
    const h = harness({ ...bestSeed, yuanKeys });
    h.finish();
    expect(h.machine.getState().ending).toBe('worst');
    expect(h.order).toEqual(['e1-worst-close', 'end']);
    h.assertEndedOnce();
  });

  it.each(['e1-best-thanks', 'e1-best-praise', 'e1-best-keep'])('trust=5：先递画/CG，再三选一 %s，最后首次笑、父亲、消息、定格', (option) => {
    const h = harness({ ...bestSeed, trust: 5 });
    expect(h.current()?.id).toBe('e1-best-month');
    h.machine.onDialogueEnd('e1-best-month');
    expect(h.current()?.id).toBe('e1-best-classroom');
    h.machine.onDialogueEnd('e1-best-classroom');
    expect(h.current()?.id).toBe('e1-best-gift');
    expect(h.dialogues[1].lines.map((line) => line.text)).toEqual([
      '她合上本子，又打开，撕下一页，折好放在你桌上。', '……给你。', '我自己画的。',
    ]);
    h.machine.onDialogueEnd('e1-best-gift');
    expect(h.current()?.id).toBe('e1-best-drawing');
    expect(h.arts).toEqual([{ stepId: 'e1-best-drawing', assetId: 'cg_ending_best_drawing' }]);
    expect(h.choices).toHaveLength(0);
    expect(h.endings).toHaveLength(0);
    h.machine.onDialogueEnd('wrong-art');
    h.machine.onChooseOption('e1-best-response', option);
    expect(h.current()?.id).toBe('e1-best-drawing');
    h.machine.onDialogueEnd('e1-best-drawing');
    expect(h.choices[0].options.map((item) => item.text)).toEqual([
      '谢谢，我会好好收着。', '……画得很好。', '（什么都没说，把画夹进笔记本里）',
    ]);
    h.machine.onDialogueEnd('e1-best-drawing');
    h.machine.onChooseOption('e1-best-response', 'invalid');
    expect(h.current()?.id).toBe('e1-best-response');
    expect(h.dialogues.some((event) => event.stepId === 'e1-best-smile')).toBe(false);
    h.machine.onChooseOption('e1-best-response', option);
    expect(h.current()?.id).toBe('e1-best-smile');
    h.machine.onChooseOption('e1-best-response', option);
    expect(h.current()?.id).toBe('e1-best-smile');
    h.machine.onDialogueEnd('e1-best-smile');
    expect(h.current()?.id).toBe('e1-best-father');
    h.machine.onDialogueEnd('e1-best-father');
    expect(h.current()?.id).toBe('e1-best-message');
    expect(h.phones[0].panel.sections[0]).toMatchObject({
      kind: 'chat', title: '林夏', messages: [{ from: '林夏', text: '今天我自己走进教室了。' }],
    });
    h.machine.onDialogueEnd('e1-best-message');
    h.machine.onPhoneAction('wrong-phone', 'close');
    expect(h.current()?.id).toBe('e1-best-message');
    h.machine.onPhoneAction('e1-best-phone', 'close');
    expect(h.current()?.id).toBe('e1-best-freeze');
    expect(h.endings).toHaveLength(0);
    h.machine.onPhoneAction('e1-best-phone', 'close');
    expect(h.current()?.id).toBe('e1-best-freeze');
    h.finish();
    expect(h.order).toEqual([
      'e1-best-month', 'e1-best-classroom', 'e1-best-gift', 'e1-best-drawing', 'e1-best-response',
      'e1-best-smile', 'e1-best-father', 'e1-best-message', 'e1-best-freeze', 'end',
    ]);
    expect(h.dialogues.find((event) => event.stepId === 'e1-best-smile')?.lines[0].text).toContain('第一次');
    expect(h.dialogues.find((event) => event.stepId === 'e1-best-father')?.lines[0].text).toContain('她自己走向他');
    expect(h.intertitles[1]).toMatchObject({
      lines: ['已被转发，无法收回。', '外界依然各说各话。但这一幅是完整的。'], skippable: false, lineDurationMs: 2800,
    });
    expect(h.machine.getState()).toMatchObject({ ...bestSeed, trust: 5, ending: 'best', harm: 20 });
    h.assertEndedOnce();
  });

  it.each([-1, 0, 4])('trust=%s：仅点头离开，不递画、不笑、不发消息，也有最好结局定格', (trust) => {
    const h = harness({ ...bestSeed, trust });
    h.finish();
    expect(h.order).toEqual(['e1-best-month', 'e1-best-classroom', 'e1-best-nod', 'e1-best-freeze', 'end']);
    expect(h.dialogues[1].lines[0].text).toBe('她对你点点头，合上速写本，走出教室。');
    expect(h.arts).toHaveLength(0);
    expect(h.choices).toHaveLength(0);
    expect(h.phones).toHaveLength(0);
    expect(h.intertitles[1].lines).toEqual(['已被转发，无法收回。', '外界依然各说各话。但这一幅是完整的。']);
    expect(h.machine.getState()).toMatchObject({ ending: 'best', trust });
    h.assertEndedOnce();
  });

  it('中间结局七行字幕 → 未完成速写 CG → 两行定格 → 一次结束', () => {
    const h = harness({ postDeleted: true, joined: false, trust: 10 });
    expect(h.intertitles[0].lines).toEqual([
      '一个月后。', '帖子早就删了。', '阿远再也没有发过任何东西。', '林夏的脚好了，走路很稳。',
      '她仍坐在最后一排，话比开学那天更少。', '走廊里遇见，你点点头，她也点点头。', '没有人再提起那天台阶上的事。',
    ]);
    expect(h.arts).toHaveLength(0);
    h.machine.onDialogueEnd('e1-middle-month');
    expect(h.current()?.id).toBe('e1-middle-sketch');
    expect(h.arts).toEqual([{ stepId: 'e1-middle-sketch', assetId: 'cg_ending_middle_sketch' }]);
    h.machine.onDialogueEnd('wrong-art');
    expect(h.current()?.id).toBe('e1-middle-sketch');
    h.machine.onDialogueEnd('e1-middle-sketch');
    expect(h.current()?.id).toBe('e1-middle-freeze');
    expect(h.intertitles[1]).toMatchObject({
      lines: ['已被转发，无法收回。', '没有人，把那一天说完整。'], lineDurationMs: 2800, skippable: false,
    });
    expect(h.endings).toHaveLength(0);
    h.finish();
    expect(h.order).toEqual(['e1-middle-month', 'e1-middle-sketch', 'e1-middle-freeze', 'end']);
    expect(h.choices).toHaveLength(0);
    expect(h.phones).toHaveLength(0);
    h.assertEndedOnce();
  });

  it('真实 S14 玩笑入口保留参与者结局并播放概括收尾', () => {
    const h = harness({}, 'S14');
    h.choose('s14-choice', 's14-joke');
    expect(h.transitions).toEqual(['S10', 'S14', 'E1']);
    expect(h.machine.getState()).toMatchObject({ postChoice: 'joke', ending: 'joined', joined: false });
    expect(h.order.slice(-2)).toEqual(['e1-joined-close', 'end']);
    h.assertEndedOnce();
  });

  it('真实 C3 再想想且略过楼梯间，保留旁观结局', () => {
    const h = harness({ seat: 'far' }, 'C3');
    h.readThrough();
    h.choose('c3-response', 'c3-think');
    h.choose('c3-stairs', 'c3-skip-stairs');
    expect(h.transitions).toEqual(['S10', 'C3', 'E1']);
    expect(h.machine.getState()).toMatchObject({ ending: 'bystander', seat: 'far', tellTeacher: 'think', visitedStairwell: false });
    expect(h.order.slice(-2)).toEqual(['e1-bystander-close', 'end']);
    h.assertEndedOnce();
  });

  it.each([1, 2, 3])('真实 D2 第 %s 轮逼迫直接进入最差收尾，不再进入 D3', (round) => {
    const h = harness({}, 'D2');
    h.readThrough();
    for (let i = 1; i < round; i++) h.choose(`d2-round-${i}`, `d2-r${i}-fact`);
    h.choose(`d2-round-${round}`, `d2-r${round}-force`);
    expect(h.transitions).toEqual(['S10', 'D2', 'E1']);
    expect(h.machine.getState()).toMatchObject({ ending: 'worst', route: 'breakdown' });
    expect(h.order.slice(-2)).toEqual(['e1-worst-close', 'end']);
    h.assertEndedOnce();
  });

  it.each(['team', 'deleteOnly'] as const)('真实 D6 %s 接 E1，保留补救结果与一次结束', (route) => {
    const h = harness({ route, joined: route === 'team', postDeleted: true, trust: 5 }, 'D6');
    expect(h.current()?.id).toBe('d6-approach');
    h.machine.onEnterZone('D6', 'corridor-linxia');
    h.readThrough();
    h.choose(route === 'team' ? 'd6-team-response' : 'd6-solo-response', route === 'team' ? 'd6-team-silent' : 'd6-solo-okay');
    h.finish();
    expect(h.transitions).toEqual(['S10', 'D6', 'E1']);
    expect(h.machine.getState()).toMatchObject({
      ending: route === 'team' ? 'best' : 'middle', apologized: route === 'team', soloRepair: route === 'deleteOnly',
    });
    h.assertEndedOnce();
  });
});
