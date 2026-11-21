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
  const torsoGeo = new THREE.CylinderGeometry(0.16, 0.19, 0.56, 8);
  const limbGeo = new THREE.CylinderGeometry(0.055, 0.048, 1, 7);
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
    matte, mesh, batch, sphere, torsoGeo, limbGeo,
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

/** 斜射冷白日光光斑（靠左侧落地窗）：单网格逐顶点渐变，零贴图零额外光源。 */
function createCoolWindowPatches(): THREE.Mesh {
  const quads: Array<[V3, V3, V3, V3]> = [
    [[-8.78, 0.012, -8.2], [-8.78, 0.012, -4.6], [-3.1, 0.012, -6.9], [-3.1, 0.012, -3.5]],
    [[-8.78, 0.012, -4.0], [-8.78, 0.012, -0.4], [-3.1, 0.012, -2.7], [-3.1, 0.012, 0.7]],
    [[-8.78, 0.012, 0.2], [-8.78, 0.012, 3.8], [-3.1, 0.012, 1.5], [-3.1, 0.012, 4.9]],
    [[-8.78, 0.012, 4.4], [-8.78, 0.012, 8.0], [-3.1, 0.012, 5.7], [-3.1, 0.012, 9.1]],
  ];
  const cols = 3;
  const rows = 5;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const tint = new THREE.Color(0xdcebf4);
  for (const [nl, nr, fl, fr] of quads) {
    const offset = positions.length / 3;
    for (let r = 0; r <= rows; r += 1) {
      const v = r / rows;
      for (let c = 0; c <= cols; c += 1) {
        const u = c / cols;
        const nx = nl[0] + (nr[0] - nl[0]) * u;
        const ny = nl[1] + (nr[1] - nl[1]) * u;
        const nz = nl[2] + (nr[2] - nl[2]) * u;
        const fx = fl[0] + (fr[0] - fl[0]) * u;
        const fy = fl[1] + (fr[1] - fl[1]) * u;
        const fz = fl[2] + (fr[2] - fl[2]) * u;
        positions.push(nx + (fx - nx) * v, ny + (fy - ny) * v, nz + (fz - nz) * v);
        const falloff = Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * (1 - v * 0.35);
        colors.push(tint.r * falloff, tint.g * falloff, tint.b * falloff);
      }
    }
    for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
      const a = offset + r * (cols + 1) + c;
      const b = a + 1;
      const cIdx = a + cols + 1;
      const dIdx = cIdx + 1;
      indices.push(a, cIdx, b, b, cIdx, dIdx);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.16, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'canteen-window-light-patches';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.raycast = () => {};
  return mesh;
}

/** 小尺寸确定性冷灰水磨石纹理：零网络，低饱和冷石碎粒，重复约每两米一次。 */
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
    pixels.set([222 - noise, 227 - noise, 229 - noise, 255], i * 4);
  }
  const colors = [[165, 174, 178], [184, 189, 190], [235, 240, 241], [139, 154, 158]];
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
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.64 });
  material.addEventListener('dispose', () => texture.dispose());
  return material;
}

