import type { SceneDef, SceneId } from './storySchema';

export const chapter3Scenes: Partial<Record<SceneId, SceneDef>> = {
  C1: {
    id: 'C1', sceneKey: 'stage2d', title: '第二天 · 清晨',
    stageNotes: ['宿舍的水声停了。小陈把手机扣在桌上，晨光穿过窗帘。'],
    steps: [
      { kind: 'intertitle', id: 'c1-morning', lines: ['第二天'], lineDurationMs: 2000 },
      { kind: 'phone', id: 'c1-post', panel: { id: 'c1-post', closeActionId: 'close', sections: [
        { kind: 'post', id: 'c1-wall', title: '校园墙', publishedAt: '昨天 8:52', assetIds: ['cg_s13_walk_together'],
          views: 48200, commentCount: 1360, text: '一夜过去，转发和评论还在增加。', comments: [] },
      ] } },
      { kind: 'dialogue', id: 'c1-guilt', when: { key: 'pointedOut', equals: true }, lines: [
        { speaker: 'xiaochen', text: '那个……我好像跟别人提过她是咱班的。' },
      ] },
      { kind: 'dialogue', id: 'c1-comfort', when: { key: 'pointedOut', equals: false }, lines: [
        { speaker: 'xiaochen', text: '你别理那些评论。' },
      ] },
      { kind: 'choice', id: 'c1-reply', options: [
        { id: 'c1-stop-spreading', text: '先别再往外说了。', effects: { log: { type: 'choice', summary: '请小陈不要继续传播。' } } },
        { id: 'c1-go-class', text: '……先去上课吧。', effects: { log: { type: 'choice', summary: '和小陈一起去上课。' } } },
      ] },
    ],
    transitions: [],
  },
};
