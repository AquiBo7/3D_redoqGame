// S12 / S13 共用食堂；模块预载不建几何、不访问 DOM、不订阅事件，也不请求模型。
import * as THREE from 'three';
import type { SceneId } from '../data/storySchema';
import type {
  NavigationConfig, SceneRuntime, SceneRuntimeContext, WorldSceneDefinition, ZoneConfig,
} from '../world/worldSceneTypes';
import { createTextSign } from './shared';

type V3 = [number, number, number];
interface Part { p: V3; s: V3; r?: V3; color?: number }

/** 脚底坐标，可直接用于浏览器 teleport；窗口锚点不是可站立位置。 */
export const CANTEEN_LOCATIONS = {
  spawn: { x: 0, z: 8.4, yaw: 0, pitchDeg: -4 },
  whispers: [
    { id: 'canteen-whisper-1', x: -3.5, z: 5.4, radius: 1.1 },
    { id: 'canteen-whisper-2', x: 0, z: 2.4, radius: 1.1 },
    { id: 'canteen-whisper-3', x: 2.1, z: -5.5, radius: 1.05 },
  ],
  windowThree: { x: 2.2, y: 1.05, z: -7.62 },
  windowApproach: { x: 2.2, z: -6.65 },
} as const;

const TABLES = [-5.5, 5.5].flatMap((x) => [5.4, 1.5, -2.4].map((z) => ({ x, z })));
const WINDOWS = [-6.6, -2.2, 2.2, 6.6];
// 第一组围坐靠窗餐桌，第二组站在中间，第三组在窗口旁；不占用目标窗口的接近路线。
const STUDENTS = [
  [
    { x: -4.8, z: 4.48, yaw: 0, seated: true },
    { x: -4.8, z: 6.32, yaw: Math.PI, seated: true },
    { x: -6.2, z: 4.48, yaw: 0.35, seated: true },
  ],
  [
    { x: -0.65, z: 0.35, yaw: 1.25, seated: false },
    { x: 0.2, z: -0.4, yaw: 0, seated: false },
    { x: 0.95, z: 0.4, yaw: -1.25, seated: false },
  ],
  [
    { x: 3.6, z: -5.6, yaw: 1.1, seated: false },
    { x: 4.5, z: -5.5, yaw: -1.1, seated: false },
    { x: 4.05, z: -6.35, yaw: 0, seated: false },
  ],
];

function navigation(): NavigationConfig {
  return {
    groundY: 0,
    bounds: { minX: -8.45, maxX: 8.45, minZ: -8.9, maxZ: 9.4 },
    obstacles: [
      { id: 'canteen-serving-line', minX: -8.8, maxX: 8.8, minZ: -9.8, maxZ: -7.75, height: 1.65 },
      ...TABLES.map(({ x, z }, i) => ({
        id: `canteen-table-${i}`, minX: x - 1.55, maxX: x + 1.55,
        minZ: z - 1.3, maxZ: z + 1.3, height: 1,
      })),
      ...STUDENTS.slice(1).flatMap((students, i) => students.map(({ x, z }, j) => ({
        id: `canteen-standing-${i + 2}-${j}`, minX: x - 0.29, maxX: x + 0.29,
        minZ: z - 0.29, maxZ: z + 0.29, height: 1.75,
      }))),
    ],
  };
}