function architecture(parent: THREE.Object3D, d: Details, occluders: THREE.Object3D[]): void {
  // 清新偏压抑冷灰基调：60% 浅灰白墙面 + 30% 冷水泥/不锈钢与淡木 + 10% 焦点色
  const coolWall = d.matte(0xe3e8eb);
  const slateWainscot = d.matte(0x6d7f83);
  const frame = d.matte(0x4b5c61, 0.5, 0.25);
  const floor = d.mesh(parent, 'canteen-terrazzo-floor', new THREE.PlaneGeometry(18, 20), terrazzo(),
    [0, 0, 0], [1, 1, 1]);
  floor.rotation.x = -Math.PI / 2;
  const walls = group(parent, 'canteen-walls');
  d.boxes(walls, 'canteen-wall-shell', coolWall, [
    { p: [0, 2.25, -10], s: [18.3, 4.5, 0.25] },
    { p: [9, 2.25, 0], s: [0.25, 4.5, 20] },
    { p: [0, 2.25, 10], s: [18.3, 4.5, 0.25] },
    { p: [-9, 0.42, 0], s: [0.25, 0.84, 20] },
    { p: [-9, 4.08, 0], s: [0.25, 0.84, 20] },
  ]);
  d.boxes(walls, 'canteen-sage-wainscot', slateWainscot, [
    { p: [8.86, 0.48, 0], s: [0.035, 0.96, 20] },
    { p: [0, 0.48, 9.86], s: [18, 0.96, 0.035] },
    { p: [-8.86, 0.42, 0], s: [0.035, 0.84, 20] },
  ]);
  d.box(parent, 'canteen-ceiling', [0, 4.57, 0], [18.3, 0.14, 20.3], d.matte(0xdde3e7));
  const mullions: Part[] = [];
  const panes: Part[] = [];
  for (let z = -10; z <= 10; z += 4) {
    mullions.push({ p: [-8.97, 2.25, z], s: [0.22, 3, 0.12] });
    if (z < 10) panes.push({ p: [-9.01, 2.25, z + 2], s: [0.025, 2.78, 3.88] });
  }
  for (const y of [0.86, 2.7, 3.64]) mullions.push({ p: [-8.94, y, 0], s: [0.25, 0.08, 20] });
  d.boxes(walls, 'canteen-window-frames', frame, mullions);
  const glass = new THREE.MeshStandardMaterial({ color: 0xc2d8e0, roughness: 0.18,
    transparent: true, opacity: 0.15, depthWrite: false });
  d.boxes(parent, 'canteen-window-glass', glass, panes);
  d.boxes(parent, 'canteen-window-sills', coolWall, [0.86, 3.64].map((y) => ({
    p: [-8.86, y, 0], s: [0.46, 0.1, 20],
  })));
  occluders.push(walls);

  // 左侧落地长窗投射进地面的清冷斜射日光光斑
  parent.add(createCoolWindowPatches());

  // 闭合后墙上的双扇入口，装饰门不承担跨场景逻辑。
  d.box(parent, 'canteen-entry-recess', [0, 1.4, 9.82], [3, 2.8, 0.05], frame);
  d.boxes(parent, 'canteen-entry-door-panels', d.matte(0xb9c9cd), [-0.73, 0.73].map((x) => ({
    p: [x, 1.42, 9.77], s: [1.39, 2.6, 0.04],
  })));
  d.boxes(parent, 'canteen-entry-handles', frame, [-0.16, 0.16].map((x) => ({
    p: [x, 1.25, 9.68], s: [0.04, 0.48, 0.06],
  })));

  // 顶部纵横外露混凝土结构梁 + 悬吊式冷白条形荧光灯具 + 吊杆 + 通风管 + 工业吊扇
  const beams: Part[] = [];
  for (let z = -8; z <= 8; z += 4) beams.push({ p: [0, 4.34, z], s: [18.1, 0.28, 0.2] });
  for (const x of [-5.5, 0, 5.5]) beams.push({ p: [x, 4.4, 0], s: [0.18, 0.18, 20] });
  d.boxes(parent, 'canteen-ceiling-ribs', d.matte(0xc2cad0, 0.86), beams);

  const lampHousingParts: Part[] = [];
  const lampPanelParts: Part[] = [];
  const lampRodParts: Part[] = [];
  for (const x of [-5.5, 0, 5.5]) {
    for (const z of [-6, -2, 2, 6]) {
      lampHousingParts.push({ p: [x, 4.02, z], s: [2.1, 0.05, 0.24] });
      lampPanelParts.push({ p: [x, 3.988, z], s: [2.0, 0.025, 0.18] });
      for (const dx of [-0.78, 0.78]) {
        lampRodParts.push({ p: [x + dx, 4.26, z], s: [0.025, 0.48, 0.025] });
      }
    }
  }
  d.boxes(parent, 'canteen-light-housings', d.matte(0x889499, 0.52, 0.3), lampHousingParts);
  d.boxes(parent, 'canteen-light-rods', d.matte(0x6d797e, 0.45, 0.35), lampRodParts);
  const lamp = d.matte(0xeef6fb, 0.35);
  lamp.emissive.setHex(0xd8ecf8);
  lamp.emissiveIntensity = 0.78;
  d.boxes(parent, 'canteen-ceiling-light-panels', lamp, lampPanelParts);

  // 顶部镀锌风管与吊扇剪影
  d.boxes(parent, 'canteen-ceiling-vents', d.matte(0x5d686c, 0.78, 0.22), [
    { p: [-4.5, 4.44, -8.4], s: [3.8, 0.18, 0.52] },
    { p: [4.5, 4.44, -8.4], s: [3.8, 0.18, 0.52] },
    { p: [0, 4.44, 8.6], s: [4.6, 0.18, 0.52] },
    { p: [-2.8, 4.42, 0], s: [0.36, 0.18, 17.2] },
    { p: [2.8, 4.42, 0], s: [0.36, 0.18, 17.2] },
  ]);
  const fanParts: Part[] = [];
  for (const [fx, fz] of [[-2.75, 4], [2.75, 4], [-2.75, -4], [2.75, -4]] as const) {
    fanParts.push(
      { p: [fx, 4.26, fz], s: [0.04, 0.42, 0.04] },
      { p: [fx, 4.02, fz], s: [0.22, 0.07, 0.22] },
      { p: [fx, 4.0, fz], s: [1.35, 0.022, 0.14], r: [0, 0.35, 0] },
      { p: [fx, 4.0, fz], s: [1.35, 0.022, 0.14], r: [0, 1.92, 0] },
    );
  }
  d.boxes(parent, 'canteen-ceiling-fans', d.matte(0x7d8a8e, 0.55, 0.28), fanParts);

  // 踢脚线沿墙底一圈，收住墙裙与地面。
  d.boxes(parent, 'canteen-baseboard', d.matte(0x465054, 0.62), [
    { p: [0, 0.07, 9.87], s: [18.1, 0.14, 0.03] },
    { p: [8.87, 0.07, 0], s: [0.03, 0.14, 20] },
    { p: [-8.87, 0.07, 0], s: [0.03, 0.14, 20] },
  ]);

  // 结构立柱贴右侧墙：深灰防撞踢脚护角 + 宣传海报 + 右墙克制文明标语底板（零新增文字/贴图）
  const columns: Part[] = [];
  const columnGuards: Part[] = [];
  const posters: Part[] = [];
  const sloganFrames: Part[] = [];
  const sloganPanels: Part[] = [];
  const posterColors = [0x829ba0, 0xa89b88, 0x7c8f9c, 0x8e9994];
  const columnZ = [-6.5, -2, 2.5, 6.5];
  for (let i = 0; i < columnZ.length; i += 1) {
    columns.push({ p: [8.66, 2.25, columnZ[i]], s: [0.44, 4.5, 0.44] });
    columnGuards.push({ p: [8.65, 0.56, columnZ[i]], s: [0.47, 1.12, 0.47] });
    posters.push({ p: [8.41, 1.82, columnZ[i]], s: [0.035, 0.94, 0.62], color: posterColors[i] });
  }
  for (const sz of [-4.2, 0.3, 4.5]) {
    sloganFrames.push({ p: [8.84, 2.48, sz], s: [0.04, 0.68, 2.2] });
    sloganPanels.push({ p: [8.81, 2.48, sz], s: [0.02, 0.54, 2.02] });
  }
  d.boxes(parent, 'canteen-columns', d.matte(0xd6dde0), columns);
  d.boxes(parent, 'canteen-column-crash-guards', d.matte(0x454f54, 0.68, 0.18), columnGuards);
  d.boxes(parent, 'canteen-column-posters', d.matte(0xffffff), posters);
  d.boxes(parent, 'canteen-wall-slogan-frames', d.matte(0x526468, 0.64), sloganFrames);
  d.boxes(parent, 'canteen-wall-slogan-panels', d.matte(0xd2dce0, 0.85), sloganPanels);

  // 角落饮水机与餐具回收推车，补生活气息。
  const dispenser = group(parent, 'canteen-water-dispenser');
  dispenser.position.set(-8.2, 0, 9.2);
  d.box(dispenser, 'canteen-dispenser-body', [0, 0.55, 0], [0.42, 1.1, 0.36], d.matte(0xd0d7da, 0.48));
  d.box(dispenser, 'canteen-dispenser-tank', [0, 1.28, 0], [0.34, 0.34, 0.28], d.matte(0x8db2bc, 0.32));
  d.box(dispenser, 'canteen-dispenser-tray', [0, 0.32, 0.1], [0.3, 0.03, 0.16], d.matte(0x4a5558, 0.5));
  const trolley = group(parent, 'canteen-recycle-trolley');
  trolley.position.set(7.4, 0, 8.9);
  d.box(trolley, 'canteen-trolley-frame', [0, 0.62, 0], [0.9, 0.75, 0.55], d.matte(0x889397, 0.42, 0.36));
  d.boxes(trolley, 'canteen-trolley-wheels', d.matte(0x2f3538, 0.5), [-0.36, 0.36].flatMap((x) =>
    [-0.2, 0.2].map((z) => ({ p: [x, 0.08, z], s: [0.14, 0.16, 0.14] }))));

  // 冷白日光室内漫射补光，克制亮度让冷灰压抑氛围与三号窗口暖焦形成层次
  const fill = new THREE.HemisphereLight(0xe2ecf2, 0x728086, 1.04);
  fill.name = 'canteen-shadowless-fill';
  parent.add(fill);

  const garden = group(parent, 'canteen-window-garden');
  d.box(garden, 'canteen-garden-ground', [-13, -0.08, 0], [9, 0.12, 26], d.matte(0x808e7c));
  d.box(garden, 'canteen-garden-low-wall', [-16.9, 0.6, 0], [0.3, 1.2, 26], d.matte(0xb0b7b6));
  // 远景校园建筑立面剪影：错落冷灰楼体
  const facadeZ = [-10, -4.5, 1, 6.5];
  const facadeH = [4.6, 5.8, 3.9, 5.2];
  const facadeTone = [0x798891, 0x86949e, 0x708089, 0x809099];
  d.boxes(garden, 'canteen-far-campus', d.matte(0xffffff), facadeZ.map((z, i) => ({
    p: [-18.4, facadeH[i] / 2 - 0.08, z], s: [2.0, facadeH[i], 3.4], color: facadeTone[i],
  })));
  // 树干（微锥圆柱）+ 多层簇状树冠 + 低矮灌木，整体偏冷灰绿。
  const trunkGeo = new THREE.CylinderGeometry(0.06, 0.1, 1, 6);
  const trunks: Part[] = [];
  const foliage: Part[] = [];
  const shrubs: Part[] = [];
  let treeIndex = 0;
  for (let z = -9; z <= 9; z += 3) {
    const jitter = (treeIndex % 3) - 1;
    const x = -12.5 + jitter * 0.4;
    const h = 3.0 + (treeIndex % 3) * 0.28;
    trunks.push({ p: [x, h / 2, z], s: [1, h, 1] });
    foliage.push(
      { p: [x, h + 1.0, z], s: [1.5, 1.65, 1.35], color: 0x6f8c6c },
      { p: [x + 0.55, h + 0.45, z + 0.3], s: [1.0, 1.1, 0.95], color: 0x88a27f },
      { p: [x - 0.5, h + 0.3, z - 0.25], s: [0.95, 1.0, 0.9], color: 0x617f66 },
      { p: [x, h + 1.6, z], s: [0.85, 0.9, 0.8], color: 0x7e9977 },
    );
    shrubs.push({ p: [x + 1.2, 0.4, z + 0.8], s: [1.1, 0.8, 0.7], color: 0x5f7d69 });
    treeIndex += 1;
  }
  d.batch(garden, 'canteen-tree-trunks', trunkGeo, d.matte(0x746d60), trunks);
  d.batch(garden, 'canteen-tree-foliage', d.sphere, d.matte(0xffffff), foliage);
  d.batch(garden, 'canteen-shrubs', d.sphere, d.matte(0xffffff), shrubs);
}

