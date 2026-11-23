// audio/audioManager.test.ts —— 静音持久化、Web Audio 门控与按声源步幅

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameEvents } from '../core/eventBus';

const store = new Map<string, string>();

function installStorage(): void {
  vi.stubGlobal('localStorage', {
    getItem: (key: string): string | null => store.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      store.set(key, value);
    },
  });
}

function audioParam() {
  return {
    setValueAtTime: vi.fn((_value: number, _time: number) => {}),
    exponentialRampToValueAtTime: vi.fn((_value: number, _time: number) => {}),
  };
}

class MockAudioContext {
  state: AudioContextState = 'running';
  sampleRate = 48000;
  currentTime = 10;
  destination = {};
  resume = vi.fn(async () => { this.state = 'running'; });
  createBuffer = vi.fn((_channels: number, length: number, _sampleRate: number) => ({
    length,
    getChannelData: vi.fn((_channel: number) => new Float32Array(length)),
  }));
  createBufferSource = vi.fn(() => ({
    buffer: null as { length: number } | null,
    playbackRate: audioParam(),
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }));
  createGain = vi.fn(() => ({ gain: audioParam(), connect: vi.fn() }));
  createBiquadFilter = vi.fn(() => ({ type: '', frequency: audioParam(), connect: vi.fn() }));
  createOscillator = vi.fn(() => ({
    type: '',
    frequency: audioParam(),
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }));
}

function motion(overrides: Partial<GameEvents['audio:motion']> = {}): GameEvents['audio:motion'] {
  return { sourceId: 'room:player', distance: 0.65, allow: true, gain: 1, surface: 'wood', ...overrides };
}

async function setupAudio() {
  vi.stubGlobal('AudioContext', MockAudioContext);
  const audio = await import('./audioManager');
  audio.unlockAudio();
  const ctx = audio.getAudioContext() as unknown as MockAudioContext;
  return { audio, ctx };
}

function expectFootsteps(ctx: MockAudioContext, count: number): void {
  const steps = ctx.createBufferSource.mock.results
    .map(({ value }) => value)
    .filter((source) => source.buffer && source.buffer.length > 1);
  expect(steps).toHaveLength(count);
  expect(ctx.createOscillator).toHaveBeenCalledTimes(count);
  for (const source of steps) {
    expect(source.start).toHaveBeenCalledOnce();
    expect(source.stop).toHaveBeenCalledOnce();
  }
}

function stepProfile(ctx: MockAudioContext, index: number) {
  return {
    master: ctx.createGain.mock.results[index * 3].value,
    noise: ctx.createGain.mock.results[index * 3 + 1].value,
    thud: ctx.createGain.mock.results[index * 3 + 2].value,
    filter: ctx.createBiquadFilter.mock.results[index].value,
    oscillator: ctx.createOscillator.mock.results[index].value,
  };
}

beforeEach(() => {
  store.clear();
  vi.resetModules();
  installStorage();
  vi.stubGlobal('AudioContext', undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('静音开关', () => {
  it('默认不静音；切换后写入 localStorage 并可被新会话读取', async () => {
    const audio = await import('./audioManager');
    expect(audio.isMuted()).toBe(false);

    expect(audio.toggleMuted()).toBe(true);
    expect(audio.isMuted()).toBe(true);
    expect(store.get('yitiaojietu:muted')).toBe('1');

    expect(audio.toggleMuted()).toBe(false);
    expect(store.get('yitiaojietu:muted')).toBe('0');

    store.set('yitiaojietu:muted', '1');
    vi.resetModules();
    const reloaded = await import('./audioManager');
    expect(reloaded.isMuted()).toBe(true);
  });

  it('localStorage 不可用时静默降级，不抛出异常', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('storage disabled'); },
      setItem: () => { throw new Error('storage disabled'); },
    });
    const audio = await import('./audioManager');
    expect(audio.isMuted()).toBe(false);
    expect(() => audio.setMuted(true)).not.toThrow();
    expect(audio.isMuted()).toBe(true);
  });

  it.each([false, true])('静音清空所有声源，解静音不补音（静音期间有运动：%s）', async (moving) => {
    const { audio, ctx } = await setupAudio();
    const sources = ['room:player', 'room:npc'];
    for (const sourceId of sources) audio.updateFootsteps(motion({ sourceId, distance: 0.6 }));
    audio.setMuted(true);
    if (moving) {
      for (const sourceId of sources) audio.updateFootsteps(motion({ sourceId, distance: 1.2 }));
    }
    audio.setMuted(false);
    for (const sourceId of sources) audio.updateFootsteps(motion({ sourceId, distance: 0.05 }));
    expectFootsteps(ctx, 0);
    for (const sourceId of sources) audio.updateFootsteps(motion({ sourceId, distance: 0.6 }));
    expectFootsteps(ctx, 2);
  });
});