/** 资源只在单次 build 内复用，全部可由 WorldApp 的树遍历释放。 */
function details() {
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const sphere = new THREE.SphereGeometry(1, 12, 8);
  const palette = new Map<string, THREE.MeshStandardMaterial>();
  function matte(color: number, roughness = 0.8, metalness = 0): THREE.MeshStandardMaterial {
    const key = `${color}:${roughness}:${metalness}`;
    let material = palette.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
      palette.set(key, material);
    }
    return material;
  }
  function mesh(parent: THREE.Object3D, name: string, geometry: THREE.BufferGeometry,
    material: THREE.Material, p: V3, s: V3): THREE.Mesh {
    const object = new THREE.Mesh(geometry, material);
    object.name = name;
    object.position.set(...p);
    object.scale.set(...s);
    // 不添加投影者，局部接触阴影采用几何薄片；沿用世界现有光照。
    object.castShadow = false;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  function batch(parent: THREE.Object3D, name: string, geometry: THREE.BufferGeometry,
    material: THREE.Material, parts: Part[]): THREE.InstancedMesh {
    const object = new THREE.InstancedMesh(geometry, material, parts.length);
    object.name = name;
    const transform = new THREE.Object3D();
    parts.forEach((part, index) => {
      transform.position.set(...part.p);
      transform.scale.set(...part.s);
      transform.rotation.set(...(part.r ?? [0, 0, 0]));
      transform.updateMatrix();
      object.setMatrixAt(index, transform.matrix);
      if (part.color !== undefined) object.setColorAt(index, new THREE.Color(part.color));
    });
    object.instanceMatrix.needsUpdate = true;
    if (object.instanceColor) object.instanceColor.needsUpdate = true;
    object.receiveShadow = true;
    object.computeBoundingBox();
    object.computeBoundingSphere();
    // WorldApp 只 dispose geometry/material，因此将实例缓冲的清理绑定到局部 geometry。
    const release = (): void => {
      object.dispose();
      geometry.removeEventListener('dispose', release);
    };
    geometry.addEventListener('dispose', release);
    parent.add(object);
    return object;
  }
  return {
    matte, mesh, batch, sphere,
    box: (parent: THREE.Object3D, name: string, p: V3, s: V3, material: THREE.Material) =>
      mesh(parent, name, cube, material, p, s),
    boxes: (parent: THREE.Object3D, name: string, material: THREE.Material, parts: Part[]) =>
      batch(parent, name, cube, material, parts),
  };
}
type Details = ReturnType<typeof details>;
function group(parent: THREE.Object3D, name: string): THREE.Group {
  const object = new THREE.Group();
  object.name = name;
  parent.add(object);
  return object;
}

/** 小尺寸确定性水磨石纹理：零网络，九宫色碎石，重复约每两米一次。 */
function terrazzo(): THREE.MeshStandardMaterial {
  const size = 256;
  const pixels = new Uint8Array(size * size * 4);
  let seed = 127;
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < size * size; i += 1) {
    const noise = Math.floor(random() * 7);
    pixels.set([237 - noise, 233 - noise, 221 - noise, 255], i * 4);
  }
  const colors = [[177, 180, 164], [203, 183, 160], [246, 244, 231], [150, 164, 158]];
  for (let i = 0; i < 1300; i += 1) {
    const x = Math.floor(random() * size);
    const y = Math.floor(random() * size);
    const radius = 1 + Math.floor(random() * 3);
    const color = colors[i % colors.length];
    for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
      if (Math.abs(dx) + Math.abs(dy) > radius) continue;
      pixels.set([...color, 255], (((y + dy + size) % size) * size + (x + dx + size) % size) * 4);
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(9, 10);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.67 });
  material.addEventListener('dispose', () => texture.dispose());
  return material;
}