function furniture(parent: THREE.Object3D, d: Details, occluders: THREE.Object3D[]): void {
  const dining = group(parent, 'canteen-dining');
  const tops: Part[] = [];
  const metal: Part[] = [];
  const seats: Part[] = [];
  const trays: Part[] = [];
  const chopsticks: Part[] = [];
  const bottles: Part[] = [];
  const tablePhones: Part[] = [];
  const bottleColors = [0x6f98a6, 0x86a37c, 0xc99668, 0x7d8fa4];

  TABLES.forEach(({ x, z }, tableIndex) => {
    // 校园连体四人金属管架餐桌（所有实例严格位于 x±1.55, z±1.3 碰撞框内）
    tops.push({ p: [x, 0.77, z], s: [2.8, 0.068, 0.9] });
    // 桌底纵向主横梁与两侧双立柱
    metal.push({ p: [x, 0.08, z], s: [2.2, 0.045, 0.055] });
    metal.push({ p: [x, 0.71, z], s: [2.36, 0.045, 0.06] });
    for (const dx of [-1.08, 1.08]) {
      for (const dz of [-0.3, 0.3]) {
        metal.push({ p: [x + dx, 0.37, z + dz], s: [0.05, 0.74, 0.05] });
      }
      metal.push({ p: [x + dx, 0.08, z], s: [0.045, 0.045, 0.64] });
    }
    // 贯穿桌底至四座位的横向连体钢管底轨 + 独立座柱 + 椅背双撑管
    for (const dx of [-0.7, 0.7]) {
      metal.push({ p: [x + dx, 0.06, z], s: [0.045, 0.045, 1.92] });
      for (const side of [-1, 1]) {
        const cz = z + side * 0.92;
        seats.push(
          { p: [x + dx, 0.45, cz], s: [0.46, 0.052, 0.44] },
          { p: [x + dx, 0.75, cz + side * 0.2], s: [0.46, 0.42, 0.042] },
        );
        metal.push(
          { p: [x + dx, 0.24, cz], s: [0.052, 0.4, 0.052] },
          { p: [x + dx, 0.42, cz], s: [0.36, 0.028, 0.32] },
          { p: [x + dx - 0.16, 0.59, cz + side * 0.2], s: [0.028, 0.34, 0.028] },
          { p: [x + dx + 0.16, 0.59, cz + side * 0.2], s: [0.028, 0.34, 0.028] },
        );
      }
    }
    // 桌面丰富生活小道具：不锈钢餐盘、筷子、饮料瓶、反扣/微亮手机
    trays.push({ p: [x - 0.7, 0.818, z - 0.08], s: [0.44, 0.022, 0.32] });
    trays.push({ p: [x + 0.18, 0.818, z + 0.14], s: [0.42, 0.022, 0.3] });
    chopsticks.push(
      { p: [x - 0.54, 0.836, z - 0.08], s: [0.012, 0.01, 0.22], r: [0, 0.12, 0] },
      { p: [x - 0.51, 0.836, z - 0.08], s: [0.012, 0.01, 0.22], r: [0, 0.04, 0] },
      { p: [x + 0.34, 0.836, z + 0.14], s: [0.012, 0.01, 0.22], r: [0, -0.1, 0] },
    );
    bottles.push({
      p: [x - 0.32, 0.905, z - 0.22], s: [1, 1, 1], color: bottleColors[tableIndex % bottleColors.length],
    });
    if (tableIndex % 2 === 0) {
      bottles.push({
        p: [x + 0.52, 0.905, z + 0.24], s: [0.92, 0.86, 0.92], color: bottleColors[(tableIndex + 2) % bottleColors.length],
      });
      tablePhones.push({
        p: [x - 0.12, 0.812, z + 0.22], s: [0.076, 0.012, 0.145], r: [0, 0.28 + tableIndex * 0.2, 0],
      });
    }
  });

  d.boxes(dining, 'canteen-tabletops', d.matte(0xd2d6d4, 0.58), tops);
  d.boxes(dining, 'canteen-table-chair-legs', d.matte(0x556267, 0.42, 0.48), metal);
  d.boxes(dining, 'canteen-chair-seats-backs', d.matte(0x75898b, 0.68), seats);
  d.boxes(dining, 'canteen-dining-trays', d.matte(0xbcc6c8, 0.36, 0.35), trays);
  d.boxes(dining, 'canteen-chopsticks', d.matte(0xbaa682, 0.78), chopsticks);
  d.batch(dining, 'canteen-dining-bowls', new THREE.CylinderGeometry(0.09, 0.055, 0.07, 14),
    d.matte(0xeceee9, 0.42), TABLES.map(({ x, z }) => ({ p: [x - 0.78, 0.86, z - 0.08], s: [1, 1, 1] })));
  d.batch(dining, 'canteen-drink-bottles', new THREE.CylinderGeometry(0.032, 0.036, 0.19, 10),
    d.matte(0xffffff, 0.32, 0.08), bottles);
  const tablePhoneMat = d.matte(0xc8e4f4, 0.32);
  tablePhoneMat.emissive.setHex(0x98cbe6);
  tablePhoneMat.emissiveIntensity = 0.28;
  d.boxes(dining, 'canteen-table-phones', tablePhoneMat, tablePhones);
  d.boxes(dining, 'canteen-tissue-boxes', d.matte(0xebeef0, 0.72), TABLES.map(({ x, z }) => ({
    p: [x + 0.74, 0.85, z], s: [0.22, 0.085, 0.15],
  })));
  d.batch(dining, 'canteen-condiment-jars', new THREE.CylinderGeometry(0.035, 0.028, 0.1, 8),
    d.matte(0x887f72, 0.52), TABLES.map(({ x, z }) => ({ p: [x + 1.02, 0.855, z], s: [1, 1, 1] })));
  occluders.push(dining);

  // 两层低透明度冷灰接触底色，避免没有新增投影时家具像悬浮。
  const shadow = new THREE.MeshBasicMaterial({ color: 0x454f54, transparent: true, opacity: 0.08, depthWrite: false });
  d.boxes(parent, 'canteen-table-contact-shadows', shadow, TABLES.flatMap(({ x, z }) => [
    { p: [x, 0.004, z], s: [2.9, 0.002, 1.95] },
    { p: [x, 0.007, z], s: [2.65, 0.002, 1.35] },
  ]));
}

