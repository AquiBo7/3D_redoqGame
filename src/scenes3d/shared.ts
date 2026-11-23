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
  castShadow?: boolean;
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

/** 禁用高面数角色网格逐三角形 CPU 射线检测（避免转视角视线遮挡检测触发骨骼蒙皮矩阵重算） */
const NOOP_RAYCAST = (): void => {};

/** 手持道具摆位：chest = 胸前（有手臂骨骼可 IK）；hand = 烘焙手掌握点（无骨骼模型专用） */
export type PropGrip = 'chest' | 'hand';

/** 按模型身高校准手持道具：手机举在胸前、袋子垂在身侧 */
function createCharacterProp(spec: CharacterPropSpec, heightM: number, grip: PropGrip): THREE.Mesh {
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
    if (grip === 'hand') {
      // 无骨骼模型的手垂在体侧：手机压进掌心，机身中心比手掌重心低 3.5 cm，让上缘被手盖住
      baseX = -sideSign * PHONE_HAND_GRIP.x;
      baseY = PHONE_HAND_GRIP.y;
      baseZ = PHONE_HAND_GRIP.z;
    } else {
      // 手机中心≈0.71 身高、贴近胸口前方（左右仅微偏），避免侧后方看出“漂浮”感
      baseX = sideSign * 0.02;
      baseY = heightM * 0.71;
      baseZ = 0.2;
    }
  } else {
    mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.34, 0.26),
      createMatteMaterial(spec.color ?? 0xb6a58a, 0.88),
    );
    // 帆布手提袋悬于自然下垂的手掌正下方（内缘 0.34 - 0.07 = 0.27m 避开腿侧不穿模），
    // 并加装竖向提手织带直连掌心高度（y≈0.74m），消除“悬空方块”感
    baseX = sideSign * 0.34;
    baseY = 0.41;
    baseZ = 0.03;
    const strapMat = createMatteMaterial(0x6c5e4b, 0.9);
    const strapTop = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.024, 0.14), strapMat);
    strapTop.position.set(0, 0.33, 0);
    strapTop.raycast = NOOP_RAYCAST;
    const strapFront = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.17, 0.022), strapMat);
    strapFront.position.set(0, 0.245, 0.062);
    strapFront.raycast = NOOP_RAYCAST;
    const strapBack = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.17, 0.022), strapMat);
    strapBack.position.set(0, 0.245, -0.062);
    strapBack.raycast = NOOP_RAYCAST;
    const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.148, 0.045, 0.268), strapMat);
    cuff.position.set(0, 0.145, 0);
    cuff.raycast = NOOP_RAYCAST;
    for (const part of [strapTop, strapFront, strapBack, cuff]) {
      part.castShadow = true;
      part.receiveShadow = true;
      mesh.add(part);
    }
  }

  const offset = spec.offset ?? {};
  mesh.position.set(baseX + (offset.x ?? 0), baseY + (offset.y ?? 0), baseZ + (offset.z ?? 0));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.raycast = NOOP_RAYCAST;
  return mesh;
}

/**
 * 无骨骼 GLB（阿远 / 父亲 / 主角）的手臂是烘焙死的，IK 没有可转的关节，胸前持机会变成"手机悬在胸口、
 * 两手垂在身侧"。这类模型改为把手机压进烘焙手掌：实测 chr_ayuan.glb 归一化到 1.68 m 后，
 * 两只手掌顶点重心在 lean 本地 (±0.32, 0.72, 0.00)，指尖到 0.62，所以机身中心取 y 0.685、
 * 上缘正好被手掌盖住，读起来是"垂手握机"而不是漂浮。右手在 −X（与 poseActor 的 R→−X 同一约定）。
 */
const PHONE_HAND_GRIP = { x: 0.315, y: 0.685, z: 0.02 };

/** 角色实例是否带可解算的手臂骨骼；无骨骼模型的手持道具只能走烘焙握点 */
export function hasArmRig(actor: THREE.Object3D): boolean {
  return Boolean(actor.getObjectByName('R_Upperarm'));
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
  const castShadow = options.castShadow ?? (modelId === 'linxia' || modelId === 'father' || modelId === 'fatherCarry');
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
  let propsGrip: PropGrip = 'chest';
  const applyProps = (heightM: number, grip: PropGrip): void => {
    if (propsHeightM === heightM && propsGrip === grip) return;
    propsHeightM = heightM;
    propsGrip = grip;
    for (const child of [...propsRoot.children]) {
      propsRoot.remove(child);
      disposeLocalTree(child);
    }
    for (const prop of options.props ?? []) {
      const mesh = createCharacterProp(prop, heightM, grip);
      mesh.traverse((node) => {
        if (node instanceof THREE.Mesh) node.castShadow = castShadow;
      });
      propsRoot.add(mesh);
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
        object.castShadow = castShadow;
        object.receiveShadow = true;
        object.raycast = NOOP_RAYCAST;
      }
    });
    pose.add(model);
    lean.add(pose);
    applyProps(entry.heightM, hasArmRig(outer) ? 'chest' : 'hand');
    modelMounted = true;
  };

  if (hasCharacterModel(modelId)) {
    mountRealModel();
  } else {
    const fallback = createPerson(fallbackHeight, fallbackColor);
    fallback.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = castShadow;
        object.receiveShadow = true;
      }
    });
    fallback.name = 'actor-fallback';
    lean.add(fallback);
    // 胶囊体没有手臂，手机放胸口反而最接近"举着手机"的剪影；真实模型到货后再按有无骨骼改握点
    applyProps(fallbackHeight, 'chest');

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

