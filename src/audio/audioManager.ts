// audio/audioManager.ts —— 轻量叙事音频：Web Audio 合成，无外部音频文件
// 职责：首次手势解锁、静音开关持久化、手机提示音、清晨闹钟、脚步、界面点击反馈。
// 所有播放接口在无 AudioContext / 静音 / 音频不可用时静默返回，不产生任何浏览器警告。

const MUTE_STORAGE_KEY = 'yitiaojietu:muted';

let context: AudioContext | null = null;
let mutedCache: boolean | null = null;
let noiseBuffer: AudioBuffer | null = null;
let noiseBufferOwner: AudioContext | null = null;
/** 已累计的步行距离（米），用于按步幅触发脚步音 */
let footstepDistance = 0;

function safeStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

/** 读取静音状态（首次读取后缓存，localStorage 不可用时默认不静音） */
export function isMuted(): boolean {
  if (mutedCache === null) {
    const storage = safeStorage();
    let stored: string | null = null;
    try {
      stored = storage?.getItem(MUTE_STORAGE_KEY) ?? null;
    } catch {
      stored = null;
    }
    mutedCache = stored === '1';
  }
  return mutedCache;
}

/** 设置静音并持久化（隐私模式等写入失败时仅本次会话生效） */
export function setMuted(muted: boolean): void {
  mutedCache = muted;
  try {
    safeStorage()?.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // 存储被禁用时忽略，保持会话内状态
  }
  if (muted) footstepDistance = 0;
}

/** 切换静音，返回切换后的状态 */
export function toggleMuted(): boolean {
  setMuted(!isMuted());
  return isMuted();
}

/** 获取全局唯一的 AudioContext（懒创建，仅应在用户手势中调用） */
export function getAudioContext(): AudioContext {
  context ??= new AudioContext();
  return context;
}

/**
 * 解锁浏览器音频，必须在用户点击等手势回调中调用。
 * iOS Safari 最稳妥的做法：创建并 resume AudioContext 后，
 * 再播放一个 1 采样点的静音 AudioBuffer。
 */
export function unlockAudio(): void {
  const ctx = getAudioContext();

  // 部分浏览器在权限受限时 resume 会失败，静默忽略即可，不影响游戏
  ctx.resume().catch(() => {});

  const silentBuffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = silentBuffer;
  source.connect(ctx.destination);
  source.start(0);
}

/** 可播放的上下文：静音 / 未解锁 / 已关闭时返回 null，并在挂起时尝试恢复 */
function playbackContext(): AudioContext | null {
  if (isMuted()) return null;
  if (!context || context.state === 'closed') return null;
  if (context.state === 'suspended') context.resume().catch(() => {});
  return context;
}

function softBeep(
  ctx: AudioContext,
  startAt: number,
  frequency: number,
  duration: number,
  peakGain: number,
  type: OscillatorType = 'sine',
): void {
  const oscillator = ctx.createOscillator();
  const envelope = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  envelope.gain.setValueAtTime(0.0001, startAt);
  envelope.gain.exponentialRampToValueAtTime(Math.max(peakGain, 0.0002), startAt + 0.03);
  envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(envelope);
  envelope.connect(ctx.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.03);
}

/**
 * 手机提示音：两段短促的清脆双音。
 * 仅在已有 AudioContext 时播放，避免在非用户手势中新建上下文触发浏览器警告。
 */
export function playPhoneChime(): void {
  const ctx = playbackContext();
  if (!ctx) return;

  try {
    const startAt = ctx.currentTime + 0.01;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, startAt);
    master.gain.exponentialRampToValueAtTime(0.075, startAt + 0.015);
    master.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.5);
    master.connect(ctx.destination);

    const notes: Array<[frequency: number, delay: number, duration: number]> = [
      [880, 0, 0.18],
      [1318.5, 0.13, 0.26],
    ];

    for (const [frequency, delay, duration] of notes) {
      const noteStart = startAt + delay;
      const oscillator = ctx.createOscillator();
      const envelope = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, noteStart);
      envelope.gain.setValueAtTime(0.0001, noteStart);
      envelope.gain.exponentialRampToValueAtTime(0.9, noteStart + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, noteStart + duration);
      oscillator.connect(envelope);
      envelope.connect(master);
      oscillator.start(noteStart);
      oscillator.stop(noteStart + duration + 0.02);
    }
  } catch {
    // 音频不可用时静默降级，不影响剧情与界面
  }
}

/** 清晨闹钟：三声轻柔电子提示音，音量逐声减弱（S1 起床） */
export function playAlarm(): void {
  const ctx = playbackContext();
  if (!ctx) return;

  try {
    const startAt = ctx.currentTime + 0.05;
    const beeps: Array<[delay: number, gain: number]> = [
      [0, 0.05],
      [0.42, 0.038],
      [0.84, 0.028],
    ];
    for (const [delay, gain] of beeps) {
      softBeep(ctx, startAt + delay, 784, 0.26, gain, 'sine');
      softBeep(ctx, startAt + delay, 1174.7, 0.2, gain * 0.35, 'triangle');
    }
  } catch {
    // 静默降级
  }
}

/** 界面按钮 / 选项点击的克制反馈音 */
export function playUiClick(): void {
  const ctx = playbackContext();
  if (!ctx) return;

  try {
    const startAt = ctx.currentTime + 0.005;
    softBeep(ctx, startAt, 1046.5, 0.055, 0.022, 'sine');
    softBeep(ctx, startAt + 0.02, 1396.9, 0.045, 0.012, 'sine');
  } catch {
    // 静默降级
  }
}

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBufferOwner === ctx) return noiseBuffer;
  const length = Math.max(1, Math.floor(ctx.sampleRate * 0.12));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    // 简单衰减噪声，听感接近布料/鞋底摩擦，不用任何外部素材
    const decay = 1 - i / length;
    data[i] = (Math.random() * 2 - 1) * decay * decay;
  }
  noiseBuffer = buffer;
  noiseBufferOwner = ctx;
  return buffer;
}

function playFootstepSound(ctx: AudioContext): void {
  try {
    const startAt = ctx.currentTime + 0.005;

    const source = ctx.createBufferSource();
    source.buffer = getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(340, startAt);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, startAt);
    envelope.gain.exponentialRampToValueAtTime(0.018, startAt + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.09);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(ctx.destination);
    source.start(startAt);
    source.stop(startAt + 0.11);

    softBeep(ctx, startAt, 92, 0.08, 0.016, 'sine');
  } catch {
    // 静默降级
  }
}

/**
 * 按实际移动速度累积步幅并播放极轻脚步（S4 / S5 / S8 步行段）。
 * allow=false（非步行场景 / 输入被锁 / 停止移动）时重置累积，避免停下又起步时补音。
 */
export function updateFootsteps(dt: number, speedMps: number, allow: boolean): void {
  if (!allow || speedMps <= 0.15 || isMuted() || !context) {
    footstepDistance = 0;
    return;
  }
  const stepLength = 0.78;
  footstepDistance += dt * Math.min(speedMps, 6);
  if (footstepDistance < stepLength) return;
  footstepDistance -= stepLength;
  const ctx = playbackContext();
  if (ctx) playFootstepSound(ctx);
}