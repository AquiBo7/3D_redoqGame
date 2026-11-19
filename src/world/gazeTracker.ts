// world/gazeTracker.ts —— 注视蓄力状态机（纯逻辑，可单测）
// 只有屏幕中心持续对准同一热点满 dwellMs，才返回 completed = true。

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** 两个三维向量的夹角（度）；零向量视为 180° */
export function angleBetweenDeg(a: Vec3Like, b: Vec3Like): number {
  const lengthA = Math.hypot(a.x, a.y, a.z);
  const lengthB = Math.hypot(b.x, b.y, b.z);
  if (lengthA === 0 || lengthB === 0) return 180;

  const dot = (a.x * b.x + a.y * b.y + a.z * b.z) / (lengthA * lengthB);
  const clamped = Math.min(1, Math.max(-1, dot));
  return (Math.acos(clamped) * 180) / Math.PI;
}

export interface GazeUpdateResult {
  aimedId: string | null;
  progress: number;
  completed: boolean;
}

export class GazeDwellTracker {
  private readonly dwellMs: number;
  private currentId: string | null = null;
  private startedAt = 0;
  private completionEmitted = false;

  constructor(dwellMs: number) {
    this.dwellMs = Math.max(1, dwellMs);
  }

  /** 每帧调用；对准目标变化或移开时立即清零 */
  update(aimedId: string | null, nowMs: number): GazeUpdateResult {
    if (aimedId === null) {
      this.currentId = null;
      this.completionEmitted = false;
      return { aimedId: null, progress: 0, completed: false };
    }

    if (aimedId !== this.currentId) {
      this.currentId = aimedId;
      this.startedAt = nowMs;
      this.completionEmitted = false;
    }

    const elapsed = Math.max(0, nowMs - this.startedAt);
    const progress = Math.min(1, elapsed / this.dwellMs);
    const completed = progress >= 1 && !this.completionEmitted;
    if (completed) this.completionEmitted = true;

    return { aimedId, progress, completed };
  }

  reset(): void {
    this.currentId = null;
    this.startedAt = 0;
    this.completionEmitted = false;
  }
}
