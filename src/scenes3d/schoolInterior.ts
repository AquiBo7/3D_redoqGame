// 教学楼共享几何：模块预载不创建资源、不访问 DOM；剧情推进完全交给 core。
import * as THREE from 'three';
import type { SceneId } from '../data/storySchema';
import type { ObstacleAabb } from '../world/navMath';
import type { SceneRuntime, SceneRuntimeContext, WorldSceneDefinition } from '../world/worldSceneTypes';
import { createCharacterActor, createTextSign, findActorModelRoot } from './shared';
import { getCharacterModel, type CharacterModelId } from './modelManifest';

type InteriorScene = 'C2' | 'C4' | 'C5' | 'C6' | 'D1' | 'D6';
type V3 = [number, number, number];
const SCENES: readonly InteriorScene[] = ['C2', 'C4', 'C5', 'C6', 'D1', 'D6'];
const MODELS: readonly CharacterModelId[] = ['linxia', 'ayuan', 'studentFemale', 'studentMale'];
const ORANGE = 0xcd793c;

/** 脚底导航点与交互锚点分开，便于浏览器验收 / teleport；所有坐标都是米。 */
export const INTERIOR_LOCATIONS = {
  spawns: {
    C2: { x: -0.1, z: 5, yaw: Math.PI / 2, pitchDeg: -6 },
    C4: { x: 3, z: 6, yaw: -Math.PI / 2, pitchDeg: -3 },
    C5: { x: 2.7, z: 6.5, yaw: 0, pitchDeg: -3 },
    C6: { x: 3, z: 3.5, yaw: -Math.PI / 2, pitchDeg: -3 },
    D1: { x: 7, z: 0, yaw: Math.PI, pitchDeg: -3 },
    D6: { x: 3, z: 5, yaw: 0, pitchDeg: -3 },
  },
  seats: [
    { id: 'seat-beside', x: -4, y: 0.48, z: 4.75, approach: { x: -5.3, z: 4.75 } },
    { id: 'seat-front', x: -7, y: 0.48, z: 1.75, approach: { x: -5.3, z: 1.75 } },
    { id: 'seat-far', x: -4, y: 0.48, z: -4.25, approach: { x: -2.5, z: -4.25 } },
  ],
  students: [-7, -4, -1, 2, 5, 7.5].map((z, i) => ({
    id: `student-${i + 1}`, x: 4.15, z, approach: { x: 2.7, z },
  })),
  linxiaDesk: { x: -7, z: 4.75 },
  stairwell: { x: 7, z: -1 },
  stairwellActor: { x: 8.3, z: -1 },
  platform: { x: 7, z: 5 },
  platformActor: { x: 8.3, z: 5 },
  corridor: { x: 2.8, z: -4 },
  corridorLinxia: { x: 4.15, z: -4 },
  corridorAyuan: { x: 4.15, z: -1 },
  classroomDoor: { x: 1, z: 5 },
  stairwellDoor: { x: 5, z: 5 },
} as const;

const DESKS = [-7, -4].flatMap((x) => [-5, -2, 1, 4].map((z) => ({ x, z })));
// 门洞宽 2.4m / 4m；墙、台阶与家具的可见占地与碰撞配置共用数据。
const PARTITIONS = [
  { name: 'class-wall-front', p: [1, 1.9, -7.6], s: [0.2, 3.8, 2.8] },
  { name: 'class-wall-middle', p: [1, 1.9, 0], s: [0.2, 3.8, 7.6] },
  { name: 'class-wall-back', p: [1, 1.9, 7.6], s: [0.2, 3.8, 2.8] },
  { name: 'stair-wall', p: [5, 1.9, -3], s: [0.2, 3.8, 12] },
  { name: 'platform-wall', p: [5, 1.9, 8], s: [0.2, 3.8, 2] },
] satisfies Array<{ name: string; p: V3; s: V3 }>;
function obstacle(id: string, x: number, z: number, w: number, d: number, height = 1.8): ObstacleAabb {
  return { id, minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, height };
}
function navigation(scene: InteriorScene): WorldSceneDefinition['nav'] {
  const people = scene === 'C5' ? INTERIOR_LOCATIONS.students : scene === 'C4' || scene === 'C6'
    ? [INTERIOR_LOCATIONS.stairwellActor] : scene === 'D1' ? [INTERIOR_LOCATIONS.platformActor]
      : scene === 'D6' ? [INTERIOR_LOCATIONS.corridorLinxia, INTERIOR_LOCATIONS.corridorAyuan] : [];
  return {
    groundY: 0,
    // 边界已内缩玩家半径，窗台不会穿入镜头。
    bounds: { minX: -8.5, maxX: 9.5, minZ: -8.5, maxZ: 8.5 },
    obstacles: [
      ...PARTITIONS.map(({ name, p, s }) => obstacle(name, p[0], p[2], s[0], s[2], s[1])),
      ...DESKS.map(({ x, z }, i) => obstacle(`desk-${i}`, x, z + 0.35, 1.45, 1.5, 1)),
      obstacle('podium', -4.5, -7.7, 3, 1, 1.05),
      obstacle('stairs-and-rail', 8.55, -6, 2.1, 5.2, 2.5),
      ...people.map(({ x, z }, i) => obstacle(`person-${i}`, x, z, 0.8, 0.8)),
    ],
  };
}
function group(parent: THREE.Object3D, name: string): THREE.Group {
  const result = new THREE.Group();
  result.name = name;
  parent.add(result);
  return result;
}

