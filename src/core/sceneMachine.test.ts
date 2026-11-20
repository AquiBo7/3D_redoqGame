import { describe, expect, it } from 'vitest';
import { chapter1 } from '../data/story';
import type { ChapterStory } from '../data/storySchema';
import { EventBus } from './eventBus';
import type { GameEvents } from './eventBus';
import { createEmptyChapterSave } from './saveStore';
import { SceneMachine } from './sceneMachine';
import type { MachineSnapshot } from './sceneMachine';
import { createInitialStoryState } from './state';

describe('当前步骤交互权限', () => {
  it('走廊找人只在辨认步骤开放，三次错问后移除无关同学', () => {
    const bus = new EventBus();
    const options: GameEvents['scene:interactionOptions'][] = [];
    bus.on('scene:interactionOptions', (value) => options.push(value));
    const machine = new SceneMachine({ chapter: chapter1, bus });
    const save = createEmptyChapterSave({ sceneId: 'C5' });
    save.state.wrongAsks = 3;
    machine.continueFrom(save);
    machine.onInteract('C5', 'student-4');
    expect(machine.getState().foundAyuanWay).toBeNull();
    expect(options[options.length - 1].ids).toEqual([]);
    machine.onPhoneAction('c5-memo-unknown', 'close');
    machine.onChooseOption('c5-find-path', 'recognize');
    expect(options[options.length - 1].ids).toEqual(['student-4']);
    machine.onInteract('C5', 'student-1');
    expect(machine.getState().wrongAsks).toBe(3);
    machine.onInteract('C5', 'student-4');
    expect(options[options.length - 1].ids).toEqual([]);
    machine.onDialogueEnd('c5-recognized');
    expect(machine.getState().foundAyuanWay).toBe('recognize');
  });
});

interface Harness {
  machine: SceneMachine;
  transitions: Array<GameEvents['scene:transition']>;
  dialogues: Array<GameEvents['ui:showDialogue']>;
  captions: Array<GameEvents['ui:showCaption']>;
  phones: Array<GameEvents['ui:showPhone']>;
  hiddenPhones: Array<GameEvents['ui:hidePhone']>;
  choices: Array<GameEvents['ui:showChoices']>;
  cutscenes: Array<GameEvents['scene:cutscene']>;
  intertitles: Array<GameEvents['ui:showIntertitle']>;
  stateChanges: Array<GameEvents['state:changed']>;
  chapterEnds: Array<GameEvents['game:chapterEnd']>;
  persists: Array<{ snapshot: MachineSnapshot; completed: boolean }>;
}

function createHarness(chapter: ChapterStory = chapter1): Harness {
  const bus = new EventBus();
  const transitions: Harness['transitions'] = [];
  const dialogues: Harness['dialogues'] = [];
  const captions: Harness['captions'] = [];
  const phones: Harness['phones'] = [];
  const hiddenPhones: Harness['hiddenPhones'] = [];
  const choices: Harness['choices'] = [];
  const cutscenes: Harness['cutscenes'] = [];
  const intertitles: Harness['intertitles'] = [];
  const stateChanges: Harness['stateChanges'] = [];
  const chapterEnds: Harness['chapterEnds'] = [];
  const persists: Harness['persists'] = [];

  bus.on('scene:transition', (payload) => transitions.push(payload));
  bus.on('ui:showDialogue', (payload) => dialogues.push(payload));
  bus.on('ui:showCaption', (payload) => captions.push(payload));
  bus.on('ui:showPhone', (payload) => phones.push(payload));
  bus.on('ui:hidePhone', (payload) => hiddenPhones.push(payload));
  bus.on('ui:showChoices', (payload) => choices.push(payload));
  bus.on('scene:cutscene', (payload) => cutscenes.push(payload));
  bus.on('ui:showIntertitle', (payload) => intertitles.push(payload));
  bus.on('state:changed', (payload) => stateChanges.push(payload));
  bus.on('game:chapterEnd', (payload) => chapterEnds.push(payload));

  const machine = new SceneMachine({
    chapter,
    bus,
    now: () => 1000,
    onPersist: (snapshot, completed) => persists.push({ snapshot, completed }),
  });

  return {
    machine,
    transitions,
    dialogues,
    captions,
    phones,
    hiddenPhones,
    choices,
    cutscenes,
    intertitles,
    stateChanges,
    chapterEnds,
    persists,
  };
}

/** 跳过 S1 的开场过场与字幕，停在等待点击手机的步骤 */
function beginS1(h: Harness): void {
  h.machine.startNew('S1', 'bystander');
  h.machine.onDialogueEnd('s1-wake');
  h.machine.onDialogueEnd('s1-caption');
}

