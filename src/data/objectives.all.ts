import type { SceneId } from './storySchema';
import { chapter1Objectives } from './objectives.ch1';

export interface SceneObjective {
  text: string;
  hint: string;
  goal: string;
}

/** 全章节任务指引：保留第一章原配置，补齐第二、三、四章探索目标 */
export const allObjectives: Partial<Record<SceneId, SceneObjective>> = {
  ...chapter1Objectives,
  S12: {
    text: '找三号窗口打饭……大家好像都在低头看手机。',
    hint: '在食堂大厅找到三号窗口打饭（可走近旁边的人听他们在说什么）',
    goal: '去三号窗口打饭',
  },
  C2: {
    text: '林夏正在教室里',
    hint: '先看看教室和她所在的位置',
    goal: '在教室选一个座位',
  },
  C3: {
    text: '先去一楼辅导员办公室找周老师聊聊吧。',
    hint: '沿教学楼东侧楼梯下到一楼，走进辅导员办公室到周老师桌前按 E 或点击交谈',
    goal: '下楼去一楼辅导员办公室',
  },
  C4: {
    text: '楼梯间拐角那边好像有声音……过去看看吧。',
    hint: '沿楼梯走上拐角休息平台',
    goal: '前往楼梯间拐角平台',
  },
  C5: {
    text: '去二楼走廊看看，也许能找到发帖的人，或者换别的办法。',
    hint: '走近走廊里的同学按 E 或点击询问，也可点击“换个办法”',
    goal: '寻找发帖的人',
  },
  C6: {
    text: '夜色已深，去楼梯间再看一眼。',
    hint: '前往教学楼楼梯间拐角',
    goal: '前往楼梯间',
  },
  D1: {
    text: '放学了，阿远好像在教学楼侧楼梯平台上。',
    hint: '走上教学楼侧楼梯平台找到阿远',
    goal: '去侧楼梯平台找阿远',
  },
  D6: {
    text: '去走廊找林夏，把话跟她说清楚。',
    hint: '走到走廊里林夏所在的位置',
    goal: '去走廊找林夏',
  },
};
