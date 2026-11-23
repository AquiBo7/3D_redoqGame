import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/eventBus';
import { SceneMachine } from '../core/sceneMachine';
import { chapter1 } from './story.ch1';
import { chapter3Scenes } from './story.ch3';
import type { ChapterStory, SceneId, StateSet } from './storySchema';

function harness(entry: SceneId = 'C5', seed: StateSet = {}) {
  const scene = chapter3Scenes[entry];
  if (!scene) throw new Error(`缺少测试入口 ${entry}`);
  const chapter: ChapterStory = {
    ...chapter1, startScene: entry,
    scenes: {
      ...chapter3Scenes,
      [entry]: { ...scene, onEnter: { set: seed } },
      D1: { id: 'D1', title: '第四章测试终点', sceneKey: 'stage2d', steps: [{ kind: 'end', id: 'd1-end' }], transitions: [] },
      E1: { id: 'E1', title: '结局测试终点', sceneKey: 'stage2d', steps: [{ kind: 'end', id: 'e1-end' }], transitions: [] },
    },
  };
  const bus = new EventBus();
  const dialogues: GameEvents['ui:showDialogue'][] = [];
  const choices: GameEvents['ui:showChoices'][] = [];
  const phones: GameEvents['ui:showPhone'][] = [];
  const intertitles: GameEvents['ui:showIntertitle'][] = [];
  bus.on('ui:showDialogue', (event) => dialogues.push(event));
  bus.on('ui:showChoices', (event) => choices.push(event));
  bus.on('ui:showPhone', (event) => phones.push(event));
  bus.on('ui:showIntertitle', (event) => intertitles.push(event));
  const machine = new SceneMachine({ chapter, bus, now: () => 1000 });
  const current = () => chapter.scenes[machine.getSceneId()]?.steps[machine.getSnapshot().stepIndex];
  // 只模拟读完展示，不替玩家选项或自动进入触发区。
  const readThrough = () => {
    for (let i = 0; i < 50; i++) {
      if (machine.isEnded()) return;
      const step = current();
      if (!step) throw new Error('状态机停在不存在的步骤');
      if (step.kind === 'phone') machine.onPhoneAction(step.panel.id, 'close');
      else if (['dialogue', 'caption', 'intertitle'].includes(step.kind)) machine.onDialogueEnd(step.id);
      else return;
    }
    throw new Error('剧情疑似循环');
  };
  const choose = (step: string, option: string) => {
    expect(current()?.id).toBe(step);
    machine.onChooseOption(step, option);
    readThrough();
  };
  machine.startNew(entry, 'bystander');
  return { machine, current, readThrough, choose, dialogues, choices, phones, intertitles };
}

type Harness = ReturnType<typeof harness>;
type Method = 'relay' | 'recognize' | 'shout';
function tryMethod(h: Harness, method: Method) {
  h.choose('c5-find-path', method);
  if (method === 'recognize') {
    expect(h.current()?.id).toBe('c5-recognize');
    h.machine.onInteract('C5', 'student-4');
    h.readThrough();
  } else if (method === 'relay') h.choose('c5-relay-confirm', 'c5-relay-send');
  expect(h.current()?.id).toBe('c5-find-path');
}

const baseClues = ['帖子发布时间 8:52', '校园墙管理员：可以帮忙转达'];
const orangeClue = '台阶旁低头打字的男生：橙色手机壳';