/** 从 S1 进入 S2 手机面板 */
function enterS2(h: Harness): void {
  beginS1(h);
  h.machine.onInteract('S1', 'phone');
}

describe('SceneMachine 主线推进', () => {
  it('完整走通 S1→S9 看手机→S10 字幕后进入真实 S11，状态与转场正确且未结束', () => {
    const h = createHarness();

    beginS1(h);
    h.machine.onGazeHotspot('S1', 'window');
    h.machine.onGazeHotspot('S1', 'culture-shirt');
    h.machine.onGazeHotspot('S1', 'suitcase');
    h.machine.onInteract('S1', 'phone');

    // S2：回复妈妈但先不关手机，再关闭
    h.machine.onPhoneAction('s2-phone', 'reply', 'mom-reply-rise');
    expect(h.machine.getState().momReply).toBe('起了起了。');
    expect(h.machine.getSceneId()).toBe('S2');
    h.machine.onPhoneAction('s2-phone', 'close');
    h.machine.onDialogueEnd('s2-caption');

    // S3 → S4
    h.machine.onDialogueEnd('s3-run');
    h.machine.onPhoneAction('street-vibration-1', 'ignore');
    h.machine.onPhoneAction('street-vibration-2', 'open');
    h.machine.onEnterZone('S4', 'stairs');

    // S5 观察楼梯一幕
    h.machine.onDialogueEnd('s5-stairs-dialogue');
    h.machine.onGazeHotspot('S5', 'father-bags');
    h.machine.onGazeHotspot('S5', 'handoff-moment');
    h.machine.onGazeHotspot('S5', 'typer');
    h.machine.onEnterZone('S5', 'school-gate');

    // S6 → S7
    h.machine.onDialogueEnd('s6-cg');
    h.machine.onDialogueEnd('s7-volunteer');
    h.machine.onGazeHotspot('S7', 'reason-form');
    h.machine.onChooseOption('s7-pen', 's7-pen-hand');
    h.machine.onChooseOption('s7-reason', 's7-reason-late');
    h.machine.onChooseOption('s7-bag', 's7-bag-pick');
    h.machine.onChooseOption('s7-return-bag', 's7-return-give');
    h.machine.onDialogueEnd('s7-thanks');

    // S8 选择同行，并回头观察爸爸
    h.machine.onDialogueEnd('s8-volunteer');
    h.machine.onGazeHotspot('S8', 'look-back-father');
    h.machine.onGazeHotspot('S8', 'phone-behind');
    h.machine.onChooseOption('s8-walk', 's8-walk-together');
    h.machine.onEnterZone('S8', 'building-entrance');

    // S9 看手机并关闭
    h.machine.onChooseOption('s9-choice', 's9-look');
    expect(h.machine.getSceneId()).toBe('S9');
    h.machine.onPhoneAction('s9-phone', 'reply', 's9-notice-photo');
    h.machine.onPhoneAction('s9-phone', 'reply', 's9-like-photo');
    h.machine.onPhoneAction('s9-phone', 'close');

    // 第一章收尾后等待 S10 字幕回执，再进入第二章真实场景。
    expect(h.machine.getSceneId()).toBe('S10');
    expect(h.machine.isEnded()).toBe(false);
    expect(h.chapterEnds).toHaveLength(0);
    expect(h.intertitles).toHaveLength(1);
    expect(h.intertitles[0]).toMatchObject({ stepId: 's10-days', lineDurationMs: 2000, skippable: true });
    expect(h.intertitles[0].lines).toHaveLength(7);
    expect(h.persists[h.persists.length - 1]).toMatchObject({
      snapshot: { sceneId: 'S10', ended: false }, completed: false,
    });
    h.machine.onDialogueEnd('s10-days');

    const state = h.machine.getState();
    expect(h.machine.getSceneId()).toBe('S11');
    expect(h.machine.isEnded()).toBe(false);
    expect(h.dialogues[h.dialogues.length - 1].stepId).toBe('s11-roommate');
    expect(state).toMatchObject({
      momReply: '起了起了。',
      phoneIgnored: 1,
      seenBag: true,
      seenHandoff: true,
      noticedTyper: true,
      handedPen: true,
      reasonText: '起晚了',
      seenCrossedOut: true,
      picked: true,
      seenFatherWatching: true,
      noticedPhoneBehind: true,
      noticedPhoto: true,
      likedPhoto: true,
      trust: 2,
      harm: 20,
    });

    expect(h.transitions.map((item) => item.toSceneId)).toEqual([
      'S1',
      'S2',
      'S3',
      'S4',
      'S5',
      'S6',
      'S7',
      'S8',
      'S9',
      'S10',
      'S11',
    ]);
    expect(h.transitions[0].fromSceneId).toBeNull();

    // 两处手机面板：S2 与 S9，均有关闭事件
    expect(h.phones.map((item) => item.stepId)).toEqual(['s2-phone', 's9-phone']);
    expect(h.hiddenPhones.map((item) => item.phoneId)).toEqual(['s2-phone', 's9-phone']);

    // 只有 S1 / S2 两处心声字幕（S1 另有 3 条观察字幕不计入）
    expect(h.captions.filter((item) => item.kind === 'inner').map((item) => item.stepId)).toEqual([
      's1-caption',
      's2-caption',
    ]);

    expect(h.chapterEnds).toHaveLength(0);
    expect(state.log.some((entry) => entry.summary === '第一章 到校段结束。')).toBe(true);
    expect(h.persists[h.persists.length - 1]).toMatchObject({
      snapshot: { sceneId: 'S11', ended: false }, completed: false,
    });
    expect(h.persists.filter((item) => item.completed)).toHaveLength(0);
  });

  it('S7 不捡药袋 + S9 不看手机：trust 为 0，phoneIgnored 累计 4', () => {
    const h = createHarness();

    enterS2(h);
    h.machine.onPhoneAction('s2-phone', 'close');
    h.machine.onDialogueEnd('s2-caption');
    h.machine.onDialogueEnd('s3-run');

    h.machine.onPhoneAction('street-vibration-1', 'ignore');
    h.machine.onPhoneAction('street-vibration-2', 'ignore');
    h.machine.onEnterZone('S4', 'stairs');

    h.machine.onDialogueEnd('s5-stairs-dialogue');
    h.machine.onEnterZone('S5', 'school-gate');
    h.machine.onDialogueEnd('s6-cg');
    h.machine.onDialogueEnd('s7-volunteer');

    h.machine.onChooseOption('s7-pen', 's7-pen-phone');
    h.machine.onChooseOption('s7-reason', 's7-reason-lost');
    h.machine.onChooseOption('s7-bag', 's7-bag-leave');
    expect(h.machine.getSceneId()).toBe('S7');
    h.machine.onDialogueEnd('s7-linxia-picks');

    h.machine.onDialogueEnd('s8-volunteer');
    h.machine.onChooseOption('s8-walk', 's8-walk-silent');
    h.machine.onEnterZone('S8', 'building-entrance');

    h.machine.onChooseOption('s9-choice', 's9-ignore');
    expect(h.machine.getSceneId()).toBe('S10');
    expect(h.machine.isEnded()).toBe(false);
    expect(h.chapterEnds).toHaveLength(0);
    expect(h.phones.map((item) => item.stepId)).toEqual(['s2-phone']);
    expect(h.intertitles).toHaveLength(1);
    expect(h.intertitles[0].stepId).toBe('s10-days');
    h.machine.onDialogueEnd('s10-days');
    expect(h.machine.getSceneId()).toBe('S11');
    expect(h.machine.isEnded()).toBe(false);
    expect(h.dialogues[h.dialogues.length - 1].stepId).toBe('s11-roommate');

    const state = h.machine.getState();
    expect(state).toMatchObject({
      phoneIgnored: 4,
      trust: 0,
      picked: false,
      handedPen: false,
      reasonText: '迷路了',
      harm: 20,
    });
    expect(state.log.some((entry) => entry.summary === '没有捡药袋。')).toBe(true);
    expect(state.log.some((entry) => entry.summary === '没有看手机上的未读消息。')).toBe(true);
    expect(h.chapterEnds).toHaveLength(0);
  });

  it('S4 触发点只生效一次，重复事件不重复累加', () => {
    const h = createHarness();
    h.machine.startNew('S4', 'bystander');

    h.machine.onPhoneAction('street-vibration-1', 'ignore');
    h.machine.onPhoneAction('street-vibration-1', 'ignore');
    h.machine.onPhoneAction('street-vibration-2', 'open');
    h.machine.onPhoneAction('street-vibration-2', 'open');

    const state = h.machine.getState();
    expect(state.phoneIgnored).toBe(1);
    expect(state.log.filter((entry) => entry.type === 'ignore')).toHaveLength(1);
    expect(state.log.filter((entry) => entry.type === 'observe')).toHaveLength(1);
  });

  it('S7 “划掉原因”观察点写入 seenCrossedOut 并给出客观字幕', () => {
    const h = createHarness();
    h.machine.startNew('S7', 'bystander');

    h.machine.onGazeHotspot('S7', 'reason-form');
    const state = h.machine.getState();
    expect(state.seenCrossedOut).toBe(true);
    expect(state.log[state.log.length - 1]?.type).toBe('observe');

    const reveal = h.captions.find((item) => item.stepId === 's7-see-crossed-out');
    expect(reveal?.kind).toBe('observation');
    expect(reveal?.text).toContain('划掉');
  });

  it('切换场景时会自动持久化，结尾持久化 completed=true', () => {
    const h = createHarness();
    enterS2(h);

    expect(h.persists.map((item) => item.snapshot.sceneId)).toEqual(['S1', 'S2']);
    expect(h.persists.every((item) => item.completed === false)).toBe(true);
  });

  it('cutscene 步骤只响应 ui:dialogueEnd，其它事件与错误 stepId 都不能推进', () => {
    const h = createHarness();
    h.machine.startNew('S1', 'bystander');

    expect(h.cutscenes).toHaveLength(1);
    expect(h.cutscenes[0]).toMatchObject({
      stepId: 's1-wake',
      key: 's1-wake',
      durationMs: 4500,
      skippable: false,
    });

    // 交互 / 注视 / 区域 / 选项 / 手机操作都无法推进过场步骤
    // （注视用不存在的热点，避免顺带触发 S1 的观察触发器产生字幕）
    h.machine.onInteract('S1', 'phone');
    h.machine.onGazeHotspot('S1', 'no-such-hotspot');
    h.machine.onEnterZone('S1', 'stairs');
    h.machine.onChooseOption('s1-wake', 'any-option');
    h.machine.onPhoneAction('s1-wake', 'close');
    expect(h.machine.getSceneId()).toBe('S1');
    expect(h.dialogues).toHaveLength(0);
    expect(h.captions).toHaveLength(0);

    // 错误的 stepId 同样不能推进
    h.machine.onDialogueEnd('s1-caption');
    expect(h.captions).toHaveLength(0);

    // 过场播放器回发正确的 ui:dialogueEnd 才推进到下一步
    h.machine.onDialogueEnd('s1-wake');
    expect(h.captions).toHaveLength(1);
    expect(h.captions[0].stepId).toBe('s1-caption');
  });
});