function architecture(parent: THREE.Object3D, d: Details, occluders: THREE.Object3D[]): void {
  const cream = d.matte(0xeee7d9);
  const sage = d.matte(0x7d9182);
  const frame = d.matte(0x53665e, 0.5, 0.25);
  const floor = d.mesh(parent, 'canteen-terrazzo-floor', new THREE.PlaneGeometry(18, 20), terrazzo(),
    [0, 0, 0], [1, 1, 1]);
  floor.rotation.x = -Math.PI / 2;
  const walls = group(parent, 'canteen-walls');
  d.boxes(walls, 'canteen-wall-shell', cream, [
    { p: [0, 2.25, -10], s: [18.3, 4.5, 0.25] },
    { p: [9, 2.25, 0], s: [0.25, 4.5, 20] },
    { p: [0, 2.25, 10], s: [18.3, 4.5, 0.25] },
    { p: [-9, 0.42, 0], s: [0.25, 0.84, 20] },
    { p: [-9, 4.08, 0], s: [0.25, 0.84, 20] },
  ]);
  d.boxes(walls, 'canteen-sage-wainscot', sage, [
    { p: [8.86, 0.48, 0], s: [0.035, 0.96, 20] },
    { p: [0, 0.48, 9.86], s: [18, 0.96, 0.035] },
    { p: [-8.86, 0.42, 0], s: [0.035, 0.84, 20] },
  ]);
  d.box(parent, 'canteen-ceiling', [0, 4.57, 0], [18.3, 0.14, 20.3], cream);
  const mullions: Part[] = [];
  const panes: Part[] = [];
  for (let z = -10; z <= 10; z += 4) {
    mullions.push({ p: [-8.97, 2.25, z], s: [0.22, 3, 0.12] });
    if (z < 10) panes.push({ p: [-9.01, 2.25, z + 2], s: [0.025, 2.78, 3.88] });
  }
  for (const y of [0.86, 2.7, 3.64]) mullions.push({ p: [-8.94, y, 0], s: [0.25, 0.08, 20] });
  d.boxes(walls, 'canteen-window-frames', frame, mullions);
  const glass = new THREE.MeshStandardMaterial({ color: 0xcadfd8, roughness: 0.18,
    transparent: true, opacity: 0.14, depthWrite: false });
  d.boxes(parent, 'canteen-window-glass', glass, panes);
  d.boxes(parent, 'canteen-window-sills', cream, [0.86, 3.64].map((y) => ({
    p: [-8.86, y, 0], s: [0.46, 0.1, 20],
  })));
  occluders.push(walls);

  // 闭合后墙上的双扇入口，装饰门不承担跨场景逻辑。
  d.box(parent, 'canteen-entry-recess', [0, 1.4, 9.82], [3, 2.8, 0.05], frame);
  d.boxes(parent, 'canteen-entry-door-panels', d.matte(0xbed2cc), [-0.73, 0.73].map((x) => ({
    p: [x, 1.42, 9.77], s: [1.39, 2.6, 0.04],
  })));
  d.boxes(parent, 'canteen-entry-handles', frame, [-0.16, 0.16].map((x) => ({
    p: [x, 1.25, 9.68], s: [0.04, 0.48, 0.06],
  })));
  const ribs: Part[] = [];
  for (let z = -8; z <= 8; z += 4) ribs.push({ p: [0, 4.35, z], s: [18, 0.22, 0.12] });
  d.boxes(parent, 'canteen-ceiling-ribs', d.matte(0xd0c7b6), ribs);
  const lamp = d.matte(0xfff2ce, 0.4);
  lamp.emissive.setHex(0xffdfaa);
  lamp.emissiveIntensity = 0.8;
  d.boxes(parent, 'canteen-ceiling-light-panels', lamp, [-5.5, 0, 5.5].flatMap((x) =>
    [-5.5, -0.5, 4.5].map((z) => ({ p: [x, 4.25, z], s: [1.65, 0.045, 0.48] }))));
  // 仅补室内漫反射，不创建实时投影或逐档口点光源。
  const fill = new THREE.HemisphereLight(0xffefd7, 0x8a9687, 1.15);
  fill.name = 'canteen-shadowless-fill';
  parent.add(fill);

  const garden = group(parent, 'canteen-window-garden');
  d.box(garden, 'canteen-garden-ground', [-13, -0.08, 0], [8, 0.12, 26], d.matte(0x91a67b));
  d.box(garden, 'canteen-garden-low-wall', [-16.7, 0.65, 0], [0.3, 1.3, 26], d.matte(0xc4c1a7));
  const trunks: Part[] = [];
  const leaves: Part[] = [];
  for (let z = -9; z <= 9; z += 3) {
    trunks.push({ p: [-12.5, 1.5, z], s: [0.16, 3, 0.16] });
    leaves.push({ p: [-12.5, 3.5, z], s: [1.45, 1.8, 1.3], color: 0x819e69 },
      { p: [-11.5, 3.05, z + 0.5], s: [1.1, 1.25, 1.05], color: 0xa5b887 },
      { p: [-10.2, 0.65, z], s: [0.75, 0.6, 1.4], color: 0x6b8d67 });
  }
  d.boxes(garden, 'canteen-tree-trunks', d.matte(0x8d7e63), trunks);
  d.batch(garden, 'canteen-tree-foliage', d.sphere, d.matte(0xffffff), leaves);
}

