// scenes3d/shared.ts —— 灰盒场景共用工厂：哑光几何体、胶囊体人物 / 3D 角色装填、文字牌
// 所有颜色低饱和、纯几何体；CanvasTexture 只在 build() 运行期创建，模块加载不碰 DOM。

import * as THREE from 'three';
import { gsap } from 'gsap';
import type { CharacterModelId } from './modelManifest';
import { getCharacterModel } from './modelManifest';
import {
  getCharacterAnimations,
  hasCharacterModel,
  instantiateCharacterModel,
  loadCharacterModel,
} from '../world/resources';
import {
  createCharacterAnimation,
  type CharacterAnimationController,
} from './characterAnimation';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface BoxSize {
  w: number;
  h: number;
  d: number;
}

export interface BoxOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
  occlude?: boolean;
}

export function createMatteMaterial(color: number, roughness = 0.92): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
}

/** 居中定位的哑光盒体；默认产生/接收阴影 */
export function addBox(
  parent: THREE.Object3D,
  center: Vec3,
  size: BoxSize,
  color: number,
  options: BoxOptions = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size.w, size.h, size.d),
    createMatteMaterial(color),
  );
  mesh.position.set(center.x, center.y, center.z);
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;
  parent.add(mesh);
  return mesh;
}

export interface PersonOptions {
  /** 手里的方块颜色（橙壳手机等）；缺省不拿东西 */
  handBoxColor?: number;
  /** 手持方块相对身体中心的偏移 */
  handBoxOffset?: Vec3;
}

/**
 * 胶囊体占位人物：胶囊身体 + 球形头 + 可选手持小方块。
 * totalHeight 为身高（米）；返回以脚底为原点的组。
 */
export function createPerson(
  totalHeight: number,
  color: number,
  options: PersonOptions = {},
): THREE.Group {
  const group = new THREE.Group();

  const headRadius = Math.min(0.17, totalHeight * 0.1);
  const bodyHeight = Math.max(0.4, totalHeight - headRadius * 2);
  const radius = 0.26;

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius, bodyHeight - radius * 2, 4, 10),
    createMatteMaterial(color),
  );
  body.position.y = bodyHeight / 2;
  body.castShadow = true;

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(headRadius, 14, 10),
    createMatteMaterial(color),
  );
  head.position.y = totalHeight - headRadius;
  head.castShadow = true;

  group.add(body, head);

  if (options.handBoxColor !== undefined) {
    const offset = options.handBoxOffset ?? { x: 0.3, y: totalHeight * 0.62, z: 0.18 };
    const handBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.15, 0.03),
      createMatteMaterial(options.handBoxColor),
    );
    handBox.position.set(offset.x, offset.y, offset.z);
    handBox.castShadow = true;
    group.add(handBox);
  }

  return group;
}

/** 角色手持道具类型：手机小方块 / 手提袋 */
export type CharacterPropKind = 'phone' | 'bag';

export interface CharacterPropSpec {
  kind: CharacterPropKind;
  /** 道具主色（手机壳 / 袋身），缺省用中性灰 */
  color?: number;
  /** 挂在角色哪只手侧（角色面向 +Z 时的 +X / -X），默认右手 */
  side?: 'left' | 'right';
  /** 在默认校准位置上的微调（米，角色本地坐标，+Z 为胸前） */
  offset?: Partial<Vec3>;
}

export interface CharacterActorOptions {
  /** 外层朝向（弧度）：0 面向 +Z，Math.PI 面向 -Z；可在该值上叠加微偏 */
  yaw?: number;
  /** 前倾 / 低头姿态（弧度，正值向角色正前方 +Z 倾） */
  leanRad?: number;
  /** 手持小道具（橙壳手机 / 行李袋），按模型身高自动校准避免穿模 */
  props?: readonly CharacterPropSpec[];
}

/** 水平站位（XZ 平面）：朝向计算只需要这两个分量 */
export interface XZ {
  x: number;
  z: number;
}

/**
 * 让位于 from 的角色面向 target 的外层 yaw（弧度）。
 * 约定：外层 yaw=0 面向 +Z，与 SceneSpawn.yaw 的“0 面向 -Z”不同，这里按角色正面方向计算。
 */