/** 仅本次 build 内共享；纹理由所属材质释放，实例缓冲由所属几何释放一次。 */
function details() {
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const palette = new Map<number, THREE.MeshStandardMaterial>();
  function material(color: number): THREE.MeshStandardMaterial {
    let m = palette.get(color);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0, envMapIntensity: 0.35 });
      palette.set(color, m);
    }
    return m;
  }
  function box(parent: THREE.Object3D, name: string, p: V3, s: V3, m: THREE.Material | number): THREE.Mesh {
    const mesh = new THREE.Mesh(cube, typeof m === 'number' ? material(m) : m);
    mesh.name = name;
    mesh.position.set(...p);
    mesh.scale.set(...s);
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function batch(parent: THREE.Object3D, name: string, parts: Array<{ p: V3; s: V3 }>, color: number) {
    const mesh = new THREE.InstancedMesh(cube, material(color), parts.length);
    mesh.name = name;
    const transform = new THREE.Object3D();
    parts.forEach(({ p, s }, i) => {
      transform.position.set(...p);
      transform.scale.set(...s);
      transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    const release = (): void => { mesh.dispose(); cube.removeEventListener('dispose', release); };
    cube.addEventListener('dispose', release);
    parent.add(mesh);
    return mesh;
  }
  return { box, batch, material };
}
type Details = ReturnType<typeof details>;
function sign(parent: THREE.Object3D, text: string, p: V3, yaw = 0, width = 1.4): void {
  const mesh = createTextSign(text, width, 0.32, { background: '#e1e5da', foreground: '#485e56' });
  mesh.name = `sign-${text}`;
  mesh.position.set(...p);
  mesh.rotation.y = yaw;
  mesh.castShadow = false;
  parent.add(mesh);
}
function floorMaterial(): THREE.MeshStandardMaterial {
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  let seed = 224;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const seam = x < 1 || y < 1;
    const n = seed % 100;
    const shade = seam ? -32 : n < 7 ? -45 : n < 18 ? -18 : n % 7;
    pixels.set([219 + shade, 215 + shade, 201 + shade, 255], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(19, 18);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.68, envMapIntensity: 0.3 });
  const release = (): void => { texture.dispose(); material.removeEventListener('dispose', release); };
  material.addEventListener('dispose', release);
  return material;
}
function architecture(root: THREE.Group, d: Details, occluders: THREE.Object3D[]) {
  const walls = group(root, 'interior-walls');
  const cream = 0xe5dfd1;
  const sage = 0x91a297;
  const trim = 0x687d76;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(19, 18), floorMaterial());
  floor.name = 'interior-terrazzo-floor';
  floor.rotation.x = -Math.PI / 2;
  floor.position.x = 0.5;
  floor.receiveShadow = true;
  root.add(floor);
  d.box(walls, 'roof', [0.5, 3.88, 0], [19.25, 0.16, 18.25], cream);
  for (const z of [-9, 9]) {
    d.box(walls, 'end-wall', [0.5, 1.9, z], [19.25, 3.8, 0.22], cream);
    d.box(walls, 'end-wainscot', [0.5, 0.48, z - Math.sign(z) * 0.13], [19, 0.96, 0.04], sage);
  }
  for (const { name, p, s } of PARTITIONS) {
    d.box(walls, name, p, s, cream);
    d.box(walls, `${name}-skirting`, [p[0], 0.4, p[2]], [s[0] + 0.025, 0.8, s[2]], sage);
  }
  for (const z of [-5, 5]) {
    d.box(walls, 'class-door-lintel', [1, 3.25, z], [0.22, 1.1, 2.4], cream);
    // 门扇贴墙停靠，不跨越通行门洞。
    d.box(walls, 'open-class-door', [0.85, 1.34, z + 1.72], [0.07, 2.68, 0.95], 0xb8aa8f);
    sign(root, '二楼 · 教室', [1.14, 2.95, z], Math.PI / 2);
  }
  d.box(walls, 'stair-door-lintel', [5, 3.35, 5], [0.22, 0.9, 4], cream);
  sign(root, '侧楼梯 · 平台', [4.86, 3.12, 5], -Math.PI / 2, 2);
  const glass = new THREE.MeshStandardMaterial({ color: 0xb6c9c5, transparent: true, opacity: 0.18,
    roughness: 0.22, depthWrite: false, envMapIntensity: 0.4 });
  for (const x of [-9, 10]) {
    d.box(walls, 'window-parapet', [x, 0.46, 0], [0.22, 0.92, 18], sage);
    d.box(walls, 'window-header', [x, 3.5, 0], [0.22, 0.6, 18], cream);
    for (let z = -7.5; z <= 7.5; z += 3) {
      d.box(walls, 'window-pane', [x, 2.04, z], [0.045, 2.24, 2.92], glass);
      d.box(walls, 'window-mullion', [x, 2.06, z - 1.5], [0.24, 2.3, 0.08], trim);
    }
    for (const y of [0.94, 2.5, 3.2]) d.box(walls, 'window-rail', [x, y, 0], [0.25, 0.06, 18], trim);
    d.box(walls, 'window-sill', [x, 0.95, 0], [0.36, 0.08, 18], cream);
  }
  occluders.push(walls);
  const stairs = group(root, 'stairwell-flight');
  for (let i = 0; i < 10; i += 1) {
    const h = (i + 1) * 0.18;
    d.box(stairs, `stair-${i}`, [8.55, h / 2, -3.6 - i * 0.5], [1.9, h, 0.5], 0xb3b6aa);
    d.box(stairs, 'stair-edge', [8.55, h + 0.008, -3.36 - i * 0.5], [1.9, 0.016, 0.035], trim);
    d.box(stairs, 'stair-baluster', [7.55, h + 0.45, -3.6 - i * 0.5], [0.035, 0.9, 0.035], trim);
  }
  const rail = d.box(stairs, 'stair-handrail', [7.55, 1.89, -5.85], [0.07, 0.07, 5.3], trim);
  rail.rotation.x = Math.atan(0.36);
  // 上行楼层暂未开放，楼梯占地整体禁入；本层转角和侧平台均为连续平地。
  d.box(stairs, 'flight-guard', [8.55, 0.62, -3.43], [2.1, 1.24, 0.045], trim);
  sign(stairs, '上楼请止步', [8.55, 1.3, -3.39], 0, 1.7);
  occluders.push(stairs);
  const garden = group(root, 'window-greenery');
  for (const x of [-12, 13]) {
    d.box(garden, 'garden-ground', [x, -0.14, 0], [6, 0.2, 24], 0x8f9b7b);
    d.box(garden, 'garden-backdrop', [x + Math.sign(x) * 2.8, 3, 0], [0.2, 6, 24], 0xaabdb0);
    for (let z = -9; z <= 9; z += 3) {
      d.box(garden, 'tree-trunk', [x, 1.7, z], [0.14, 3.4, 0.14], 0x817661);
      const tree = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), d.material(z % 2 ? 0x829c76 : 0x9bb087));
      tree.position.set(x, 3, z);
      tree.scale.set(1.5, 1.65, 1.4);
      garden.add(tree);
    }
  }
  const lamp = d.material(0xf0e4ca);
  lamp.emissive.setHex(0xffdfac);
  lamp.emissiveIntensity = 0.45;
  for (const x of [-6, -2, 3, 7]) for (const z of [-6, 0, 6])
    d.box(root, 'ceiling-lamp', [x, 3.73, z], [1.2, 0.06, 0.32], lamp);
  const fill = new THREE.HemisphereLight(0xffeed6, 0x8c9d9a, 1.2);
  fill.name = 'interior-fill';
  root.add(fill);
  const sunset = new THREE.PointLight(0xffb477, 0, 16, 2);
  sunset.name = 'interior-sunset';
  sunset.position.set(9.2, 2.7, 5);
  root.add(sunset);
  return { fill, sunset, garden };
}
function furniture(root: THREE.Group, d: Details, occluders: THREE.Object3D[]) {
  const furniture = group(root, 'classroom-furniture');
  const legs: Array<{ p: V3; s: V3 }> = [];
  DESKS.forEach(({ x, z }, i) => {
    d.box(furniture, `desk-${i}`, [x, 0.76, z], [1.4, 0.07, 0.7], 0xc4ae87);
    d.box(furniture, 'desk-drawer', [x, 0.64, z], [1.18, 0.15, 0.48], 0xa29d8b);
    d.box(furniture, 'chair-seat', [x, 0.46, z + 0.75], [0.48, 0.05, 0.45], 0x91a297);
    d.box(furniture, 'chair-back', [x, 0.77, z + 0.97], [0.48, 0.55, 0.045], 0x91a297);
    for (const dx of [-0.57, 0.57]) for (const dz of [-0.25, 0.25]) legs.push({ p: [x + dx, 0.36, z + dz], s: [0.045, 0.72, 0.045] });
    for (const dx of [-0.18, 0.18]) for (const dz of [-0.17, 0.17]) legs.push({ p: [x + dx, 0.22, z + 0.75 + dz], s: [0.035, 0.44, 0.035] });
  });
  d.batch(furniture, 'desk-chair-legs', legs, 0x677972);
  d.box(furniture, 'podium', [-4.5, 0.51, -7.7], [3, 1.02, 1], 0xa3987c);
  d.box(root, 'blackboard-frame', [-4.5, 2.1, -8.85], [5.8, 1.48, 0.1], 0xb6ac93);
  d.box(root, 'blackboard', [-4.5, 2.1, -8.78], [5.6, 1.3, 0.045], 0x395b52);
  sign(root, '新生活 · 新开始', [-4.5, 3.23, -8.75], 0, 3.5);
  d.box(root, 'chalk-tray', [-4.5, 1.38, -8.68], [5.8, 0.035, 0.2], 0x677972);
  const sketch = group(root, 'linxia-sketchbook');
  d.box(sketch, 'sketchbook-cover', [-7, 0.807, 4], [0.57, 0.018, 0.4], 0x8b947e);
  for (const dx of [-0.14, 0.14]) d.box(sketch, 'sketchbook-page', [-7 + dx, 0.82, 4], [0.27, 0.012, 0.38], 0xf0eadb);
  const lines: Array<{ p: V3; s: V3 }> = [];
  for (let i = 0; i < 5; i += 1) lines.push({ p: [-7.21 + i * 0.09, 0.828, 3.97], s: [0.002, 0.001, 0.21] });
  for (const z of [3.88, 4.07]) lines.push({ p: [-7.03, 0.828, z], s: [0.38, 0.001, 0.002] });
  d.batch(sketch, 'pencilled-window-study', lines, 0x777c72);
  const pencil = d.box(sketch, 'pencil', [-6.84, 0.843, 4.18], [0.008, 0.008, 0.18], 0xb28c50);
  pencil.rotation.y = -0.3;
  d.box(sketch, 'pencil-tip', [-6.815, 0.841, 4.095], [0.005, 0.005, 0.015], 0x53544d);
  d.box(sketch, 'pencil-case', [-7.48, 0.825, 4], [0.12, 0.055, 0.3], 0x8e9c96);
  occluders.push(furniture);
  const shade = new THREE.MeshBasicMaterial({ color: 0x394238, transparent: true, opacity: 0.065, depthWrite: false });
  for (const { x, z } of DESKS) d.box(root, 'desk-contact-shade', [x, 0.004, z + 0.3], [1.44, 0.002, 1.48], shade);
  return sketch;
}

