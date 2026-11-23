// 教学楼共享几何：模块预载不创建资源、不访问 DOM；剧情推进完全交给 core。
import * as THREE from 'three';
import type { SceneId } from '../data/storySchema';
import type { ObstacleAabb } from '../world/navMath';
import type { SceneRuntime, SceneRuntimeContext, WorldSceneDefinition } from '../world/worldSceneTypes';
import { createActorAnimation, createCharacterActor, createTextSign, findActorModelRoot } from './shared';
import type { CharacterAnimationController } from './characterAnimation';
import { getCharacterModel, type CharacterModelId } from './modelManifest';

type InteriorScene = 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'D1' | 'D6';
type V3 = [number, number, number];
const SCENES: readonly InteriorScene[] = ['C2', 'C3', 'C4', 'C5', 'C6', 'D1', 'D6'];
const MODELS: readonly CharacterModelId[] = [
  'linxia',
  'ayuan',
  'studentMale2',
  'studentMale3',
  'studentMale4',
  'studentFemale3',
  'studentFemale4',
];
const ORANGE = 0xcd793c;

/** 脚底导航点与交互锚点分开，便于浏览器验收 / teleport；所有坐标都是米。 */
export const INTERIOR_LOCATIONS = {
  spawns: {
    C2: { x: -0.1, z: 5, yaw: Math.PI / 2, pitchDeg: -6 },
    C3: { x: 2.8, z: 5.2, yaw: 0, pitchDeg: -3 },
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
  students: [
    // 教室前侧过道（不敢出声的旁观者女同学）：四处张望/抱臂/拘谨
    { id: 'student-1', modelId: 'studentFemale4' as CharacterModelId, x: -1.5, z: -6.2, yaw: 0.32, approach: { x: -1.1, z: -4.8 }, lightOffset: { x: 0.14, z: 0.48 }, clips: ['look_around', 'fold_arms', 'afraid'] as const },
    // 走廊北侧靠墙（理性正派男同学，保留 (4.15, -4) 碰撞契约）：接电话/点头/张望
    { id: 'student-2', modelId: 'studentMale4' as CharacterModelId, x: 4.15, z: -4, yaw: -Math.PI / 2, approach: { x: 2.7, z: -4 }, lightOffset: { x: -0.5, z: 0 }, clips: ['make_a_call_02', 'agree', 'look_around'] as const },
    // 教室后侧过道（冷嘲热讽女同学）：窃笑/附和/拘谨（纯站姿）
    { id: 'student-3', modelId: 'studentFemale3' as CharacterModelId, x: -1.5, z: 2.6, yaw: 0.18, approach: { x: -1.3, z: 4.1 }, lightOffset: { x: 0.07, z: 0.5 }, clips: ['laugh_01', 'agree', 'afraid'] as const },
    // 侧楼梯平台窗边（阿远，橙色手机壳线索）：低头看手机
    { id: 'student-4', modelId: 'ayuan' as CharacterModelId, x: 8.2, z: 1.2, yaw: -Math.PI / 2, approach: { x: 6.8, z: 1.2 }, lightOffset: { x: -0.5, z: 0 }, clips: [] as const },
    // 走廊中段西侧（围观看热闹男同学）：起哄/待机/拿手机
    { id: 'student-5', modelId: 'studentMale3' as CharacterModelId, x: 1.9, z: 0.4, yaw: Math.PI / 2, approach: { x: 3.3, z: 0.4 }, lightOffset: { x: 0.5, z: 0 }, clips: ['cheer', 'wait', 'make_a_call_02'] as const },
    // 侧楼梯南侧平台（发帖起哄/键盘侠男同学）：急躁/嗤笑/待机（纯站姿）
    { id: 'student-6', modelId: 'studentMale2' as CharacterModelId, x: 8.2, z: 6.4, yaw: -Math.PI * 0.72, approach: { x: 6.9, z: 5.7 }, lightOffset: { x: -0.44, z: -0.24 }, clips: ['angry_01', 'laugh_02', 'wait'] as const },
  ],
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
  teacherOfficeDoor: { x: 3.0, y: 1.2, z: -8.82 },
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
    const shade = seam ? -30 : n < 7 ? -42 : n < 18 ? -16 : n % 7;
    // 清冷微灰水磨石底色（去暖黄），突出教学楼整洁偏压抑的冷静空间感
    pixels.set([213 + shade, 218 + shade, 220 + shade, 255], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(19, 18);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.36, metalness: 0.06, envMapIntensity: 0.45 });
  const release = (): void => { texture.dispose(); material.removeEventListener('dispose', release); };
  material.addEventListener('dispose', release);
  return material;
}

