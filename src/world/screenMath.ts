// world/screenMath.ts —— 目标指引点的屏幕投影与边缘吸附（纯函数，可单测）
// 输入屏幕坐标与方向，输出贴边位置与箭头角度；底部预留安全区。

export interface GuidePlacementInput {
  /** 目标在屏幕上的普通投影坐标（像素） */
  screenX: number;
  screenY: number;
  /** 目标是否位于相机身后 */
  behind: boolean;
  /** 屏幕方向：向右为正，向下为正；behind 时由相机空间方向换算得到 */
  directionX: number;
  directionY: number;
  width: number;
  height: number;
  marginPx?: number;
  bottomSafePx?: number;
}

export interface GuidePlacement {
  x: number;
  y: number;
  /** true 表示已吸附到屏幕边缘，应显示箭头 */
  clamped: boolean;
  /** 箭头朝向（弧度），仅 clamped 时有意义 */
  angleRad: number;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function computeGuidePlacement(input: GuidePlacementInput): GuidePlacement {
  const margin = input.marginPx ?? 28;
  const bottomSafe = input.bottomSafePx ?? 56;

  const left = margin;
  const right = Math.max(left, input.width - margin);
  const top = margin;
  const bottom = Math.max(top, input.height - bottomSafe);

  const insideViewport =
    !input.behind &&
    input.screenX >= left &&
    input.screenX <= right &&
    input.screenY >= top &&
    input.screenY <= bottom;

  if (insideViewport) {
    return { x: input.screenX, y: input.screenY, clamped: false, angleRad: 0 };
  }

  let directionX = input.directionX;
  let directionY = input.directionY;
  const length = Math.hypot(directionX, directionY);

  if (!Number.isFinite(length) || length < 1e-6) {
    directionX = 0;
    directionY = -1;
  } else {
    directionX /= length;
    directionY /= length;
  }

  const centerX = input.width / 2;
  const centerY = input.height / 2;

  let distance = Number.POSITIVE_INFINITY;
  if (directionX > 0) {
    distance = Math.min(distance, (right - centerX) / directionX);
  } else if (directionX < 0) {
    distance = Math.min(distance, (left - centerX) / directionX);
  }
  if (directionY > 0) {
    distance = Math.min(distance, (bottom - centerY) / directionY);
  } else if (directionY < 0) {
    distance = Math.min(distance, (top - centerY) / directionY);
  }
  if (!Number.isFinite(distance) || distance < 0) distance = 0;

  return {
    x: clamp(centerX + directionX * distance, left, right),
    y: clamp(centerY + directionY * distance, top, bottom),
    clamped: true,
    angleRad: Math.atan2(directionY, directionX),
  };
}