describe('SceneMachine Phase A 观察、照片与字幕', () => {
  it('S8 新观察只接受当前场景的正确热点，重复注视不重复字幕与日志', () => {
    const h = createHarness();
    h.machine.startNew('S8', 'bystander');
    h.machine.onDialogueEnd('s8-volunteer');
    h.machine.onChooseOption('s8-walk', 's8-walk-together');
    const before = h.machine.getSnapshot();
    const changeCount = h.stateChanges.length;

    h.machine.onGazeHotspot('S7', 'phone-behind');
    h.machine.onGazeHotspot('S8', 'unknown-hotspot');
    h.machine.onInteract('S8', 'phone-behind');
    expect(h.machine.getSnapshot()).toEqual(before);
    expect(h.captions).toHaveLength(0);
    expect(h.stateChanges).toHaveLength(changeCount);

    h.machine.onGazeHotspot('S8', 'phone-behind');
    const observed = h.machine.getSnapshot();
    expect(observed.state).toMatchObject({ noticedPhoneBehind: true, seenFatherWatching: false, harm: 20 });
    expect(observed.stepIndex).toBe(before.stepIndex);
    expect(observed.state.log).toHaveLength(before.state.log.length + 1);
    expect(observed.state.log[observed.state.log.length - 1]).toMatchObject({ sceneId: 'S8', type: 'observe' });
    expect(h.captions).toEqual([{
      stepId: 's8-phone-behind', kind: 'observation', durationMs: 2600,
      text: '路边有同学正举着手机拍林荫道，镜头晃过你们这边。',
    }]);
    expect(h.stateChanges).toHaveLength(changeCount + 1);

    h.machine.onGazeHotspot('S8', 'phone-behind');
    expect(h.machine.getSnapshot()).toEqual(observed);
    expect(h.captions).toHaveLength(1);
    expect(h.stateChanges).toHaveLength(changeCount + 1);
    h.machine.onGazeHotspot('S8', 'look-back-father');
    expect(h.machine.getState()).toMatchObject({ noticedPhoneBehind: true, seenFatherWatching: true });
    h.machine.onEnterZone('S8', 'building-entrance');
    expect(h.machine.getSceneId()).toBe('S9');
  });

  it.each([
    ['s9-notice-photo', 'noticedPhoto', 's9-like-photo', 'likedPhoto'],
    ['s9-like-photo', 'likedPhoto', 's9-notice-photo', 'noticedPhoto'],
  ] as const)('S9 %s 只记录一次且与另一照片动作独立，不改 harm 或推进手机', (firstId, firstKey, secondId, secondKey) => {
    const h = createHarness();
    h.machine.startNew('S9', 'bystander');
    h.machine.onChooseOption('s9-choice', 's9-look');
    const before = h.machine.getSnapshot();
    const changeCount = h.stateChanges.length;
    h.machine.onPhoneAction('s9-phone', 'reply', firstId);
    const first = h.machine.getSnapshot();
    expect(first.state[firstKey]).toBe(true);
    expect(first.state[secondKey]).toBe(false);
    expect(first.state.harm).toBe(before.state.harm);
    expect(first.state.log).toHaveLength(before.state.log.length + 1);
    expect(first.firedTriggerIds).toEqual([firstId]);
    expect(first.stepIndex).toBe(before.stepIndex);
    expect(h.stateChanges).toHaveLength(changeCount + 1);

    h.machine.onPhoneAction('s9-phone', 'reply', firstId);
    expect(h.machine.getSnapshot()).toEqual(first);
    expect(h.stateChanges).toHaveLength(changeCount + 1);
    h.machine.onPhoneAction('s9-phone', 'reply', secondId);
    const both = h.machine.getSnapshot();
    expect(both.state).toMatchObject({ noticedPhoto: true, likedPhoto: true, harm: before.state.harm });
    expect(both.state.log).toHaveLength(before.state.log.length + 2);
    expect(both.firedTriggerIds).toEqual([firstId, secondId]);
    expect(h.stateChanges).toHaveLength(changeCount + 2);
    h.machine.onPhoneAction('s9-phone', 'reply', secondId);
    expect(h.machine.getSnapshot()).toEqual(both);
    expect(h.stateChanges).toHaveLength(changeCount + 2);
    expect(h.machine.getSceneId()).toBe('S9');
    expect(h.machine.isEnded()).toBe(false);
    expect(h.hiddenPhones).toHaveLength(0);
    expect(h.captions).toHaveLength(0);
    expect(h.dialogues).toHaveLength(0);
    expect(h.intertitles).toHaveLength(0);

    h.machine.onPhoneAction('s9-phone', 'close');
    expect(h.machine.getSceneId()).toBe('S10');
    expect(h.machine.isEnded()).toBe(false);
    expect(h.chapterEnds).toHaveLength(0);
    expect(h.hiddenPhones).toEqual([{ phoneId: 's9-phone' }]);
  });

  it('S9 错误手机、动作或回复 ID 均不触发照片状态，关闭后的迟到回复无效', () => {
    const h = createHarness();
    h.machine.startNew('S9', 'bystander');
    h.machine.onChooseOption('s9-choice', 's9-look');
    const before = h.machine.getSnapshot();
    const changeCount = h.stateChanges.length;
    for (const optionId of ['s9-notice-photo', 's9-like-photo']) {
      h.machine.onPhoneAction('s2-phone', 'reply', optionId);
      h.machine.onPhoneAction('s9-phone', 'open', optionId);
      h.machine.onPhoneAction('s9-phone', 'ignore', optionId);
    }
    h.machine.onPhoneAction('s9-phone', 'reply', 'unknown-option');
    h.machine.onPhoneAction('s9-phone', 'reply', 'mom-reply-rise');
    h.machine.onPhoneAction('s9-phone', 'reply');
    expect(h.machine.getSnapshot()).toEqual(before);
    expect(h.stateChanges).toHaveLength(changeCount);
    expect(h.captions).toHaveLength(0);
    expect(h.hiddenPhones).toHaveLength(0);

    h.machine.onPhoneAction('s9-phone', 'close');
    const afterClose = h.machine.getSnapshot();
    expect(afterClose).toMatchObject({ sceneId: 'S10', ended: false, state: { noticedPhoto: false, likedPhoto: false, harm: 20 } });
    h.machine.onPhoneAction('s9-phone', 'reply', 's9-notice-photo');
    h.machine.onPhoneAction('s9-phone', 'reply', 's9-like-photo');
    expect(h.machine.getSnapshot()).toEqual(afterClose);
  });

  it('S10 字幕只响应正确 ui:dialogueEnd，进入 S11 后忽略迟到的 S10 事件', () => {
    const h = createHarness();
    h.machine.startNew('S10', 'bystander');
    expect(chapter1.scenes.S10).toBeDefined();
    const step = chapter1.scenes.S10!.steps[0];
    if (step.kind !== 'intertitle') throw new Error('S10 首步必须是 intertitle');
    expect(h.intertitles).toEqual([{
      stepId: 's10-days', lines: step.lines, lineDurationMs: 2000, skippable: true,
    }]);
    expect(h.intertitles[0].lines).toHaveLength(7);
    const before = h.machine.getSnapshot();
    h.machine.onDialogueEnd('s9-end');
    h.machine.onInteract('S10', 'phone');
    h.machine.onGazeHotspot('S10', 'phone-behind');
    h.machine.onEnterZone('S10', 'building-entrance');
    h.machine.onChooseOption('s10-days', 'skip');
    h.machine.onPhoneAction('s10-days', 'close');
    expect(h.machine.getSnapshot()).toEqual(before);
    expect(h.chapterEnds).toHaveLength(0);
    expect(h.persists.filter((item) => item.completed)).toHaveLength(0);

    h.machine.onDialogueEnd('s10-days');
    expect(h.machine.getSnapshot()).toMatchObject({ sceneId: 'S11', stepIndex: 0, ended: false });
    expect(h.dialogues[h.dialogues.length - 1].stepId).toBe('s11-roommate');
    expect(h.chapterEnds).toHaveLength(0);
    expect(h.persists.filter((item) => item.completed)).toHaveLength(0);
    const entered = h.machine.getSnapshot();
    const persistCount = h.persists.length;
    const changeCount = h.stateChanges.length;
    h.machine.onDialogueEnd('s10-days');
    h.machine.onEnterZone('S10', 'building-entrance');
    h.machine.onGazeHotspot('S10', 'phone-behind');
    h.machine.onInteract('S10', 'phone');
    expect(h.machine.getSnapshot()).toEqual(entered);
    expect(h.dialogues).toHaveLength(1);
    expect(h.stateChanges).toHaveLength(changeCount);
    expect(h.chapterEnds).toHaveLength(0);
    expect(h.persists).toHaveLength(persistCount);
  });
});

