import type { EventBus } from '../core/eventBus';
import { chapter1Objectives } from '../data/objectives.ch1';
import type { SceneId } from '../data/storySchema';
import { createElement } from './uiDom';
import './objectivePrompt.css';

export function initObjectivePrompt(container: HTMLElement, bus: EventBus): () => void {
  const root = createElement('div', 'objective-prompt');
  root.hidden = true;
  root.setAttribute('role', 'status');
  const text = createElement('p', 'objective-prompt__text');
  const hint = createElement('p', 'objective-prompt__hint');
  root.append(text, hint);
  const chip = createElement('div', 'objective-prompt__goal');
  chip.hidden = true;
  container.append(root, chip);
  let timer = 0;
  const clear = (): void => {
    window.clearTimeout(timer);
    root.hidden = true;
    chip.hidden = true;
  };
  const show = (sceneId: SceneId): void => {
    const objective = chapter1Objectives[sceneId];
    if (!objective) return;
    clear();
    text.textContent = `“${objective.text}”`;
    hint.textContent = objective.hint;
    chip.textContent = objective.goal;
    root.classList.remove('is-fading');
    root.hidden = false;
    chip.hidden = false;
    timer = window.setTimeout(() => root.classList.add('is-fading'), 4200);
  };
  const unsubscribers = [
    bus.on('ui:showObjective', ({ sceneId }) => show(sceneId)),
    bus.on('scene:transition', clear),
    bus.on('ui:showPhone', clear),
    bus.on('game:chapterEnd', clear),
    bus.on('state:changed', ({ sceneId, state }) => {
      if (sceneId === 'S7' && state.picked) clear();
    }),
  ];
  return () => {
    clear();
    for (const unsubscribe of unsubscribers) unsubscribe();
    root.remove();
    chip.remove();
  };
}
