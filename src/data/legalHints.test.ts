import { describe, expect, it } from 'vitest';
import { chapter1 } from './story';
import type { SceneDef, SceneId } from './storySchema';
import {
  LEGAL_HINTS, PERSPECTIVE_LABELS, PERSPECTIVE_TABS, getLegalHintByStepId,
} from './legalHints';

const LIMITS = { lawSummary: 60, hintPractice: 65, hintBeyondFrame: 55, perspective: 55 };

/** 真实主体、具体辱骂与自伤表述、以及任何评判性数值词汇都不允许出现在提示里。 */
const FORBIDDEN = /微信|微博|抖音|快手|小红书|QQ|贴吧|打分|得分|分数|正确率|对错|伤害值|信任值|信任度|harm|trust|yuanScore|自杀|自伤|滚出去|去死/;

function chars(text: string): number {
  return [...text].length;
}

function allTexts(): string[] {
  const texts: string[] = [];
  for (const hint of LEGAL_HINTS) {
    texts.push(hint.title, hint.lawRef, hint.lawSummary, hint.hintPractice, hint.hintBeyondFrame);
    texts.push(hint.perspectives.victim, hint.perspectives.bystander, hint.perspectives.perpetrator);
  }
  return texts;
}

describe('关键节点现实与法治提示', () => {
  it('六个节点齐全，字段非空且标识唯一', () => {
    expect(LEGAL_HINTS.map((hint) => hint.id)).toEqual(['N1', 'N2', 'N3', 'N4', 'N5', 'N6']);
    for (const hint of LEGAL_HINTS) {
      expect(hint.stepIds.length).toBeGreaterThan(0);
      expect(hint.scenes.length).toBeGreaterThan(0);
      for (const text of [hint.title, hint.lawRef, hint.lawSummary, hint.hintPractice, hint.hintBeyondFrame]) {
        expect(text.trim()).not.toBe('');
      }
      for (const perspective of Object.values(hint.perspectives)) expect(perspective.trim()).not.toBe('');
    }
  });

  it('每条文案都克制在字数上限内', () => {
    for (const hint of LEGAL_HINTS) {
      expect(chars(hint.lawSummary)).toBeLessThanOrEqual(LIMITS.lawSummary);
      expect(chars(hint.hintPractice)).toBeLessThanOrEqual(LIMITS.hintPractice);
      expect(chars(hint.hintBeyondFrame)).toBeLessThanOrEqual(LIMITS.hintBeyondFrame);
      for (const perspective of Object.values(hint.perspectives)) {
        expect(chars(perspective)).toBeLessThanOrEqual(LIMITS.perspective);
      }
    }
  });

  it('不出现真实主体、辱骂与自伤表述，也不出现评判性数值词汇', () => {
    for (const text of allTexts()) expect(FORBIDDEN.test(text)).toBe(false);
  });

  it('法条引用给出规范名称与条款号', () => {
    for (const hint of LEGAL_HINTS) {
      expect(hint.lawRef).toContain('《');
      expect(/第[〇零一二三四五六七八九十百千]+条|指导意见》/.test(hint.lawRef)).toBe(true);
    }
  });

  it('绑定的 stepId 都是剧本里真实存在的选项步骤', () => {
    const choiceStepIds = new Set<string>();
    for (const scene of Object.values(chapter1.scenes)) {
      for (const step of scene?.steps ?? []) if (step.kind === 'choice') choiceStepIds.add(step.id);
    }
    for (const hint of LEGAL_HINTS) {
      for (const stepId of hint.stepIds) expect(choiceStepIds.has(stepId)).toBe(true);
    }
  });

  it('scenes 与 stepId 所在场景一致，供结局页标注本局亲历', () => {
    const sceneOfStep = new Map<string, SceneId>();
    for (const [sceneId, scene] of Object.entries(chapter1.scenes) as Array<[SceneId, SceneDef | undefined]>) {
      for (const step of scene?.steps ?? []) sceneOfStep.set(step.id, sceneId);
    }
    for (const hint of LEGAL_HINTS) {
      for (const stepId of hint.stepIds) expect(hint.scenes).toContain(sceneOfStep.get(stepId) as SceneId);
    }
  });

  it('getLegalHintByStepId 可查全部节点，普通选项查不到', () => {
    for (const hint of LEGAL_HINTS) {
      for (const stepId of hint.stepIds) expect(getLegalHintByStepId(stepId)?.id).toBe(hint.id);
    }
    expect(getLegalHintByStepId('d1-approach')).toBeUndefined();
    expect(getLegalHintByStepId('')).toBeUndefined();
  });

  it('三视角标签与筛选页签一一对应', () => {
    expect(Object.keys(PERSPECTIVE_LABELS).sort()).toEqual(['bystander', 'perpetrator', 'victim']);
    expect(PERSPECTIVE_TABS.map((tab) => tab.key)).toEqual(['all', 'victim', 'bystander', 'perpetrator']);
    for (const tab of PERSPECTIVE_TABS) {
      if (tab.key === 'all') continue;
      expect(PERSPECTIVE_LABELS[tab.key]).toBeTruthy();
    }
  });
});