describe('SceneMachine 小游戏结算', () => {
  // 单场景夹具隔离结算公式，避免真实剧本的分支与额外加值干扰。
  function settlementHarness(game: 'bubble' | 'crystal' = 'crystal'): Harness {
    return createHarness({
      id: 'ch1', title: '小游戏结算测试', startScene: 'S1', characters: chapter1.characters,
      scenes: {
        S1: {
          id: 'S1', sceneKey: 'stage2d', title: '结算', transitions: [],
          steps: [
            { kind: 'minigame', id: 'settlement', game },
            { kind: 'minigame', id: 'settlement-next', game: 'bubble' },
            { kind: 'caption', id: 'settlement-caption', text: '结算完成' },
            { kind: 'end', id: 'settlement-end' },
          ],
        },
      },
    });
  }

  describe.each(['bubble', 'crystal'] as const)('%s 公式 min(hits,8)-min(floor(kills/5),4)', (game) => {
    it.each([
      [0, 0, 0],
      [3, 4, 3],
      [3, 5, 2],
      [3, 9, 2],
      [3, 10, 1],
      [7, 19, 4],
      [8, 20, 4],
      [9, 25, 4],
      [30, 0, 8],
      [0, 100, -4],
    ])('hits=%i kills=%i 时 harm 增量为 %i', (hits, kills, delta) => {
      const h = settlementHarness(game);
      h.machine.startNew('S1', 'bystander');
      const before = h.machine.getState();
      const changes = h.stateChanges.length;
      h.machine.onMinigameEnd('settlement', hits, kills, 2);
      const after = h.machine.getState();
      expect(after.harm).toBe(before.harm + delta);
      expect(after.log).toHaveLength(before.log.length + 1);
      expect(after.log[after.log.length - 1]).toMatchObject({ sceneId: 'S1', type: 'choice' });
      expect(after).toMatchObject(game === 'crystal'
        ? { crystalHits: hits, kills, stage1Tries: 2, helpedByAyuan: false }
        : { crystalHits: 0, kills: 0, stage1Tries: 0, helpedByAyuan: false });
      expect(h.machine.getSnapshot()).toMatchObject({ stepIndex: 1, ended: false });
      expect(h.stateChanges).toHaveLength(changes + 1);
      expect(h.chapterEnds).toHaveLength(0);
    });
  });

  it('水晶结算保留原始计数、继承 joined，省略 tries 时为 0', () => {
    const h = settlementHarness();
    h.machine.continueFrom(createEmptyChapterSave({
      state: { ...createInitialStoryState(), joined: true, stage1Tries: 7 },
    }));
    h.machine.onMinigameEnd('settlement', 12, 30);
    expect(h.machine.getState()).toMatchObject({
      harm: 24, crystalHits: 12, kills: 30, stage1Tries: 0, helpedByAyuan: true,
    });
  });

  describe.each(['hits', 'kills', 'tries'] as const)('非法 %s', (field) => {
    it.each([NaN, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1])('%s 不改变状态、日志或步骤，随后仍可正常结算', (invalid) => {
      const h = settlementHarness();
      h.machine.startNew('S1', 'bystander');
      const before = h.machine.getSnapshot();
      const changes = h.stateChanges.length;
      const persists = h.persists.length;
      const values = { hits: 3, kills: 5, tries: 2, [field]: invalid };
      h.machine.onMinigameEnd('settlement', values.hits, values.kills, values.tries);
      expect(h.machine.getSnapshot()).toEqual(before);
      expect(h.stateChanges).toHaveLength(changes);
      expect(h.persists).toHaveLength(persists);
      expect(h.chapterEnds).toHaveLength(0);
      h.machine.onMinigameEnd('settlement', 3, 5, 2);
      expect(h.machine.getSnapshot()).toMatchObject({ stepIndex: 1, state: { harm: 22 } });
    });
  });

  it('错误步骤、后续小游戏中的过期回调、非小游戏步骤及结束后的重复回调均无效', () => {
    const h = settlementHarness();
    h.machine.startNew('S1', 'bystander');
    const before = h.machine.getSnapshot();
    h.machine.onMinigameEnd('outdated', 8, 0, 1);
    expect(h.machine.getSnapshot()).toEqual(before);
    h.machine.onMinigameEnd('settlement', 3, 5, 2);
    const settled = h.machine.getSnapshot();
    const changes = h.stateChanges.length;
    h.machine.onMinigameEnd('settlement', 8, 0, 9);
    expect(h.machine.getSnapshot()).toEqual(settled);
    expect(h.stateChanges).toHaveLength(changes);
    h.machine.onMinigameEnd('settlement-next', 0, 0);
    const caption = h.machine.getSnapshot();
    h.machine.onMinigameEnd('settlement-next', 8, 0);
    h.machine.onMinigameEnd('settlement-caption', 8, 0);
    expect(h.machine.getSnapshot()).toEqual(caption);
    expect(h.captions).toHaveLength(1);
    h.machine.onDialogueEnd('settlement-caption');
    const ended = h.machine.getSnapshot();
    const finalChanges = h.stateChanges.length;
    h.machine.onMinigameEnd('settlement-next', 8, 0);
    expect(h.machine.getSnapshot()).toEqual(ended);
    expect(h.stateChanges).toHaveLength(finalChanges);
    expect(h.chapterEnds).toHaveLength(1);
    expect(h.persists.filter(({ completed }) => completed)).toHaveLength(1);
  });
});