describe('音频解锁与降级', () => {
  it('没有 AudioContext 时，解锁及播放接口全部静默 no-op', async () => {
    const audio = await import('./audioManager');
    expect(() => {
      audio.unlockAudio();
      audio.playAlarm();
      audio.playUiClick();
      audio.playPhoneChime();
      audio.updateFootsteps(motion());
      audio.resetFootsteps();
    }).not.toThrow();
  });

  it('已有 running 上下文但未经手势解锁时不播放、不累计步幅', async () => {
    vi.stubGlobal('AudioContext', MockAudioContext);
    const audio = await import('./audioManager');
    const ctx = audio.getAudioContext() as unknown as MockAudioContext;
    audio.playAlarm();
    audio.playUiClick();
    audio.playPhoneChime();
    audio.updateFootsteps(motion({ distance: 0.6 }));
    expect(ctx.createBufferSource).not.toHaveBeenCalled();
    expect(ctx.createOscillator).not.toHaveBeenCalled();
    expect(ctx.resume).not.toHaveBeenCalled();
    audio.unlockAudio();
    audio.updateFootsteps(motion({ distance: 0.05 }));
    expectFootsteps(ctx, 0);
    audio.updateFootsteps(motion({ distance: 0.6 }));
    expectFootsteps(ctx, 1);
  });

  it('手势 resume 尚未完成时不播放，也不会重复主动 resume', async () => {
    vi.stubGlobal('AudioContext', MockAudioContext);
    const audio = await import('./audioManager');
    const ctx = audio.getAudioContext() as unknown as MockAudioContext;
    ctx.state = 'suspended';
    ctx.resume.mockImplementation(async () => {});
    audio.unlockAudio();
    audio.updateFootsteps(motion({ distance: 0.6 }));
    audio.playAlarm();
    audio.playUiClick();
    audio.playPhoneChime();
    expectFootsteps(ctx, 0);
    expect(ctx.resume).toHaveBeenCalledOnce();
    ctx.state = 'running';
    audio.updateFootsteps(motion({ distance: 0.05 }));
    expectFootsteps(ctx, 0);
    audio.updateFootsteps(motion({ distance: 0.6 }));
    expectFootsteps(ctx, 1);
  });

  it.each(['suspended', 'closed'] as const)('%s 时不播放，丢弃该源步幅且不主动 resume', async (state) => {
    const { audio, ctx } = await setupAudio();
    audio.updateFootsteps(motion({ distance: 0.6 }));
    ctx.state = state;
    audio.updateFootsteps(motion());
    audio.playAlarm();
    audio.playUiClick();
    audio.playPhoneChime();
    expectFootsteps(ctx, 0);
    expect(ctx.resume).not.toHaveBeenCalled();
    if (state === 'suspended') {
      audio.unlockAudio();
      audio.updateFootsteps(motion({ distance: 0.05 }));
      expectFootsteps(ctx, 0);
      audio.updateFootsteps(motion({ distance: 0.6 }));
      expectFootsteps(ctx, 1);
      expect(ctx.resume).toHaveBeenCalledOnce();
    }
  });

  it('已解锁时手机、UI、闹钟仍可播放，静音后全部不播放', async () => {
    const { audio, ctx } = await setupAudio();
    audio.playPhoneChime();
    audio.playUiClick();
    audio.playAlarm();
    expect(ctx.createOscillator).toHaveBeenCalledTimes(10);
    audio.setMuted(true);
    audio.playPhoneChime();
    audio.playUiClick();
    audio.playAlarm();
    expect(ctx.createOscillator).toHaveBeenCalledTimes(10);
  });
});

