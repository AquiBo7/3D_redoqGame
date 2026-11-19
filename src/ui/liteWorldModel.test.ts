import { describe, expect, it } from 'vitest';
import { chapter1 } from '../data/story.ch1';
import { SCENE_IDS } from '../data/storySchema';
import type { SceneId } from '../data/storySchema';
import { buildLiteSceneModel, getLiteCutscene } from './liteWorldModel';

const sceneIds = Object.keys(chapter1.scenes) as SceneId[];

describe('liteWorldModel 降级场景契约', () => {
  it('S1–S9 均有标题与清晨舞台描写', () => {
    expect(sceneIds.sort()).toEqual([...SCENE_IDS].sort());
    for (const sceneId of sceneIds) {
      const model = buildLiteSceneModel(sceneId);
      expect(model.id).toBe(sceneId);
      expect(model.title).toBe(chapter1.scenes[sceneId].title);
      expect(model.stage.length).toBeGreaterThan(8);
    }
  });

  it('S1 枕边手机是主交互，另含窗外 / 文化衫 / 行李箱观察点', () => {
    const model = buildLiteSceneModel('S1');
    expect(model.actions[0]).toMatchObject({ kind: 'interact', id: 'phone' });
    const hotspots = model.actions.filter((action) => action.kind === 'hotspot');
    expect(hotspots.map((action) => action.id)).toEqual(
      expect.arrayContaining(['window', 'culture-shirt', 'suitcase']),
    );
    expect(model.onward).toBeNull();
  });

  it('S3 / S7 的可选交互覆盖文化衫、证件袋、药袋与原因栏', () => {
    const s3 = buildLiteSceneModel('S3');
    expect(s3.actions.map((action) => action.id)).toEqual(
      expect.arrayContaining(['culture-shirt', 'document-bag']),
    );

    const s7 = buildLiteSceneModel('S7');
    const s7Ids = s7.actions.map((action) => `${action.kind}:${action.id}`);
    expect(s7Ids).toEqual(expect.arrayContaining(['interact:medicine-bag', 'hotspot:reason-form']));
  });

  it('S4 / S5 / S8 的等待区域渲染为“下一区域”按钮', () => {
    expect(buildLiteSceneModel('S4').onward).toMatchObject({
      kind: 'zone',
      id: 'stairs',
    });
    expect(buildLiteSceneModel('S5').onward).toMatchObject({
      kind: 'zone',
      id: 'school-gate',
    });
    expect(buildLiteSceneModel('S8').onward).toMatchObject({
      kind: 'zone',
      id: 'building-entrance',
    });
    expect(buildLiteSceneModel('S5').actions.map((action) => action.id)).toEqual(
      expect.arrayContaining(['father-bags', 'handoff-moment', 'typer']),
    );
    expect(buildLiteSceneModel('S8').actions.map((action) => action.id)).toContain(
      'look-back-father',
    );
  });

  it('纯过场场景不产生多余按钮（S2 / S6 / S9）', () => {
    for (const sceneId of ['S2', 'S6', 'S9'] as SceneId[]) {
      const model = buildLiteSceneModel(sceneId);
      expect(model.actions).toHaveLength(0);
      expect(model.onward).toBeNull();
    }
  });

  it('剧本中的每个过场都有非空文字，未知 key 走通用兜底', () => {
    for (const sceneId of sceneIds) {
      for (const step of chapter1.scenes[sceneId].steps) {
        if (step.kind !== 'cutscene') continue;
        const text = getLiteCutscene(step.key);
        expect(text.title.length).toBeGreaterThan(0);
        expect(text.text.length).toBeGreaterThan(12);
      }
    }
    const fallback = getLiteCutscene('unknown-cutscene');
    expect(fallback.title).toBe('过场');
    expect(fallback.text.length).toBeGreaterThan(12);
  });

  it('动作卡片不重复，且文案不含危险/真实主体信息', () => {
    const texts: string[] = [];
    for (const sceneId of sceneIds) {
      const model = buildLiteSceneModel(sceneId);
      const keys = model.actions.map((action) => `${action.kind}:${action.id}`);
      expect(new Set(keys).size).toBe(keys.length);
      texts.push(model.stage);
      for (const action of model.actions) texts.push(action.label, action.hint);
      if (model.onward) texts.push(model.onward.label, model.onward.hint);
    }
    for (const sceneId of sceneIds) {
      for (const step of chapter1.scenes[sceneId].steps) {
        if (step.kind !== 'cutscene') continue;
        const text = getLiteCutscene(step.key);
        texts.push(text.title, text.text);
      }
    }

    const joined = texts.join('\n');
    for (const forbidden of ['harm', '伤害值', '分数', '微信', '抖音', '微博']) {
      expect(joined.includes(forbidden)).toBe(false);
    }
  });
});