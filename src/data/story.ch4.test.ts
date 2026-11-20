import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/eventBus';
import { SceneMachine } from '../core/sceneMachine';
import { ASSET_MANIFEST } from './assetManifest';
import { chapter1 } from './story.ch1';
import { chapter4Scenes } from './story.ch4';
import type { ChapterStory, SceneId, StateSet } from './storySchema';

function harness(entry: SceneId = 'D1', seed: StateSet = {}) {
  const chapter: ChapterStory = {
    ...chapter1, startScene: 'S10', scenes: {
      ...chapter4Scenes,
      S10: { id: 'S10', title: '测试播种入口', sceneKey: 'stage2d', onEnter: { set: seed }, steps: [], transitions: [{ to: entry }] },
      E1: { id: 'E1', title: '结局测试终点', sceneKey: 'stage2d', steps: [{ kind: 'end', id: 'e1-end' }], transitions: [] },
    },
  };
  const bus = new EventBus();
  const dialogues: GameEvents['ui:showDialogue'][] = [];
  const captions: GameEvents['ui:showCaption'][] = [];
  const choices: GameEvents['ui:showChoices'][] = [];
  const arts: GameEvents['ui:showArt'][] = [];
  const phones: GameEvents['ui:showPhone'][] = [];
  const intertitles: GameEvents['ui:showIntertitle'][] = [];
  const transitions: SceneId[] = [];
  bus.on('ui:showDialogue', (event) => dialogues.push(event));
  bus.on('ui:showCaption', (event) => captions.push(event));
  bus.on('ui:showChoices', (event) => choices.push(event));
  bus.on('ui:showArt', (event) => arts.push(event));
  bus.on('ui:showPhone', (event) => phones.push(event));
  bus.on('ui:showIntertitle', (event) => intertitles.push(event));
  bus.on('scene:transition', (event) => transitions.push(event.toSceneId));
  const machine = new SceneMachine({ chapter, bus, now: () => 1000 });
  const current = () => chapter.scenes[machine.getSceneId()]?.steps[machine.getSnapshot().stepIndex];
  const readThrough = () => {
    for (let i = 0; i < 60; i++) {
      if (machine.isEnded()) return;
      const step = current();
      if (!step) throw new Error('剧情停在不存在的步骤');
      if (step.kind === 'phone') machine.onPhoneAction(step.panel.id, 'close');
      else if (['dialogue', 'caption', 'intertitle', 'cutscene', 'art'].includes(step.kind)) machine.onDialogueEnd(step.id);
      else return;
    }
    throw new Error('剧情疑似循环');
  };
  const choose = (step: string, option: string) => {
    expect(current()?.id).toBe(step);
    machine.onChooseOption(step, option);
    readThrough();
  };
  machine.startNew('S10', 'bystander');
  return { machine, current, readThrough, choose, dialogues, captions, choices, arts, phones, intertitles, transitions };
}

function reachRounds(h: ReturnType<typeof harness>) {
  h.readThrough();
  expect(h.current()?.id).toBe('d1-approach');
  h.machine.onEnterZone('D1', 'platform-ayuan');
  h.readThrough();
  expect(h.current()?.id).toBe('d2-round-1');
}

const firstTypes = ['fact', 'empathy', 'force', 'noise'] as const;
const lastTypes = ['company', 'fact', 'force', 'noise'] as const;
const combinations = firstTypes.flatMap((a) => firstTypes.flatMap((b) => lastTypes.map((c) => [a, b, c] as const)));

