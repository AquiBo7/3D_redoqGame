// scenes3d/characterAnimation.ts —— 角色骨骼动画控制器：AnimationMixer 封装 + 交叉淡入淡出 + 彻底清理
// 只操作 3D 表现层，不感知剧情状态；场景运行时装通过 tick(dt) 驱动。

import * as THREE from 'three';

/** 播放参数：timeScale < 1 表示放慢（虚弱 / 拘谨），loop=false 为一次性动作 */
export interface CharacterPlayOptions {
  timeScale?: number;
  /** 交叉淡入时长（秒），0 立即切换 */
  fadeIn?: number;
  loop?: boolean;
}

export function posePiggybackPassenger(actor: THREE.Object3D): boolean {
  const directions: Array<[string, string, THREE.Vector3]> = [
    ['L_Thigh', 'L_Calf', new THREE.Vector3(-0.38, -0.35, 0.85)],
    ['R_Thigh', 'R_Calf', new THREE.Vector3(0.38, -0.35, 0.85)],
    ['L_Calf', 'L_Foot', new THREE.Vector3(0, -0.95, -0.3)],
    ['R_Calf', 'R_Foot', new THREE.Vector3(0, -0.95, -0.3)],
    ['L_Upperarm', 'L_Forearm', new THREE.Vector3(-0.1, -0.18, 0.98)],
    ['R_Upperarm', 'R_Forearm', new THREE.Vector3(0.1, -0.18, 0.98)],
    ['L_Forearm', 'L_Hand', new THREE.Vector3(0.5, -0.15, 0.7)],
    ['R_Forearm', 'R_Hand', new THREE.Vector3(-0.5, -0.15, 0.7)],
  ];
  const links = directions.map(([name, tipName, direction]) => ({
    bone: actor.getObjectByName(name), tip: actor.getObjectByName(tipName), direction,
  }));
  if (links.some(({ bone, tip }) => !bone || !tip)) return false;

  for (const { bone, tip, direction } of links) {
    actor.updateWorldMatrix(true, true);
    const joint = bone!;
    const current = tip!.getWorldPosition(new THREE.Vector3())
      .sub(joint.getWorldPosition(new THREE.Vector3())).normalize();
    const target = direction.transformDirection(actor.matrixWorld);
    const rotation = new THREE.Quaternion().setFromUnitVectors(current, target)
      .multiply(joint.getWorldQuaternion(new THREE.Quaternion()));
    joint.quaternion.copy(joint.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
  }
  actor.updateWorldMatrix(true, true);
  return true;
}

/**
 * 生成一份按时间倒放的新剪辑：骨骼资产里只有"放下"类动作，倒放即"拾起"。
 * 走独立剪辑而不是负 timeScale，是为了让一次性动作的收尾姿态由剪辑首帧唯一确定。
 */
export function reverseClip(clip: THREE.AnimationClip, name: string): THREE.AnimationClip {
  const tracks = clip.tracks.map((track) => {
    const valueSize = track.getValueSize();
    const keyCount = track.values.length / valueSize;
    const times = new Float32Array(keyCount);
    const values = new Float32Array(track.values.length);
    for (let index = 0; index < keyCount; index += 1) {
      const source = keyCount - 1 - index;
      times[index] = clip.duration - track.times[source];
      for (let offset = 0; offset < valueSize; offset += 1) {
        values[index * valueSize + offset] = track.values[source * valueSize + offset];
      }
    }
    const TrackConstructor = track.constructor as new (
      trackName: string,
      keyTimes: Float32Array,
      keyValues: Float32Array,
      interpolation?: THREE.InterpolationModes,
    ) => THREE.KeyframeTrack;
    return new TrackConstructor(track.name, times, values, track.getInterpolation());
  });
  return new THREE.AnimationClip(name, clip.duration, tracks);
}

export interface CharacterAnimationController {
  /** 该角色是否自带动画剪辑 */
  hasAnimation(name: string): boolean;
  /** 播放指定剪辑；重播同一剪辑时只更新 timeScale，不会重置进度 */
  play(name: string, options?: CharacterPlayOptions): THREE.AnimationAction | null;
  /** 淡出当前动作（低于 0 视为立即停止） */
  stop(fadeOutSec?: number): void;
  update(dtSeconds: number): void;
  /** 停止全部动作并解除对骨骼根的缓存引用，避免切换场景后残留 */
  dispose(): void;
}

/**
 * 为一个已实例化的角色模型创建动画控制器。
 * root 必须是含骨骼层级的实例根（SkeletonUtils.clone 的产物），剪辑取 resources 缓存中的共享剪辑。
 */
export function createCharacterAnimation(
  root: THREE.Object3D,
  clips: readonly THREE.AnimationClip[],
): CharacterAnimationController {
  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const clip of clips) {
    actions.set(clip.name, mixer.clipAction(clip));
  }

  let current: THREE.AnimationAction | null = null;
  let disposed = false;

  return {
    hasAnimation(name) {
      return actions.has(name);
    },

    play(name, options = {}) {
      if (disposed) return null;
      const next = actions.get(name);
      if (!next) return null;

      const timeScale = options.timeScale ?? 1;
      const fadeIn = Math.max(0, options.fadeIn ?? 0);

      if (current === next) {
        next.setEffectiveTimeScale(timeScale);
        return next;
      }

      if (current) {
        if (fadeIn > 0) current.fadeOut(fadeIn);
        else current.stop();
      }

      const loop = options.loop ?? true;
      next.reset();
      next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
      next.clampWhenFinished = !loop;
      next.setEffectiveTimeScale(timeScale);
      next.setEffectiveWeight(1);
      if (fadeIn > 0) next.fadeIn(fadeIn);
      next.play();
      current = next;
      return next;
    },

    stop(fadeOutSec = 0) {
      if (!current) return;
      if (fadeOutSec > 0) current.fadeOut(fadeOutSec);
      else current.stop();
      current = null;
    },

    update(dtSeconds) {
      if (disposed || dtSeconds <= 0) return;
      mixer.update(dtSeconds);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      actions.clear();
      current = null;
    },
  };
}