export function yawToward(from: XZ, target: XZ): number {
  return Math.atan2(target.x - from.x, target.z - from.z);
}

/** 按模型身高校准手持道具：手机举在胸前、袋子垂在身侧 */
function createCharacterProp(spec: CharacterPropSpec, heightM: number): THREE.Mesh {
  const sideSign = spec.side === 'left' ? -1 : 1;
  let mesh: THREE.Mesh;
  let baseX: number;
  let baseY: number;
  let baseZ: number;

  if (spec.kind === 'phone') {
    mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.084, 0.16, 0.024),
      createMatteMaterial(spec.color ?? 0x9aa2ab, 0.6),
    );
    // 手机中心≈0.71 身高、贴近胸口前方（左右仅微偏），避免侧后方看出“漂浮”感
    baseX = sideSign * 0.02;
    baseY = heightM * 0.71;
    baseZ = 0.2;
  } else {
    mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.44, 0.26),
      createMatteMaterial(spec.color ?? 0x9b8f78),
    );
    // 袋顶≈0.82m 贴近自然下垂的手部，袋身贴在大腿外侧前方，不落地
    baseX = sideSign * 0.3;
    baseY = 0.6;
    baseZ = 0.12;
  }

  const offset = spec.offset ?? {};
  mesh.position.set(baseX + (offset.x ?? 0), baseY + (offset.y ?? 0), baseZ + (offset.z ?? 0));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** 是否已脱离场景树：向上找到的根必须仍是一个 Scene（被 dispose 的子树根不是 Scene） */
function isDetachedFromScene(node: THREE.Object3D): boolean {
  let root: THREE.Object3D = node;
  while (root.parent) root = root.parent;
  return (root as { isScene?: boolean }).isScene !== true;
}

/** 释放本地临时网格（胶囊体 / 道具），不触碰共享模型资源 */
function disposeLocalTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
}

/**
 * 统一角色装填工厂：优先使用缓存中的 .glb 模板（内层按 frontYawRad 归正，正面朝 +Z），
 * 外层 group.rotation.y = yaw 控制面向（0 → +Z，π → -Z）；可挂手持道具并设置前倾姿态。
 * 模型未预载时先挂胶囊体占位并异步补载：下载完成后若角色仍挂在场景树上，
 * 自动移除胶囊体并热替换为真实模型（保留朝向、阴影与手持道具）；
 * 脱离场景（切换/销毁）或纯 Node 单测环境则静默跳过，不产生任何报错。
 */
export function createCharacterActor(
  modelId: CharacterModelId,
  fallbackHeight: number,
  fallbackColor: number,
  options: CharacterActorOptions = {},
): THREE.Group {
  const outer = new THREE.Group();
  outer.name = `actor-${modelId}`;
  outer.rotation.y = options.yaw ?? 0;
  outer.userData.actorModelId = modelId;

  // 前倾姿态组：位于外层朝向之内，倾斜方向始终是角色自己的正前方
  const lean = new THREE.Group();
  lean.rotation.x = options.leanRad ?? 0;
  outer.add(lean);

  // 道具单独成组，热替换后按真实模型身高重新校准
  const propsRoot = new THREE.Group();
  propsRoot.name = 'actor-props';
  lean.add(propsRoot);

  let modelMounted = false;
  let propsHeightM = -1;
  const applyProps = (heightM: number): void => {
    if (propsHeightM === heightM) return;
    propsHeightM = heightM;
    for (const child of [...propsRoot.children]) {
      propsRoot.remove(child);
      disposeLocalTree(child);
    }
    for (const prop of options.props ?? []) {
      propsRoot.add(createCharacterProp(prop, heightM));
    }
  };

  const mountRealModel = (): void => {
    const entry = getCharacterModel(modelId);
    const pose = new THREE.Group();
    pose.name = 'actor-pose';
    pose.rotation.y = entry.frontYawRad;
    const model = instantiateCharacterModel(modelId);
    model.userData.actorModelRootId = modelId;
    model.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    pose.add(model);
    lean.add(pose);
    applyProps(entry.heightM);
    modelMounted = true;
  };

  if (hasCharacterModel(modelId)) {
    mountRealModel();
  } else {
    const fallback = createPerson(fallbackHeight, fallbackColor);
    fallback.name = 'actor-fallback';
    lean.add(fallback);
    applyProps(fallbackHeight);

    // 弱网 / 超时先让剧情可玩，模型就绪后再原地换装
    void loadCharacterModel(modelId)
      .then(() => {
        if (modelMounted || !fallback.parent || isDetachedFromScene(outer)) return;
        lean.remove(fallback);
        disposeLocalTree(fallback);
        mountRealModel();
      })
      .catch(() => {
        // 加载失败保持胶囊体占位，静默兜底
      });
  }

  return outer;
}