function servingLine(parent: THREE.Object3D, d: Details, occluders: THREE.Object3D[]): void {
  const counter = group(parent, 'canteen-serving-counters');
  const steel = d.matte(0xb4c0c4, 0.3, 0.58);
  const dark = d.matte(0x47565b, 0.48, 0.24);
  // 1/2/4 号窗口冷淡中性微光，3 号窗口保持温暖焦糖焦光作为叙事视觉锚点
  const coolGlow = d.matte(0xe6f0f3, 0.36);
  coolGlow.emissive.setHex(0xcbe0e8);
  coolGlow.emissiveIntensity = 0.42;
  const focusGlow = d.matte(0xffe9be, 0.34);
  focusGlow.emissive.setHex(0xffd286);
  focusGlow.emissiveIntensity = 0.68;

  const counterBodies: Part[] = [];
  const counterTops: Part[] = [];
  const serviceRecesses: Part[] = [];
  const passShelves: Part[] = [];
  const warmerCanopies: Part[] = [];
  const warmerLights: Part[] = [];
  const pans: Part[] = [];
  const food: Part[] = [];
  const slats: Part[] = [];
  const trayStacks: Part[] = [];
  const garnishColors = [0x9bb37e, 0xd8b27c, 0xf2e9d4, 0xc48b65, 0xb86649, 0x84ae6b, 0xe6d2a4, 0x90b5c0];

  for (const [index, x] of WINDOWS.entries()) {
    const isWindowThree = index === 2;
    counterBodies.push({ p: [x, 0.48, -8.6], s: [4.3, 0.96, 1.7], color: isWindowThree ? 0x6f8783 : 0x748588 });
    counterTops.push({ p: [x, 1.0, -8.55], s: [4.32, 0.08, 1.6] });
    serviceRecesses.push({ p: [x, 1.95, -9.81], s: [4.08, 1.66, 0.04] });
    // 保留 canteen-lightbox-1..4 独立命名供单测校验
    d.box(counter, `canteen-lightbox-${index + 1}`, [x, 2.92, -8.82], [3.94, 0.62, 0.2],
      isWindowThree ? focusGlow : coolGlow);
    const label = createTextSign(`${['一', '二', '三', '四'][index]}号窗口`, 3.64, 0.46,
      isWindowThree
        ? { background: '#fae3b4', foreground: '#38463e' }
        : { background: '#e4ecef', foreground: '#3e5157' });
    label.name = `canteen-window-label-${index + 1}`;
    label.position.set(x, 2.92, -8.71);
    label.castShadow = false;
    const labelMaterial = label.material as THREE.MeshStandardMaterial;
    labelMaterial.emissive.setHex(isWindowThree ? 0xffd78c : 0xcce0e6);
    labelMaterial.emissiveMap = labelMaterial.map;
    labelMaterial.emissiveIntensity = isWindowThree ? 0.34 : 0.2;
    labelMaterial.roughness = 0.82;
    counter.add(label);

    // 三号窗口锚点前置于台沿外，交互光点不会被自身台面遮挡。
    passShelves.push({ p: [x, 1.04, -7.93], s: [3.9, 0.065, 0.35] });
    warmerCanopies.push({ p: [x, 1.68, -8.48], s: [3.8, 0.09, 0.8] });
    warmerLights.push({ p: [x, 1.626, -8.48], s: [3.5, 0.014, 0.35] });
    for (const dx of [-1.78, 1.78]) slats.push({ p: [x + dx, 1.36, -8.7], s: [0.035, 0.6, 0.035] });
    for (let k = 0; k < 9; k += 1) slats.push({ p: [x - 1.65 + k * 0.41, 0.51, -7.735], s: [0.022, 0.72, 0.016] });
    for (let k = 0; k < 4; k += 1) {
      pans.push({ p: [x - 1.27 + k * 0.7, 1.075, -8.43], s: [0.6, 0.06, 0.49] });
      food.push({ p: [x - 1.27 + k * 0.7, 1.11, -8.43], s: [0.5, 0.025, 0.39],
        color: [0x86a065, 0xcfa264, 0xeae0c2, 0xb57551][k] });
      for (let piece = 0; piece < 7; piece += 1) food.push({
        p: [x - 1.43 + k * 0.7 + (piece % 3) * 0.14, 1.135, -8.54 + Math.floor(piece / 3) * 0.15],
        s: [0.1, 0.028, 0.1], color: garnishColors[(k * 2 + piece) % garnishColors.length],
      });
    }
    for (let k = 0; k < 6; k += 1) trayStacks.push({
      p: [x + 1.62, 1.07 + k * 0.026, -8.02], s: [0.36, 0.018, 0.27],
    });
  }
  d.boxes(counter, 'canteen-counters', d.matte(0xffffff, 0.76), counterBodies);
  d.boxes(counter, 'canteen-counter-tops', steel, counterTops);
  d.boxes(counter, 'canteen-service-recesses', dark, serviceRecesses);
  d.boxes(counter, 'canteen-pass-shelves', steel, passShelves);
  d.boxes(counter, 'canteen-warmer-canopies', steel, warmerCanopies);
  d.boxes(counter, 'canteen-warmer-lights', coolGlow, warmerLights);
  d.boxes(counter, 'canteen-counter-trim-posts', dark, slats);
  d.boxes(counter, 'canteen-hot-food-pans', steel, pans);
  d.boxes(counter, 'canteen-hot-food', d.matte(0xffffff), food);
  d.boxes(counter, 'canteen-tray-stacks', steel, trayStacks);

  // 菜单灯箱：价目板色块与分区抬头色带，三号窗口配琥珀焦点边框（纯几何不新增贴图/文字）
  const menuBoard: Part[] = [];
  const menuTitle: Part[] = [];
  const menuSwatch: Part[] = [];
  const menuPrice: Part[] = [];
  const lightFrame: Part[] = [];
  const titleColors = [0x6e8591, 0x6d877a, 0xc7894c, 0x7b8093];
  const swatchPalettes: number[][] = [
    [0x86a065, 0xcfa264, 0xebe1c4, 0xb57551],
    [0xdcc898, 0xbf845b, 0x7aa467, 0xceb088],
    [0x769f5c, 0xc96042, 0xeddba6, 0xb4844a],
    [0x9e8355, 0x829f69, 0xc17946, 0xd8c38c],
  ];
  for (const [index, x] of WINDOWS.entries()) {
    menuBoard.push({ p: [x, 2.3, -9.74], s: [3.7, 0.95, 0.04] });
    menuTitle.push({ p: [x, 2.7, -9.72], s: [3.7, 0.18, 0.05], color: titleColors[index] });
    for (let row = 0; row < 3; row += 1) {
      const y = 2.44 - row * 0.21;
      for (let col = 0; col < 3; col += 1) {
        menuSwatch.push({ p: [x - 1.0 + col * 1.0, y, -9.71], s: [0.6, 0.155, 0.02],
          color: swatchPalettes[index][(row * 3 + col) % 4] });
      }
      menuPrice.push({ p: [x + 1.28, y, -9.71], s: [0.46, 0.06, 0.02] });
    }
    for (const edge of [-1, 1]) {
      lightFrame.push({ p: [x + edge * 1.97, 2.92, -8.82], s: [0.055, 0.66, 0.22] });
      lightFrame.push({ p: [x, 2.92 + edge * 0.31, -8.82], s: [3.98, 0.055, 0.22] });
    }
  }
  d.boxes(counter, 'canteen-menu-board', d.matte(0xe8eef0, 0.86), menuBoard);
  d.boxes(counter, 'canteen-menu-title', d.matte(0xffffff), menuTitle);
  d.boxes(counter, 'canteen-menu-swatches', d.matte(0xffffff), menuSwatch);
  d.boxes(counter, 'canteen-menu-prices', d.matte(0xc9d2d6, 0.65), menuPrice);
  d.boxes(counter, 'canteen-lightbox-frame', dark, lightFrame);
  // 三号窗口专属暖琥珀高光压条（位于灯箱顶部与底沿，强化视觉引导）
  d.boxes(counter, 'canteen-window-three-accent', focusGlow, [
    { p: [WINDOWS[2], 3.26, -8.78], s: [4.04, 0.045, 0.24] },
    { p: [WINDOWS[2], 2.58, -8.78], s: [4.04, 0.045, 0.24] },
  ]);

  // 玻璃防溅隔断柜 + 不锈钢竖向立柱 + 排队护栏 + 刷卡机 + 筷勺桶
  const sneezeGuard = new THREE.MeshStandardMaterial({ color: 0xd4e2e8, roughness: 0.14,
    metalness: 0.12, transparent: true, opacity: 0.17, depthWrite: false });
  d.boxes(counter, 'canteen-sneeze-guard', sneezeGuard, WINDOWS.map((x) => ({
    p: [x, 1.62, -8.18], s: [3.7, 0.85, 0.02],
  })));
  d.boxes(counter, 'canteen-sneeze-brackets', steel, WINDOWS.flatMap((x) =>
    [-1.85, 0, 1.85].map((dx) => ({ p: [x + dx, 1.46, -8.18], s: [0.03, 0.92, 0.035] }))));
  const railPosts: Part[] = [];
  const railBars: Part[] = [];
  for (const x of WINDOWS) {
    for (const dx of [-1.95, 1.95]) railPosts.push({ p: [x + dx, 0.42, -7.0], s: [0.035, 0.84, 0.035] });
    railBars.push({ p: [x, 0.72, -7.0], s: [3.9, 0.03, 0.03] },
      { p: [x, 0.36, -7.0], s: [3.9, 0.03, 0.03] });
  }
  d.boxes(counter, 'canteen-queue-rail-posts', steel, railPosts);
  d.boxes(counter, 'canteen-queue-rail-bars', steel, railBars);
  d.boxes(counter, 'canteen-card-readers', d.matte(0x364348, 0.5), WINDOWS.map((x) => ({
    p: [x + 1.85, 1.07, -8.3], s: [0.18, 0.24, 0.14],
  })));
  const utensilGeo = new THREE.CylinderGeometry(0.075, 0.06, 0.22, 10);
  d.batch(counter, 'canteen-utensil-buckets', utensilGeo, d.matte(0xb5bec2, 0.38, 0.35), WINDOWS.map((x) => ({
    p: [x - 1.85, 1.11, -8.28], s: [1, 1, 1],
  })));
  occluders.push(counter);
}