describe('第三章剧本与交互合同', () => {
  it('C1–C6 场景类型、步骤和本地跳转完整', () => {
    expect(Object.keys(chapter3Scenes)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6']);
    for (const scene of Object.values(chapter3Scenes)) {
      expect(scene.sceneKey).toBe(scene.id === 'C1' ? 'stage2d' : 'interior');
      const ids = scene.steps.map((step) => step.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const step of scene.steps) {
        const targets = step.kind === 'goto' ? [step.target]
          : step.kind === 'choice' ? step.options.flatMap((option) => option.goto ? [option.goto] : []) : [];
        for (const target of targets) expect(ids).toContain(target);
        if (step.kind === 'choice') expect(new Set(step.options.map((option) => option.id)).size).toBe(step.options.length);
      }
    }
  });

  it.each([true, false])('C1 保留第二天、上涨帖子及 pointedOut=%s 的台词，随后进入 C2', (pointedOut) => {
    const h = harness('C1', { pointedOut });
    h.readThrough();
    expect(h.intertitles[0].lines).toEqual(['第二天']);
    expect(h.phones[0].panel.sections[0]).toMatchObject({ views: 48200, commentCount: 1360 });
    expect(h.dialogues.map((event) => event.stepId)).toEqual([pointedOut ? 'c1-guilt' : 'c1-comfort']);
    h.choose('c1-reply', 'c1-stop-spreading');
    expect(h.machine.getSceneId()).toBe('C2');
    expect(h.current()?.id).toBe('c2-seat');
  });

  it.each(['beside', 'front', 'far'] as const)('C2 场景交互选择 %s，只结算一次', (seat) => {
    const h = harness('C2');
    h.readThrough();
    expect(h.current()).toMatchObject({ id: 'c2-seat', allowMovement: true });
    h.machine.onInteract('C5', `seat-${seat}`);
    h.machine.onInteract('C2', 'seat-invalid');
    expect(h.machine.getState().seat).toBeNull();
    h.machine.onInteract('C2', `seat-${seat}`);
    h.readThrough();
    h.machine.onInteract('C2', `seat-${seat}`);
    expect(h.machine.getState()).toMatchObject({ seat, trust: seat === 'beside' ? 1 : 0, phoneIgnored: seat === 'far' ? 1 : 0 });
    expect(h.current()?.id).toBe('c3-find-office');
    h.machine.onInteract('C3', 'teacher-office-door');
    h.readThrough();
    expect(h.current()?.id).toBe('c3-response');
  });

  it.each(['explain', 'wait'] as const)('C2 旁座呈现 %s 对应反应与速写本', (postChoice) => {
    const h = harness('C2', { postChoice });
    h.readThrough();
    h.choose('c2-seat', 'seat-beside');
    const ids = h.dialogues.map((event) => event.stepId);
    expect(ids).toContain('c2-sketch');
    expect(ids).toContain(postChoice === 'explain' ? 'c2-nod' : 'c2-relax');
    expect(ids).not.toContain(postChoice === 'explain' ? 'c2-relax' : 'c2-nod');
  });

  for (const seat of ['beside', 'front', 'far'] as const) {
    for (const tellTeacher of ['told', 'ask_her', 'think'] as const) {
      for (const skip of [true, false]) {
        it(`旁观三条件：${seat}/${tellTeacher}/跳过=${skip}`, () => {
          const h = harness('C2');
          h.readThrough();
          h.choose('c2-seat', `seat-${seat}`);
          h.machine.onInteract('C3', 'teacher-office-door');
          h.readThrough();
          h.choose('c3-response', { told: 'c3-told', ask_her: 'c3-ask-her', think: 'c3-think' }[tellTeacher]);
          const eligible = seat === 'far' && tellTeacher === 'think';
          if (eligible) {
            expect(h.machine.getState().ending).toBeNull();
            h.choose('c3-stairs', skip ? 'c3-skip-stairs' : 'c3-go-stairs');
          } else h.machine.onChooseOption('c3-stairs', 'c3-skip-stairs');
          const ended = eligible && skip;
          expect(h.machine.getSceneId()).toBe(ended ? 'E1' : 'C4');
          expect(h.machine.getState()).toMatchObject({
            teacherTalked: tellTeacher !== 'think', tellTeacher, visitedStairwell: false, ending: ended ? 'bystander' : null,
          });
          if (!ended) expect(h.current()?.id).toBe('c4-arrive');
        });
      }
    }
  }

  it.each(['c4-father-witness', 'c4-father-teacher', 'c4-father-knows'])('C4 必须抵达拐角，提问 %s 不会通知爸爸', (question) => {
    const h = harness('C4', { fatherKnows: true });
    h.machine.onDialogueEnd('c4-arrive');
    h.machine.onEnterZone('C5', 'stairwell-corner');
    h.machine.onEnterZone('C4', 'night-phone');
    expect(h.dialogues).toHaveLength(0);
    expect(h.current()?.id).toBe('c4-arrive');
    h.machine.onEnterZone('C4', 'stairwell-corner');
    expect(h.current()?.id).toBe('c4-father-call');
    expect(h.machine.getState()).toMatchObject({ visitedStairwell: true, fatherKnows: false, askedAboutFather: false });
    h.readThrough();
    h.choose('c4-comfort', 'c4-comfort-tissue');
    h.choose('c4-father-question', question);
    expect(h.machine.getState()).toMatchObject({ askedAboutFather: true, fatherKnows: false });
  });

  for (const picked of [true, false]) {
    for (const evidence of [true, false]) {
      it.each([
        ['c4-respect', 2], ['c4-other-way', 1], ['c4-insist', -1],
      ] as const)(`C4 %s 留证授权 picked=${picked}/evidence=${evidence}`, (response, trust) => {
        const h = harness('C4', { picked, evidence });
        h.machine.onEnterZone('C4', 'stairwell-corner');
        h.readThrough();
        h.choose('c4-comfort', 'c4-comfort-stay');
        h.choose('c4-father-question', 'c4-father-knows');
        h.machine.onChooseOption('c4-response', response);
        const shouldConsent = picked && !evidence && response !== 'c4-insist';
        expect(h.machine.getState().evidence).toBe(evidence);
        if (shouldConsent) {
          expect(h.current()?.id).toBe('c4-evidence-consent');
          const consent = h.dialogues[h.dialogues.length - 1];
          expect(consent.lines.some((line) => line.speaker === 'linxia' && line.text.includes('可以') && line.text.includes('先问我'))).toBe(true);
          h.machine.onDialogueEnd('wrong-step');
          expect(h.machine.getState().evidence).toBe(false);
        }
        h.readThrough();
        expect(h.machine.getState()).toMatchObject({ trust: trust + 1, evidence: evidence || shouldConsent, fatherKnows: false });
        expect(h.dialogues.some((event) => event.stepId === 'c4-evidence-consent')).toBe(shouldConsent);
        expect(h.dialogues.some((event) => event.stepId === 'c4-insist-reply')).toBe(response === 'c4-insist');
        expect(h.current()?.id).toBe('c5-find-path');
      });
    }
  }

  it.each([true, false])('C5 自动线索与备忘录按 noticedTyper=%s 呈现，重看不重复追加', (noticedTyper) => {
    const h = harness('C5', { noticedTyper, clues: [baseClues[0]] });
    const expected = noticedTyper ? [...baseClues, orangeClue] : baseClues;
    expect(h.machine.getState().clues).toEqual(expected);
    h.readThrough();
    for (let i = 0; i < 3; i++) h.choose('c5-find-path', 'c5-memo');
    expect(h.machine.getState().clues).toEqual(expected);
    expect(h.phones).toHaveLength(4);
    for (const event of h.phones) expect(event.panel.sections[0]).toMatchObject({ kind: 'memo', items: expected });
    h.machine.onChooseOption('c5-find-path', 'c5-proceed');
    expect(h.current()?.id).toBe('c5-find-path');
  });

  it.each(['student-1', 'student-2', 'student-3', 'student-5', 'student-6'])('C5 %s 是错误目标且先告知认错人再循环', (student) => {
    const h = harness();
    h.readThrough();
    h.choose('c5-find-path', 'recognize');
    expect(h.current()).toMatchObject({ allowMovement: true });
    expect(h.choices[h.choices.length - 1].options).toHaveLength(7);
    h.machine.onInteract('C4', student);
    expect(h.machine.getState().wrongAsks).toBe(0);
    h.machine.onInteract('C5', student);
    expect(h.current()?.id).toBe('c5-wrong-person');
    expect(h.dialogues[h.dialogues.length - 1].lines[0].text).toBe('你认错人了吧？');
    expect(h.machine.getState()).toMatchObject({ wrongAsks: 1, harm: 22, foundAyuanWay: null });
    h.readThrough();
    expect(h.current()?.id).toBe('c5-recognize');
  });

  it.each([['student-1', 'student-1', 'student-1'], ['student-2', 'student-5', 'student-6']])('C5 错问总上限三次（包括重复对象）%j', (...students) => {
    const h = harness();
    h.readThrough();
    h.choose('c5-find-path', 'recognize');
    for (const student of students) {
      h.machine.onInteract('C5', student);
      h.readThrough();
    }
    expect(h.machine.getState()).toMatchObject({ wrongAsks: 3, harm: 26 });
    h.choose('c5-recognize', 'back-menu');
    h.choose('c5-find-path', 'recognize');
    for (const student of ['student-1', 'student-2', 'student-3', 'student-5', 'student-6']) {
      h.machine.onInteract('C5', student);
      h.machine.onChooseOption('c5-recognize', student);
    }
    expect(h.machine.getState()).toMatchObject({ wrongAsks: 3, harm: 26 });
    expect(h.choices[h.choices.length - 1].options.map((option) => option.id)).toEqual(['student-4', 'back-menu']);
    h.machine.onInteract('C5', 'student-4');
    h.readThrough();
    expect(h.machine.getState()).toMatchObject({ foundAyuanWay: 'recognize', yuanState: 'unprepared', harm: 26 });
    expect(h.current()?.id).toBe('c5-find-path');
  });

  it('C5 管理员仅查看或取消不算成功', () => {
    const h = harness();
    h.readThrough();
    h.choose('c5-find-path', 'relay');
    expect(h.machine.getState().foundAyuanWay).toBeNull();
    expect(h.phones[h.phones.length - 1].panel.sections[0]).toMatchObject({ kind: 'chat', messages: [
      { text: '投稿人信息我不能给你。但可以帮你转达。' },
    ] });
    h.choose('c5-relay-confirm', 'back-menu');
    expect(h.machine.getState().foundAyuanWay).toBeNull();
  });

  // 三次尝试的全部排列（含重复）覆盖两两顺序、所有三路径顺序和幂等性。
  for (const first of ['relay', 'recognize', 'shout'] as const) {
    for (const second of ['relay', 'recognize', 'shout'] as const) {
      for (const third of ['relay', 'recognize', 'shout'] as const) {
        it(`C5 优先级 ${first} → ${second} → ${third}，显式继续才离开`, () => {
          const h = harness();
          h.readThrough();
          const attempted: Method[] = [];
          for (const method of [first, second, third]) {
            tryMethod(h, method);
            attempted.push(method);
            const winner = attempted.includes('shout') ? 'shout' : attempted.includes('recognize') ? 'recognize' : 'relay';
            expect(h.machine.getState()).toMatchObject({ foundAyuanWay: winner,
              yuanState: { shout: 'hostile', recognize: 'unprepared', relay: 'guarded' }[winner],
              harm: attempted.includes('shout') ? 30 : 20,
            });
            expect(h.machine.getSceneId()).toBe('C5');
          }
          h.choose('c5-find-path', 'c5-proceed');
          expect(h.current()?.id).toBe('c6-arrive');
        });
      }
    }
  }

  it('C6 夜间触发区后播放不可跳过三秒钩子，收到展示完成才进入 D1', () => {
    const h = harness('C6');
    h.machine.onEnterZone('C5', 'night-phone');
    h.machine.onEnterZone('C6', 'stairwell-corner');
    h.machine.onInteract('C6', 'night-phone');
    expect(h.current()?.id).toBe('c6-arrive');
    expect(h.intertitles).toHaveLength(0);
    h.machine.onEnterZone('C6', 'night-phone');
    expect(h.intertitles[0]).toMatchObject({ stepId: 'c6-orange-phone', lineDurationMs: 3000, skippable: false });
    expect(h.intertitles[0].lines).toEqual(['楼梯间，一个橙色手机壳亮了一下。']);
    expect(h.machine.getSceneId()).toBe('C6');
    h.machine.onDialogueEnd('c6-orange-phone');
    expect(h.machine.getSceneId()).toBe('D1');
  });

  it('追加 F：C1 转给室友、点开林夏头像与 C4 先征得同意留证会记入 draftReactions', () => {
    const h1 = harness('C1', { addedHer: true });
    h1.machine.onDialogueEnd('c1-morning');
    expect(h1.current()?.kind).toBe('phone');
    h1.machine.onPhoneAction('c1-post', 'reply', 'c1-forward-roommate');
    h1.machine.onPhoneAction('c1-post', 'reply', 'view-linxia-avatar');
    h1.machine.onPhoneAction('c1-post', 'reply', 'view-linxia-avatar');
    expect(h1.machine.getState().draftReactions).toEqual([
      '我不知道是谁，但我猜得到。',
      '那天，我看到有人点开了我的头像。',
    ]);

    const h2 = harness('C4', { picked: true, evidence: false });
    h2.machine.onEnterZone('C4', 'stairwell-corner');
    h2.readThrough();
    h2.choose('c4-comfort', 'c4-comfort-stay');
    h2.choose('c4-father-question', 'c4-father-knows');
    h2.choose('c4-response', 'c4-respect');
    expect(h2.machine.getState().draftReactions).toContain('你先问了我。谢谢。');
  });
});
