import type { StoryVariables } from './storySchema';

export type EndingId = NonNullable<StoryVariables['ending']>;
export const ACHIEVEMENTS = [
  { id: 'A1', ending: 'best', title: '完整的那一天', description: '你让她的故事，不止停留在被截取的一角。', color: 'gold', status: '已完成' },
  { id: 'A2', ending: 'middle', title: '未完成的画', description: '帖子删了，事情却没有说完整。', color: 'silver', status: '已完成' },
  { id: 'A3', ending: 'worst', title: '另一种围观', description: '为她出头，也可能把另一个人推出来。', color: 'silver', status: '已记录' },
  { id: 'A4', ending: 'bystander', title: '沉默的席位', description: '你什么都没做，她什么都没等到。', color: 'silver', status: '已记录' },
  { id: 'A5', ending: 'joined', title: '随手一笑', description: '一句玩笑，也是在场。', color: 'silver', status: '已记录' },
  { id: 'A6', ending: null, title: '看见', description: '你从每个角落，都看过一遍。', color: 'gold', status: '已完成' },
] as const;
