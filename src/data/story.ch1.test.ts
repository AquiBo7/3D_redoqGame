import { describe, expect, it } from 'vitest';
import { chapter1 } from './story.ch1';
import { SCENE_IDS } from './storySchema';
import type { SceneId, StoryChoice, StoryStep } from './storySchema';

const CHAPTER_ONE_SCENE_IDS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9'] as const;
const configuredSceneIds = Object.keys(chapter1.scenes) as SceneId[];

function sceneOf(sceneId: SceneId) {
  const scene = chapter1.scenes[sceneId];
  expect(scene, `缺少已配置场景 ${sceneId}`).toBeDefined();
  return scene!;
}

function stepsOf(sceneId: SceneId): StoryStep[] {
  return sceneOf(sceneId).steps;
}

function stepById(sceneId: SceneId, stepId: string): StoryStep {
  const step = stepsOf(sceneId).find((item) => item.id === stepId);
  if (!step) throw new Error(`缺少步骤 ${sceneId}/${stepId}`);
  return step;
}

function choiceOf(sceneId: SceneId, stepId: string): Extract<StoryStep, { kind: 'choice' }> {
  const step = stepById(sceneId, stepId);
  if (step.kind !== 'choice') throw new Error(`${stepId} 不是 choice`);
  return step;
}

function optionOf(sceneId: SceneId, stepId: string, optionId: string): StoryChoice {
  const option = choiceOf(sceneId, stepId).options.find((item) => item.id === optionId);
  if (!option) throw new Error(`缺少选项 ${stepId}/${optionId}`);
  return option;
}