describe('SceneMachine 自由探索选项', () => {
  function beginBag(): Harness {
    const h = createHarness();
    h.machine.startNew('S7', 'bystander');
    h.machine.onDialogueEnd('s7-volunteer');
    h.machine.onChooseOption('s7-pen', 's7-pen-hand');
    h.machine.onChooseOption('s7-reason', 's7-reason-delay');
    return h;
  }

  it('药袋阶段允许移动，真实交互与原按钮得到完全相同的状态和下一步', () => {
    const physical = beginBag();
    const button = beginBag();
    expect(physical.choices[physical.choices.length - 1]).toMatchObject({ stepId: 's7-bag', allowMovement: true });
    physical.machine.onGazeHotspot('S7', 'reason-form');
    button.machine.onGazeHotspot('S7', 'reason-form');
    physical.machine.onInteract('S7', 'medicine-bag');
    button.machine.onChooseOption('s7-bag', 's7-bag-pick');
    expect(physical.machine.getState()).toEqual(button.machine.getState());
    expect(physical.machine.getState().picked).toBe(true);
    expect(physical.machine.getState().seenCrossedOut).toBe(true);
    expect(physical.choices[physical.choices.length - 1].stepId).toBe('s7-return-bag');
    physical.machine.onInteract('S7', 'medicine-bag');
    expect(physical.machine.getState()).toEqual(button.machine.getState());
  });

  it('错误场景或物体不能代替拾取，也不能抢先跳过登记步骤', () => {
    const h = createHarness();
    h.machine.startNew('S7', 'bystander');
    h.machine.onInteract('S7', 'medicine-bag');
    h.machine.onDialogueEnd('s7-volunteer');
    h.machine.onInteract('S7', 'medicine-bag');
    expect(h.machine.getState().picked).toBe(false);
    const ready = beginBag();
    ready.machine.onInteract('S8', 'medicine-bag');
    ready.machine.onInteract('S7', 'unknown');
    expect(ready.machine.getState().picked).toBe(false);
    expect(ready.choices[ready.choices.length - 1].stepId).toBe('s7-bag');
  });

  it('不捡选项保持可通关，普通选项仍不开放移动', () => {
    const h = beginBag();
    expect(h.choices[0].allowMovement).toBeUndefined();
    h.machine.onChooseOption('s7-bag', 's7-bag-leave');
    expect(h.machine.getState().picked).toBe(false);
    expect(h.dialogues[h.dialogues.length - 1].stepId).toBe('s7-linxia-picks');
    h.machine.onDialogueEnd('s7-linxia-picks');
    expect(h.machine.getSceneId()).toBe('S8');
  });
});