function furniture(parent: THREE.Object3D, d: Details, occluders: THREE.Object3D[]): void {
  const dining = group(parent, 'canteen-dining');
  const tops: Part[] = [];
  const metal: Part[] = [];
  const seats: Part[] = [];
  const trays: Part[] = [];
  for (const { x, z } of TABLES) {
    tops.push({ p: [x, 0.77, z], s: [2.8, 0.075, 0.9] });
    for (const dx of [-1.08, 1.08]) for (const dz of [-0.3, 0.3]) {
      metal.push({ p: [x + dx, 0.37, z + dz], s: [0.055, 0.74, 0.055] });
    }
    for (const dx of [-0.7, 0.7]) for (const side of [-1, 1]) {
      const cz = z + side * 0.92;
      seats.push({ p: [x + dx, 0.45, cz], s: [0.46, 0.055, 0.45] },
        { p: [x + dx, 0.76, cz + side * 0.2], s: [0.46, 0.46, 0.045] });
      for (const lx of [-0.18, 0.18]) for (const lz of [-0.17, 0.17]) metal.push({
        p: [x + dx + lx, 0.22, cz + lz], s: [0.033, 0.44, 0.033],
      });
    }
    trays.push({ p: [x - 0.7, 0.821, z], s: [0.42, 0.025, 0.31] });
  }
  d.boxes(dining, 'canteen-tabletops', d.matte(0xdcc9a4, 0.66), tops);
  d.boxes(dining, 'canteen-table-chair-legs', d.matte(0x68756e, 0.48, 0.4), metal);
  d.boxes(dining, 'canteen-chair-seats-backs', d.matte(0x879a82), seats);
  d.boxes(dining, 'canteen-dining-trays', d.matte(0xc2cbc2, 0.4, 0.25), trays);
  d.batch(dining, 'canteen-dining-bowls', new THREE.CylinderGeometry(0.09, 0.055, 0.07, 16),
    d.matte(0xf4eee0, 0.4), TABLES.map(({ x, z }) => ({ p: [x - 0.78, 0.863, z], s: [1, 1, 1] })));
  occluders.push(dining);
  // 两层低透明度接触底色，避免没有新增投影时家具像悬浮。
  const shadow = new THREE.MeshBasicMaterial({ color: 0x55594c, transparent: true, opacity: 0.07, depthWrite: false });
  d.boxes(parent, 'canteen-table-contact-shadows', shadow, TABLES.flatMap(({ x, z }) => [
    { p: [x, 0.004, z], s: [2.9, 0.002, 1.65] },
    { p: [x, 0.007, z], s: [2.65, 0.002, 1.25] },
  ]));
}

