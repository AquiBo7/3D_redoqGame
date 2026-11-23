import type { SceneId, StateSet } from './storySchema';

export type ChapterId = 'ch1' | 'ch2' | 'ch3' | 'ch4' | 'ch5';
export const CHAPTER_PRESETS: ReadonlyArray<{
  id: ChapterId; title: string; sceneId: SceneId; description: string; state: StateSet;
}> = [
  { id: 'ch1', title: '第一章 · 到校', sceneId: 'S1', description: '从清晨出发，亲眼看见台阶前后发生的事。', state: {} },
  { id: 'ch2', title: '第二章 · 被截取的一角', sceneId: 'S11', description: '预设：递过笔、留意过迟到表和合照，还没有回应帖子。', state: { newsSeen: true, trust: 1, handedPen: true, seenCrossedOut: true, noticedPhoto: true } },
  { id: 'ch3', title: '第三章 · 寻找发布者', sceneId: 'C1', description: '预设：选择等待、添加好友并听她说完；尚未获得留证许可。', state: { newsSeen: true, trust: 4, postChoice: 'wait', addedHer: true, listened: true, picked: true, seenCrossedOut: true, canteenSeen: 3 } },
  { id: 'ch4', title: '第四章 · 说完整', sceneId: 'D1', description: '预设：尊重她的意愿并获准留证，通过辨认找到发布者。', state: { newsSeen: true, trust: 7, picked: true, evidence: true, seenCrossedOut: true, noticedTyper: true, postChoice: 'wait', addedHer: true, listened: true, seat: 'beside', teacherTalked: true, tellTeacher: 'ask_her', visitedStairwell: true, askedAboutFather: true, foundAyuanWay: 'recognize', yuanState: 'unprepared', clues: ['迟到登记表', '橙色手机壳'] } },
  { id: 'ch5', title: '第五章 · 一个月后', sceneId: 'E1', description: '收尾预览：预设并肩补救、当面道歉与收到画；不解锁成就，不覆盖正式存档。', state: { newsSeen: true, trust: 7, ending: 'best', joined: true, apologized: true, postDeleted: true, route: 'team', helpedByAyuan: true, postChoice: 'wait', addedHer: true, listened: true, evidence: true, picked: true, seat: 'beside', teacherTalked: true, tellTeacher: 'ask_her', visitedStairwell: true, foundAyuanWay: 'recognize', yuanKeys: ['fact', 'empathy', 'company'] } },
];