/** 定位角色实例内部的模型根（含骨骼层级），胶囊体占位 / 加载失败时返回 null */
export function findActorModelRoot(
  actor: THREE.Object3D,
): { modelId: CharacterModelId; root: THREE.Object3D } | null {
  let found: { modelId: CharacterModelId; root: THREE.Object3D } | null = null;
  actor.traverse((object) => {
    if (found) return;
    const modelId = object.userData.actorModelRootId as CharacterModelId | undefined;
    if (modelId) found = { modelId, root: object };
  });
  return found;
}

/** 为角色实例创建骨骼动画控制器；模型无动画或仍在用胶囊体占位时返回 null */
export function createActorAnimation(actor: THREE.Object3D): CharacterAnimationController | null {
  const ref = findActorModelRoot(actor);
  if (!ref) return null;
  const clips = getCharacterAnimations(ref.modelId);
  if (clips.length === 0) return null;
  return createCharacterAnimation(ref.root, clips);
}

export interface IdleMotionOptions {
  /** 呼吸起伏幅度（相对身高的纵向缩放比例） */
  breathAmp?: number;
  /** 重心左右微摆幅度（弧度） */
  swayAmp?: number;
  /** 单个呼吸周期（秒） */
  period?: number;
}

/**
 * 站立角色的极轻呼吸 / 重心摆动；返回清理函数，场景 exit 时必须调用以杀掉补间。
 */
export function startIdleMotion(
  target: THREE.Object3D,
  options: IdleMotionOptions = {},
): () => void {
  const breathAmp = options.breathAmp ?? 0.006;
  const swayAmp = options.swayAmp ?? 0.006;
  const period = options.period ?? 2.8;
  const baseScaleY = target.scale.y;
  const baseRotationZ = target.rotation.z;

  const breath = gsap.to(target.scale, {
    y: baseScaleY * (1 + breathAmp),
    duration: period,
    yoyo: true,
    repeat: -1,
    ease: 'sine.inOut',
  });
  const sway = gsap.to(target.rotation, {
    z: baseRotationZ + swayAmp,
    duration: period * 1.4,
    yoyo: true,
    repeat: -1,
    ease: 'sine.inOut',
    delay: period * 0.35,
  });

  return () => {
    breath.kill();
    sway.kill();
    target.scale.y = baseScaleY;
    target.rotation.z = baseRotationZ;
  };
}

export interface TextSignOptions {
  background?: string;
  foreground?: string;
}

/** 带文字的直立牌 / 横幅（Canvas 纹理），内容一律使用通用称呼 */
export function createTextSign(
  text: string,
  width: number,
  height: number,
  options: TextSignOptions = {},
): THREE.Mesh {
  const canvas = document.createElement('canvas');
  const ratio = 160;
  canvas.width = Math.ceil(width * ratio);
  canvas.height = Math.ceil(height * ratio);

  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = options.background ?? '#e8e2d4';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = options.foreground ?? '#7a4a35';
    const fontSize = Math.round(canvas.height * 0.38);
    context.font = `700 ${fontSize}px "YT Sans", "Microsoft YaHei", sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2 + fontSize * 0.04, canvas.width * 0.9);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;

  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 });
  material.addEventListener('dispose', () => texture.dispose());
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.castShadow = true;
  return mesh;
}

/** 生成单色地面，不参与光点遮挡 */
export function addGround(parent: THREE.Object3D, size: number, color: number): void {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    createMatteMaterial(color, 0.96),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  parent.add(ground);
}