/** 细腻粉刷肌理墙面：低对比冷灰白逐像素噪点，随材质释放贴图，不产生全局共享标记。 */
function wallMaterial(): THREE.MeshStandardMaterial {
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  let seed = 991;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const n = seed % 100;
    const shade = n < 6 ? -9 : n < 16 ? -4 : n < 34 ? 3 : n % 6;
    pixels.set([226 + shade, 231 + shade, 234 + shade, 255], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 7);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.93, envMapIntensity: 0.3 });
  const release = (): void => { texture.dispose(); material.removeEventListener('dispose', release); };
  material.addEventListener('dispose', release);
  return material;
}

interface FoliagePart { p: V3; s: V3; color: number }
/** 多簇自然树冠：球体实例 + 逐实例颜色，单批绘制；几何/材质均为本 build 自有资源。 */
function instancedFoliage(parent: THREE.Object3D, name: string, parts: FoliagePart[]): THREE.InstancedMesh {
  const geometry = new THREE.SphereGeometry(1, 9, 6);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, envMapIntensity: 0.35 });
  const mesh = new THREE.InstancedMesh(geometry, material, parts.length);
  mesh.name = name;
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  parts.forEach((part, i) => {
    transform.position.set(...part.p);
    transform.scale.set(...part.s);
    transform.updateMatrix();
    mesh.setMatrixAt(i, transform.matrix);
    mesh.setColorAt(i, color.setHex(part.color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  const release = (): void => { mesh.dispose(); geometry.removeEventListener('dispose', release); };
  geometry.addEventListener('dispose', release);
  parent.add(mesh);
  return mesh;
}

type BeamQuad = [V3, V3, V3, V3];
/** 斜射柔光光束：单网格、加色混合、逐顶点亮度衰减，零贴图零额外光源。 */
function createSoftLightBeam(quads: BeamQuad[], baseColor: number, opacity: number): THREE.Mesh {
  const columns = 3;
  const rows = 6;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const base = new THREE.Color(baseColor);
  for (const [nl, nr, fl, fr] of quads) {
    const offset = positions.length / 3;
    for (let row = 0; row <= rows; row += 1) {
      const v = row / rows;
      for (let col = 0; col <= columns; col += 1) {
        const u = col / columns;
        const nearX = nl[0] + (nr[0] - nl[0]) * u;
        const nearY = nl[1] + (nr[1] - nl[1]) * u;
        const nearZ = nl[2] + (nr[2] - nl[2]) * u;
        const farX = fl[0] + (fr[0] - fl[0]) * u;
        const farY = fl[1] + (fr[1] - fl[1]) * u;
        const farZ = fl[2] + (fr[2] - fl[2]) * u;
        positions.push(nearX + (farX - nearX) * v, nearY + (farY - nearY) * v, nearZ + (farZ - nearZ) * v);
        const falloff = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
        colors.push(base.r * falloff, base.g * falloff, base.b * falloff);
      }
    }
    for (let row = 0; row < rows; row += 1) for (let col = 0; col < columns; col += 1) {
      const a = offset + row * (columns + 1) + col;
      const b = a + 1;
      const c = a + columns + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'corridor-light-beam';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.raycast = () => {};
  return mesh;
}
function architecture(root: THREE.Group, d: Details, occluders: THREE.Object3D[]) {
  const walls = group(root, 'interior-walls');
  const cream = 0xe2e7ea;
  const sage = 0x768989;
  const trim = 0x586b6e;
  const baseboard = 0x424a4c;
  const plaster = wallMaterial();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(19, 18), floorMaterial());
  floor.name = 'interior-terrazzo-floor';
  floor.rotation.x = -Math.PI / 2;
  floor.position.x = 0.5;
  floor.receiveShadow = true;
  root.add(floor);
  d.box(walls, 'roof', [0.5, 3.88, 0], [19.25, 0.16, 18.25], cream);
  for (const z of [-9, 9]) {
    d.box(walls, 'end-wall', [0.5, 1.9, z], [19.25, 3.8, 0.22], plaster);
    d.box(walls, 'end-wainscot', [0.5, 0.48, z - Math.sign(z) * 0.13], [19, 0.96, 0.04], sage);
    d.box(walls, 'end-baseboard', [0.5, 0.06, z - Math.sign(z) * 0.15], [19, 0.12, 0.02], baseboard);
  }
  for (const { name, p, s } of PARTITIONS) {
    d.box(walls, name, p, s, plaster);
    d.box(walls, `${name}-skirting`, [p[0], 0.4, p[2]], [s[0] + 0.025, 0.8, s[2]], sage);
    d.box(walls, `${name}-baseboard`, [p[0], 0.06, p[2]], [s[0] + 0.02, 0.12, s[2]], baseboard);
  }
  const frosted = new THREE.MeshStandardMaterial({ color: 0xe3ece8, roughness: 0.85,
    transparent: true, opacity: 0.55, depthWrite: false, envMapIntensity: 0.35 });
  for (const z of [-5, 5]) {
    d.box(walls, 'class-door-lintel', [1, 3.25, z], [0.22, 1.1, 2.4], cream);
    // 门扇贴墙停靠，不跨越通行门洞（青蓝色双扇推拉门画风）。
    d.box(walls, 'open-class-door', [0.85, 1.34, z + 1.72], [0.07, 2.68, 0.95], 0x1c7894);
    for (const jz of [-1.2, 1.2]) d.box(walls, 'class-door-jamb', [1, 1.34, z + jz], [0.24, 2.7, 0.06], trim);
    d.box(walls, 'class-door-transom', [1, 2.86, z], [0.18, 0.34, 2.4], frosted);
    d.box(walls, 'class-door-handle', [0.83, 1.15, z + 1.78], [0.05, 0.24, 0.02], 0xd2d8de);
    sign(root, '二楼 · 教室', [1.14, 2.95, z], Math.PI / 2);
    sign(root, '高一(3)班', [1.12, 2.36, z + 0.55], Math.PI / 2, 0.9);
  }
  d.box(walls, 'stair-door-lintel', [5, 3.35, 5], [0.22, 0.9, 4], cream);
  sign(root, '侧楼梯 · 平台', [4.86, 3.12, 5], -Math.PI / 2, 2);
  // 年级办公室门（装饰，不承担通行逻辑）。
  d.box(walls, 'office-door-frame', [5, 1.4, 0], [0.08, 2.7, 1.05], trim);
  d.box(walls, 'office-door-leaf', [4.92, 1.35, 0], [0.03, 2.55, 0.95], 0x8d7a58);
  d.box(walls, 'office-door-transom', [5, 2.9, 0], [0.06, 0.4, 1.05], frosted);
  d.box(walls, 'office-door-handle', [4.88, 1.1, 0.32], [0.02, 0.14, 0.05], 0x4b5450);
  sign(root, '年级办公室', [5.12, 2.34, 0], -Math.PI / 2, 1.6);
  // 走廊北尽头的辅导员办公室门（C3 交互入口）。
  d.box(walls, 'teacher-office-frame', [3.0, 1.4, -8.86], [1.16, 2.7, 0.08], trim);
  d.box(walls, 'teacher-office-leaf', [3.0, 1.35, -8.82], [1.04, 2.55, 0.04], 0x8d7a58);
  d.box(walls, 'teacher-office-transom', [3.0, 2.9, -8.86], [1.16, 0.4, 0.06], frosted);
  d.box(walls, 'teacher-office-handle', [3.34, 1.1, -8.78], [0.05, 0.14, 0.03], 0x4b5450);
  sign(root, '辅导员办公室', [3.0, 2.42, -8.79], 0, 1.5);
  const glass = new THREE.MeshStandardMaterial({ color: 0xb6c9c5, transparent: true, opacity: 0.18,
    roughness: 0.2, metalness: 0.3, depthWrite: false, envMapIntensity: 0.5 });
  for (const x of [-9, 10]) {
    d.box(walls, 'window-parapet', [x, 0.46, 0], [0.22, 0.92, 18], sage);
    d.box(walls, 'window-header', [x, 3.5, 0], [0.22, 0.6, 18], cream);
    for (let z = -7.5; z <= 7.5; z += 3) {
      d.box(walls, 'window-pane', [x, 2.04, z], [0.045, 2.24, 2.92], glass);
      d.box(walls, 'window-mullion', [x, 2.06, z - 1.5], [0.24, 2.3, 0.08], trim);
    }
    for (const y of [0.94, 2.5, 3.2]) d.box(walls, 'window-rail', [x, y, 0], [0.25, 0.06, 18], trim);
    d.box(walls, 'window-sill', [x, 0.95, 0], [0.36, 0.08, 18], cream);
    d.box(walls, 'window-sill-board', [x, 0.9, 0], [0.42, 0.03, 18], 0xd6cdb8);
  }
  // 走廊宣传栏与消防栓箱（克制、无文字）。
  d.box(walls, 'corridor-board-frame', [1.14, 1.7, -2], [0.05, 1.1, 1.5], 0x5a6a62);
  d.box(walls, 'corridor-board-panel', [1.12, 1.7, -2], [0.02, 0.96, 1.36], 0x9fb6a8);
  d.box(walls, 'corridor-board-frame-2', [1.14, 1.7, 2], [0.05, 1.1, 1.5], 0x5a6a62);
  d.box(walls, 'corridor-board-panel-2', [1.12, 1.7, 2], [0.02, 0.96, 1.36], 0xb4a68c);
  d.box(walls, 'fire-hydrant-box', [1.1, 1.1, -6.4], [0.12, 0.8, 0.55], 0x9c4a3c);

  // 视频同款校园元素：走廊黄色地面导引线、青蓝双管吊灯、安全出口吊挂灯箱、壁挂音箱
  d.box(walls, 'corridor-yellow-guide', [4.55, 0.008, -0.5], [0.09, 0.008, 15.6], 0xf2c94c);
  for (const lz of [-6, -1.5, 3, 7]) {
    d.box(walls, 'corridor-lamp-hood', [3.0, 3.74, lz], [0.34, 0.06, 1.35], 0x1f6e8c);
    d.box(walls, 'corridor-lamp-bulb', [3.0, 3.7, lz], [0.22, 0.03, 1.25], 0xfff3d8);
  }
  d.box(walls, 'corridor-hanging-exit', [3.0, 3.25, -3.8], [0.68, 0.24, 0.07], 0x268a5c);
  d.box(walls, 'corridor-speaker-n', [1.14, 3.05, -3.5], [0.16, 0.24, 0.22], 0x6b523d);
  d.box(walls, 'corridor-speaker-s', [1.14, 3.05, 3.5], [0.16, 0.24, 0.22], 0x6b523d);
  // 白框橙门矮柜 + 蓝框粉门矮柜（贴西墙放置）+ 柜顶书包/收纳桶
  for (const [idx, cz] of [-2.0, 2.0].entries()) {
    const isPink = idx === 1;
    d.box(walls, `corridor-locker-frame-${idx}`, [1.28, 0.44, cz], [0.36, 0.88, 1.56], isPink ? 0x7cb2d9 : 0xedf1f6);
    for (const dz of [-0.52, 0, 0.52]) {
      d.box(walls, `corridor-locker-door-${idx}`, [1.465, 0.44, cz + dz], [0.02, 0.78, 0.46], isPink ? 0xe8b3c2 : 0xe06e3b);
      d.box(walls, `corridor-locker-lock-${idx}`, [1.48, 0.48, cz + dz + 0.14], [0.015, 0.06, 0.05], 0x262d3d);
    }
    d.box(walls, `corridor-locker-top-bag-${idx}`, [1.28, 1.0, cz - 0.3], [0.28, 0.24, 0.36], 0x2e5b99);
    if (isPink) d.box(walls, 'corridor-locker-bin', [1.28, 0.99, cz + 0.35], [0.24, 0.22, 0.24], 0x3b6796);
  }
  // 走廊南端灰蓝高铁皮柜 + 并排灭火器 + 配电箱 + 雨伞架
  d.box(walls, 'corridor-tall-cabinet', [4.72, 0.95, -7.2], [0.42, 1.9, 1.15], 0x7c90a6);
  d.box(walls, 'corridor-electric-box', [4.88, 1.45, -1.6], [0.12, 0.62, 0.46], 0xe8edf5);
  d.box(walls, 'corridor-umbrella-rack', [4.7, 0.42, 7.6], [0.44, 0.84, 0.36], 0x4b5669);
  for (const ez of [-6.0, -6.32]) {
    const ext = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.5, 10), d.material(0xc23329));
    ext.name = 'corridor-extinguisher';
    ext.position.set(1.22, 0.25, ez);
    ext.castShadow = false;
    walls.add(ext);
  }
  occluders.push(walls);
  const stairs = group(root, 'stairwell-flight');
  for (let i = 0; i < 10; i += 1) {
    const h = (i + 1) * 0.18;
    d.box(stairs, `stair-${i}`, [8.55, h / 2, -3.6 - i * 0.5], [1.9, h, 0.5], 0xb3b6aa);
    d.box(stairs, 'stair-edge', [8.55, h + 0.008, -3.36 - i * 0.5], [1.9, 0.016, 0.035], 0x8a918a);
    d.box(stairs, 'stair-baluster', [7.55, h + 0.45, -3.6 - i * 0.5], [0.035, 0.9, 0.035], 0x4b5450);
    d.box(stairs, 'stair-riser-strip', [8.55, h - 0.09, -3.6 - i * 0.5], [1.92, 0.03, 0.015], 0x3c433f);
  }
  const rail = d.box(stairs, 'stair-handrail', [7.55, 1.89, -5.85], [0.07, 0.07, 5.3], 0x4b5450);
  rail.rotation.x = Math.atan(0.36);
  // 上行楼层暂未开放，楼梯占地整体禁入；本层转角和侧平台均为连续平地。
  d.box(stairs, 'flight-guard', [8.55, 0.62, -3.43], [2.1, 1.24, 0.045], trim);
  sign(stairs, '上楼请止步', [8.55, 1.3, -3.39], 0, 1.7);
  sign(stairs, '1F / 2F', [7.2, 1.7, -3.2], 0, 1.2);
  occluders.push(stairs);
  const garden = group(root, 'window-greenery');
  for (const x of [-12, 13]) {
    const sgn = Math.sign(x);
    d.box(garden, 'garden-ground', [x, -0.14, 0], [7, 0.2, 24], 0x8f9b7b);
    d.box(garden, 'garden-backdrop', [x + sgn * 2.8, 3, 0], [0.2, 6, 24], 0xaabdb0);
    const farX = x + sgn * 4.6;
    const farA: Array<{ p: V3; s: V3 }> = [
      { p: [farX, 2.4, -8], s: [0.6, 4.8, 4] },
      { p: [farX, 2.9, 0], s: [0.6, 5.8, 4] },
      { p: [farX, 2.1, 8], s: [0.6, 4.2, 4] },
    ];
    const farB: Array<{ p: V3; s: V3 }> = [
      { p: [farX + sgn * 1.1, 3.4, -3.5], s: [0.6, 6.8, 3.2] },
      { p: [farX + sgn * 1.1, 3.4, 4.5], s: [0.6, 6.8, 3.2] },
    ];
    d.batch(garden, 'garden-far-building-a', farA, 0x7f8b93);
    d.batch(garden, 'garden-far-building-b', farB, 0x8b97a0);
    const trunks: Array<{ p: V3; s: V3 }> = [];
    const foliage: FoliagePart[] = [];
    const shrubs: FoliagePart[] = [];
    let treeIndex = 0;
    for (let z = -9; z <= 9; z += 3) {
      const jitter = (treeIndex % 3) - 1;
      const tx = x + jitter * 0.4;
      const h = 3.0 + (treeIndex % 3) * 0.3;
      trunks.push({ p: [tx, h / 2, z], s: [0.13, h, 0.13] });
      foliage.push(
        { p: [tx, h + 1.0, z], s: [1.5, 1.6, 1.35], color: treeIndex % 2 ? 0x7c9a68 : 0x86a173 },
        { p: [tx + 0.55, h + 0.45, z + 0.3], s: [1.0, 1.05, 0.95], color: 0x9ab582 },
        { p: [tx - 0.5, h + 0.3, z - 0.25], s: [0.95, 0.95, 0.9], color: 0x6f8f64 },
        { p: [tx, h + 1.55, z], s: [0.85, 0.85, 0.8], color: 0x8fae7b },
      );
      shrubs.push({ p: [tx + 1.15, 0.42, z + 0.8], s: [1.05, 0.78, 0.68], color: 0x6b8d67 });
      treeIndex += 1;
    }
    d.batch(garden, 'garden-tree-trunks', trunks, 0x817661);
    instancedFoliage(garden, 'garden-tree-foliage', foliage);
    instancedFoliage(garden, 'garden-shrubs', shrubs);
  }
  const lamp = d.material(0xeef5fa);
  lamp.emissive.setHex(0xd6e8f4);
  lamp.emissiveIntensity = 0.52;
  for (const x of [-6, -2, 3, 7]) for (const z of [-6, 0, 6])
    d.box(root, 'ceiling-lamp', [x, 3.73, z], [1.2, 0.06, 0.32], lamp);
  for (const z of [-7.6, -3.6, 3.6, 7.6]) d.box(root, 'ceiling-beam', [0.5, 3.8, z], [19.25, 0.06, 0.2], 0xc9d0d4);
  // 斜射窗光光束（日间冷白清透、黄昏由 runtime 切为微暖残阳）：单网格加色混合，零额外光源、零贴图。
  const beams = group(root, 'corridor-light-beams');
  const platformBeams: BeamQuad[] = [
    [[9.85, 3.05, 3.6], [9.85, 3.05, 4.4], [5.4, 0.04, 2.4], [5.4, 0.04, 5.4]],
    [[9.85, 3.05, 5.2], [9.85, 3.05, 6.0], [5.4, 0.04, 4.2], [5.4, 0.04, 7.2]],
    [[9.85, 3.05, 1.8], [9.85, 3.05, 2.6], [6.2, 0.04, 0.8], [6.2, 0.04, 3.6]],
  ];
  const classBeams: BeamQuad[] = [
    [[-8.85, 2.9, 2.8], [-8.85, 2.9, 3.6], [-3.8, 0.04, 1.8], [-3.8, 0.04, 4.6]],
  ];
  beams.add(createSoftLightBeam(platformBeams, 0xd8e8f2, 0.14));
  beams.add(createSoftLightBeam(classBeams, 0xe0edf5, 0.11));
  const fill = new THREE.HemisphereLight(0xe0eaf1, 0x738288, 1.12);
  fill.name = 'interior-fill';
  root.add(fill);
  const sunset = new THREE.PointLight(0xffb477, 0, 16, 2);
  sunset.name = 'interior-sunset';
  sunset.position.set(9.2, 2.7, 5);
  root.add(sunset);
  return { fill, sunset, garden, beams };
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
  // 讲台小物件：黄色大三角尺 + 粉笔盒 + 黑板擦 + 教案本
  d.box(furniture, 'podium-triangle-ruler', [-4.1, 1.03, -7.6], [0.46, 0.025, 0.28], 0xf2c94c);
  d.box(furniture, 'podium-chalk-box', [-4.95, 1.05, -7.65], [0.22, 0.07, 0.15], 0xe8dec5);
  d.box(furniture, 'podium-book', [-5.3, 1.04, -7.55], [0.32, 0.035, 0.24], 0x4f756b);
  d.box(root, 'blackboard-frame', [-4.5, 2.1, -8.85], [5.8, 1.48, 0.1], 0xb6ac93);
  d.box(root, 'blackboard', [-4.5, 2.1, -8.78], [5.6, 1.3, 0.045], 0x395b52);
  // 教室墙角高立柜 + 黑板旁蓝底公告栏 + 后墙 24 格书包柜与垃圾桶扫把
  d.box(root, 'class-front-cabinet', [-8.4, 1.0, -8.4], [0.85, 2.0, 0.55], 0x9b7958);
  d.box(root, 'class-side-blue-board', [-0.6, 2.0, -8.84], [1.4, 0.96, 0.05], 0x3b6796);
  d.box(root, 'class-back-cubby', [-4.6, 0.52, 8.65], [5.0, 1.04, 0.42], 0xb88f64);
  d.box(root, 'class-back-cubby-bag', [-5.6, 1.18, 8.65], [0.36, 0.26, 0.28], 0x2e5b99);
  d.box(root, 'class-back-metal-locker', [0.55, 1.0, 8.6], [0.48, 2.0, 0.5], 0x3b6796);
  d.box(root, 'class-back-trashbin', [-0.25, 0.32, 8.65], [0.34, 0.64, 0.34], 0x325e9e);
  d.box(root, 'class-back-broom-stick', [0.12, 0.72, 8.75], [0.035, 1.4, 0.035], 0x9c7b56);
  d.box(root, 'class-back-broom-head', [0.12, 0.08, 8.75], [0.22, 0.14, 0.08], 0xd8c394);
  // 教室吊装青蓝荧光灯
  for (const lx of [-6.0, -2.5]) {
    for (const lz of [-4.0, 2.0]) {
      d.box(root, 'class-lamp-hood', [lx, 3.68, lz], [0.32, 0.07, 1.35], 0x1f6e8c);
      d.box(root, 'class-lamp-bulb', [lx, 3.64, lz], [0.2, 0.03, 1.25], 0xfff3d8);
    }
  }
  sign(root, '新生活 · 新开始', [-4.5, 3.23, -8.75], 0, 3.5);
  d.box(root, 'chalk-tray', [-4.5, 1.38, -8.68], [5.8, 0.035, 0.2], 0x677972);
  // 黑板擦、克制板书痕迹、石英挂钟与国旗。
  d.box(root, 'blackboard-eraser', [-3.4, 1.42, -8.6], [0.3, 0.05, 0.1], 0xc8bfa8);
  const chalkMarks: Array<{ p: V3; s: V3 }> = [];
  for (let i = 0; i < 6; i += 1) chalkMarks.push({ p: [-5.8 + i * 0.55, 2.16 + (i % 3) * 0.06, -8.74], s: [0.4, 0.012, 0.006] });
  d.batch(root, 'blackboard-chalk-marks', chalkMarks, 0xf2efe4);
  const clock = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 20), d.material(0xeee9dc));
  clock.name = 'classroom-clock'; clock.position.set(-1.9, 3.12, -8.75); clock.rotation.x = Math.PI / 2;
  clock.castShadow = false; root.add(clock);
  d.box(root, 'classroom-clock-face', [-1.9, 3.12, -8.72], [0.26, 0.26, 0.01], 0xfbf7ec);
  d.box(root, 'classroom-flag-pole', [-6.5, 2.9, -8.8], [0.03, 0.6, 0.03], 0x8a7a5c);
  d.box(root, 'classroom-flag', [-6.35, 3.12, -8.8], [0.28, 0.16, 0.01], 0xb03a2e);
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
  // 教室吊扇 + 窗侧微垂半透明窗帘 + 桌面散落课本/文具盒（稀疏点缀，不遮选座光点）。
  const fan = group(root, 'classroom-ceiling-fan');
  fan.position.set(-2, 3.55, 1);
  d.box(fan, 'fan-rod', [0, -0.15, 0], [0.04, 0.3, 0.04], 0x6b7370);
  d.box(fan, 'fan-hub', [0, -0.32, 0], [0.18, 0.06, 0.18], 0x6b7370);
  for (let b = 0; b < 3; b += 1) {
    const angle = (b / 3) * Math.PI * 2;
    const blade = d.box(fan, 'fan-blade', [Math.cos(angle) * 0.45, -0.34, Math.sin(angle) * 0.45], [0.85, 0.02, 0.16], 0x9aa69c);
    blade.rotation.y = -angle;
  }
  const curtainMat = new THREE.MeshStandardMaterial({ color: 0x4e7aa8, roughness: 0.9,
    transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide });
  for (const z of [-4, 2]) {
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.1, 8, 10), curtainMat);
    curtain.name = 'classroom-curtain';
    curtain.position.set(-8.86, 2.02, z);
    curtain.castShadow = false;
    curtain.receiveShadow = true;
    root.add(curtain);
  }
  const booksA: Array<{ p: V3; s: V3 }> = [];
  const booksB: Array<{ p: V3; s: V3 }> = [];
  const pencilCases: Array<{ p: V3; s: V3 }> = [];
  DESKS.forEach(({ x, z }, i) => {
    if (i % 3 !== 0) return;
    booksA.push({ p: [x + 0.35, 0.81, z - 0.1], s: [0.3, 0.035, 0.22] });
    booksB.push({ p: [x + 0.42, 0.845, z - 0.06], s: [0.22, 0.03, 0.18] });
    pencilCases.push({ p: [x - 0.4, 0.815, z + 0.1], s: [0.16, 0.05, 0.26] });
  });
  d.batch(furniture, 'desk-books-a', booksA, 0x8d5f4b);
  d.batch(furniture, 'desk-books-b', booksB, 0x4f6f7a);
  d.batch(furniture, 'desk-pencil-cases', pencilCases, 0x8e9c96);
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
  const { fill, sunset, garden, beams } = architecture(root, d, occluders);
  const sketch = furniture(root, d, occluders);
  const actors: Record<string, THREE.Object3D> = { 'interior-fill': fill, 'interior-sunset': sunset, 'window-greenery': garden, 'corridor-light-beams': beams, 'linxia-sketchbook': sketch };
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
  for (let i = 0; i < INTERIOR_LOCATIONS.students.length; i += 1) {
    if (i === 3) continue;
    const spec = INTERIOR_LOCATIONS.students[i];
    const actor = create(spec.modelId, spec.id,
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

interface StudentAnimState {
  actor: THREE.Object3D;
  clips: readonly string[];
  controller: CharacterAnimationController | null;
  clipIndex: number;
  timer: number;
  switchSec: number;
}

interface Session {
  context: SceneRuntimeContext;
  scene: InteriorScene;
  unsubscribe: Array<() => void>;
  models: Map<THREE.Object3D, THREE.Object3D | null>;
  rotations: Map<THREE.Object3D, number>;
  studentAnims: Map<THREE.Object3D, StudentAnimState>;
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
function syncStudentAnimation(state: StudentAnimState, dt: number): boolean {
  if (state.clips.length === 0) return false;
  if (!state.controller) {
    const controller = createActorAnimation(state.actor);
    if (!controller) return false;
    const available = state.clips.filter((clip) => controller.hasAnimation(clip));
    if (available.length === 0) {
      controller.dispose();
      return false;
    }
    state.controller = controller;
    state.clips = available;
    state.clipIndex = 0;
    state.timer = 0;
    resetPose(state.actor);
    const props = state.actor.getObjectByName('actor-props');
    if (props) props.visible = false;
    controller.play(available[0], { fadeIn: 0.3, timeScale: 0.86, loop: true });
    controller.update(dt);
    return true;
  }
  if (state.clips.length > 1 && dt > 0) {
    state.timer += dt;
    if (state.timer >= state.switchSec) {
      state.timer = 0;
      state.clipIndex = (state.clipIndex + 1) % state.clips.length;
      state.controller.play(state.clips[state.clipIndex], { fadeIn: 0.45, timeScale: 0.86, loop: true });
    }
  }
  state.controller.update(dt);
  return true;
}
function clearRuntime(): void {
  const current = session;
  if (!current) return;
  studentVisibility(current);
  session = null; // 先失效：已经进入事件队列的旧闭包也不能修改新场景。
  current.unsubscribe.forEach((off) => off());
  for (const state of current.studentAnims.values()) state.controller?.dispose();
  current.studentAnims.clear();
  for (const [actor, z] of current.rotations) { actor.rotation.z = z; resetPose(actor); }
}
export const schoolInteriorRuntime: SceneRuntime = {
  enter(context): void {
    if (session?.context === context && session.scene === context.sceneId) return;
    clearRuntime();
    if (!SCENES.includes(context.sceneId as InteriorScene)) return;
    const scene = context.sceneId as InteriorScene;
    const current: Session = {
      context, scene, unsubscribe: [], models: new Map(), rotations: new Map(),
      studentAnims: new Map(), time: 0, noticed: context.storyFlags?.noticedTyper ?? false,
    };
    session = current;
    studentVisibility(current);
    const place = (
      name: string,
      location: { x: number; z: number },
      yaw = -Math.PI / 2,
      animClips: readonly string[] = [],
      switchSec = 7.5,
    ): void => {
      const actor = context.actors[name];
      if (!actor) return;
      actor.visible = true; actor.position.set(location.x, 0, location.z); actor.rotation.set(0, yaw, 0);
      const seated = name === 'linxia' && scene === 'C2';
      const props = actor.getObjectByName('actor-props');
      if (props) props.visible = !seated;
      let animated = false;
      if (animClips.length > 0) {
        const animState: StudentAnimState = {
          actor, clips: animClips, controller: null, clipIndex: 0, timer: 0, switchSec,
        };
        current.studentAnims.set(actor, animState);
        animated = syncStudentAnimation(animState, 0);
      }
      if (!animated) poseActor(actor, seated, !seated);
      current.models.set(actor, findActorModelRoot(actor)?.root ?? null);
      current.rotations.set(actor, actor.rotation.z);
    };
    for (const name of ['linxia', 'ayuan', ...INTERIOR_LOCATIONS.students.map(({ id }) => id)]) {
      const actor = context.actors[name]; if (actor) actor.visible = false;
    }
    if (context.actors['linxia-sketchbook']) context.actors['linxia-sketchbook'].visible = scene === 'C2';
    if (scene === 'C2') place('linxia', INTERIOR_LOCATIONS.linxiaDesk, Math.PI);
    if (scene === 'C4') place('linxia', INTERIOR_LOCATIONS.stairwellActor);
    if (scene === 'C5') {
      INTERIOR_LOCATIONS.students.forEach((student, index) => {
        place(student.id, student, student.yaw, student.clips, 7.2 + index * 0.65);
      });
    }
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
      fill.color.setHex(night ? 0x7894c5 : evening ? 0xf4caa2 : 0xe0eaf1);
      fill.groundColor.setHex(night ? 0x303f60 : evening ? 0x7a8584 : 0x738288);
      fill.intensity = night ? 0.28 : evening ? 0.78 : 1.12;
    }
    if (sunset instanceof THREE.PointLight) sunset.intensity = evening ? 18 : 0;
    if (context.actors['window-greenery']) context.actors['window-greenery'].visible = !night;
    const beamsGroup = context.actors['corridor-light-beams'];
    if (beamsGroup) {
      beamsGroup.visible = !night;
      beamsGroup.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
          child.material.color.setHex(evening ? 0xf6c997 : 0xffffff);
        }
      });
    }
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
    const dt = Math.min(dtSeconds, 0.1);
    session.time += dt;
    for (const [actor, base] of session.rotations) {
      const root = findActorModelRoot(actor)?.root ?? null;
      const animState = session.studentAnims.get(actor);
      if (root !== session.models.get(actor)) {
        session.models.set(actor, root);
        if (animState) {
          animState.controller?.dispose();
          animState.controller = null;
        }
        const animated = animState ? syncStudentAnimation(animState, 0) : false;
        if (!animated) poseActor(actor, actor === session.context.actors.linxia && session.scene === 'C2', true);
      } else if (animState && actor.visible) {
        syncStudentAnimation(animState, dt);
      }
      if (actor.visible) actor.rotation.z = base + Math.sin(session.time * 1.5) * 0.003;
    }
    const garden = session.context.actors['window-greenery'];
    if (garden && garden.visible) {
      garden.position.z = Math.sin(session.time * 0.68) * 0.04;
    }
    const beams = session.context.actors['corridor-light-beams'];
    if (beams && beams.visible) {
      const pulse = 0.045 + Math.sin(session.time * 0.8) * 0.006;
      beams.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
          child.material.opacity = pulse;
        }
      });
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
    })) : scene === 'C3' ? [{
      id: 'teacher-office-door',
      position: { ...INTERIOR_LOCATIONS.teacherOfficeDoor },
      lightOffsetY: 0.25,
      maxDistance: 2.8,
      hitRadius: 0.5,
    }] : scene === 'C5' ? INTERIOR_LOCATIONS.students.map(({ id, x, z, lightOffset }) => ({
      id, position: { x: x + lightOffset.x, y: 1.1, z: z + lightOffset.z }, lightOffsetY: 0.3, maxDistance: 2.8, hitRadius: 0.28,
    })) : [],
    zones: zone ? [{ id: zone.id, kind: 'circle', center: { x: zone.x, y: 0, z: zone.z }, radius: 0.8, once: true }] : [],
    targetGuides: scene === 'C3'
      ? [{ id: 'teacher-office-door', position: { x: 3.0, y: 1.35, z: -8.7 } }]
      : zone ? [{ id: zone.id, position: { x: zone.x, y: 0.8, z: zone.z } }] : [],
    // 分级氛围空间雾：日间冷灰压抑（C2/C4/C5）、黄昏克制残阳（D1/D6）、夜间冷暗压迫（C6）
    fog: scene === 'C6'
      ? { color: 0x2c394d, near: 10, far: 38 }
      : scene === 'D1' || scene === 'D6'
        ? { color: 0xc7b3a4, near: 16, far: 52 }
        : { color: 0xc3ccd4, near: 14, far: 48 },
    panoramaAnchor: scene === 'D1' ? {
      position: { x: 6.55, y: 1.54, z: 5.05 }, lookAt: { x: 8.3, y: 1.35, z: 5 },
    } : undefined,
  };
}