function servingLine(parent: THREE.Object3D, d: Details, occluders: THREE.Object3D[]): void {
  const counter = group(parent, 'canteen-serving-counters');
  const steel = d.matte(0xb5c1bb, 0.32, 0.55);
  const dark = d.matte(0x53645d, 0.48, 0.2);
  const glow = d.matte(0xfff0c7, 0.35);
  glow.emissive.setHex(0xffe0a1);
  glow.emissiveIntensity = 0.55;
  const pans: Part[] = [];
  const food: Part[] = [];
  const slats: Part[] = [];
  const trayStacks: Part[] = [];
  for (const [index, x] of WINDOWS.entries()) {
    d.box(counter, `canteen-counter-${index + 1}`, [x, 0.48, -8.6], [4.3, 0.96, 1.7], d.matte(0x8a9c87));
    d.box(counter, `canteen-counter-top-${index + 1}`, [x, 1.0, -8.55], [4.32, 0.08, 1.6], steel);
    d.box(counter, `canteen-service-recess-${index + 1}`, [x, 1.95, -9.81], [4.08, 1.66, 0.04], dark);
    d.box(counter, `canteen-lightbox-${index + 1}`, [x, 2.92, -8.82], [3.94, 0.62, 0.2], glow);
    const label = createTextSign(`${['一', '二', '三', '四'][index]}号窗口`, 3.64, 0.46,
      { background: '#fff0cc', foreground: '#465d51' });
    label.name = `canteen-window-label-${index + 1}`;
    label.position.set(x, 2.92, -8.71);
    label.castShadow = false;
    const labelMaterial = label.material as THREE.MeshStandardMaterial;
    labelMaterial.emissive.setHex(0xffeac3);
    labelMaterial.emissiveMap = labelMaterial.map;
    labelMaterial.emissiveIntensity = 0.25;
    counter.add(label);
    // 三号窗口锚点前置于台沿外，交互光点不会被自身台面遮挡。
    d.box(counter, `canteen-pass-shelf-${index + 1}`, [x, 1.04, -7.93], [3.9, 0.065, 0.35], steel);
    d.box(counter, `canteen-warmer-canopy-${index + 1}`, [x, 1.68, -8.48], [3.8, 0.09, 0.8], steel);
    d.box(counter, `canteen-warmer-light-${index + 1}`, [x, 1.626, -8.48], [3.5, 0.014, 0.35], glow);
    for (const dx of [-1.78, 1.78]) slats.push({ p: [x + dx, 1.36, -8.7], s: [0.035, 0.6, 0.035] });
    for (let k = 0; k < 9; k += 1) slats.push({ p: [x - 1.65 + k * 0.41, 0.51, -7.735], s: [0.022, 0.72, 0.016] });
    for (let k = 0; k < 4; k += 1) {
      pans.push({ p: [x - 1.27 + k * 0.7, 1.075, -8.43], s: [0.6, 0.06, 0.49] });
      food.push({ p: [x - 1.27 + k * 0.7, 1.11, -8.43], s: [0.5, 0.025, 0.39],
        color: [0x8eab68, 0xd5a766, 0xf2e5c4, 0xbb7953][k] });
      for (let piece = 0; piece < 5; piece += 1) food.push({
        p: [x - 1.43 + k * 0.7 + (piece % 3) * 0.14, 1.135, -8.54 + Math.floor(piece / 3) * 0.15],
        s: [0.1, 0.028, 0.1], color: [0xabc183, 0xe0ba81, 0xf8efd8, 0xcf946b][k],
      });
    }
    for (let k = 0; k < 6; k += 1) trayStacks.push({
      p: [x + 1.62, 1.07 + k * 0.026, -8.02], s: [0.36, 0.018, 0.27],
    });
  }
  d.boxes(counter, 'canteen-counter-trim-posts', dark, slats);
  d.boxes(counter, 'canteen-hot-food-pans', steel, pans);
  d.boxes(counter, 'canteen-hot-food', d.matte(0xffffff), food);
  d.boxes(counter, 'canteen-tray-stacks', steel, trayStacks);
  occluders.push(counter);
}

