import { describe, expect, it } from 'vitest';
import { chapter1 } from '../data/story';
import type { PhonePanel, PhoneSection, SceneId } from '../data/storySchema';
import { buildPhonePresentation } from './phonePresentation';
import { createInitialStoryState } from './state';
import { EventBus } from './eventBus';
import { SceneMachine } from './sceneMachine';

function panelAt(sceneId: SceneId, id?: string): PhonePanel {
  const step = chapter1.scenes[sceneId]?.steps.find((item) => item.kind === 'phone' && (!id || item.id === id));
  if (step?.kind !== 'phone') throw new Error(sceneId);
  return step.panel;
}
const byKind = <K extends PhoneSection['kind']>(panel: PhonePanel, kind: K) => panel.sections.filter((section): section is Extract<PhoneSection, { kind: K }> => section.kind === kind);

describe('四Tab手机的剧情展示投影', () => {
  it('S2空墙、置顶群、妈妈与新生攻略，保留当前真实回复选项', () => {
    const source = panelAt('S2');
    const result = buildPhonePresentation(source, createInitialStoryState(), 'S2', chapter1);
    expect(result.defaultTab).toBe('messages');
    expect(byKind(result, 'post')).toHaveLength(0);
    expect(byKind(result, 'chat').find((chat) => chat.pinned)?.title).toBe('2026级新生迎新群');
    expect(byKind(result, 'chat').find((chat) => chat.id === 'mom')?.replyOptions).toBe(byKind(source, 'chat').find((chat) => chat.id === 'mom')?.replyOptions);
    expect(result.profile?.drafts).toBeUndefined();
    expect(byKind(result, 'memo')[0].items).toHaveLength(5);
  });

  it('S9群照片附件保留观察/点赞ID和v0.6热区，动作经真实core生效', () => {
    const bus = new EventBus();
    let shown: PhonePanel | null = null;
    bus.on('ui:showPhone', ({ panel }) => { shown = panel; });
    const machine = new SceneMachine({ bus, chapter: chapter1 });
    machine.startNew('S9', 'bystander');
    machine.onChooseOption('s9-choice', 's9-look');
    const result = shown as unknown as PhonePanel;
    const photo = byKind(result, 'photo')[0];
    expect(photo.hotspot).toEqual({ x: 69, y: 37, width: 16, height: 38 });
    expect(byKind(result, 'chat').find((chat) => chat.pinned)?.attachments).toContain(photo.id);
    machine.onPhoneAction(result.id, 'reply', photo.noticeActionId);
    machine.onPhoneAction(result.id, 'reply', photo.likeActionId);
    expect(machine.getState()).toMatchObject({ noticedPhoto: true, likedPhoto: true });
    expect(byKind(result, 'chat').find((chat) => chat.title === '妈妈')?.replyOptions).toBeUndefined();
  });

  it.each(['S11', 'S13'] as const)('%s室友分享卡链接当前帖子，保持原有评论协议', (sceneId) => {
    const source = panelAt(sceneId);
    const result = buildPhonePresentation(source, createInitialStoryState(), sceneId, chapter1);
    expect(result.defaultTab).toBe('wall');
    const post = byKind(source, 'post')[0];
    expect(result.sections).toContain(post);
    expect(byKind(result, 'chat').find((chat) => chat.title === '室友小陈')?.attachments).toContain(post.id);
    expect(result.notification?.title).toBe('室友小陈');
    expect(byKind(result, 'post')[0].assetIds).toHaveLength(sceneId === 'S11' ? 1 : 2);
  });

  it('C5显示实际线索和管理员，只读历史不携带旧阶段动作', () => {
    const state = { ...createInitialStoryState(), clues: ['实际见到的线索'], noticedTyper: false };
    const result = buildPhonePresentation(panelAt('C5', 'c5-admin'), state, 'C5', chapter1);
    expect(byKind(result, 'memo').find((memo) => memo.id === 'archive-clues')?.items).toEqual(state.clues);
    expect(byKind(result, 'chat').some((chat) => chat.title === '校园墙管理员')).toBe(true);
    expect(byKind(result, 'photo')[0].noticeActionId).toBeUndefined();
    expect(byKind(result, 'post').every((post) => !post.actions && post.comments.every((comment) => !comment.actionId))).toBe(true);
  });

  it('D4保留214次历史转发与搬运帖，非零转发不冒充清理完成', () => {
    const state = { ...createInitialStoryState(), postDeleted: true };
    const result = buildPhonePresentation(panelAt('D4'), state, 'D4', chapter1);
    expect(byKind(result, 'post')[0]).toMatchObject({ deleted: true, historicalTransfers: 214 });
    expect(byKind(result, 'post')[1]).toMatchObject({ id: 'd4-repost', views: 52680 });
  });

  it.each([0, 1, 3, 5, 7])('E1草稿阈值沿用GDD，trust=%s仅用于core投影', (trust) => {
    const state = { ...createInitialStoryState(), trust, ending: 'best' as const };
    const result = buildPhonePresentation({ id: 'ending-archive', closeActionId: 'close', sections: [] }, state, 'E1', chapter1);
    expect(result.profile?.drafts?.map((draft) => draft.unlocked)).toEqual([1, 3, 5, 7].map((threshold) => trust >= threshold));
    expect(result.profile?.name).toBe('2026级新生');
    expect('trust' in result).toBe(false);
  });

  it.each(['joined', 'bystander', 'worst'] as const)('早期%s结局不会伪造原帖已删除或后续线索', (ending) => {
    const result = buildPhonePresentation({ id: 'ending-archive', closeActionId: 'close', sections: [] }, { ...createInitialStoryState(), ending }, 'E1', chapter1);
    expect(byKind(result, 'post').some((post) => post.deleted || post.id === 'd4-repost')).toBe(false);
    if (ending !== 'worst') expect(byKind(result, 'chat').some((chat) => chat.title === '校园墙管理员')).toBe(false);
  });

  it('不改原始剧本和状态，不生成未获得的林夏好友消息', () => {
    const source = panelAt('S13');
    const state = createInitialStoryState();
    const before = JSON.stringify({ source, state });
    const result = buildPhonePresentation(source, state, 'S13', chapter1);
    expect(byKind(result, 'chat').some((chat) => chat.title === '林夏')).toBe(false);
    expect(JSON.stringify({ source, state })).toBe(before);
  });
});
