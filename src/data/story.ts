import { chapter1 as arrival } from './story.ch1';
import { chapter2Scenes } from './story.ch2';
import { chapter3Scenes } from './story.ch3';
import { endingScene } from './story.ending';
import type { ChapterStory } from './storySchema';

export const chapter1: ChapterStory = {
  ...arrival,
  scenes: {
    ...arrival.scenes,
    S10: { ...arrival.scenes.S10!, transitions: [{ to: 'S11' }] },
    ...chapter2Scenes,
    ...chapter3Scenes,
    E1: endingScene,
  },
};