interface PoseSnapshot { object: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }
const poses = new WeakMap<THREE.Object3D, PoseSnapshot[]>();
function resetPose(actor: THREE.Object3D): void {
  for (const p of poses.get(actor) ?? []) {
    p.object.position.copy(p.position); p.object.quaternion.copy(p.quaternion); p.object.scale.copy(p.scale);
  }
  poses.delete(actor);
}
/** 转动实例骨骼，不改共享网格或动画剪辑；适配真实模型的原生轴向。 */
function poseActor(actor: THREE.Object3D, seated: boolean, phone: boolean): void {
  resetPose(actor);
  const saved: PoseSnapshot[] = [];
  const remember = (object: THREE.Object3D): void => {
    if (!saved.some((p) => p.object === object)) saved.push({ object, position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone() });
  };
  poses.set(actor, saved);
  const model = findActorModelRoot(actor);
  const aim = (name: string, tipName: string, direction: THREE.Vector3): void => {
    const bone = actor.getObjectByName(name); const tip = actor.getObjectByName(tipName);
    if (!bone || !tip || !bone.parent) return;
    remember(bone);
    actor.updateWorldMatrix(true, true);
    const current = tip.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
    const rotation = new THREE.Quaternion().setFromUnitVectors(current, direction.normalize())
      .multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
    bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
  };
  if (model && seated) {
    for (const side of ['L', 'R']) {
      aim(`${side}_Thigh`, `${side}_Calf`, new THREE.Vector3(0, -0.08, 1).transformDirection(actor.matrixWorld));
      aim(`${side}_Calf`, `${side}_Foot`, new THREE.Vector3(0, -1, 0).transformDirection(actor.matrixWorld));
    }
    const hip = actor.getObjectByName('Hip');
    const pose = actor.getObjectByName('actor-pose');
    if (hip && pose) {
      actor.updateWorldMatrix(true, true);
      const localHip = actor.worldToLocal(hip.getWorldPosition(new THREE.Vector3()));
      remember(pose);
      pose.position.y += 0.62 - localHip.y;
    }
  }
  if (model && (phone || seated)) {
    // 两段手臂 IK：手机在胸前、绘画手落在桌沿，不用缩放整个人伪装坐姿。
    for (const [side, sign] of [['L', -1], ['R', 1]] as const) {
      const upper = actor.getObjectByName(`${side}_Upperarm`);
      const lower = actor.getObjectByName(`${side}_Forearm`);
      const hand = actor.getObjectByName(`${side}_Hand`);
      if (!upper || !lower || !hand) continue;
      actor.updateWorldMatrix(true, true);
      const shoulder = upper.getWorldPosition(new THREE.Vector3());
      const elbow = lower.getWorldPosition(new THREE.Vector3());
      const wrist = hand.getWorldPosition(new THREE.Vector3());
      const lengthA = shoulder.distanceTo(elbow); const lengthB = elbow.distanceTo(wrist);
      const prop = actor.getObjectByName('actor-props')?.children[0];
      const target = seated ? actor.localToWorld(new THREE.Vector3(sign * 0.14, 0.84, 0.53))
        : prop ? prop.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(sign * 0.045, -0.035, 0).transformDirection(actor.matrixWorld).multiplyScalar(0.04))
          : actor.localToWorld(new THREE.Vector3(sign * 0.06, 1.17, 0.24));
      const direction = target.clone().sub(shoulder).normalize();
      const distance = Math.max(0.001, Math.min(shoulder.distanceTo(target), lengthA + lengthB - 0.001));
      const along = (lengthA * lengthA - lengthB * lengthB + distance * distance) / (2 * distance);
      const bend = new THREE.Vector3(sign, -0.6, 0).transformDirection(actor.matrixWorld);
      bend.addScaledVector(direction, -bend.dot(direction)).normalize();
      const desiredElbow = shoulder.clone().addScaledVector(direction, along)
        .addScaledVector(bend, Math.sqrt(Math.max(0, lengthA * lengthA - along * along)));
      aim(`${side}_Upperarm`, `${side}_Forearm`, desiredElbow.sub(shoulder));
      actor.updateWorldMatrix(true, true);
      aim(`${side}_Forearm`, `${side}_Hand`, target.sub(lower.getWorldPosition(new THREE.Vector3())));
    }
    const head = actor.getObjectByName('Head');
    if (head) { remember(head); head.rotateX(0.12); }
  }
  const fallback = actor.getObjectByName('actor-fallback');
  if (fallback && seated) {
    const body = fallback.children[0]; const head = fallback.children[1];
    if (body && head) {
      remember(body); remember(head);
      body.scale.y = 0.43; body.position.y = 0.9; head.position.y = 1.3;
    }
  }
  const legs = actor.getObjectByName('seated-fallback-legs');
  if (legs) legs.visible = seated && !model;
}
function buildSchoolInterior(parent: THREE.Object3D) {
  const root = group(parent, 'school-interior');
  const d = details();
  const occluders: THREE.Object3D[] = [];
  const { fill, sunset, garden } = architecture(root, d, occluders);
  const sketch = furniture(root, d, occluders);
  const actors: Record<string, THREE.Object3D> = { 'interior-fill': fill, 'interior-sunset': sunset, 'window-greenery': garden, 'linxia-sketchbook': sketch };
  const create = (id: CharacterModelId, name: string, phoneColor?: number): THREE.Group => {
    const entry = getCharacterModel(id);
    const actor = createCharacterActor(id, entry.heightM, id === 'linxia' ? 0xa0afa5 : 0x9ca6b2, {
      castShadow: false, props: phoneColor === undefined ? [] : [{ kind: 'phone', color: phoneColor }],
    });
    actor.name = name;
    actor.visible = false;
    root.add(actor); actors[name] = actor;
    // 所有实例独有的 skeleton（含 boneTexture）跟随本地接触底片销毁，不动缓存模板。
    const geometry = new THREE.PlaneGeometry(0.7, 0.6);
    const material = new THREE.MeshBasicMaterial({ color: 0x303c36, transparent: true, opacity: 0.1, depthWrite: false });
    const contact = new THREE.Mesh(geometry, material);
    contact.name = 'actor-contact-shade'; contact.rotation.x = -Math.PI / 2; contact.position.y = 0.006;
    actor.add(contact);
    const release = (): void => {
      const skeletons = new Set<THREE.Skeleton>();
      actor.traverse((node) => { if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton); });
      skeletons.forEach((skeleton) => skeleton.dispose());
      resetPose(actor);
      geometry.removeEventListener('dispose', release);
    };
    geometry.addEventListener('dispose', release);
    // 人物由导航占地防穿模。遮挡列表只放静态建筑/家具：Raycaster 不会跳过
    // invisible 子树，同 key 切场景后不能让隐藏演员留下幽灵遮挡。
    return actor;
  };
  const linxia = create('linxia', 'linxia', 0x889994);
  const legs = group(linxia, 'seated-fallback-legs');
  for (const x of [-0.12, 0.12]) {
    d.box(legs, 'seated-thigh', [x, 0.57, 0.18], [0.15, 0.16, 0.4], 0x66736e);
    d.box(legs, 'seated-calf', [x, 0.27, 0.34], [0.13, 0.48, 0.14], 0x66736e);
  }
  legs.visible = false;
  const ayuan = create('ayuan', 'ayuan', ORANGE);
  actors['student-4'] = ayuan;
  for (let i = 0; i < 6; i += 1) {
    if (i === 3) continue;
    const actor = create(i % 2 ? 'studentMale' : 'studentFemale', `student-${i + 1}`,
      [0x627b87, 0x998b83, 0x87957e, ORANGE, 0x665d6b, 0x555f65][i]);
    if (i === 1) d.box(actor, 'held-book', [-0.27, 1.05, 0.05], [0.19, 0.3, 0.045], 0x9aa88b);
    if (i === 2) d.box(actor, 'backpack', [0, 1.08, -0.24], [0.32, 0.43, 0.14], 0x7b827e);
  }
  const hint = new THREE.PointLight(0xffb46e, 0, 1.5, 2);
  hint.name = 'orange-phone-hint'; hint.position.set(0.02, 1.18, 0.29);
  ayuan.add(hint); actors['orange-phone-hint'] = hint;
  // 独立暖光薄片，不篡改可能热替换的共享人物材质。
  const screen = d.box(ayuan, 'orange-phone-screen', [0.02, 1.1928, 0.216], [0.066, 0.13, 0.003], ORANGE);
  const screenMaterial = screen.material as THREE.MeshStandardMaterial;
  screenMaterial.emissive.setHex(0xffbe78);
  screenMaterial.emissiveIntensity = 0.08;
  actors['orange-phone-screen'] = screen;
  return { occluders, actors };
}

