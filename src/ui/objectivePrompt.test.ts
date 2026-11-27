import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/eventBus';
import { createInitialStoryState } from '../core/state';
import { chapter1Objectives } from '../data/objectives.ch1';
import { initObjectivePrompt } from './objectivePrompt';

class ElementStub {
  hidden = false;
  textContent = '';
  className = '';
  children: ElementStub[] = [];
  classes = new Set<string>();
  styleProperties = new Map<string, string>();
  style = { setProperty: (name: string, value: string) => this.styleProperties.set(name, value) };
  classList = {
    add: (value: string) => this.classes.add(value),
    remove: (value: string) => this.classes.delete(value),
    contains: (value: string) => this.classes.has(value),
    toggle: (value: string, force?: boolean) => {
      const enabled = force ?? !this.classes.has(value);
      if (enabled) this.classes.add(value);
      else this.classes.delete(value);
      return enabled;
    },
  };
  append(...children: ElementStub[]): void { this.children.push(...children); }
  setAttribute(): void {}
  remove = vi.fn();
}

describe('主角行动提醒', () => {
  let bus: EventBus;
  let host: ElementStub;
  let dispose: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { createElement: () => new ElementStub() });
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    bus = new EventBus();
    host = new ElementStub();
    dispose = initObjectivePrompt(host as unknown as HTMLElement, bus);
  });
  afterEach(() => { dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('覆盖全部六个自由行动节点且不展示伤害值', () => {
    expect(Object.keys(chapter1Objectives)).toEqual(['S1', 'S3', 'S4', 'S5', 'S7', 'S8']);
    for (const [sceneId, objective] of Object.entries(chapter1Objectives)) {
      expect(objective.text.length).toBeGreaterThan(15);
      expect(objective.hint.length).toBeGreaterThan(10);
      expect(JSON.stringify(objective)).not.toMatch(/harm|伤害值|分数/);
      bus.emit('ui:showObjective', { sceneId: sceneId as keyof typeof chapter1Objectives });
      expect(host.children[0].children[0].textContent).toBe(`“${objective.text}”`);
      expect(host.children[1].textContent).toBe(objective.goal);
    }
  });
  it('4.2秒后字幕渐隐，当前目标仍保留', () => {
    bus.emit('ui:showObjective', { sceneId: 'S1' });
    const [root, chip] = host.children;
    vi.advanceTimersByTime(4199);
    expect(root.classes.has('is-fading')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(root.classes.has('is-fading')).toBe(true);
    expect(chip.hidden).toBe(false);
  });
  it('场景切换清空提示与旧计时器，手机打开不残留', () => {
    bus.emit('ui:showObjective', { sceneId: 'S1' });
    vi.advanceTimersByTime(3000);
    bus.emit('scene:transition', { fromSceneId: 'S1', toSceneId: 'S3', sceneKey: 'room', role: 'bystander', title: '' });
    expect(host.children.every((child) => child.hidden)).toBe(true);
    bus.emit('ui:showObjective', { sceneId: 'S3' });
    vi.advanceTimersByTime(1200);
    expect(host.children[0].classes.has('is-fading')).toBe(false);
    bus.emit('ui:showPhone', { stepId: 'test', panel: { id: 'test', closeActionId: 'close', sections: [] } });
    expect(host.children.every((child) => child.hidden)).toBe(true);
  });
  it('药袋捡起后目标清空，销毁后取消订阅', () => {
    bus.emit('ui:showObjective', { sceneId: 'S7' });
    bus.emit('state:changed', { sceneId: 'S7', role: 'bystander', state: { ...createInitialStoryState(), picked: true }, changedKeys: ['picked'] });
    expect(host.children.every((child) => child.hidden)).toBe(true);
    dispose();
    bus.emit('ui:showObjective', { sceneId: 'S8' });
    expect(host.children.every((child) => child.hidden)).toBe(true);
  });
  it('开场提醒常驻手机与房间内换场，重进不重复且新档重置', () => {
    const [root] = host.children;
    bus.emit('ui:showObjective', { sceneId: 'S1', persistent: true });
    expect(root.classes.has('is-opening')).toBe(true);
    vi.advanceTimersByTime(10000);
    expect(root.classes.has('is-fading')).toBe(false);
    bus.emit('scene:transition', { fromSceneId: 'S1', toSceneId: 'S2', sceneKey: 'room', role: 'bystander', title: '' });
    bus.emit('ui:showPhone', { stepId: 's2-phone', panel: { id: 'phone', closeActionId: 'close', sections: [] } });
    expect(root.hidden).toBe(false);
    bus.emit('scene:transition', { fromSceneId: 'S2', toSceneId: 'S3', sceneKey: 'room', role: 'bystander', title: '' });
    bus.emit('ui:showObjective', { sceneId: 'S3' });
    expect(root.hidden).toBe(false);
    bus.emit('ui:hideObjective');
    vi.advanceTimersByTime(200);
    expect(root.hidden).toBe(true);
    bus.emit('ui:showObjective', { sceneId: 'S1', persistent: true });
    expect(root.hidden).toBe(true);
    bus.emit('game:start');
    bus.emit('ui:showObjective', { sceneId: 'S1', persistent: true });
    expect(root.hidden).toBe(false);
  });
  it('倒计时环同步剩余秒数并在结束时隐藏', () => {
    bus.emit('ui:showObjective', { sceneId: 'S1', persistent: true });
    const root = host.children[0];
    const countdown = root.children[2];
    bus.emit('ui:objectiveCountdown', { remaining: 4.2, total: 5, active: true });
    expect(countdown.hidden).toBe(false);
    expect(countdown.children[0].textContent).toBe('5');
    expect(countdown.styleProperties.get('--objective-progress')).toBe(`${4.2 / 5 * 360}deg`);
    expect(root.classes.has('is-counting')).toBe(true);
    bus.emit('ui:objectiveCountdown', { remaining: 0, total: 5, active: false });
    expect(countdown.hidden).toBe(true);
    expect(root.classes.has('is-counting')).toBe(false);
  });
  it('常驻提醒按 0.2 秒淡出，普通提醒保留原 4.2 秒节奏', () => {
    bus.emit('ui:showObjective', { sceneId: 'S1', persistent: true });
    const [root] = host.children;
    bus.emit('ui:hideObjective');
    vi.advanceTimersByTime(199);
    expect(root.hidden).toBe(false);
    expect(root.classes.has('is-fading')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(root.hidden).toBe(true);
    bus.emit('ui:showObjective', { sceneId: 'S3' });
    vi.advanceTimersByTime(4199);
    expect(root.classes.has('is-fading')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(root.classes.has('is-fading')).toBe(true);
  });
});
