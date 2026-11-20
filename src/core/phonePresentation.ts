import { SCENE_IDS } from '../data/storySchema';
import type { ChapterStory, PhonePanel, PhoneSection, SceneId } from '../data/storySchema';
import { createEndingReview } from './endingReview';
import type { StoryState } from './state';

type Chat = Extract<PhoneSection, { kind: 'chat' }>;

function phoneSections(chapter: ChapterStory, sceneId: SceneId): PhoneSection[] {
  return (chapter.scenes[sceneId]?.steps ?? []).flatMap((step) => step.kind === 'phone' ? step.panel.sections : []);
}

function readOnly(section: PhoneSection): PhoneSection {
  if (section.kind === 'chat') return { ...section, unread: 0, replyOptions: undefined, messages: section.messages.map((message) => ({ ...message, unread: false })) };
  if (section.kind === 'photo') return { ...section, likeActionId: undefined, noticeActionId: undefined, hotspot: undefined };
  if (section.kind === 'post') return { ...section, previousStats: undefined, actions: undefined, comments: section.comments.map((comment) => ({ ...comment, actionId: undefined })) };
  return { ...section };
}

export function buildPhonePresentation(panel: PhonePanel, state: Readonly<StoryState>, sceneId: SceneId, chapter: ChapterStory): PhonePanel {
  const progressionScene = sceneId === 'E1' ? state.ending === 'joined' ? 'S14'
    : state.ending === 'bystander' ? 'C3' : state.ending === 'worst' ? 'D2' : sceneId : sceneId;
  const reached = (target: SceneId): boolean => SCENE_IDS.indexOf(progressionScene) >= SCENE_IDS.indexOf(target);
  const sections: PhoneSection[] = [...panel.sections];
  const add = (section: PhoneSection | undefined): void => {
    if (section && !sections.some((item) => item.id === section.id)) sections.push(section);
  };
  const activeChats = sections.filter((section): section is Chat => section.kind === 'chat');
  const startup = phoneSections(chapter, 'S2');
  const group = activeChats.find((section) => section.title.includes('迎新群'));
  const initialGroup = startup.find((section): section is Chat => section.kind === 'chat' && section.id === 'group');
  const laterGroup = phoneSections(chapter, 'S9').find((section): section is Chat => section.kind === 'chat');
  if (!group && initialGroup) {
    const source = reached('S9') && laterGroup ? laterGroup : initialGroup;
    add(readOnly(source));
  }
  const currentGroup = sections.find((section): section is Chat => section.kind === 'chat' && section.title.includes('迎新群'));
  if (currentGroup) {
    const photos = phoneSections(chapter, 'S9').filter((section) => section.kind === 'photo');
    if (reached('S9')) for (const photo of photos) add(readOnly(photo));
    const index = sections.indexOf(currentGroup);
    sections[index] = { ...currentGroup, title: '2026级新生迎新群', pinned: true,
      attachments: sections.filter((item) => item.kind === 'photo').map((item) => item.id) };
  }
  if (!activeChats.some((section) => section.title === '妈妈')) {
    const mom = startup.find((section): section is Chat => section.kind === 'chat' && section.title === '妈妈');
    if (mom) {
      const history = readOnly(mom) as Chat;
      if (state.momReply) history.messages.push({ id: 'mom-saved-reply', from: '我', text: state.momReply });
      add(history);
    }
  }
  add(startup.find((section) => section.kind === 'memo'));

  if (reached('S11')) {
    let wall = sections.filter((item) => item.kind === 'post');
    if (wall.length === 0) {
      const source = reached('D4') ? 'D4' : reached('C1') ? 'C1' : reached('S13') ? 'S13' : 'S11';
      for (const post of phoneSections(chapter, source).filter((item) => item.kind === 'post')) add(readOnly(post));
      wall = sections.filter((item) => item.kind === 'post');
    }
    if (state.postDeleted && !wall.some((item) => item.kind === 'post' && item.deleted)) {
      const deleted: PhoneSection = { kind: 'post', id: 'archive-deleted-original', title: '校园墙 · 原帖', publishedAt: '已由发布者删除', assetIds: [], views: 0, commentCount: 0,
        historicalTransfers: 214, text: '', comments: [], deleted: true };
      const firstPost = sections.findIndex((section) => section.kind === 'post');
      sections.splice(Math.max(0, firstPost), 0, deleted);
    }
    if (!activeChats.some((section) => section.title.includes('小陈'))) {
      const shared = wall.find((item) => item.kind === 'post' && !item.deleted);
      add({ kind: 'chat', id: 'archive-xiaochen', title: '室友小陈', unread: sceneId === 'S11' || sceneId === 'S13' ? 1 : 0,
        messages: [{ id: 'archive-xiaochen-message', from: '室友小陈', time: reached('S13') ? '12:18' : '21:14', text: reached('S13') ? '你快看帖子。' : '你看，有人被爸爸背着来报到。' }],
        attachments: shared ? [shared.id] : [] });
    }
  }
  if (reached('C5')) {
    if (!activeChats.some((section) => section.title.includes('管理员'))) {
      const admin = phoneSections(chapter, 'C5').find((section) => section.kind === 'chat');
      if (admin) add(readOnly(admin));
    }
    if (!sections.some((section) => section.kind === 'memo' && section.id.startsWith('c5-'))) {
      add({ kind: 'memo', id: 'archive-clues', title: '线索记录', updatedAt: '第二天 · 仅自己可见', items: [...state.clues] });
    }
  }
  if ((state.addedHer || state.postChoice === 'explain') && !activeChats.some((section) => section.title === '林夏')) {
    add({ kind: 'chat', id: 'archive-linxia', title: '林夏', unread: 0, messages: [
      { id: 'archive-linxia-hello', from: '林夏', text: state.postChoice === 'explain' ? '……谢谢。我是林夏。' : '嗯。……你不用特意告诉我。' },
    ] });
  }
  const currentChat = activeChats.find((section) => section.unread > 0);
  const shareChat = sections.find((section): section is Chat => section.kind === 'chat' && section.id === 'archive-xiaochen');
  const notification = currentChat
    ? { title: currentChat.title, text: currentChat.messages[currentChat.messages.length - 1]?.text ?? '有一条新消息', sectionId: currentChat.id }
    : (sceneId === 'S11' || sceneId === 'S13') && shareChat
      ? { title: shareChat.title, text: shareChat.messages[0].text, sectionId: shareChat.id }
      : undefined;
  return {
    ...panel,
    defaultTab: panel.sections.some((section) => section.kind === 'post') ? 'wall'
      : panel.sections.every((section) => section.kind === 'memo') ? 'notes' : 'messages',
    likedPhoto: state.likedPhoto, noticedPhoto: state.noticedPhoto,
    profile: { name: '2026级新生', account: 'freshman_2026', ...(sceneId === 'E1' && state.ending ? { drafts: createEndingReview(state).drafts } : {}) },
    notification,
    sections,
  };
}
