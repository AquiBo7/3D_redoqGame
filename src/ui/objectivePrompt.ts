import type { EventBus } from '../core/eventBus';
import { allObjectives } from '../data/objectives.all';
import type { SceneId } from '../data/storySchema';
import { createElement } from './uiDom';
import './objectivePrompt.css';

export function initObjectivePrompt(container: HTMLElement, bus: EventBus): () => void {
  const root = createElement('div', 'objective-prompt');
  root.hidden = true;
  root.setAttribute('role', 'status');
  const text = createElement('p', 'objective-prompt__text');
  const hint = createElement('p', 'objective-prompt__hint');
  const countdown = createElement('div', 'objective-prompt__countdown');
  countdown.hidden = true;
  countdown.setAttribute('aria-hidden', 'true');
  const countdownLabel = createElement('span', 'objective-prompt__countdown-label');
  countdown.append(countdownLabel);
  root.append(text, hint, countdown);
  const chip = createElement('div', 'objective-prompt__goal');
  chip.hidden = true;
  container.append(root, chip);
  let timer = 0;
  let fadeTimer = 0;
  let persistent = false;
  let openingShown = false;

  const clear = (): void => {
    window.clearTimeout(timer);
    window.clearTimeout(fadeTimer);
    timer = 0;
    fadeTimer = 0;
    persistent = false;
    root.hidden = true;
    chip.hidden = true;
    countdown.hidden = true;
    root.classList.remove('is-fading', 'is-opening', 'is-counting');
  };

  const fadeOut = (): void => {
    if (root.hidden) return;
    window.clearTimeout(fadeTimer);
    root.classList.add('is-fading');
    fadeTimer = window.setTimeout(() => {
      root.hidden = true;
      chip.hidden = true;
      countdown.hidden = true;
      persistent = false;
      root.classList.remove('is-fading', 'is-opening', 'is-counting');
    }, 200);
  };

  const show = (sceneId: SceneId, isPersistent = false): void => {
    const objective = allObjectives[sceneId];
    if (!objective) return;
    if (sceneId === 'S1' && isPersistent && openingShown) return;
    if (persistent && (sceneId === 'S2' || sceneId === 'S3')) {
      text.textContent = `“${objective.text}”`;
      hint.textContent = objective.hint;
      chip.textContent = objective.goal;
      return;
    }
    clear();
    if (sceneId === 'S1' && isPersistent) openingShown = true;
    persistent = isPersistent;
    text.textContent = `“${objective.text}”`;
    hint.textContent = objective.hint;
    chip.textContent = objective.goal;
    root.classList.toggle('is-opening', persistent);
    root.hidden = false;
    chip.hidden = false;
    if (!persistent) timer = window.setTimeout(() => root.classList.add('is-fading'), 4200);
  };

  const unsubscribers = [
    bus.on('ui:showObjective', ({ sceneId, persistent: isPersistent }) => show(sceneId, isPersistent)),
    bus.on('ui:hideObjective', fadeOut),
    bus.on('ui:objectiveCountdown', ({ remaining, total, active }) => {
      if (!persistent || !active) {
        countdown.hidden = true;
        countdown.classList.remove('is-urgent');
        root.classList.remove('is-counting');
        return;
      }
      countdown.hidden = false;
      countdown.classList.toggle('is-urgent', remaining <= 1.0 && remaining > 0);
      countdownLabel.textContent = String(Math.max(0, Math.ceil(remaining)));
      countdown.style.setProperty('--objective-progress', `${Math.max(0, Math.min(1, remaining / total)) * 360}deg`);
      root.classList.add('is-counting');
    }),
    bus.on('scene:transition', ({ toSceneId }) => {
      if (persistent && (toSceneId === 'S2' || toSceneId === 'S3')) return;
      clear();
    }),
    bus.on('ui:showPhone', () => {
      if (!persistent) clear();
    }),
    bus.on('game:chapterEnd', clear),
    bus.on('game:title', clear),
    bus.on('game:start', () => {
      openingShown = false;
      clear();
    }),
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