/** 风格化低多边形学生人物：带贴合衣领、精准衔接的弯臂持机姿势、发饰差异与低饱和校园冷色调。 */
function student(parent: THREE.Object3D, d: Details, index: number, seated: boolean): THREE.Group {
  const actor = group(parent, `canteen-student-${index}`);
  const motion = group(actor, 'canteen-student-motion');
  const jacket = d.matte([0x7a8a92, 0x8e9691, 0x6f7e8a][index % 3], 0.86);
  const collarMat = d.matte([0xd2dade, 0xdce1e4, 0xc7d0d4][index % 3], 0.82);
  const skin = d.matte(0xd4b698, 0.76);
  const hairMat = d.matte([0x393c40, 0x453e38, 0x32373d][index % 3], 0.88);
  const pants = d.matte([0x3f4a50, 0x495257, 0x3b454c][index % 3], 0.88);
  const shoeMat = d.matte(0xd4d9dc, 0.82);
  const bodyY = seated ? 0.9 : 1.14;
  const up = new THREE.Vector3(0, 1, 0);

  const addLimb = (name: string, from: V3, to: V3, radiusScale: number, mat: THREE.Material): void => {
    const start = new THREE.Vector3(...from);
    const end = new THREE.Vector3(...to);
    const dir = end.clone().sub(start);
    const len = Math.max(0.05, dir.length());
    const mid = start.clone().add(end).multiplyScalar(0.5);
    const limb = d.mesh(motion, name, d.limbGeo, mat, [mid.x, mid.y, mid.z], [radiusScale, len, radiusScale]);
    limb.quaternion.setFromUnitVectors(up, dir.normalize());
  };

  // 锥形低模校园外套躯干 + 贴合式圆领衬领（避免方角突兀）
  d.mesh(motion, 'canteen-student-torso', d.torsoGeo, jacket, [0, bodyY, 0], [1.22, 1, 0.74]);
  d.mesh(motion, 'canteen-student-collar', d.torsoGeo, collarMat, [0, bodyY + 0.295, 0], [0.84, 0.14, 0.62]);

  // 头部与差异化柔和发型轮廓（短发刘海 / 垂肩长发 / 后脑高马尾）
  const head = group(motion, 'canteen-student-head');
  head.position.set(0, bodyY + 0.46, 0.02);
  head.rotation.x = 0.22;
  d.mesh(head, 'canteen-student-face', d.sphere, skin, [0, 0, 0], [0.132, 0.156, 0.13]);
  d.mesh(head, 'canteen-student-hair', d.sphere, hairMat, [0, 0.052, -0.022], [0.144, 0.138, 0.14]);
  const hairStyle = index % 3;
  if (hairStyle === 0) {
    // 贴合前额的柔和弧形短刘海
    d.mesh(head, 'canteen-student-hair-detail', d.sphere, hairMat, [0, 0.088, 0.055], [0.128, 0.068, 0.088]);
  } else if (hairStyle === 1) {
    // 柔和垂肩发束
    d.mesh(head, 'canteen-student-hair-detail', d.torsoGeo, hairMat, [0, -0.05, -0.055], [0.88, 0.42, 0.56]);
  } else {
    // 后脑高马尾发髻
    d.mesh(head, 'canteen-student-hair-detail', d.sphere, hairMat, [0, 0.06, -0.165], [0.068, 0.088, 0.072]);
  }

  for (const side of [-1, 1]) {
    if (seated) d.box(actor, 'canteen-student-thigh', [side * 0.115, 0.54, 0.14], [0.145, 0.145, 0.44], pants);
    d.mesh(actor, 'canteen-student-leg', d.limbGeo, pants,
      [side * 0.115, seated ? 0.26 : 0.41, seated ? 0.31 : 0],
      [1.25, seated ? 0.48 : 0.8, 1.3]);
    d.box(actor, 'canteen-student-shoe', [side * 0.115, 0.055, seated ? 0.36 : 0.06],
      [0.125, 0.09, 0.24], shoeMat);

    // 精准矢量衔接的弯臂持机姿势：肩部 → 肘部 → 胸前手机两侧
    const shoulder: V3 = [side * 0.185, bodyY + 0.21, 0.01];
    const elbow: V3 = [side * 0.205, bodyY - 0.02, 0.1];
    const hand: V3 = [side * 0.055, bodyY - 0.02, 0.315];
    addLimb('canteen-student-upper-arm', shoulder, elbow, 0.94, jacket);
    addLimb('canteen-student-forearm', elbow, hand, 0.82, jacket);
  }

  const phone = d.box(motion, 'canteen-student-phone', [0, bodyY - 0.015, 0.33], [0.08, 0.145, 0.018], d.matte(0x323f44));
  phone.rotation.x = -0.52;
  const screen = d.matte(0xdcf0fa, 0.35);
  screen.emissive.setHex(0xb4ddf2);
  screen.emissiveIntensity = 0.38;
  d.box(phone, 'canteen-student-phone-screen', [0, 0, -0.55], [0.84, 0.88, 0.1], screen);
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
    // 清新偏压抑冷灰室内雾效：拉开食堂纵深，让远处低语人群与窗口更具空间距离感
    fog: { color: 0xc3ccd4, near: 14, far: 48 },
    build: buildCanteen,
  };
}