interface PoseRestore {
  object: THREE.Object3D;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

const chestPhonePoses = new WeakMap<THREE.Object3D, PoseRestore[]>();

/** 把一根骨骼转到指定的世界朝向，只改实例骨骼，不动共享网格与动画剪辑 */
function aimBone(
  actor: THREE.Object3D,
  boneName: string,
  tipName: string,
  direction: THREE.Vector3,
  saved: PoseRestore[],
): boolean {
  const bone = actor.getObjectByName(boneName);
  const tip = actor.getObjectByName(tipName);
  if (!bone || !tip || !bone.parent) return false;
  if (!saved.some((entry) => entry.object === bone)) {
    saved.push({ object: bone, position: bone.position.clone(), quaternion: bone.quaternion.clone() });
  }
  actor.updateWorldMatrix(true, true);
  const current = tip.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
  const rotation = new THREE.Quaternion().setFromUnitVectors(current, direction.clone().normalize())
    .multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
  return true;
}

/**
 * 胸前双手持机：把两臂骨骼用两段 IK 收到手机下缘两侧，读起来是"捧着手机"而不是"手机飘在胸口"。
 * 只转骨骼、可重复调用（先把上次改过的骨骼还原再摆），模型异步热替换后在下一拍补摆即可。
 * 仍在用胶囊体占位、或该角色正由动画剪辑驱动手臂时不要调用（动画每帧会覆盖骨骼四元数）。
 */
export function poseHandsOnChestPhone(actor: THREE.Object3D): boolean {
  const prop = actor.getObjectByName('actor-props')?.children[0];
  if (!prop || !findActorModelRoot(actor)) return false;
  const previous = chestPhonePoses.get(actor);
  if (previous) {
    for (const entry of previous) {
      entry.object.position.copy(entry.position);
      entry.object.quaternion.copy(entry.quaternion);
    }
  }
  const saved: PoseRestore[] = [];
  chestPhonePoses.set(actor, saved);
  actor.updateWorldMatrix(true, true);
  const phone = prop.getWorldPosition(new THREE.Vector3());
  let posed = 0;
  // actor 绕 Y 转过后，本地 +X 恰好是角色的左手边
  for (const [prefix, out] of [['L', 1], ['R', -1]] as const) {
    const upper = actor.getObjectByName(`${prefix}_Upperarm`);
    const lower = actor.getObjectByName(`${prefix}_Forearm`);
    const hand = actor.getObjectByName(`${prefix}_Hand`);
    if (!upper || !lower || !hand) continue;
    actor.updateWorldMatrix(true, true);
    const shoulder = upper.getWorldPosition(new THREE.Vector3());
    const elbow = lower.getWorldPosition(new THREE.Vector3());
    const wrist = hand.getWorldPosition(new THREE.Vector3());
    const lengthA = shoulder.distanceTo(elbow);
    const lengthB = elbow.distanceTo(wrist);
    const side = new THREE.Vector3(out, 0, 0).transformDirection(actor.matrixWorld);
    // 手套有厚度：只偏 5 cm 时两只掌心会压在机身正面互相交叉，把下半屏和领带一起挡住。
    // 外扩到 6.8 cm、再压低 4.2 cm 并前移 1.2 cm，掌心改捧下缘两角；
    // 总偏移仍要 < 9 cm（sharedPhonePose.test.ts 的"手腕必须在机身上"红线），所以这里留 0.9 cm 余量。
    const target = phone.clone().addScaledVector(side, 0.068).add(new THREE.Vector3(0, -0.042, 0.012));
    const direction = target.clone().sub(shoulder).normalize();
    const distance = Math.max(0.001, Math.min(shoulder.distanceTo(target), lengthA + lengthB - 0.001));
    const along = (lengthA * lengthA - lengthB * lengthB + distance * distance) / (2 * distance);
    // 肘尖朝外下方，避免两臂交叉或肘部反关节
    const bend = side.clone().add(new THREE.Vector3(0, -0.6, 0)).normalize();
    bend.addScaledVector(direction, -bend.dot(direction)).normalize();
    const desiredElbow = shoulder.clone().addScaledVector(direction, along)
      .addScaledVector(bend, Math.sqrt(Math.max(0, lengthA * lengthA - along * along)));
    if (!aimBone(actor, `${prefix}_Upperarm`, `${prefix}_Forearm`, desiredElbow.sub(shoulder), saved)) continue;
    actor.updateWorldMatrix(true, true);
    if (aimBone(actor, `${prefix}_Forearm`, `${prefix}_Hand`, target.sub(lower.getWorldPosition(new THREE.Vector3())), saved)) {
      posed += 1;
    }
  }
  const head = actor.getObjectByName('Head');
  if (head) {
    saved.push({ object: head, position: head.position.clone(), quaternion: head.quaternion.clone() });
    head.rotateX(0.1);
  }
  return posed === 2;
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
  /** 画布每米像素数，默认 160；玩家 2 m 内会读到的牌面提到 320，笔画才不糊 */
  resolution?: number;
  /** 牌面自发光强度：走 emissiveMap（复用同一张画布，不额外占贴图），只在暗处补出笔画 */
  emissiveIntensity?: number;
  emissive?: number;
}

/** 带文字的直立牌 / 横幅（Canvas 纹理），内容一律使用通用称呼 */
export function createTextSign(
  text: string,
  width: number,
  height: number,
  options: TextSignOptions = {},
): THREE.Mesh {
  const canvas = document.createElement('canvas');
  const ratio = options.resolution ?? 160;
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
  if (options.emissiveIntensity) {
    material.emissiveMap = texture;
    material.emissive = new THREE.Color(options.emissive ?? 0xffffff);
    material.emissiveIntensity = options.emissiveIntensity;
  }
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