describe('第一章剧本结构', () => {
  it('Phase A 包含完整第一章 S1–S9 与 S10 字幕，不为扩展场景制造假节点', () => {
    expect(SCENE_IDS).toHaveLength(27);
    expect([...configuredSceneIds].sort()).toEqual([...CHAPTER_ONE_SCENE_IDS, 'S10'].sort());
    for (const sceneId of configuredSceneIds) {
      expect(SCENE_IDS).toContain(sceneId);
      expect(sceneOf(sceneId).id).toBe(sceneId);
      expect(stepsOf(sceneId).length).toBeGreaterThan(0);
    }
  });

  it('第一章按 S1→S9 线性推进到 S10，Phase A 在 S10 字幕后结束', () => {
    const phaseASceneIds = [...CHAPTER_ONE_SCENE_IDS, 'S10'] as const;
    for (let index = 0; index < phaseASceneIds.length - 1; index += 1) {
      const current = phaseASceneIds[index];
      const next = phaseASceneIds[index + 1];
      expect(sceneOf(current).transitions).toEqual([{ to: next }]);
    }
    expect(sceneOf('S10').transitions).toEqual([]);
  });

  it('所有条件跳转目标都存在', () => {
    for (const sceneId of configuredSceneIds) {
      const stepIds = new Set(stepsOf(sceneId).map((step) => step.id));
      for (const step of stepsOf(sceneId)) {
        if (step.kind !== 'choice') continue;
        for (const option of step.options) {
          if (option.goto) expect(stepIds.has(option.goto)).toBe(true);
        }
      }
    }
  });

  it('心声字幕覆盖起床、早间新闻后两句小字心声与手机退出', () => {
    const captions = configuredSceneIds.flatMap((sceneId) =>
      stepsOf(sceneId).filter((step) => step.kind === 'caption'),
    );
    expect(captions.map((step) => step.id)).toEqual([
      's1-caption',
      's1-news-thought-1',
      's1-news-thought-2',
      's2-caption',
    ]);
    const newsStep = stepById('S1', 's1-news');
    expect(newsStep).toMatchObject({
      kind: 'moment',
      moment: 'opening-news',
      effects: { set: { newsSeen: true } },
    });
    if (newsStep.kind === 'moment') {
      expect(newsStep.lines).toEqual([
        '……近日，多所学校提醒学生：转发未经核实的内容，同样可能伤害他人。',
        '某学生因一张被断章取义的照片，被围攻数日，最终关闭了账号，也不再出门。',
        '教育部门同时呼吁：面对网络争议多些宽容与理性核实，不做跟风伤害的推手，共同拒绝网络暴力。',
      ]);
    }
    expect(stepById('S1', 's1-news-thought-1')).toMatchObject({ text: '……又是这种新闻。', tone: 'subtle' });
    expect(stepById('S1', 's1-news-thought-2')).toMatchObject({ text: '……跟我没关系。', tone: 'subtle' });
  });

  it('S2 手机内容包含闹钟、3 条群消息、3:12 备忘录与妈妈 2 条消息 + 3 个回复', () => {
    const step = stepById('S2', 's2-phone');
    if (step.kind !== 'phone') throw new Error('s2-phone 不是 phone');

    expect(step.panel.lockTime).toBe('8:40');
    const group = step.panel.sections.find((section) => section.id === 'group');
    const memo = step.panel.sections.find((section) => section.id === 'memo');
    const mom = step.panel.sections.find((section) => section.id === 'mom');
    const alarm = step.panel.sections.find((section) => section.kind === 'alarm');
    if (
      group?.kind !== 'chat' ||
      memo?.kind !== 'memo' ||
      mom?.kind !== 'chat' ||
      alarm?.kind !== 'alarm'
    ) {
      throw new Error('S2 手机面板结构不完整');
    }

    expect(group.title).toBe('迎新群');
    expect(group.unread).toBe(3);
    expect(group.messages).toHaveLength(3);
    expect(memo.updatedAt).toBe('凌晨 3:12');
    expect(memo.items).toHaveLength(5);
    expect(mom.messages).toHaveLength(2);
    expect(mom.replyOptions?.map((option) => option.id)).toEqual([
      'mom-reply-rise',
      'mom-reply-leaving',
      'mom-reply-none',
    ]);
    expect(alarm.dismissed).toBe(true);
  });

  it('S1 / S3 预留文化衫与证件袋可选互动', () => {
    const s1Targets = (sceneOf('S1').triggers ?? []).map((trigger) => trigger.target);
    const s3Targets = (sceneOf('S3').triggers ?? []).map((trigger) => trigger.target);
    expect(s1Targets).toContain('culture-shirt');
    expect(s3Targets).toContain('culture-shirt');
    expect(s3Targets).toContain('document-bag');
  });

  it('S4 最多两次震动，忽略 +1、打开不增加污染值', () => {
    const triggers = sceneOf('S4').triggers ?? [];
    const ignore = triggers.filter((trigger) => trigger.action === 'ignore');
    const open = triggers.filter((trigger) => trigger.action === 'open');

    expect(ignore).toHaveLength(2);
    expect(open).toHaveLength(2);
    for (const trigger of ignore) {
      expect(trigger.effects?.add?.phoneIgnored).toBe(1);
    }
    for (const trigger of open) {
      expect(trigger.effects?.add?.phoneIgnored).toBeUndefined();
    }
  });

  it('S4 包含三处可选街道伏笔与扶起自行车交互，均不阻塞主线', () => {
    const triggers = sceneOf('S4').triggers ?? [];
    const byId = new Map(triggers.map((item) => [item.id, item]));
    expect(byId.get('s4-foreshadow-scroll')).toMatchObject({
      event: 'scene:gazeHotspot',
      target: 'convenience-scroller',
      reveal: { kind: 'inner', text: '……随手转一下而已。' },
    });
    expect(byId.get('s4-foreshadow-father')).toMatchObject({
      event: 'scene:gazeHotspot',
      target: 'father-suitcase',
      reveal: { kind: 'inner', text: '……爸爸都这样。' },
    });
    expect(byId.get('s4-foreshadow-bicycle')).toMatchObject({
      event: 'scene:gazeHotspot',
      target: 'fallen-bicycle',
      reveal: { kind: 'inner', text: '……他们为什么都在拍？' },
    });
    expect(byId.get('s4-help-passerby')).toMatchObject({
      event: 'scene:interact',
      target: 'help-passerby',
      effects: { set: { helpedPasserby: true } },
    });
  });

  it('S7 递笔 / 原因 / 药袋选项数量与效果符合设计', () => {
    const pen = choiceOf('S7', 's7-pen');
    const reason = choiceOf('S7', 's7-reason');
    const bag = choiceOf('S7', 's7-bag');
    const giveBack = choiceOf('S7', 's7-return-bag');

    expect(pen.options).toHaveLength(3);
    expect(reason.options).toHaveLength(3);
    expect(bag.options).toHaveLength(2);
    expect(giveBack.options).toHaveLength(3);

    const hand = pen.options.find((option) => option.id === 's7-pen-hand');
    expect(hand?.effects?.set?.handedPen).toBe(true);
    expect(hand?.effects?.add?.trust).toBe(1);

    const phone = pen.options.find((option) => option.id === 's7-pen-phone');
    expect(phone?.effects?.add?.phoneIgnored).toBe(1);

    for (const option of giveBack.options) {
      expect(option.effects?.add?.trust).toBe(1);
    }
  });

  it('S7 捡药袋与不捡药袋两条路径都推进到 S8', () => {
    const pick = optionOf('S7', 's7-bag', 's7-bag-pick');
    const leave = optionOf('S7', 's7-bag', 's7-bag-leave');
    expect(pick.goto).toBe('s7-return-bag');
    expect(leave.goto).toBe('s7-linxia-picks');
    expect(pick.effects?.set?.picked).toBe(true);

    const thanks = stepById('S7', 's7-thanks');
    const linxiaPicks = stepById('S7', 's7-linxia-picks');
    expect(thanks.when).toEqual({ key: 'picked', equals: true });
    expect(linxiaPicks.when).toEqual({ key: 'picked', equals: false });
    expect(sceneOf('S7').transitions).toEqual([{ to: 'S8' }]);
  });

  it('S7 药袋小票可触发“划掉原因”观察点', () => {
    const trigger = (sceneOf('S7').triggers ?? []).find(
      (item) => item.id === 's7-see-crossed-out',
    );
    expect(trigger?.event).toBe('scene:gazeHotspot');
    expect(trigger?.target).toBe('reason-form');
    expect(trigger?.effects?.set?.seenCrossedOut).toBe(true);
    expect(trigger?.reveal?.text).toContain('划掉');
  });

  it('S8 回头观察爸爸与三种同行选项', () => {
    const walk = choiceOf('S8', 's8-walk');
    expect(walk.options).toHaveLength(3);

    const trigger = (sceneOf('S8').triggers ?? []).find(
      (item) => item.id === 's8-see-father',
    );
    expect(trigger?.effects?.set?.seenFatherWatching).toBe(true);
  });

  it('S8 路边举手机观察独立记录状态，客观字幕不占心声额度', () => {
    const trigger = sceneOf('S8').triggers?.find((item) => item.target === 'phone-behind');
    expect(trigger).toBeDefined();
    expect(trigger).toMatchObject({
      id: 's8-phone-behind', event: 'scene:gazeHotspot', target: 'phone-behind',
      effects: { set: { noticedPhoneBehind: true }, log: { type: 'observe' } },
      reveal: { text: '路边有同学正举着手机拍林荫道，镜头晃过你们这边。' },
    });
    expect(trigger!.once).not.toBe(false);
    expect(trigger!.effects?.add?.harm).toBeUndefined();
  });

  it('S9 看 / 不看手机分别进入手机面板与系统收尾，日志保留并转场 S10', () => {
    expect(stepsOf('S9').map((step) => step.id)).toEqual([
      's9-choice',
      's9-phone',
      's9-end',
    ]);

    const look = optionOf('S9', 's9-choice', 's9-look');
    const ignore = optionOf('S9', 's9-choice', 's9-ignore');
    expect(look.goto).toBe('s9-phone');
    expect(ignore.goto).toBe('s9-end');
    expect(ignore.effects?.add?.phoneIgnored).toBe(1);

    const end = stepById('S9', 's9-end');
    expect(end.kind).toBe('system');
    expect(end.effects?.log).toEqual({ type: 'system', summary: '第一章 到校段结束。' });
    expect(sceneOf('S9').transitions).toEqual([{ to: 'S10' }]);
  });

  it('S9 群消息与合照资产、两个静默 reply 动作一一对应', () => {
    const step = stepById('S9', 's9-phone');
    if (step.kind !== 'phone') throw new Error('s9-phone 不是 phone');
    expect(step.panel.id).toBe('s9-phone');
    expect(step.panel.closeActionId).toBe('close');
    const chat = step.panel.sections.find((section) => section.kind === 'chat');
    const photo = step.panel.sections.find((section) => section.kind === 'photo');
    expect(chat).toBeDefined();
    expect(photo).toBeDefined();
    expect(chat!.title).toBe('迎新群');
    expect(chat!.unread).toBe(3);
    expect(chat!.messages.map(({ from, text }) => ({ from, text }))).toEqual([
      { from: '学姐', text: '开学第一天照片合集～' },
      { from: '群友', text: '我在左边！' },
      { from: '群友', text: '好多人啊。' },
    ]);
    expect(photo).toMatchObject({
      kind: 'photo', assetId: 'cg_s6_gate_panorama',
      noticeActionId: 's9-notice-photo', likeActionId: 's9-like-photo',
    });
    const triggers = sceneOf('S9').triggers;
    expect(triggers).toHaveLength(2);
    for (const [id, stateKey] of [
      [photo!.noticeActionId, 'noticedPhoto'],
      [photo!.likeActionId, 'likedPhoto'],
    ] as const) {
      const trigger = triggers!.find((item) => item.id === id);
      expect(trigger).toBeDefined();
      expect(trigger).toMatchObject({
        event: 'ui:phoneAction', target: step.panel.id, action: 'reply',
        effects: { set: { [stateKey]: true } },
      });
      expect(trigger!.once).not.toBe(false);
      expect(trigger!.reveal).toBeUndefined();
      expect(trigger!.effects?.add?.harm).toBeUndefined();
      expect(trigger!.effects?.set?.harm).toBeUndefined();
    }
  });

  it('S10 仅配置七行入学字幕，每行 2000ms、可跳过且不伪造 S11', () => {
    const scene = sceneOf('S10');
    expect(scene.sceneKey).toBe('stage2d');
    expect(scene.steps).toHaveLength(1);
    const step = stepById('S10', 's10-days');
    if (step.kind !== 'intertitle') throw new Error('s10-days 不是 intertitle');
    expect(step.lineDurationMs).toBe(2000);
    expect(step.skippable).toBe(true);
    expect(step.lines).toEqual([
      '入学第三天，你记住了室友的名字。',
      '第五天，班群里有了第一个表情包梗。',
      '食堂的酸辣粉，比想象中好吃。',
      '走廊里偶尔遇到她，点点头，她也点点头。',
      '一切都很顺利。',
      '顺利得你几乎忘了，那天台阶上的事。',
      '直到……',
    ]);
    expect(scene.transitions).toEqual([]);
    expect(chapter1.scenes.S11).toBeUndefined();
  });
});