interface Session {
  context: SceneRuntimeContext;
  scene: InteriorScene;
  unsubscribe: Array<() => void>;
  models: Map<THREE.Object3D, THREE.Object3D | null>;
  rotations: Map<THREE.Object3D, number>;
  time: number;
  noticed: boolean;
}
let session: Session | null = null;
function studentVisibility(current: Session, ids: readonly string[] = []): void {
  if (session !== current) return;
  for (const { id } of INTERIOR_LOCATIONS.students) current.context.setInteractableVisible(id, ids.includes(id));
}
function glow(current: Session): void {
  const hint = current.context.actors['orange-phone-hint'];
  const screen = current.context.actors['orange-phone-screen'];
  const night = current.scene === 'C6';
  const noticed = current.scene === 'C5' && current.noticed;
  if (hint instanceof THREE.PointLight) hint.intensity = night ? 0.32 : noticed ? 0.09 : 0;
  if (screen instanceof THREE.Mesh) (screen.material as THREE.MeshStandardMaterial).emissiveIntensity = night ? 0.9 : noticed ? 0.32 : 0.08;
}
function clearRuntime(): void {
  const current = session;
  if (!current) return;
  studentVisibility(current);
  session = null; // 先失效：已经进入事件队列的旧闭包也不能修改新场景。
  current.unsubscribe.forEach((off) => off());
  for (const [actor, z] of current.rotations) { actor.rotation.z = z; resetPose(actor); }
}
export const schoolInteriorRuntime: SceneRuntime = {
  enter(context): void {
    if (session?.context === context && session.scene === context.sceneId) return;
    clearRuntime();
    if (!SCENES.includes(context.sceneId as InteriorScene)) return;
    const scene = context.sceneId as InteriorScene;
    const current: Session = { context, scene, unsubscribe: [], models: new Map(), rotations: new Map(), time: 0, noticed: context.storyFlags?.noticedTyper ?? false };
    session = current;
    studentVisibility(current);
    const place = (name: string, location: { x: number; z: number }, yaw = -Math.PI / 2): void => {
      const actor = context.actors[name];
      if (!actor) return;
      actor.visible = true; actor.position.set(location.x, 0, location.z); actor.rotation.set(0, yaw, 0);
      const seated = name === 'linxia' && scene === 'C2';
      const props = actor.getObjectByName('actor-props');
      if (props) props.visible = !seated;
      poseActor(actor, seated, !seated);
      current.models.set(actor, findActorModelRoot(actor)?.root ?? null);
      current.rotations.set(actor, actor.rotation.z);
    };
    for (const name of ['linxia', 'ayuan', ...INTERIOR_LOCATIONS.students.map(({ id }) => id)]) {
      const actor = context.actors[name]; if (actor) actor.visible = false;
    }
    if (context.actors['linxia-sketchbook']) context.actors['linxia-sketchbook'].visible = scene === 'C2';
    if (scene === 'C2') place('linxia', INTERIOR_LOCATIONS.linxiaDesk, Math.PI);
    if (scene === 'C4') place('linxia', INTERIOR_LOCATIONS.stairwellActor);
    if (scene === 'C5') for (const student of INTERIOR_LOCATIONS.students) place(student.id, student);
    if (scene === 'C6') place('ayuan', INTERIOR_LOCATIONS.stairwellActor);
    if (scene === 'D1') place('ayuan', INTERIOR_LOCATIONS.platformActor);
    if (scene === 'D6') {
      place('linxia', INTERIOR_LOCATIONS.corridorLinxia);
      place('ayuan', INTERIOR_LOCATIONS.corridorAyuan);
      if (context.actors.ayuan) context.actors.ayuan.visible = context.storyFlags?.joined ?? false;
    }
    const fill = context.actors['interior-fill'];
    const sunset = context.actors['interior-sunset'];
    const night = scene === 'C6'; const evening = scene === 'D1' || scene === 'D6';
    if (fill instanceof THREE.HemisphereLight) {
      fill.color.setHex(night ? 0x7894c5 : evening ? 0xffd5ae : 0xffefdb);
      fill.groundColor.setHex(night ? 0x303f60 : 0x86968b);
      fill.intensity = night ? 0.28 : evening ? 0.8 : 1.25;
    }
    if (sunset instanceof THREE.PointLight) sunset.intensity = evening ? 18 : 0;
    if (context.actors['window-greenery']) context.actors['window-greenery'].visible = !night;
    glow(current);
    const active = (): boolean => session === current;
    current.unsubscribe.push(context.bus.on('state:changed', (event) => {
      if (!active() || event.sceneId !== scene) return;
      current.noticed = event.state.noticedTyper;
      if (scene === 'D6' && context.actors.ayuan) context.actors.ayuan.visible = event.state.joined;
      glow(current);
    }));
    if (scene !== 'C5') return;
    const hide = (): void => { if (active()) studentVisibility(current); };
    current.unsubscribe.push(context.bus.on('ui:showChoices', ({ stepId, options }) => {
      if (active()) studentVisibility(current, stepId === 'c5-recognize' ? options.map(({ id }) => id) : []);
    }));
    // 菜单/手机/对话等接管后立即禁用，认错次数上限通过 core 已过滤的 options 呈现。
    for (const event of ['ui:showPhone', 'ui:showDialogue', 'ui:showArt', 'ui:showMinigame',
      'ui:showIntertitle', 'scene:cutscene', 'scene:transition'] as const)
      current.unsubscribe.push(context.bus.on(event, hide));
  },
  tick(dtSeconds): void {
    if (!session || !Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
    session.time += Math.min(dtSeconds, 0.1);
    for (const [actor, base] of session.rotations) {
      const root = findActorModelRoot(actor)?.root ?? null;
      if (root !== session.models.get(actor)) {
        poseActor(actor, actor === session.context.actors.linxia && session.scene === 'C2', true);
        session.models.set(actor, root);
      }
      if (actor.visible) actor.rotation.z = base + Math.sin(session.time * 1.5) * 0.003;
    }
  },
  exit: clearRuntime,
};

export function createSchoolInteriorDefinition(sceneId: SceneId): WorldSceneDefinition {
  if (!SCENES.includes(sceneId as InteriorScene)) throw new Error(`教学楼不支持场景：${sceneId}`);
  const scene = sceneId as InteriorScene;
  const zone = scene === 'C4' ? { id: 'stairwell-corner', ...INTERIOR_LOCATIONS.stairwell }
    : scene === 'C6' ? { id: 'night-phone', ...INTERIOR_LOCATIONS.stairwell }
      : scene === 'D1' ? { id: 'platform-ayuan', ...INTERIOR_LOCATIONS.platform }
        : scene === 'D6' ? { id: 'corridor-linxia', ...INTERIOR_LOCATIONS.corridor } : null;
  return {
    sceneKey: 'interior', spawn: { ...INTERIOR_LOCATIONS.spawns[scene] }, nav: navigation(scene),
    // 同 key 不重建，首次进入预载共享几何实际使用的四类角色；main 负责懒加载本模块。
    requiredModels: [...MODELS], footstepSurface: 'stone', build: buildSchoolInterior,
    interactables: scene === 'C2' ? INTERIOR_LOCATIONS.seats.map(({ id, x, y, z }) => ({
      id, position: { x, y, z }, lightOffsetY: 0.6, maxDistance: 2.8, hitRadius: 0.3,
    })) : scene === 'C5' ? INTERIOR_LOCATIONS.students.map(({ id, x, z }) => ({
      id, position: { x: x - 0.5, y: 1.1, z }, lightOffsetY: 0.3, maxDistance: 2.8, hitRadius: 0.28,
    })) : [],
    zones: zone ? [{ id: zone.id, kind: 'circle', center: { x: zone.x, y: 0, z: zone.z }, radius: 0.8, once: true }] : [],
    targetGuides: zone ? [{ id: zone.id, position: { x: zone.x, y: 0.8, z: zone.z } }] : [],
    panoramaAnchor: scene === 'D1' ? {
      position: { x: 6.55, y: 1.54, z: 5.05 }, lookAt: { x: 8.3, y: 1.35, z: 5 },
    } : undefined,
  };
}