describe('第四章数据与真实状态机', () => {
  it('仅提供 D1–D6；步骤 ID 唯一，所有本地跳转只向前，不实现 E1', () => {
    expect(Object.keys(chapter4Scenes)).toEqual(['D1', 'D2', 'D3', 'D4', 'D5', 'D6']);
    for (const scene of Object.values(chapter4Scenes)) {
      const ids = scene.steps.map((step) => step.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const [index, step] of scene.steps.entries()) {
        expect(step.kind).not.toBe('end');
        const targets = step.kind === 'goto' ? [step.target]
          : step.kind === 'choice' ? step.options.flatMap((option) => option.goto ? [option.goto] : []) : [];
        for (const target of targets) expect(ids.indexOf(target)).toBeGreaterThan(index);
      }
    }
  });

  it.each([
    ['unprepared', 1, '啊？你是……'], ['guarded', 0, '是你让管理员转达的？……有事吗。'],
    ['hostile', -1, '又是你。别在墙上喊了行吗。'], [null, 0, '是你让管理员转达的？……有事吗。'],
  ] as const)('D1 开场 %s 重置上轮结果并等待真实接近事件', (yuanState, score, line) => {
    const h = harness('D1', {
      yuanState, yuanScore: 99, yuanKeys: ['force'], route: 'breakdown', joined: true, postDeleted: true,
      apologized: true, soloRepair: true, helpedByAyuan: true, stage1Tries: 5, crystalHits: 10, kills: 30,
      phrase: '旧表态', ending: 'worst', harm: 37, evidence: true, trust: 2,
    });
    expect(h.machine.getState()).toMatchObject({
      yuanKeys: [], yuanScore: 0, route: null, joined: false, postDeleted: false,
      apologized: false, soloRepair: false, helpedByAyuan: false, stage1Tries: 0, crystalHits: 0, kills: 0,
      phrase: null, ending: null, harm: 37, evidence: true, trust: 2,
    });
    expect(h.intertitles[0].lines).toEqual(['第三天，放学后']);
    h.readThrough();
    expect(chapter4Scenes.D1?.sceneKey).toBe('interior');
    h.machine.onEnterZone('D2', 'platform-ayuan');
    h.machine.onEnterZone('D1', 'corridor-linxia');
    expect(h.current()?.id).toBe('d1-approach');
    h.machine.onEnterZone('D1', 'platform-ayuan');
    expect(h.current()).toMatchObject({ kind: 'cutscene', key: 'platform-approach', durationMs: 1500, skippable: true });
    h.readThrough();
    expect(h.machine.getState()).toMatchObject({ yuanScore: score, yuanState: yuanState ?? 'guarded' });
    expect(h.dialogues[0].lines[0].text).toBe(line);
    expect(h.dialogues.filter((event) => event.stepId.startsWith('d1-'))).toHaveLength(1);
  });

  for (const [yuanState, initialScore] of [['unprepared', 1], ['guarded', 0], ['hostile', -1]] as const) {
    for (const evidence of [false, true]) {
      describe(`${yuanState} / evidence=${evidence} 的全部 64 组合`, () => {
        it.each(combinations)('%s → %s → %s', (a, b, c) => {
          const selected = [a, b, c];
          const h = harness('D1', { yuanState, evidence });
          reachRounds(h);
          let score = initialScore;
          for (const [index, type] of selected.entries()) {
            const round = index + 1;
            expect(h.current()?.id).toBe(`d2-round-${round}`);
            const shown = h.choices[h.choices.length - 1];
            expect(shown.options).toHaveLength(4);
            expect(new Set(shown.options.map((option) => option.id)).size).toBe(4);
            h.machine.onChooseOption(`d2-round-${round}`, `d2-r${round}-${type}`);
            if (type === 'force') {
              expect(h.current()?.id).toBe('d2-breakdown-caption');
              expect(h.machine.getState()).toMatchObject({
                yuanKeys: selected.slice(0, round), yuanScore: score, harm: 35,
                route: 'breakdown', ending: 'worst', joined: false, postDeleted: false,
              });
              h.machine.onChooseOption(`d2-round-${round}`, `d2-r${round}-force`);
              h.readThrough();
              expect(h.machine.getSceneId()).toBe('E1');
              expect(h.machine.isEnded()).toBe(true);
              expect(h.machine.getState().harm).toBe(35);
              expect(h.choices).toHaveLength(round);
              expect(h.transitions).toEqual(['S10', 'D1', 'D2', 'E1']);
              expect(h.captions[0].text).toBe('你刚才的做法，和他发帖时一样。');
              expect(h.dialogues.some((event) => event.lines.some((line) => line.text.includes('对话截图发进群里')))).toBe(true);
              expect(h.arts).toHaveLength(index > 1 && b === 'fact' && evidence ? 1 : 0);
              return;
            }
            score += type === 'noise' ? 0 : index === 1 && type === 'fact' && evidence ? 2 : 1;
            h.readThrough();
            expect(h.machine.getState().yuanScore).toBe(score);
          }
          const isTeam = selected.join(',') === 'fact,empathy,company' || (!selected.includes('noise') && score >= 2);
          expect(h.machine.getState()).toMatchObject({
            yuanKeys: selected, yuanScore: score, route: isTeam ? 'team' : 'deleteOnly',
            joined: isTeam, postDeleted: true, ending: null, harm: 20,
          });
          expect(h.current()?.id).toBe(isTeam ? 'd4-team-phrase' : 'd4-solo-phrase');
          expect(h.arts).toHaveLength(b === 'fact' && evidence ? 1 : 0);
        });
      });
    }
  }

  it.each([
    { evidence: true, picked: false, trust: -2, proof: true },
    { evidence: false, picked: true, trust: 1, proof: true },
    { evidence: false, picked: true, trust: 0, proof: false },
    { evidence: false, picked: false, trust: 3, proof: false },
  ])('第二轮证明条件、互斥文案、额外分与小票暂停：%j', ({ proof, ...seed }) => {
    const h = harness('D2', seed);
    h.readThrough();
    h.choose('d2-round-1', 'd2-r1-noise');
    const option = h.choices[h.choices.length - 1].options.find((item) => item.id === 'd2-r2-fact');
    expect(option?.text).toBe(proof ? '我这儿有她当天的药店小票和照片，你看时间。' : '我知道不是你一个人。但最先传开的是你那条。');
    h.machine.onChooseOption('d2-round-2', 'd2-r2-fact');
    expect(h.machine.getState().yuanScore).toBe(proof ? 2 : 1);
    if (proof) {
      expect(h.current()).toMatchObject({ kind: 'art', id: 'd2-proof-receipt', assetId: 'prop_pharmacy_receipt' });
      expect(ASSET_MANIFEST.prop_pharmacy_receipt.alt).toContain('07:52');
      h.machine.onDialogueEnd('wrong-art');
      expect(h.current()?.id).toBe('d2-proof-receipt');
    }
    h.readThrough();
    expect(h.current()?.id).toBe('d2-round-3');
    expect(h.machine.getState().yuanKeys).toEqual(['noise', 'fact']);
  });

  it.each([
    [false, false, false], [true, false, false], [false, true, true], [true, true, true],
  ])('共情与镜像文案 listened=%s / crossed=%s / pointed=%s', (listened, seenCrossedOut, pointedOut) => {
    const h = harness('D2', { listened, seenCrossedOut, pointedOut });
    h.readThrough();
    h.choose('d2-round-1', 'd2-r1-fact');
    const option = h.choices[h.choices.length - 1].options.find((item) => item.id === 'd2-r2-empathy');
    expect(option?.text).toBe(listened || seenCrossedOut ? '她那天也没想麻烦谁。' : '她那天好像挺累的。');
    h.choose('d2-round-2', 'd2-r2-empathy');
    const mirror = h.dialogues.filter((event) => event.stepId.startsWith('d2-mirror-'));
    expect(mirror).toHaveLength(1);
    expect(mirror[0].lines[0].text).toBe(pointedOut ? '你不是还说过‘这是我们班的’吗？' : '你当时不也在台阶那儿吗？你不也看见了？');
    expect(h.arts).toHaveLength(0);
  });

  it.each([
    ['fact', 'empathy', 'team'], ['empathy', 'fact', 'deleteOnly'], ['fact', 'fact', 'deleteOnly'],
  ] as const)('低分时精确顺序优先：%s/%s/company → %s', (a, b, route) => {
    const h = harness('D2', { yuanScore: -5 });
    h.readThrough();
    h.choose('d2-round-1', `d2-r1-${a}`);
    h.choose('d2-round-2', `d2-r2-${b}`);
    h.choose('d2-round-3', 'd2-r3-company');
    expect(h.machine.getState()).toMatchObject({ yuanScore: -2, route, yuanKeys: [a, b, 'company'] });
  });

  it('逼迫优先于高分、已有入队标记，不会被结算覆盖', () => {
    const h = harness('D2', { yuanScore: 100, route: 'team', joined: true, postDeleted: true });
    h.readThrough();
    h.choose('d2-round-1', 'd2-r1-fact');
    h.choose('d2-round-2', 'd2-r2-empathy');
    h.choose('d2-round-3', 'd2-r3-force');
    expect(h.machine.getState()).toMatchObject({ yuanScore: 102, harm: 35, route: 'breakdown', ending: 'worst', joined: false, postDeleted: false });
    expect(h.machine.getSceneId()).toBe('E1');
  });

  for (const route of ['team', 'deleteOnly'] as const) {
    const phraseOptions = route === 'team'
      ? [['d4-team-act', '我们该做点什么了。'], ['d4-team-explain', '删了不够，我们去把话说清楚。']]
      : [['d4-solo-more', '或许我还可以做得更多。'], ['d4-solo-start', '至少，我能做的我先做。']];
    const responses = route === 'team' ? ['d6-team-speak', 'd6-team-silent']
      : ['d6-solo-deleted', 'd6-solo-tell-me', 'd6-solo-okay'];
    for (const [phraseId, phrase] of phraseOptions) {
      it.each(responses)(`${route} / ${phraseId} / %s 完整通过 D3–D6`, (response) => {
        const joined = route === 'team';
        const h = harness('D3', { route, joined, postDeleted: true });
        h.readThrough();
        const deletedPost = h.phones[0].panel.sections[0];
        expect(deletedPost).toMatchObject({ kind: 'post', deleted: true, text: '该内容已删除', assetIds: [] });
        expect(h.dialogues.some((event) => event.lines.some((line) => line.text === (joined ? '……我跟你一起。' : '我删了。别的，我不管了。')))).toBe(true);
        const repost = h.phones[1].panel.sections.find((section) => section.kind === 'post');
        expect(repost?.views).toBeGreaterThan(0);
        expect(repost?.text).toContain('转发 326 次');
        expect(repost?.comments.map((comment) => comment.text)).toEqual(['原来是脚崴了？可是我还是觉得……', '删了就想没事？']);
        expect(h.choices).toHaveLength(1);
        expect(h.choices[0].options).toHaveLength(2);
        h.choose(joined ? 'd4-team-phrase' : 'd4-solo-phrase', phraseId);
        expect(h.machine.getState().phrase).toBe(phrase);
        expect(h.current()).toMatchObject({ id: 'd5-crystal', kind: 'minigame', game: 'crystal' });
        h.machine.onMinigameEnd('wrong-game', 13, 25, 5);
        expect(h.current()?.id).toBe('d5-crystal');
        h.machine.onMinigameEnd('d5-crystal', 13, 25, 5);
        h.machine.onMinigameEnd('d5-crystal', 13, 25, 5);
        h.readThrough();
        expect(h.machine.getState()).toMatchObject({ harm: 24, crystalHits: 13, kills: 25, stage1Tries: 5, helpedByAyuan: joined });
        expect(h.captions.some((event) => event.text === (joined ? '挡不住所有的，但不是一个人。' : '一个人很难挡住所有人。'))).toBe(true);
        expect(chapter4Scenes.D6?.sceneKey).toBe('interior');
        expect(h.current()?.id).toBe('d6-approach');
        h.machine.onEnterZone('D5', 'corridor-linxia');
        h.machine.onEnterZone('D6', 'platform-ayuan');
        expect(h.current()?.id).toBe('d6-approach');
        h.machine.onEnterZone('D6', 'corridor-linxia');
        h.readThrough();
        expect(h.machine.getState()).toMatchObject({ apologized: false, soloRepair: false, ending: null, harm: 24 });
        const step = joined ? 'd6-team-response' : 'd6-solo-response';
        expect(h.choices[h.choices.length - 1].options).toHaveLength(joined ? 2 : 3);
        h.choose(step, response);
        h.machine.onChooseOption(step, response);
        expect(h.machine.getState()).toMatchObject({
          apologized: joined, soloRepair: !joined, harm: joined ? 14 : 24, ending: joined ? 'best' : 'middle',
        });
        const replies = h.dialogues.filter((event) => event.stepId.startsWith('d6-'));
        expect(replies).toHaveLength(1);
        expect(replies[0].lines.some((line) => line.text === (joined ? '……我需要时间。' : '嗯。'))).toBe(true);
        expect(h.intertitles[h.intertitles.length - 1].lines).toEqual(['一个月后']);
        expect(h.machine.getSceneId()).toBe('E1');
        expect(h.machine.isEnded()).toBe(true);
      });
    }
  }
});