describe('按实际距离累计脚步', () => {
  it.each([1, 30, 60, 120])('%i FPS 下走 6.5 米始终触发 10 步', async (fps) => {
    const { audio, ctx } = await setupAudio();
    const frames = fps * 5;
    for (let frame = 0; frame < frames; frame += 1) {
      audio.updateFootsteps(motion({ distance: 6.5 / frames }));
      ctx.currentTime += 1 / fps;
    }
    expectFootsteps(ctx, 10);
  });

  it('同帧跨越多个步幅时全部计入，保留不足一步的余量', async () => {
    const { audio, ctx } = await setupAudio();
    audio.updateFootsteps(motion({ distance: 2.1 }));
    expectFootsteps(ctx, 3);
    audio.updateFootsteps(motion({ distance: 0.5 }));
    expectFootsteps(ctx, 4);
  });

  it('多个声源独立累计，同一人物名在不同场景也不共享步幅', async () => {
    const { audio, ctx } = await setupAudio();
    const sources = ['room:player', 'room:npc', 'street:player'];
    for (const sourceId of sources) audio.updateFootsteps(motion({ sourceId, distance: 0.4 }));
    expectFootsteps(ctx, 0);
    for (let index = 0; index < sources.length; index += 1) {
      audio.updateFootsteps(motion({ sourceId: sources[index], distance: 0.25 }));
      expectFootsteps(ctx, index + 1);
    }
  });

  it.each([
    { distance: 0 },
    { allow: false },
    { gain: 0 },
  ])('停走或不可听 %j 时仅清除该源，重新开始无补音', async (stop) => {
    const { audio, ctx } = await setupAudio();
    audio.updateFootsteps(motion({ distance: 0.6 }));
    audio.updateFootsteps(motion({ sourceId: 'room:npc', distance: 0.6 }));
    audio.updateFootsteps(motion(stop));
    audio.updateFootsteps(motion({ distance: 0.05 }));
    expectFootsteps(ctx, 0);
    audio.updateFootsteps(motion({ sourceId: 'room:npc', distance: 0.05 }));
    expectFootsteps(ctx, 1);
    audio.updateFootsteps(motion({ distance: 0.6 }));
    expectFootsteps(ctx, 2);
  });

  it('暂停或场景重置清除全部声源，重新开始无补音', async () => {
    const { audio, ctx } = await setupAudio();
    const sources = ['room:player', 'room:npc'];
    for (const sourceId of sources) audio.updateFootsteps(motion({ sourceId, distance: 0.6 }));
    audio.resetFootsteps();
    for (const sourceId of sources) audio.updateFootsteps(motion({ sourceId, distance: 0.05 }));
    expectFootsteps(ctx, 0);
    for (const sourceId of sources) audio.updateFootsteps(motion({ sourceId, distance: 0.6 }));
    expectFootsteps(ctx, 2);
  });

  it.each([
    { distance: -1 }, { distance: NaN }, { distance: Infinity },
    { gain: -1 }, { gain: NaN }, { gain: Infinity },
  ])('无效位移或增益 %j 不播放也不污染后续累计', async (invalid) => {
    const { audio, ctx } = await setupAudio();
    audio.updateFootsteps(motion({ distance: 0.6 }));
    audio.updateFootsteps(motion(invalid));
    audio.updateFootsteps(motion({ distance: 0.05 }));
    expectFootsteps(ctx, 0);
    audio.updateFootsteps(motion({ distance: 0.6 }));
    expectFootsteps(ctx, 1);
  });
});

