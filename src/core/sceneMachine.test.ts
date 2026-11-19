import { describe, expect, it } from 'vitest';
import { chapter1 } from '../data/story';
import type { ChapterStory } from '../data/storySchema';
import { EventBus } from './eventBus';
import type { GameEvents } from './eventBus';
import { createEmptyChapterSave } from './saveStore';
import { SceneMachine } from './sceneMachine';
import type { MachineSnapshot } from './sceneMachine';
import { createInitialStoryState } from './state';

interface Harness {
  machine: SceneMachine;
  transitions: Array<GameEvents['scene:transition']>;
  dialogues: Array<GameEvents['ui:showDialogue']>;
  captions: Array<GameEvents['ui:showCaption']>;
  phones: Array<GameEvents['ui:showPhone']>;
  hiddenPhones: Array<GameEvents['ui:hidePhone']>;
  choices: Array<GameEvents['ui:showChoices']>;
  cutscenes: Array<GameEvents['scene:cutscene']>;
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
  const chapterEnds: Harness['chapterEnds'] = [];
  const persists: Harness['persists'] = [];

  bus.on('scene:transition', (payload) => transitions.push(payload));
  bus.on('ui:showDialogue', (payload) => dialogues.push(payload));
  bus.on('ui:showCaption', (payload) => captions.push(payload));
  bus.on('ui:showPhone', (payload) => phones.push(payload));
  bus.on('ui:hidePhone', (payload) => hiddenPhones.push(payload));
  bus.on('ui:showChoices', (payload) => choices.push(payload));
  bus.on('scene:cutscene', (payload) => cutscenes.push(payload));
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
  it('完整走通 S1→S9（看手机结局），状态、转场与结尾均正确', () => {
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
    h.machine.onChooseOption('s8-walk', 's8-walk-together');
    h.machine.onEnterZone('S8', 'building-entrance');

    // S9 看手机并关闭
    h.machine.onChooseOption('s9-choice', 's9-look');
    expect(h.machine.getSceneId()).toBe('S9');
    h.machine.onPhoneAction('s9-phone', 'close');

    const state = h.machine.getState();
    expect(h.machine.isEnded()).toBe(true);
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

    expect(h.chapterEnds).toHaveLength(1);
    expect(h.chapterEnds[0].sceneId).toBe('S9');
    expect(h.chapterEnds[0].state.log.some((entry) => entry.summary === '第一章 到校段结束。')).toBe(
      true,
    );
    expect(h.persists[h.persists.length - 1]?.completed).toBe(true);
    expect(h.persists.filter((item) => item.completed)).toHaveLength(1);
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
    expect(h.chapterEnds).toHaveLength(1);
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
    conditional.scenes.S1.transitions = [
      { when: { key: 'seenBag', equals: true }, to: 'S2' },
      { to: 'S3' },
    ];
    conditional.scenes.S1.triggers = (conditional.scenes.S1.triggers ?? []).map((trigger) =>
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