describe('SceneMachine 继续游戏与条件转场', () => {
  it('继续游戏从存档场景第 0 步开始，且不重复执行 onEnter 日志', () => {
    const first = createHarness();
    enterS2(first);

    const s2Persist = first.persists.find((item) => item.snapshot.sceneId === 'S2');
    expect(s2Persist).toBeDefined();
    if (!s2Persist) return;

    const enterLogCount = s2Persist.snapshot.state.log.filter(
      (entry) => entry.summary === '进入 S2 手机教学',
    ).length;
    expect(enterLogCount).toBe(1);

    const resumed = createHarness();
    resumed.machine.continueFrom(
      createEmptyChapterSave({
        sceneId: 'S2',
        savedAt: 2000,
        state: s2Persist.snapshot.state,
        completed: false,
      }),
    );

    expect(resumed.machine.getSceneId()).toBe('S2');
    expect(resumed.phones[0]?.stepId).toBe('s2-phone');
    expect(resumed.dialogues).toHaveLength(0);
    const resumedLogCount = resumed.machine
      .getState()
      .log.filter((entry) => entry.summary === '进入 S2 手机教学').length;
    expect(resumedLogCount).toBe(1);
  });

  it('已完成存档继续时直接重展示章节结尾，不会卡在 S9 选择', () => {
    const h = createHarness();
    const state = {
      ...createInitialStoryState(),
      trust: 1,
      log: [{ timestamp: 1, sceneId: 'S9' as const, type: 'system' as const, summary: '第一章 到校段结束。' }],
    };

    h.machine.continueFrom(
      createEmptyChapterSave({ sceneId: 'S9', completed: true, state, savedAt: 3000 }),
    );

    expect(h.machine.isEnded()).toBe(true);
    expect(h.choices).toHaveLength(0);
    expect(h.chapterEnds).toHaveLength(1);
    expect(h.transitions[0]).toMatchObject({ toSceneId: 'S9', fromSceneId: null });
    expect(h.persists[h.persists.length - 1]?.completed).toBe(true);
  });

  it('按条件选择不同转场目标（全真跳 S2，否则跳 S3）', () => {
    const conditional = structuredClone(chapter1);
    expect(conditional.scenes.S1).toBeDefined();
    conditional.scenes.S1!.transitions = [
      { when: { key: 'seenBag', equals: true }, to: 'S2' },
      { to: 'S3' },
    ];
    conditional.scenes.S1!.triggers = (conditional.scenes.S1!.triggers ?? []).map((trigger) =>
      trigger.id === 's1-observe-window'
        ? { ...trigger, effects: { set: { seenBag: true } } }
        : trigger,
    );

    const chosen = createHarness(conditional);
    beginS1(chosen);
    chosen.machine.onGazeHotspot('S1', 'window');
    chosen.machine.onInteract('S1', 'phone');
    expect(chosen.machine.getSceneId()).toBe('S2');

    const fallback = createHarness(conditional);
    beginS1(fallback);
    fallback.machine.onInteract('S1', 'phone');
    expect(fallback.machine.getSceneId()).toBe('S3');
  });

  it('忽略错误场景 / 错误步骤 / 未满足条件的选项事件', () => {
    const h = createHarness();
    h.machine.startNew('S7', 'bystander');

    h.machine.onGazeHotspot('S1', 'reason-form');
    expect(h.machine.getState().seenCrossedOut).toBe(false);

    h.machine.onChooseOption('not-current', 's7-pen-hand');
    expect(h.machine.getState().handedPen).toBe(false);

    h.machine.onDialogueEnd('s7-volunteer');
    h.machine.onChooseOption('s7-pen', 'missing-option');
    expect(h.machine.getState().handedPen).toBe(false);
    expect(h.machine.getSceneId()).toBe('S7');
  });
});