function student(parent: THREE.Object3D, d: Details, index: number, seated: boolean): THREE.Group {
  const actor = group(parent, `canteen-student-${index}`);
  const motion = group(actor, 'canteen-student-motion');
  const shirt = d.matte([0xa7b7aa, 0xc7b9a6, 0x8d9cac][index % 3]);
  const skin = d.matte(0xd5b99a);
  const pants = d.matte(0x535f63);
  const bodyY = seated ? 0.86 : 1.12;
  d.mesh(motion, 'canteen-student-torso', d.sphere, shirt, [0, bodyY, 0], [0.23, 0.32, 0.16]);
  const head = group(motion, 'canteen-student-head');
  head.position.set(0, bodyY + 0.46, 0.015);
  head.rotation.x = 0.2;
  d.mesh(head, 'canteen-student-face', d.sphere, skin, [0, 0, 0], [0.145, 0.18, 0.14]);
  d.mesh(head, 'canteen-student-hair', d.sphere, d.matte(0x4d4c43), [0, 0.07, -0.035], [0.151, 0.14, 0.13]);
  d.box(head, 'canteen-student-nose', [0, -0.02, 0.14], [0.045, 0.055, 0.04], skin);
  for (const side of [-1, 1]) {
    if (seated) d.box(actor, 'canteen-student-thigh', [side * 0.12, 0.55, 0.13], [0.16, 0.16, 0.46], pants);
    d.box(actor, 'canteen-student-leg', [side * 0.12, seated ? 0.27 : 0.4, seated ? 0.3 : 0],
      [0.13, seated ? 0.48 : 0.8, 0.14], pants);
    d.box(actor, 'canteen-student-shoe', [side * 0.12, 0.065, seated ? 0.36 : 0.065],
      [0.15, 0.1, 0.27], d.matte(0xe0ded0));
    const arm = d.box(motion, 'canteen-student-arm', [side * 0.22, bodyY - 0.045, 0.16], [0.11, 0.36, 0.12], shirt);
    arm.rotation.x = -0.6;
    d.mesh(motion, 'canteen-student-hand', d.sphere, skin,
      [side * 0.115, bodyY - 0.03, 0.33], [0.06, 0.06, 0.055]);
  }
  const phone = d.box(motion, 'canteen-student-phone', [0, bodyY, 0.33], [0.085, 0.15, 0.022], d.matte(0x3e4d4d));
  phone.rotation.x = -0.45;
  const screen = d.matte(0xd3e1d6, 0.4);
  screen.emissive.setHex(0xa4bfbd);
  screen.emissiveIntensity = 0.18;
  d.box(phone, 'canteen-student-phone-screen', [0, 0, -0.55], [0.83, 0.87, 0.1], screen);
  return actor;
}

function buildCanteen(parent: THREE.Object3D) {
  const root = group(parent, 'canteen-environment');
  const d = details();
  const occluders: THREE.Object3D[] = [];
  architecture(root, d, occluders);
  furniture(root, d, occluders);
  servingLine(root, d, occluders);
  const actors: Record<string, THREE.Object3D> = {};
  STUDENTS.forEach((students, i) => {
    const id = CANTEEN_LOCATIONS.whispers[i].id;
    const crowd = group(root, id);
    students.forEach(({ x, z, yaw, seated }, j) => {
      const actor = student(crowd, d, i * 3 + j, seated);
      actor.position.set(x, 0, z);
      actor.rotation.y = yaw;
    });
    actors[id] = crowd;
    occluders.push(crowd);
  });
  return { occluders, actors };
}

interface StudentMotion {
  actor: THREE.Object3D;
  motion: THREE.Object3D;
  head: THREE.Object3D;
  rotation: THREE.Euler;
  headRotation: THREE.Euler;
  scale: THREE.Vector3;
  phase: number;
  stopped: boolean;
  targetYaw: number;
}
interface CanteenSession {
  context: SceneRuntimeContext;
  groups: Map<string, StudentMotion[]>;
  time: number;
  unsubscribe?: () => void;
}
let session: CanteenSession | null = null;

function clearRuntime(): void {
  if (!session) return;
  session.unsubscribe?.();
  for (const students of session.groups.values()) for (const record of students) {
    record.motion.rotation.copy(record.rotation);
    record.motion.scale.copy(record.scale);
    record.head.rotation.copy(record.headRotation);
  }
  session = null;
}

