import { describe, expect, it } from 'vitest';
import { chapter1 } from './story.ch1';
import { SCENE_IDS } from './storySchema';
import type { SceneId, StoryChoice, StoryStep } from './storySchema';

function stepsOf(sceneId: SceneId): StoryStep[] {
  return chapter1.scenes[sceneId].steps;
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
  it('包含 S1–S9 全部场景，且 id 与键一致', () => {
    expect(Object.keys(chapter1.scenes).sort()).toEqual([...SCENE_IDS].sort());
    for (const sceneId of SCENE_IDS) {
      expect(chapter1.scenes[sceneId].id).toBe(sceneId);
    }
  });

  it('场景按 S1→S9 线性推进，S9 无后续转场', () => {
    for (let index = 0; index < SCENE_IDS.length - 1; index += 1) {
      const current = SCENE_IDS[index];
      const next = SCENE_IDS[index + 1];
      expect(chapter1.scenes[current].transitions).toEqual([{ to: next }]);
    }
    expect(chapter1.scenes.S9.transitions).toEqual([]);
  });

  it('所有条件跳转目标都存在', () => {
    for (const sceneId of SCENE_IDS) {
      const stepIds = new Set(stepsOf(sceneId).map((step) => step.id));
      for (const step of stepsOf(sceneId)) {
        if (step.kind !== 'choice') continue;
        for (const option of step.options) {
          if (option.goto) expect(stepIds.has(option.goto)).toBe(true);
        }
      }
    }
  });

  it('心声字幕不超过 3 处（当前为 2 处）', () => {
    const captions = SCENE_IDS.flatMap((sceneId) =>
      stepsOf(sceneId).filter((step) => step.kind === 'caption'),
    );
    expect(captions).toHaveLength(2);
    expect(captions.map((step) => step.id)).toEqual(['s1-caption', 's2-caption']);
    expect(captions.length).toBeLessThanOrEqual(3);
  });

  it('S2 手机内容包含闹钟、3 条群消息、3:12 备忘录与妈妈 2 条消息 + 3 个回复', () => {
    const step = stepById('S2', 's2-phone');
    if (step.kind !== 'phone') throw new Error('s2-phone 不是 phone');

    expect(step.panel.lockTime).toBe('8:47');
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
    const s1Targets = (chapter1.scenes.S1.triggers ?? []).map((trigger) => trigger.target);
    const s3Targets = (chapter1.scenes.S3.triggers ?? []).map((trigger) => trigger.target);
    expect(s1Targets).toContain('culture-shirt');
    expect(s3Targets).toContain('culture-shirt');
    expect(s3Targets).toContain('document-bag');
  });

  it('S4 最多两次震动，忽略 +1、打开不增加污染值', () => {
    const triggers = chapter1.scenes.S4.triggers ?? [];
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
    expect(chapter1.scenes.S7.transitions).toEqual([{ to: 'S8' }]);
  });

  it('S7 药袋小票可触发“划掉原因”观察点', () => {
    const trigger = (chapter1.scenes.S7.triggers ?? []).find(
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

    const trigger = (chapter1.scenes.S8.triggers ?? []).find(
      (item) => item.id === 's8-see-father',
    );
    expect(trigger?.effects?.set?.seenFatherWatching).toBe(true);
  });

  it('S9 看 / 不看手机分别进入手机面板与结尾，且结尾记录日志', () => {
    expect(chapter1.scenes.S9.steps.map((step) => step.id)).toEqual([
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
    expect(end.kind).toBe('end');
    expect(end.effects?.log).toEqual({ type: 'system', summary: '第一章 到校段结束。' });
  });
});