describe('脚步合成音色与距离衰减', () => {
  it('木地板比石面更低沉、尾音稍长，两者噪声与短击峰值有克制差异', async () => {
    const { audio, ctx } = await setupAudio();
    audio.updateFootsteps(motion({ sourceId: 'room:a', surface: 'wood' }));
    audio.updateFootsteps(motion({ sourceId: 'street:a', surface: 'stone' }));
    expectFootsteps(ctx, 2);
    const wood = stepProfile(ctx, 0);
    const stone = stepProfile(ctx, 1);
    expect(wood.filter.frequency.setValueAtTime.mock.calls[0][0])
      .toBeLessThan(stone.filter.frequency.setValueAtTime.mock.calls[0][0]);
    expect(wood.oscillator.frequency.setValueAtTime.mock.calls[0][0])
      .toBeLessThan(stone.oscillator.frequency.setValueAtTime.mock.calls[0][0]);
    for (const layer of ['noise', 'thud'] as const) {
      const woodRamp = wood[layer].gain.exponentialRampToValueAtTime.mock.calls;
      const stoneRamp = stone[layer].gain.exponentialRampToValueAtTime.mock.calls;
      expect(woodRamp[0][0]).toBeGreaterThan(stoneRamp[0][0]);
      expect(woodRamp[0][0]).toBeLessThan(0.1);
      expect(stoneRamp[0][0]).toBeGreaterThan(0.018);
      expect(woodRamp[1][1]).toBeGreaterThan(stoneRamp[1][1]);
    }
  });

  it.each(['wood', 'stone'] as const)('%s 的噪声和低频短击共同乘以听者距离 gain', async (surface) => {
    const { audio, ctx } = await setupAudio();
    audio.updateFootsteps(motion({ sourceId: 'room:near', surface, gain: 1 }));
    audio.updateFootsteps(motion({ sourceId: 'room:far', surface, gain: 0.25 }));
    const near = stepProfile(ctx, 0);
    const far = stepProfile(ctx, 1);
    expect(near.master.gain.setValueAtTime).toHaveBeenCalledWith(1, expect.any(Number));
    expect(far.master.gain.setValueAtTime).toHaveBeenCalledWith(0.25, expect.any(Number));
    for (const profile of [near, far]) {
      expect(profile.noise.connect).toHaveBeenCalledWith(profile.master);
      expect(profile.thud.connect).toHaveBeenCalledWith(profile.master);
      expect(profile.master.connect).toHaveBeenCalledWith(ctx.destination);
    }
    expect(near.noise.gain.exponentialRampToValueAtTime.mock.calls)
      .toEqual(far.noise.gain.exponentialRampToValueAtTime.mock.calls);
    expect(near.thud.gain.exponentialRampToValueAtTime.mock.calls)
      .toEqual(far.thud.gain.exponentialRampToValueAtTime.mock.calls);
  });

  it('gain 上限为 1，避免超范围输入放大脚步', async () => {
    const { audio, ctx } = await setupAudio();
    audio.updateFootsteps(motion({ gain: 3 }));
    expect(stepProfile(ctx, 0).master.gain.setValueAtTime).toHaveBeenCalledWith(1, expect.any(Number));
  });

  it('同声源左右脚轻微交替，其他声源和 reset 后从首步音色开始', async () => {
    const { audio, ctx } = await setupAudio();
    for (let step = 0; step < 3; step += 1) audio.updateFootsteps(motion());
    audio.updateFootsteps(motion({ sourceId: 'room:npc' }));
    audio.resetFootsteps();
    audio.updateFootsteps(motion());
    expectFootsteps(ctx, 5);
    const frequencies = ctx.createOscillator.mock.results
      .map(({ value }) => value.frequency.setValueAtTime.mock.calls[0][0]);
    expect(frequencies[1]).not.toBe(frequencies[0]);
    expect(Math.abs(frequencies[1] / frequencies[0] - 1)).toBeLessThan(0.1);
    expect(frequencies.slice(2)).toEqual([frequencies[0], frequencies[0], frequencies[0]]);
    expect(stepProfile(ctx, 0).noise.gain.exponentialRampToValueAtTime.mock.calls[0][0])
      .not.toBe(stepProfile(ctx, 1).noise.gain.exponentialRampToValueAtTime.mock.calls[0][0]);
  });
});

describe('小游戏消息弹出压迫音效', () => {
  it('未解锁或静音时不发声；解锁后随压迫强度提高音高并叠加低频短震，55ms 内自动节流防爆音', async () => {
    const { audio, ctx } = await setupAudio();
    audio.playMessagePop(0.1);
    expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
    const lowFreq = ctx.createOscillator.mock.results[0].value.frequency.setValueAtTime.mock.calls[0][0];

    // 55ms 内重复触发应被节流
    ctx.currentTime += 0.02;
    audio.playMessagePop(0.8);
    expect(ctx.createOscillator).toHaveBeenCalledTimes(2);

    // 超过 55ms 后高压阶段触发（主音 + 泛音 + 低频短震 = 3 个振荡器）
    ctx.currentTime += 0.06;
    audio.playMessagePop(0.9);
    expect(ctx.createOscillator).toHaveBeenCalledTimes(5);
    const highFreq = ctx.createOscillator.mock.results[2].value.frequency.setValueAtTime.mock.calls[0][0];
    expect(highFreq).toBeGreaterThan(lowFreq);

    // 静音后静默返回
    audio.setMuted(true);
    ctx.currentTime += 0.1;
    audio.playMessagePop(1);
    expect(ctx.createOscillator).toHaveBeenCalledTimes(5);
  });
});