/** 只消费视觉事件，不发事件、不触碰剧情状态；tick 驱动，无计时器或 GSAP 残留。 */
export const canteenRuntime: SceneRuntime = {
  enter(context): void {
    if (context.sceneId !== 'S12' && context.sceneId !== 'S13') {
      clearRuntime();
      return;
    }
    const sameActors = session && CANTEEN_LOCATIONS.whispers.every(({ id }) =>
      session!.context.actors[id] === context.actors[id]);
    if (session && sameActors && session.context.bus === context.bus &&
      (session.context.sceneId === context.sceneId || context.sceneId === 'S13')) {
      // 同 key 切到 S13 不重建演员，不把已经收住的话头重新启动。
      session.context = context;
      if (context.sceneId === 'S13') {
        session.unsubscribe?.();
        session.unsubscribe = undefined;
      }
      return;
    }
    clearRuntime();
    const current: CanteenSession = { context, groups: new Map(), time: 0 };
    session = current;
    for (const { id } of CANTEEN_LOCATIONS.whispers) {
      const records: StudentMotion[] = [];
      for (const [i, actor] of (context.actors[id]?.children ?? []).entries()) {
        const motion = actor.getObjectByName('canteen-student-motion');
        const head = actor.getObjectByName('canteen-student-head');
        if (!motion || !head) continue;
        records.push({ actor, motion, head, rotation: motion.rotation.clone(), headRotation: head.rotation.clone(),
          scale: motion.scale.clone(), phase: i * 1.8, stopped: false, targetYaw: head.rotation.y });
      }
      current.groups.set(id, records);
    }
    if (context.sceneId !== 'S12') return;
    current.unsubscribe = context.bus.on('scene:enterZone', ({ sceneId, zoneId }) => {
      if (sceneId !== 'S12' || current.context.sceneId !== 'S12') return;
      const zone = CANTEEN_LOCATIONS.whispers.find(({ id }) => id === zoneId);
      if (!zone) return;
      const target = new THREE.Vector3(zone.x, 1.55, zone.z);
      const feet = current.context.getPlayerFeet?.(new THREE.Vector3());
      if (feet) target.set(feet.x, feet.y + 1.55, feet.z);
      for (const record of current.groups.get(zoneId) ?? []) {
        if (record.stopped) continue;
        record.stopped = true;
        // 转入头部父节点坐标，适配演员朝向及场景根的平移/旋转。
        record.head.parent!.updateWorldMatrix(true, false);
        const localTarget = record.head.parent!.worldToLocal(target.clone()).sub(record.head.position);
        record.targetYaw = THREE.MathUtils.clamp(Math.atan2(localTarget.x, localTarget.z), -1.15, 1.15);
      }
    });
  },
  tick(dtSeconds): void {
    if (!session || !Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
    const dt = Math.min(dtSeconds, 0.1);
    session.time += dt;
    for (const records of session.groups.values()) for (const record of records) {
      if (record.stopped) {
        const alpha = 1 - Math.exp(-dt * 9);
        record.head.rotation.y += (record.targetYaw - record.head.rotation.y) * alpha;
        record.head.rotation.x += (0 - record.head.rotation.x) * alpha;
      } else {
        const wave = Math.sin(session.time * 1.65 + record.phase);
        record.motion.rotation.z = record.rotation.z + wave * 0.012;
        record.motion.scale.y = record.scale.y * (1 + Math.sin(session.time * 2 + record.phase) * 0.004);
        record.head.rotation.y = record.headRotation.y + Math.sin(session.time * 0.9 + record.phase) * 0.07;
      }
    }
  },
  exit: clearRuntime,
};

export function createCanteenDefinition(sceneId: SceneId): WorldSceneDefinition {
  const zones: ZoneConfig[] = sceneId === 'S12' ? CANTEEN_LOCATIONS.whispers.map(({ id, x, z, radius }) => ({
    id, kind: 'circle', center: { x, y: 0, z }, radius, once: true,
  })) : [];
  return {
    sceneKey: 'canteen',
    spawn: { ...CANTEEN_LOCATIONS.spawn },
    nav: navigation(),
    requiredModels: [],
    footstepSurface: 'stone',
    interactables: [{ id: 'window-three', position: { ...CANTEEN_LOCATIONS.windowThree },
      lightOffsetY: 0.32, hitRadius: 0.38, maxDistance: 3.2 }],
    targetGuides: [{ id: 'window-three', position: { ...CANTEEN_LOCATIONS.windowThree } }],
    zones,
    build: buildCanteen,
  };
}
