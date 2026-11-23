// S12 / S13 共用食堂；模块预载不建几何、不访问 DOM、不订阅事件，也不请求模型。
import * as THREE from 'three';
import type { SceneId } from '../data/storySchema';
import type {
  NavigationConfig, SceneRuntime, SceneRuntimeContext, WorldSceneDefinition, ZoneConfig,
} from '../world/worldSceneTypes';
import { createTextSign } from './shared';
import { createCharacterAnimation, type CharacterAnimationController } from './characterAnimation';
import { getCharacterModel, type CharacterModelId } from './modelManifest';
import type { PropModelAsset } from '../world/resources';
import {
  getCharacterAnimations,
  instantiateCharacterModel,
  loadCharacterModel,
  loadPropModel,
} from '../world/resources';
import type { PropModelId } from './propManifest';

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
/** 程序化桌板台面 = 板中心 0.77 + 板厚 0.068 的一半。成品套装按椅背 0.956 归一化后桌面顶在 0.783，换桌后桌面小道具整批下沉这个差值。 */
const TABLE_TOP_PROCEDURAL = 0.804;
const TABLE_TOP_PROP = 0.783;
const WINDOWS = [-6.6, -2.2, 2.2, 6.6];
/** 右墙结构柱与套件凹槽大柱的摆放列（程序化柱批在成品到位后让位） */
const COLUMN_Z = [-6.5, -2, 2.5, 6.5];
/** 左侧落地高窗的套件窗湾摆放列，每 4 米一湾铺满整墙 */
const WINDOW_BAY_Z = [-8, -4, 0, 4, 8];
// 第一组围坐靠窗餐桌，第二组站在左侧过道，第三组在窗口旁；不占用目标窗口的接近路线。
// C-34：第二组原先站在 (−0.65,0.35)/(0.2,−0.4)/(0.95,0.4)，正落在出生点→三号窗口的视线上
// （该视线在 z=0 处 x≈1.15，左右各留 1.2 米）。整组移到 x<−0.86 的过道里，
// 并把两人转向入口（yaw≈0 即面向玩家），形成"进门被注视"的一拍。
/** 吊扇坐标（每台含 1 吊杆 + 1 电机 + 2 叶片，tick 时匀速旋转 8 片扇叶） */
const FAN_POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [-2.75, 4],
  [2.75, 4],
  [-2.75, -4],
  [2.75, -4],
];

/** 9 名食堂学生对应的真实 3D 动作模型人设与轮播剪辑（浏览器运行时异步热替换） */
const CANTEEN_STUDENT_CAST: ReadonlyArray<{
  modelId: CharacterModelId;
  clips: readonly string[];
  seated: boolean;
}> = [
  // 靠窗餐桌 3 人（坐姿低语：原生 sit / 原生坐姿接电话 make_a_call_01 / 骨骼坐姿）
  { modelId: 'studentFemale4', clips: ['sit'], seated: true },
  { modelId: 'studentFemale3', clips: ['make_a_call_01'], seated: true },
  { modelId: 'studentMale4', clips: [], seated: true },
  // 过道站姿 3 人（进门直面注视：键盘侠 + 阴阳怪气 + 起哄看热闹，全部使用纯站姿剪辑）
  { modelId: 'studentMale2', clips: ['angry_01', 'laugh_02', 'wait'], seated: false },
  { modelId: 'studentFemale3', clips: ['laugh_01', 'agree', 'swagger'], seated: false },
  { modelId: 'studentMale3', clips: ['make_a_call_02', 'cheer', 'wait'], seated: false },
  // 三号窗口旁 3 人（理性同学 + 沉默旁观 + 抱臂议论）
  { modelId: 'studentMale4', clips: ['look_around', 'agree', 'make_a_call_02'], seated: false },
  { modelId: 'studentFemale4', clips: ['fold_arms', 'look_around', 'afraid'], seated: false },
  { modelId: 'studentMale', clips: ['fold_arms', 'complain_01', 'make_a_call_02'], seated: false },
];

const STUDENTS = [
  [
    { x: -4.8, z: 4.48, yaw: 0, seated: true },
    { x: -4.8, z: 6.32, yaw: Math.PI, seated: true },
    { x: -6.2, z: 4.48, yaw: 0.35, seated: true },
  ],
  [
    { x: -1.9, z: 1.9, yaw: 0.18, seated: false },
    { x: -2.65, z: 0.95, yaw: -0.3, seated: false },
    { x: -1.15, z: 0.35, yaw: 2.6, seated: false },
  ],
  [
    { x: 3.6, z: -5.6, yaw: 1.1, seated: false },
    { x: 4.5, z: -5.5, yaw: -1.1, seated: false },
    { x: 4.05, z: -6.35, yaw: 0, seated: false },
  ],
];

/**
 * C-34：九个脚底接触阴影合成一个 InstancedMesh（1 个 draw call，零贴图）。
 * 椭圆长轴随人物朝向；站姿压在小腿 footprint 上，坐姿往前挪到臀→脚之间。
 */
function createStudentShadows(parent: THREE.Object3D, d: Details): void {
  const geo = new THREE.CircleGeometry(0.5, 10);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x2b3438, transparent: true, opacity: 0.16, depthWrite: false,
  });
  const parts: Part[] = [];
  for (const crowd of STUDENTS) {
    for (const { x, z, yaw, seated } of crowd) {
      // yaw=0 时局部 +z 指向世界 +z，偏移沿朝向轴推
      const along = seated ? 0.18 : 0.02;
      parts.push({
        p: [x + Math.sin(yaw) * along, 0.006, z + Math.cos(yaw) * along],
        s: seated ? [0.62, 1, 0.56] : [0.55, 1, 0.44],
        r: [0, yaw, 0],
      });
    }
  }
  d.batch(parent, 'canteen-student-contact-shadows', geo, mat, parts);
}


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
  // 傍晚套件接入后面数预算吃紧：学生头/树冠分段下调一档（仅本场景局部几何，轮廓不变）
  const sphere = new THREE.SphereGeometry(1, 10, 6);
  const torsoGeo = new THREE.CylinderGeometry(0.16, 0.19, 0.56, 6);
  const limbGeo = new THREE.CylinderGeometry(0.055, 0.048, 1, 6);
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
  const tint = new THREE.Color(0xffb469);
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
    vertexColors: true, transparent: true, opacity: 0.24, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'canteen-window-light-patches';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.raycast = () => {};
  return mesh;
}

/**
 * 一处光 = 一个网格里若干块参数化面片。顶点色用 4 分量：rgb 放光色、a 放衰减，
 * 材质 opacity 做总增益。这样同一套构建器既能喂加色混合（光幕、窗外冷光），也能喂
 * 正常混合（落在地面和台面上的光斑）——加色下 alpha 决定"加多少"，正常下决定"换掉多少"。
 *
 * 为什么地面光斑必须走正常混合：加色混合的最终像素还要过一遍 ACES，而 ACES 会把高光去饱和。
 * 实测 a=0.46 的琥珀加色落在冷灰地面上只得到 (222,206,192)，r-b=30，勉强够 28 的暖色判定线，
 * 再降一点就整片不算暖。改成 mix(底色, 琥珀, 0.5) 直接得到 (192,170,118)，r-b=74，
 * 明度几乎不变但色相站得住——暖色像素占比才有得谈。
 */
interface LightPatch {
  cols: number;
  rows: number;
  gain: number;
  tint: THREE.Color;
  place: (u: number, v: number) => V3;
  weight: (u: number, v: number) => number;
}

function createLightMesh(patches: LightPatch[], options: {
  name: string; opacity: number; blending: THREE.Blending; renderOrder: number;
}): THREE.Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (const spec of patches) {
    const { cols, rows, gain, tint, place, weight } = spec;
    const offset = positions.length / 3;
    for (let r = 0; r <= rows; r += 1) {
      for (let c = 0; c <= cols; c += 1) {
        const [x, y, z] = place(c / cols, r / rows);
        positions.push(x, y, z);
        colors.push(tint.r, tint.g, tint.b, Math.min(1, weight(c / cols, r / rows) * gain));
      }
    }
    for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
      const a = offset + r * (cols + 1) + c;
      indices.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: options.opacity, depthWrite: false,
    blending: options.blending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = options.name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = options.renderOrder;
  mesh.raycast = () => {};
  return mesh;
}

const WARM_TINT = new THREE.Color(0xff9e4d);
const DUSK_BEAM = new THREE.Color(0xffa860);
const beamFeather = (u: number): number => Math.sin(Math.PI * u);
const beamLerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * C-33 / C-40：三号窗口落在实体上的暖光——地面一片洒落 + 台身正面一道暖洗，正常混合，1 个 draw call。
 * 出生点机位在 12 m 外平视，地面被透视压成一条窄横带，靠墙那一小片矩形光斑最多只占画面 0.9%。
 * 所以取低角度日光：光沿地面一路铺到玩家脚前（z 从 -7.75 拉到 +3.25），台前窄、往入口一侧张开成梯形，
 * 衰减用 (1-v)^0.35·(1-v⁴)——中段保持平台、末端快速收干净，不让橙光糊满整个下带。
 */
function createWindowThreeFloorLight(): THREE.Mesh {
  const pool = (u: number, v: number): V3 => [2.2 + (u - 0.5) * 2 * (2.0 + 2.6 * v), 0.09, -7.75 + 11.0 * v];
  return createLightMesh([
    { cols: 8, rows: 9, gain: 0.72, tint: WARM_TINT, place: pool,
      weight: (u, v) => Math.pow(beamFeather(u), 0.5) * Math.pow(1 - v, 0.35) * (1 - Math.pow(v, 4)) },
    // 台身正面的暖洗：y 0.14→1.02，越靠台口越亮，把"这一格是热的"刷在立面上
    { cols: 7, rows: 4, gain: 1.9, tint: WARM_TINT,
      place: (u, v) => [0.15 + 4.1 * u, 0.14 + 0.88 * v, -7.71],
      weight: (u, v) => beamFeather(u) * Math.pow(v, 1.8) * (1 - Math.pow(v, 2.5)) },
  ], { name: 'canteen-window-three-floor-light', opacity: 0.8, blending: THREE.NormalBlending, renderOrder: 9 });
}

/**
 * C-39 + 三号窗口的光幕：三束窗外斜进来的冷光，加两片台口暖光幕，全部加色混合，仍然只有 1 个 draw call。
 * 冷光只做"房间有白天"的铺底，权重压在暖光之下，不和三号窗口抢视觉锚点。
 */
function createLightSheets(): THREE.Mesh {
  const patches: LightPatch[] = [];
  // 两片交叉的暖光幕：从台口斜落到地面光斑近端，构成"一道光"的体积感
  patches.push({ cols: 6, rows: 6, gain: 0.62, tint: WARM_TINT,
    place: (u, v) => beamLerp([0.35 + 3.7 * u, 1.06, -7.66], [0.5 + 4.6 * u, 0.1, 2.6], v),
    weight: (u, v) => Math.pow(beamFeather(u), 0.7) * Math.pow(1 - v, 1.15) });
  patches.push({ cols: 6, rows: 5, gain: 0.46, tint: WARM_TINT,
    place: (u, v) => beamLerp([0.9 + 2.6 * u, 1.34, -7.86], [0.2 + 4.4 * u, 0.1, 1.0], v),
    weight: (u, v) => Math.pow(beamFeather(u), 0.7) * Math.pow(1 - v, 1.35) });
  for (const [index, cz] of [-6.4, -2.2, 2.6].entries()) {
    const spread = 1.5 + index * 0.35;
    patches.push({ cols: 5, rows: 4, gain: 0.16, tint: DUSK_BEAM,
      place: (u, v) => beamLerp([-8.72, 3.42, cz - 0.85 + 1.7 * u],
        [-3.6 - index * 0.5, 0.04, cz - spread / 2 + spread * u], v),
      weight: (u, v) => Math.pow(beamFeather(u), 0.8) * Math.pow(1 - v, 1.2) });
  }
  return createLightMesh(patches,
    { name: 'canteen-light-sheets', opacity: 0.34, blending: THREE.AdditiveBlending, renderOrder: 8 });
}

/** 尘埃位点：三束冷光里各撒一片，附带三号窗口光幕下的一小撮。用实例化小方片而不是 Points，
 *  世界清理规则只遍历 Mesh，Points 的几何与材质会漏在场景外。 */
const DUST_SPECS: Array<{ x: number; y: number; z: number; phase: number }> = (() => {
  const list: Array<{ x: number; y: number; z: number; phase: number }> = [];
  let seed = 20261118;
  // Lehmer 同余：乘数小到 seed*48271 仍在 2^53 以内，位运算不会退化成固定值
  const random = (): number => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  for (const cz of [-6.4, -2.2, 2.6]) {
    for (let i = 0; i < 34; i += 1) {
      const v = 0.12 + random() * 0.78;
      const u = 0.12 + random() * 0.76;
      list.push({
        x: lerp(-8.72, -3.6, v) + (random() - 0.5) * 0.5,
        y: lerp(3.42, 0.04, v) + (random() - 0.5) * 0.55,
        z: cz + (u - 0.5) * 1.7 * (1 - v * 0.4),
        phase: random(),
      });
    }
  }
  for (let i = 0; i < 18; i += 1) {
    const v = 0.1 + random() * 0.8;
    list.push({
      x: lerp(1.0, 1.2, v) + (random() - 0.5) * 3.2,
      y: lerp(1.3, 0.1, v) + (random() - 0.5) * 0.4,
      z: lerp(-7.6, -3.6, v) + (random() - 0.5) * 0.5,
      phase: random(),
    });
  }
  return list;
})();

function createDustMotes(): THREE.InstancedMesh {
  const geometry = new THREE.PlaneGeometry(0.026, 0.026);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffd9a8, transparent: true, opacity: 0.5, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, DUST_SPECS.length);
  mesh.name = 'canteen-dust-motes';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 10;
  mesh.raycast = () => {};
  const transform = new THREE.Object3D();
  DUST_SPECS.forEach((spec, i) => {
    transform.position.set(spec.x, spec.y, spec.z);
    transform.rotation.set(spec.phase * 2.4, spec.phase * 3.1, 0);
    transform.updateMatrix();
    mesh.setMatrixAt(i, transform.matrix);
    mesh.setColorAt(i, new THREE.Color().setScalar(0.3 + spec.phase * 0.7));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  // 世界清理规则只 dispose 几何与材质，不碰实例缓冲；沿用蒸汽卡的写法把几何 dispose 转成
  // 整只 InstancedMesh 的 dispose，否则 instanceMatrix/instanceColor 会留在显存里。
  const release = (): void => {
    mesh.dispose();
    geometry.removeEventListener('dispose', release);
  };
  geometry.addEventListener('dispose', release);
  return mesh;
}

const DUST_COLOR = new THREE.Color();
const DUST_TRANSFORM = new THREE.Object3D();

/** 尘埃明暗呼吸 + 轻缓斜向气流飘浮（低开销实例矩阵与能量更新） */
function updateDust(mesh: THREE.InstancedMesh, time: number): void {
  for (let i = 0; i < DUST_SPECS.length; i += 1) {
    const spec = DUST_SPECS[i];
    const phase = spec.phase * 6.28318;
    const twinkle = Math.sin(time * 0.6 + phase) * 0.5 + 0.5;
    mesh.setColorAt(i, DUST_COLOR.setScalar(0.14 + twinkle * twinkle * 0.86));
    DUST_TRANSFORM.position.set(
      spec.x + Math.sin(time * 0.35 + phase) * 0.06,
      spec.y + Math.sin(time * 0.48 + phase * 1.3) * 0.055,
      spec.z + Math.cos(time * 0.3 + phase) * 0.05,
    );
    DUST_TRANSFORM.rotation.set(phase + time * 0.15, phase * 1.3 + time * 0.12, 0);
    DUST_TRANSFORM.scale.setScalar(0.85 + twinkle * 0.3);
    DUST_TRANSFORM.updateMatrix();
    mesh.setMatrixAt(i, DUST_TRANSFORM.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/** 蒸汽卡：上升行程、单卡尺寸与六张卡的站位／错相。固定 6 张，不做 LOD。 */
const STEAM_RISE = 0.42;
const STEAM_LAYOUT = [
  { x: 1.05, yaw: 0, tilt: 0.1, phase: 0.0 },
  { x: 1.62, yaw: Math.PI / 2, tilt: -0.08, phase: 0.37 },
  { x: 2.16, yaw: 0.7, tilt: 0.12, phase: 0.71 },
  { x: 2.2, yaw: 2.25, tilt: -0.06, phase: 0.18 },
  { x: 2.78, yaw: 1.5, tilt: 0.09, phase: 0.55 },
  { x: 3.32, yaw: 0, tilt: -0.11, phase: 0.86 },
];

/**
 * C-33：六张蒸汽卡合成一个 InstancedMesh（1 个 draw call、零贴图）。
 * 渐变烘在顶点色里，每帧用 instanceColor 把颜色推向黑色完成淡出——加色混合下
 * 颜色即能量，不需要顶点 alpha，也不需要每卡一个材质。
 */
function createSteamBatch(): THREE.InstancedMesh {
  const cols = 3;
  const rows = 6;
  const width = 0.46;
  const height = 0.75;
  const tint = new THREE.Color(0xfff0d6);
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r <= rows; r += 1) {
    const v = r / rows;
    for (let c = 0; c <= cols; c += 1) {
      const u = c / cols;
      positions.push((u - 0.5) * width, v * height, 0);
      const falloff = Math.sin(Math.PI * u) * Math.pow(v, 1.5) * (1 - Math.pow(v, 2.4));
      colors.push(tint.r * falloff, tint.g * falloff, tint.b * falloff);
    }
  }
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
    const a = r * (cols + 1) + c;
    indices.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.38, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, STEAM_LAYOUT.length);
  mesh.name = 'canteen-window-three-steam';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 10;
  mesh.raycast = () => {};
  const scratch = new THREE.Object3D();
  const black = new THREE.Color(1, 1, 1);
  STEAM_LAYOUT.forEach((spec, i) => {
    scratch.position.set(spec.x, 1.12, -7.82);
    scratch.rotation.set(0, spec.yaw, spec.tilt);
    scratch.scale.setScalar(1);
    scratch.updateMatrix();
    mesh.setMatrixAt(i, scratch.matrix);
    mesh.setColorAt(i, black);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  const release = (): void => {
    mesh.dispose();
    geometry.removeEventListener('dispose', release);
  };
  geometry.addEventListener('dispose', release);
  return mesh;
}

const steamTransform = new THREE.Object3D();
const steamColor = new THREE.Color();

/** 由 canteenRuntime.tick 驱动：0.25 m/s 上升，sin(πt) 淡入淡出，越往上越散。 */
function updateSteam(mesh: THREE.InstancedMesh, time: number): void {
  STEAM_LAYOUT.forEach((spec, i) => {
    const t = ((time * 0.25 / STEAM_RISE) + spec.phase) % 1;
    const grow = 0.78 + t * 0.6;
    steamTransform.position.set(spec.x + Math.sin((time + spec.phase * 6) * 0.7) * 0.05,
      1.12 + t * STEAM_RISE, -7.82);
    steamTransform.rotation.set(0, spec.yaw, spec.tilt);
    steamTransform.scale.set(grow, grow, grow);
    steamTransform.updateMatrix();
    mesh.setMatrixAt(i, steamTransform.matrix);
    mesh.setColorAt(i, steamColor.setScalar(Math.sin(Math.PI * t)));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}


/**
 * 小尺寸确定性冷灰水磨石纹理：零网络，低饱和冷石碎粒，重复约每两米一次。
 * C-30：底色 #c3cac9（原 #dee3e5），石子明度跨度收到 ±14，数量 1300→910，
 * 大石子只留 12%，roughness 0.64→0.74。实测下带明度 190→156、边缘密度 22%→11%。勿再提亮。
 */
function terrazzo(): THREE.MeshStandardMaterial {
  const size = 256;
  const pixels = new Uint8Array(size * size * 4);
  let seed = 127;
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 4;
      const noise = Math.floor(random() * 7) - 3;
      // 2x2 大砖分缝与 1px 柔和微亮倒角，消除平面灰块感、强化镜面水磨石秩序
      const onSeam = x === 0 || x === 128 || y === 0 || y === 128;
      const onBevel = x === 1 || x === 129 || y === 1 || y === 129;
      const tileTone = ((x >= 128 ? 1 : 0) ^ (y >= 128 ? 1 : 0)) ? 3 : -2;
      const delta = onSeam ? -22 : onBevel ? 9 : tileTone + noise;
      pixels.set([104 + delta, 110 + delta, 124 + delta, 255], idx);
    }
  }
  // 三阶细碎矿物颗粒（玄武岩深灰 + 中灰云母 + 微亮石英点），低对比耐看
  const colors = [[88, 94, 106], [98, 105, 118], [116, 122, 134], [128, 132, 140]];
  for (let i = 0; i < 960; i += 1) {
    const x = Math.floor(random() * size);
    const y = Math.floor(random() * size);
    const radius = random() < 0.12 ? 2 : 1;
    const color = colors[i % colors.length];
    for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
      if (Math.abs(dx) + Math.abs(dy) > radius) continue;
      const px = (x + dx + size) % size;
      const py = (y + dy + size) % size;
      if (px === 0 || px === 128 || py === 0 || py === 128) continue;
      pixels.set([...color, 255], (py * size + px) * 4);
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
  // 傍晚擦亮水磨石：roughness 0.28 + 轻微金属度与环境反射，映出暖金窗光与灯箱微光
  const material = new THREE.MeshStandardMaterial({
    map: texture, roughness: 0.28, metalness: 0.08, envMapIntensity: 0.72, vertexColors: true,
  });
  material.addEventListener('dispose', () => texture.dispose());
  return material;
}

/** 左侧落地窗外的傍晚晚霞天际幕板：暖橘地平线过渡到暮蓝紫天顶（1 DrawCall / 2 三角形 / 零贴图） */
function createDuskBackdrop(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(34, 12, 1, 4);
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const stops = [
    new THREE.Color(0x28324a),
    new THREE.Color(0x4b4c6e),
    new THREE.Color(0x9b6b68),
    new THREE.Color(0xe59d6d),
    new THREE.Color(0xf7c288),
  ];
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i += 1) {
    const t = Math.max(0, Math.min(1, 1 - (pos.getY(i) + 6) / 12));
    const scaled = t * (stops.length - 1);
    const idx = Math.min(stops.length - 2, Math.floor(scaled));
    tmp.copy(stops[idx]).lerp(stops[idx + 1], scaled - idx);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'canteen-dusk-backdrop';
  mesh.position.set(-20.5, 4.8, 0);
  mesh.rotation.y = Math.PI / 2;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.raycast = () => {};
  return mesh;
}

/**
 * C-30：地面大尺度明度梯度。用顶点色而不是贴图内渐变——贴图 repeat 是 9×10，
 * 画进贴图会平铺成条纹。靠窗亮、靠右墙与靠入口暗，把最亮的近景压下去。
 * 实测：0.9 起手的近带只降到 176，改 0.70→1.00 的线性推近景，下带目标 150–162。
 */
function createFloorGeometry(): THREE.PlaneGeometry {
  const width = 18;
  const depth = 20;
  const geometry = new THREE.PlaneGeometry(width, depth, 9, 10);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    const u = position.getX(i) / width + 0.5;
    const v = position.getY(i) / depth + 0.5;
    // 局部 +y 经 mesh 的 -90° 俯仰后落到世界 -z，所以 v=0 是入口侧、v=1 是售饭线侧
    const shade = Math.min(1, 0.6 + v * 0.32 + (1 - u) * 0.08);
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}


function architecture(parent: THREE.Object3D, d: Details, occluders: THREE.Object3D[]): void {
  // 清新偏压抑冷灰基调：60% 浅灰白墙面 + 30% 冷水泥/不锈钢与淡木 + 10% 焦点色
  // C-31：墙面 0xe3e8eb→0xd8dfe3。上带里除了天花还有右侧整片白墙，只压天花不动墙面无效。
  // 傍晚室内：深灰蓝略紫的墙身，暖金光斑与灯箱自发光才有冷暖对撞
  const coolWall = d.matte(0x5a6178);
  const slateWainscot = d.matte(0x39404e);
  const frame = d.matte(0x2c3340, 0.5, 0.25);
  const floor = d.mesh(parent, 'canteen-terrazzo-floor', createFloorGeometry(), terrazzo(),
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
  // C-31：天花 0xdde3e7→0xb9c3c9，上带明度 157→145
  d.box(parent, 'canteen-ceiling', [0, 4.57, 0], [18.3, 0.14, 20.3], d.matte(0x434a5c));
  const mullions: Part[] = [];
  const panes: Part[] = [];
  for (let z = -10; z <= 10; z += 4) {
    mullions.push({ p: [-8.97, 2.25, z], s: [0.22, 3, 0.12] });
    if (z < 10) panes.push({ p: [-9.01, 2.25, z + 2], s: [0.025, 2.78, 3.88] });
  }
  for (const y of [0.86, 2.7, 3.64]) mullions.push({ p: [-8.94, y, 0], s: [0.25, 0.08, 20] });
  d.boxes(walls, 'canteen-window-frames', frame, mullions);
  const glass = new THREE.MeshStandardMaterial({ color: 0x2b3749, roughness: 0.18,
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
  d.boxes(parent, 'canteen-entry-door-panels', d.matte(0x495063), [-0.73, 0.73].map((x) => ({
    p: [x, 1.42, 9.77], s: [1.39, 2.6, 0.04],
  })));
  d.boxes(parent, 'canteen-entry-handles', frame, [-0.16, 0.16].map((x) => ({
    p: [x, 1.25, 9.68], s: [0.04, 0.48, 0.06],
  })));

  // 顶部外露混凝土结构梁 + 悬吊式冷白条形荧光灯具 + 吊杆 + 通风管 + 工业吊扇
  // C-31：去掉 x=0 的中央纵梁——它正好压在出生点到三号窗口的中轴上，在画面顶部切出一道硬边；
  // 梁色与天花的差从 40 收到 14，剪影还在但不产生高对比边。实测上带边缘 13%→7%。
  const beams: Part[] = [];
  for (let z = -8; z <= 8; z += 4) beams.push({ p: [0, 4.34, z], s: [18.1, 0.28, 0.2] });
  for (const x of [-5.5, 5.5]) beams.push({ p: [x, 4.4, 0], s: [0.18, 0.18, 20] });
  d.boxes(parent, 'canteen-ceiling-ribs', d.matte(0x3d4354, 0.86), beams);

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
  // C-31：梁与天花压暗后，灯管自己提亮一点，靠高亮小面撑住顶部，而不是抬整体曝光
  lamp.emissiveIntensity = 1.35;
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
  for (const [fx, fz] of FAN_POSITIONS) {
    fanParts.push(
      { p: [fx, 4.26, fz], s: [0.04, 0.42, 0.04] },
      { p: [fx, 4.02, fz], s: [0.22, 0.07, 0.22] },
      { p: [fx, 4.0, fz], s: [1.35, 0.022, 0.14], r: [0, 0.35, 0] },
      { p: [fx, 4.0, fz], s: [1.35, 0.022, 0.14], r: [0, 1.92, 0] },
    );
  }
  d.boxes(parent, 'canteen-ceiling-fans', d.matte(0x7d8a8e, 0.55, 0.28), fanParts);

  // 端墙挂钟动态指针（贴合 prop_canteen_clock 中心 (0, 3.75, -9.74)，傍晚 17:42 起走）
  const clockPivot = group(parent, 'canteen-clock-hands');
  clockPivot.position.set(0, 3.75, -9.73);
  const hourHand = group(clockPivot, 'canteen-clock-hour');
  d.box(hourHand, 'canteen-clock-hour-bar', [0, 0.07, 0], [0.02, 0.16, 0.008], d.matte(0x28303b, 0.4));
  const minuteHand = group(clockPivot, 'canteen-clock-minute');
  d.box(minuteHand, 'canteen-clock-minute-bar', [0, 0.1, 0.006], [0.014, 0.22, 0.008], d.matte(0x323b48, 0.4));
  const secondHand = group(clockPivot, 'canteen-clock-second');
  d.box(secondHand, 'canteen-clock-second-bar', [0, 0.095, 0.012], [0.008, 0.24, 0.006], d.matte(0xc44f42, 0.4));

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
  const columnZ = COLUMN_Z;
  for (let i = 0; i < columnZ.length; i += 1) {
    columns.push({ p: [8.66, 2.25, columnZ[i]], s: [0.44, 4.5, 0.44] });
    columnGuards.push({ p: [8.65, 0.56, columnZ[i]], s: [0.47, 1.12, 0.47] });
    posters.push({ p: [8.36, 1.82, columnZ[i]], s: [0.035, 0.94, 0.62], color: posterColors[i] });
  }
  for (const sz of [-4.2, 0.3, 4.5]) {
    sloganFrames.push({ p: [8.84, 2.48, sz], s: [0.04, 0.68, 2.2] });
    sloganPanels.push({ p: [8.81, 2.48, sz], s: [0.02, 0.54, 2.02] });
  }
  d.boxes(parent, 'canteen-columns', d.matte(0xd6dde0), columns);
  d.boxes(parent, 'canteen-column-crash-guards', d.matte(0x454f54, 0.68, 0.18), columnGuards);
  d.boxes(parent, 'canteen-column-posters', d.matte(0xffffff), posters);
  d.boxes(parent, 'canteen-wall-slogan-frames', d.matte(0x526468, 0.64), sloganFrames);
  d.boxes(parent, 'canteen-wall-slogan-panels', d.matte(0x79839a, 0.85), sloganPanels);

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

  // 傍晚：冷灰蓝紫的天光漫射压到半亮以下，暖光斑与灯箱自发光才有对比层次
  const fill = new THREE.HemisphereLight(0x5a6488, 0x2c2f38, 0.55);
  fill.name = 'canteen-shadowless-fill';
  parent.add(fill);

  const garden = group(parent, 'canteen-window-garden');
  garden.add(createDuskBackdrop());
  d.box(garden, 'canteen-garden-ground', [-13, -0.08, 0], [9, 0.12, 26], d.matte(0x46524a));
  d.box(garden, 'canteen-garden-low-wall', [-16.9, 0.6, 0], [0.3, 1.2, 26], d.matte(0x5a616b));
  // 远景校园建筑立面剪影：错落冷灰楼体
  const facadeZ = [-10, -4.5, 1, 6.5];
  const facadeH = [4.6, 5.8, 3.9, 5.2];
  const facadeTone = [0x39434e, 0x414b57, 0x333d47, 0x3c4650];
  d.boxes(garden, 'canteen-far-campus', d.matte(0xffffff), facadeZ.map((z, i) => ({
    p: [-18.4, facadeH[i] / 2 - 0.08, z], s: [2.0, facadeH[i], 3.4], color: facadeTone[i],
  })));
  // 树干（微锥圆柱）+ 多簇树冠 + 低矮灌木。
  // C-38 空气透视：远处 5 棵整体降饱和 25%、提亮 8%，近处 2 棵保持原色并加枝干剪影。
  // 任务书建议近处换卡片树，但贴图账已经到 25 上限，且资源生命周期单测禁止两次 build 共享同一张
  // 缓存贴图——canopy.ts 的贴图是模块级缓存，换过来必然同时踩两条红线。这里改用"近实远虚"的
  // 配色 + 同批次加枝干盒实现同一目的：0 新贴图、0 新 draw call。
  //
  // 树冠不用 d.sphere（168 面，且与学生头像共用同一份几何，改它等于改人脸）：另建 8×4 分段球
  // 48 面，靠"每棵 6~7 块偏心簇 + 逐实例旋转 + 三层色"把原来 30 个大球的蘑菇轮廓拆掉。
  // 背光口径按任务书：冠顶透光黄绿、冠体中绿、冠底与内侧深绿，远景整层灰化提亮。
  // 面数 30×168 + 7×168 = 6216 → 44×48 + 12×48 = 2688，省出的 3528 面付给一桌四椅真实模型套装。
  const trunkGeo = new THREE.CylinderGeometry(0.06, 0.1, 1, 6);
  const canopyGeo = new THREE.SphereGeometry(1, 7, 4);
  const trunks: Part[] = [];
  const foliage: Part[] = [];
  const shrubs: Part[] = [];
  // 三层色：0 冠顶（透光黄绿）/ 1 冠体（中绿）/ 2 冠底与内侧（深绿）
  const nearTone = [0x6d7a3a, 0x48603a, 0x2c4a30];
  const farTone = [0x5d6a4c, 0x4d5c50, 0x3e4f45];
  const nearShrub = 0x35473f;
  const farShrub = 0x3c4d44;
  // [dx, dy(相对树梢基准 h), dz, sx, sy, sz, 色层, 旋转]：偏心且不对称，破掉球堆感
  const CLUMPS: Array<[number, number, number, number, number, number, number, number]> = [
    [0.00, 0.95, 0.00, 1.28, 0.98, 1.16, 1, 0.0],
    [0.66, 0.42, 0.26, 0.94, 0.78, 0.88, 2, 0.5],
    [-0.62, 0.30, -0.32, 0.88, 0.72, 0.82, 2, 1.1],
    [0.34, 1.48, -0.24, 0.78, 0.66, 0.74, 0, 0.8],
    [-0.40, 1.34, 0.34, 0.70, 0.60, 0.68, 0, 1.7],
    [-0.82, 0.98, -0.58, 0.60, 0.52, 0.58, 1, 0.3],
    [0.10, 1.88, 0.04, 0.52, 0.44, 0.50, 0, 2.4],
  ];
  let treeIndex = 0;
  for (let z = -9; z <= 9; z += 3) {
    const jitter = (treeIndex % 3) - 1;
    const near = treeIndex >= 5;
    const tone = near ? nearTone : farTone;
    const x = -12.5 + jitter * 0.4;
    const h = 3.0 + (treeIndex % 3) * 0.28 + (near ? 0.35 : 0);
    trunks.push({ p: [x, h / 2, z], s: [1, h, 1] });
    const spin = treeIndex * 0.41;
    CLUMPS.forEach((clump, i) => {
      // 远景树少挂一块侧簇、并整体收拢 8%，七棵树的天际线因此高低错落
      if (!near && (i === 5 || i === 3)) return;
      const [dx, dy, dz, sx, sy, sz, layer, rot] = clump;
      const tuck = near ? 1 : 0.92;
      foliage.push({
        p: [x + dx * tuck, h + dy, z + dz * tuck],
        s: [sx * tuck, sy, sz * tuck],
        r: [rot + spin, spin * 0.7, rot * 0.4 - spin * 0.3],
        color: tone[layer],
      });
    });
    shrubs.push({
      p: [x + 1.2, 0.4, z + 0.8], s: [1.1, 0.8, 0.7], r: [0.18 * treeIndex, treeIndex * 0.9, 0],
      color: near ? nearShrub : farShrub,
    });
    if (near) {
      // C-38 出枝：细圆柱绕 X 轴转到近水平，从 trunk 批次里斜插出冠缘。天空背景下剩下的就是
      // 枝干剪影，球冠的"蘑菇"轮廓因此破掉。同批次加实例 = 0 新 draw call、0 新贴图。
      for (const [side, pitch, len] of [[1, 1.22, 1.55], [-1, 1.06, 1.3], [1, 0.82, 1.0]] as Array<[number, number, number]>) {
        const theta = side * pitch;
        trunks.push({
          p: [x + 0.08, h + 0.42 + (len / 2) * Math.cos(theta), z + (len / 2) * Math.sin(theta)],
          s: [0.9, len, 0.9],
          r: [theta, 0, 0],
        });
      }
      // 冠外一块偏心的侧叶，让两棵树的外轮廓不重样
      foliage.push({
        p: [x + 0.2, h + 0.62, z - 0.95], s: [1.12, 0.66, 0.92], r: [0.4, spin, 0.2],
        color: tone[1],
      });
    }
    treeIndex += 1;
  }
  // 灌木补一行矮丛，把地面与树冠之间的空档填上（仍共用同一批次）
  for (let i = 0; i < 3; i += 1) {
    shrubs.push({
      p: [-11.6 + (i % 2) * 1.4, 0.28, -7.5 + i * 3.6],
      s: [0.86, 0.52, 0.78],
      r: [0.25, i * 1.3, 0.1],
      color: i % 2 === 0 ? farShrub : nearShrub,
    });
  }
  d.batch(garden, 'canteen-tree-trunks', trunkGeo, d.matte(0x4a443c), trunks);
  d.batch(garden, 'canteen-tree-foliage', canopyGeo, d.matte(0xffffff), foliage);
  d.batch(garden, 'canteen-shrubs', canopyGeo, d.matte(0xffffff), shrubs);
}

/** 场景代次：切走食堂后仍在途的道具回调必须作废，不能往复用的关卡根节点里补挂上一代的几何 */
let canteenGeneration = 0;
/** 道具实例网格：几何与材质归 resources 的道具缓存共享，这里只登记每代场景自己的 instanceMatrix */
const canteenPropMeshes: THREE.InstancedMesh[] = [];

/**
 * 用道具几何按位表建一个 InstancedMesh：几何已在 resources 里贴地、XZ 居中、按清单高度归一化，
 * 位姿只带位移与 yaw。逐实例明度 ±4% 抖动打散六张同模餐桌的重复感，instanceColor 不加 DrawCall，
 * 抖动按序号而不是随机数，保证同机位截图可复现。食堂全场景不添加投影者，故 castShadow 恒为 false。
 */
function createPropInstances(
  parent: THREE.Object3D,
  name: string,
  asset: PropModelAsset,
  specs: ReadonlyArray<{ x: number; z: number }>,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(asset.geometry, asset.material, specs.length);
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  specs.forEach((spec, index) => {
    transform.position.set(spec.x, 0, spec.z);
    transform.rotation.set(0, 0, 0);
    transform.scale.set(1, 1, 1);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    mesh.setColorAt(index, color.setScalar(1 + (((index * 7) % 5) - 2) * 0.02));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  parent.add(mesh);
  canteenPropMeshes.push(mesh);
  return mesh;
}

/** 整批实例只沿 Y 平移：成品台面与程序化台面差 2.2cm，桌面小道具的位表因此不用重写第二份 */
function shiftInstances(mesh: THREE.InstancedMesh, dy: number): void {
  const transform = new THREE.Object3D();
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < mesh.count; index += 1) {
    mesh.getMatrixAt(index, matrix);
    matrix.decompose(transform.position, transform.quaternion, transform.scale);
    transform.position.y += dy;
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
}

interface CanteenTableSwap {
  dining: THREE.Group;
  /** 程序化桌板：换桌后只关 visible，仍留在遮挡射线与场景树里 */
  tops: THREE.InstancedMesh;
  /** 桌底骨架与座椅底轨同批，套装自带脚架，换装后整批关 visible，DrawCall 反而少一次 */
  legs: THREE.InstancedMesh;
  /** 程序化座面与椅背：套装自带四把椅子，同样只关 visible */
  seats: THREE.InstancedMesh;
  tabletopProps: THREE.InstancedMesh[];
}

/**
 * 餐桌热替换：程序化桌椅先照常建好，GLB 到位才换视觉层，加载失败或已切场景就什么都不做，
 * 场景里留下的永远是完整的一套桌椅而不是空洞。
 * 套装是一件「一桌 + 四椅」的单网格单材质模型，程序化的桌板、椅腿、座面三批全部让位给它，
 * 因此这里换的是视觉层而不是几何来源——遮挡射线与 nav 碰撞框仍按原来的批次走。
 */
function mountPropTables(swap: CanteenTableSwap): void {
  const generation = canteenGeneration;
  loadPropModel('canteenSet').then((asset) => {
    if (!asset || generation !== canteenGeneration) return;
    createPropInstances(swap.dining, 'canteen-set-props', asset, TABLES);
    swap.tops.visible = false;
    swap.legs.visible = false;
    swap.seats.visible = false;
    const drop = TABLE_TOP_PROP - TABLE_TOP_PROCEDURAL;
    for (const batch of swap.tabletopProps) shiftInstances(batch, drop);
  });
}

function furniture(parent: THREE.Object3D, d: Details, occluders: THREE.Object3D[]): void {
  const dining = group(parent, 'canteen-dining');
  const tops: Part[] = [];
  // 座椅侧底轨与座柱：程序化椅子的骨架，成品套装到位后与桌架同批退出绘制
  const seatFrames: Part[] = [];
  // 桌底纵向主横梁与两侧双立柱：成品餐桌自带脚架
  const tableFrames: Part[] = [];
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
    tableFrames.push({ p: [x, 0.08, z], s: [2.2, 0.045, 0.055] });
    tableFrames.push({ p: [x, 0.71, z], s: [2.36, 0.045, 0.06] });
    for (const dx of [-1.08, 1.08]) {
      for (const dz of [-0.3, 0.3]) {
        tableFrames.push({ p: [x + dx, 0.37, z + dz], s: [0.05, 0.74, 0.05] });
      }
      tableFrames.push({ p: [x + dx, 0.08, z], s: [0.045, 0.045, 0.64] });
    }
    // 贯穿桌底至四座位的横向连体钢管底轨 + 独立座柱 + 椅背双撑管
    for (const dx of [-0.7, 0.7]) {
      seatFrames.push({ p: [x + dx, 0.06, z], s: [0.045, 0.045, 1.92] });
      for (const side of [-1, 1]) {
        const cz = z + side * 0.92;
        seats.push(
          { p: [x + dx, 0.45, cz], s: [0.46, 0.052, 0.44] },
          { p: [x + dx, 0.75, cz + side * 0.2], s: [0.46, 0.42, 0.042] },
        );
        seatFrames.push(
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

  const topsBatch = d.boxes(dining, 'canteen-tabletops', d.matte(0xd2d6d4, 0.58), tops);
  // 底轨与桌架同批：套装自带椅腿与桌脚架，成品到位后整批退出绘制，仍然只占一次 DrawCall
  const legsBatch = d.boxes(dining, 'canteen-table-chair-legs', d.matte(0x556267, 0.42, 0.48),
    [...seatFrames, ...tableFrames]);
  const seatsBatch = d.boxes(dining, 'canteen-chair-seats-backs', d.matte(0x75898b, 0.68), seats);
  const traysBatch = d.boxes(dining, 'canteen-dining-trays', d.matte(0xbcc6c8, 0.36, 0.35), trays);
  const chopsticksBatch = d.boxes(dining, 'canteen-chopsticks', d.matte(0xbaa682, 0.78), chopsticks);
  const bowlsBatch = d.batch(dining, 'canteen-dining-bowls', new THREE.CylinderGeometry(0.09, 0.055, 0.07, 14),
    d.matte(0xeceee9, 0.42), TABLES.map(({ x, z }) => ({ p: [x - 0.78, 0.86, z - 0.08], s: [1, 1, 1] })));
  const bottlesBatch = d.batch(dining, 'canteen-drink-bottles', new THREE.CylinderGeometry(0.032, 0.036, 0.19, 10),
    d.matte(0xffffff, 0.32, 0.08), bottles);
  const tablePhoneMat = d.matte(0xc8e4f4, 0.32);
  tablePhoneMat.emissive.setHex(0x98cbe6);
  tablePhoneMat.emissiveIntensity = 0.28;
  const phonesBatch = d.boxes(dining, 'canteen-table-phones', tablePhoneMat, tablePhones);
  const tissueBatch = d.boxes(dining, 'canteen-tissue-boxes', d.matte(0xebeef0, 0.72), TABLES.map(({ x, z }) => ({
    p: [x + 0.74, 0.85, z], s: [0.22, 0.085, 0.15],
  })));
  // 成品桌面半宽 1.01m：调料罐从 1.02 内收到 0.92，换桌前后都稳稳落在板面里而不是压在边沿上
  const jarsBatch = d.batch(dining, 'canteen-condiment-jars', new THREE.CylinderGeometry(0.035, 0.028, 0.1, 8),
    d.matte(0x887f72, 0.52), TABLES.map(({ x, z }) => ({ p: [x + 0.92, 0.855, z], s: [1, 1, 1] })));
  occluders.push(dining);
  mountPropTables({
    dining,
    tops: topsBatch,
    legs: legsBatch,
    seats: seatsBatch,
    tabletopProps: [traysBatch, chopsticksBatch, bowlsBatch, bottlesBatch, phonesBatch, tissueBatch, jarsBatch],
  });

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
  coolGlow.emissiveIntensity = 0.85;
  // C-40 复核兜底：手册原文允许"再加一盏食物保温灯的发光面，只加 emissive 面片不加灯"。
  // 保温灯本就悬在餐盘上方，琥珀色是物理正确的；它补的是第一视角里食物带的暖色占比。
  const warmGlow = d.matte(0xffdcb0, 0.4);
  warmGlow.emissive.setHex(0xffb257);
  warmGlow.emissiveIntensity = 1.05;
  const focusGlow = d.matte(0xffe9be, 0.34);
  focusGlow.emissive.setHex(0xffd286);
  focusGlow.emissiveIntensity = 1.0;

  const counterBodies: Part[] = [];
  const counterTops: Part[] = [];
  const serviceRecesses: Part[] = [];
  const passShelves: Part[] = [];
  const warmerCanopies: Part[] = [];
  const warmerLights: Part[] = [];
  const pans: Part[] = [];
  const food: Part[] = [];
  const mounds: Part[] = [];
  const bands: Part[] = [];
  const rails: Part[] = [];
  const slats: Part[] = [];
  const trayStacks: Part[] = [];
  const garnishColors = [0x9bb37e, 0xd8b27c, 0xf2e9d4, 0xc48b65, 0xb86649, 0x84ae6b, 0xe6d2a4, 0x90b5c0];

  for (const [index, x] of WINDOWS.entries()) {
    const isWindowThree = index === 2;
    // C-40：售饭线柜体取木纹贴面而非青灰——现实食堂柜面本就是木色，也让"售饭区暖、就餐区冷"
    // 落在材质上而不是只落在灯光上。两档木色的明度与原青灰持平，中带明度不因此抬升。
    counterBodies.push({ p: [x, 0.48, -8.6], s: [4.3, 0.96, 1.7], color: isWindowThree ? 0xa8845f : 0x8d7b62 });
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
    // C-32：竖帖从 9 根 0.41 间距改成 8 根 0.55，密度降下来才让得下后面的横带
    for (let k = 0; k < 8; k += 1) slats.push({ p: [x - 1.925 + k * 0.55, 0.51, -7.735], s: [0.022, 0.72, 0.016] });
    for (let k = 0; k < 4; k += 1) {
      pans.push({ p: [x - 1.27 + k * 0.7, 1.075, -8.43], s: [0.6, 0.06, 0.49] });
      // C-32：菜盆从"平面色片"改成三堆扁球，近景才数得出分量
      for (let mound = 0; mound < 3; mound += 1) {
        mounds.push({
          p: [x - 1.42 + k * 0.7 + mound * 0.3, 1.135, -8.43 + (mound % 2 ? 0.05 : -0.04)],
          s: [0.15, 0.075, 0.17], color: [0x86a065, 0xcfa264, 0xeae0c2, 0xb57551][(k + mound) % 4],
        });
      }
      for (let piece = 0; piece < 7; piece += 1) food.push({
        p: [x - 1.43 + k * 0.7 + (piece % 3) * 0.14, 1.135, -8.54 + Math.floor(piece / 3) * 0.15],
        s: [0.1, 0.028, 0.1], color: garnishColors[(k * 2 + piece) % garnishColors.length],
      });
    }
    for (let k = 0; k < 6; k += 1) trayStacks.push({
      p: [x + 1.62, 1.07 + k * 0.026, -8.02], s: [0.36, 0.018, 0.27],
    });
    // C-32：台身正面拆成五条横带——台面亮边 / 上裙板 / 中部横档 / 台身 / 踢脚阴影。
    // 近景从一整块灰板变成能数出层次的台口，且不多加 draw call（全部并一个批次）。
    bands.push(
      { p: [x, 1.03, -7.745], s: [4.26, 0.06, 0.02], color: 0xc9d4d6 },
      { p: [x, 0.93, -7.745], s: [4.26, 0.14, 0.02], color: 0x84979a },
      { p: [x, 0.47, -7.745], s: [4.26, 0.06, 0.02], color: 0xa8b4b6 },
      { p: [x, 0.06, -7.745], s: [4.26, 0.12, 0.02], color: 0x394447 },
    );
    rails.push({ p: [x, 0.98, -7.7], s: [4.2, 0.035, 0.05] });
  }
  d.boxes(counter, 'canteen-counters', d.matte(0xffffff, 0.76), counterBodies);
  d.boxes(counter, 'canteen-counter-tops', steel, counterTops);
  d.boxes(counter, 'canteen-service-recesses', dark, serviceRecesses);
  d.boxes(counter, 'canteen-pass-shelves', steel, passShelves);
  d.boxes(counter, 'canteen-warmer-canopies', steel, warmerCanopies);
  d.boxes(counter, 'canteen-warmer-lights', warmGlow, warmerLights);
  d.boxes(counter, 'canteen-counter-trim-posts', dark, slats);
  d.boxes(counter, 'canteen-hot-food-pans', steel, pans);
  d.boxes(counter, 'canteen-hot-food', d.matte(0xffffff), food);
  d.boxes(counter, 'canteen-tray-stacks', steel, trayStacks);
  // C-32：菜从平面色片改成三堆扁球；台身正面五条横带；台口一道托盘轨。各并一个批次。
  d.batch(counter, 'canteen-hot-food-mounds', new THREE.SphereGeometry(1, 8, 4),
    d.matte(0xffffff, 0.82), mounds);
  d.boxes(counter, 'canteen-counter-bands', d.matte(0xffffff, 0.72), bands);
  d.boxes(counter, 'canteen-tray-rails', steel, rails);

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
  // 玻璃防溅隔断柜 + 不锈钢竖向立柱 + 排队护栏 + 刷卡机 + 筷勺桶
  const sneezeGuard = new THREE.MeshStandardMaterial({ color: 0xd4e2e8, roughness: 0.14,
    metalness: 0.12, transparent: true, opacity: 0.22, depthWrite: false });
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
  const readerLedMat = d.matte(0x74d4a2, 0.3);
  readerLedMat.emissive.setHex(0x63d69b);
  readerLedMat.emissiveIntensity = 1.1;
  d.boxes(counter, 'canteen-card-reader-leds', readerLedMat, WINDOWS.map((x) => ({
    p: [x + 1.85, 1.13, -8.225], s: [0.08, 0.04, 0.012],
  })));
  const utensilGeo = new THREE.CylinderGeometry(0.075, 0.06, 0.22, 10);
  d.batch(counter, 'canteen-utensil-buckets', utensilGeo, d.matte(0xb5bec2, 0.38, 0.35), WINDOWS.map((x) => ({
    p: [x - 1.85, 1.11, -8.28], s: [1, 1, 1],
  })));
  // C-33：三号窗口台沿加一条暖压边，把"这一格是热的"从灯箱一路带到台口。
  // 并入已有的 accent 批次，不多花 draw call，也不新增贴图。
  d.boxes(counter, 'canteen-window-three-accent', focusGlow, [
    { p: [WINDOWS[2], 3.26, -8.78], s: [4.04, 0.045, 0.24] },
    { p: [WINDOWS[2], 2.58, -8.78], s: [4.04, 0.045, 0.24] },
    { p: [WINDOWS[2], 1.075, -7.76], s: [3.86, 0.03, 0.05] },
  ]);

  // C-33 / C-40：地面暖光斑与台身暖洗走正常混合（1 个 draw call），两片斜光幕并进 C-39 的冷光
  // 网格（仍然 1 个），外加台口六张蒸汽卡——全部零贴图、零新增光源。
  counter.add(createWindowThreeFloorLight());
  counter.add(createSteamBatch());

  // C-36：竖屏 390 宽时灯箱被横向裁掉，补一块从天花梁悬挑下来的实体牌号。
  // 这是 3D 场景里的一块 Mesh，不碰任何 HTML/CSS，也不改手机界面布局。
  const hangSign = createTextSign('三号窗口', 1.3, 0.62,
    { background: '#fae3b4', foreground: '#38463e' });
  hangSign.name = 'canteen-window-three-hanging-sign';
  hangSign.position.set(WINDOWS[2], 2.5, -7.9);
  hangSign.castShadow = false;
  const hangMaterial = hangSign.material as THREE.MeshStandardMaterial;
  hangMaterial.emissive.setHex(0xffd78c);
  hangMaterial.emissiveMap = hangMaterial.map;
  hangMaterial.emissiveIntensity = 0.46;
  hangMaterial.roughness = 0.8;
  counter.add(hangSign);
  d.boxes(counter, 'canteen-hang-sign-rods', d.matte(0x59656a, 0.5, 0.4), [-0.6, 0.6].map((dx) => ({
    p: [WINDOWS[2] + dx, 3.575, -7.9], s: [0.025, 1.53, 0.025],
  })));
  occluders.push(counter);
}

/**
 * C-37：八件食堂小道具，全部并进三个批次（+3 个 draw call、约 +0.9k 面）。
 * 成簇贴右墙与入口角，不占出生点→三号窗口的中轴；也不写进 nav.obstacles——
 * navigation() 的碰撞框由 TABLES / STUDENTS 生成，任务书明令不要手改。
 */
function props(parent: THREE.Object3D, d: Details): void {
  const frames: Part[] = [];
  const surfaces: Part[] = [];
  const rounds: Part[] = [];
  const steel = d.matte(0xa7b3b6, 0.4, 0.52);
  const darkSteel = d.matte(0x6c787d, 0.5, 0.4);

  // 1 托盘回收架改由成品道具挂载（见 mountKitProps），程序化批次在此移除

  // 2 回收站推车（右墙 z=0.8）：车斗 + 推手 + 两只轮
  frames.push({ p: [8.42, 0.62, 0.8], s: [0.5, 0.5, 1.1] });
  for (const dz of [-0.52, 0.52]) frames.push({ p: [8.62, 0.92, 0.8 + dz], s: [0.04, 0.6, 0.04] });
  frames.push({ p: [8.62, 1.2, 0.8], s: [0.04, 0.04, 1.1] });
  for (const dz of [-0.4, 0.4]) rounds.push({ p: [8.42, 0.12, 0.8 + dz], s: [0.12, 0.05, 0.12], r: [0, 0, Math.PI / 2] });
  surfaces.push({ p: [8.42, 0.88, 0.8], s: [0.46, 0.02, 1.04], color: 0x8b979b });

  // 3 调料架（右墙 z=4.6）：两层搁板 + 六只罐
  for (const dz of [-0.34, 0.34]) frames.push({ p: [8.46, 0.42, 4.6 + dz], s: [0.04, 0.84, 0.04] });
  for (const y of [0.5, 0.86]) surfaces.push({ p: [8.4, y, 4.6], s: [0.3, 0.025, 0.76], color: 0xc3ccd0 });
  for (const y of [0.57, 0.93]) for (let k = 0; k < 3; k += 1) {
    rounds.push({ p: [8.4, y, 4.34 + k * 0.26], s: [0.05, 0.11, 0.05] });
  }

  // 4 拖把桶 + 拖把（右墙 z=-6.3）
  rounds.push({ p: [8.36, 0.24, -6.3], s: [0.24, 0.48, 0.24] });
  frames.push({ p: [8.36, 0.5, -6.3], s: [0.5, 0.03, 0.5] });
  frames.push({ p: [8.2, 0.86, -6.02], s: [0.03, 0.9, 0.03], r: [0.42, 0, 0.3] });
  rounds.push({ p: [8.02, 0.1, -5.72], s: [0.12, 0.2, 0.12], r: [0.5, 0, 0] });

  // 5 小心地滑牌（入口右侧 x=5.6 z=8.4）：A 字两片 + 顶脊
  surfaces.push({ p: [5.6, 0.42, 8.4], s: [0.52, 0.78, 0.02], color: 0xd8b23c, r: [0, 0.42, 0] });
  surfaces.push({ p: [5.6, 0.42, 8.4], s: [0.52, 0.78, 0.02], color: 0xc9a531, r: [0, -0.42, 0] });
  frames.push({ p: [5.6, 0.82, 8.4], s: [0.54, 0.04, 0.06] });

  // 6 菜单立牌（左墙入口角 x=-8.3 z=7.2）：黑板两片 + 脚
  surfaces.push({ p: [-8.3, 0.78, 7.2], s: [0.62, 0.9, 0.025], color: 0x39474b, r: [0, 0.5, 0] });
  surfaces.push({ p: [-8.3, 0.78, 7.2], s: [0.62, 0.9, 0.025], color: 0x33403f, r: [0, -0.5, 0] });
  for (const dz of [-0.24, 0.24]) frames.push({ p: [-8.3, 0.16, 7.2 + dz], s: [0.03, 0.34, 0.03], r: [0, 0, 0.2] });

  // 7 保温盖（二号窗口两只菜盆上）：盖片 + 提钮
  for (const k of [1, 3]) {
    rounds.push({ p: [-2.2 - 1.27 + k * 0.7, 1.16, -8.43], s: [0.27, 0.03, 0.27] });
    frames.push({ p: [-2.2 - 1.27 + k * 0.7, 1.2, -8.43], s: [0.05, 0.05, 0.05] });
  }

  // 8 汤勺（四号窗口筷勺桶里斜插两把）：长柄 + 勺碗
  for (const [dz, tilt] of [[-0.05, 0.3], [0.06, -0.22]] as Array<[number, number]>) {
    frames.push({ p: [4.75 + dz, 1.34, -8.28], s: [0.02, 0.34, 0.02], r: [tilt, 0, dz * 2.4] });
    rounds.push({ p: [4.75 + dz * 3, 1.2, -8.24], s: [0.06, 0.03, 0.06] });
  }

  const cluster = group(parent, 'canteen-props');
  d.boxes(cluster, 'canteen-props-frames', steel, frames);
  d.boxes(cluster, 'canteen-props-surfaces', d.matte(0xffffff, 0.7), surfaces);
  d.batch(cluster, 'canteen-props-rounds', new THREE.CylinderGeometry(1, 1, 1, 10), darkSteel, rounds);
}

/**
 * 傍晚套件挂载：凹槽大柱 / 窗湾 / 托盘回收架 / 售货机 / 端墙挂钟都是单网格单材质成品，
 * 按位表建 InstancedMesh；GLB 到位后才隐藏对应程序化批次，加载失败或已切场景就保留
 * 程序化兜底，场景里永远不会出现空洞。代次号作废切场景后的在途回调。
 */
interface KitPlacement { x: number; z: number; yaw?: number; y?: number }
function mountKitProps(root: THREE.Object3D): void {
  const generation = canteenGeneration;
  const place = (id: PropModelId, name: string, specs: readonly KitPlacement[],
    hide: string[] = [], onFinish?: () => void): void => {
    loadPropModel(id).then((asset) => {
      if (!asset || generation !== canteenGeneration) return;
      const mesh = new THREE.InstancedMesh(asset.geometry, asset.material, specs.length);
      const transform = new THREE.Object3D();
      specs.forEach((spec, index) => {
        transform.position.set(spec.x, spec.y ?? 0, spec.z);
        transform.rotation.set(0, spec.yaw ?? 0, 0);
        transform.scale.set(1, 1, 1);
        transform.updateMatrix();
        mesh.setMatrixAt(index, transform.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.name = name;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      root.add(mesh);
      canteenPropMeshes.push(mesh);
      for (const target of hide) {
        const node = root.getObjectByName(target);
        if (node) node.visible = false;
      }
      onFinish?.();
    });
  };
  place('canteenColumn', 'canteen-column-props', COLUMN_Z.map((z) => ({ x: 8.66, z })),
    ['canteen-columns', 'canteen-column-crash-guards']);
  place('canteenWindowBay', 'canteen-window-bay-props', WINDOW_BAY_Z.map((z) => ({ x: -8.95, z })),
    ['canteen-window-frames', 'canteen-window-sills']);
  place('canteenTrayRack', 'canteen-tray-rack-props', [{ x: 8.5, z: -3.4 }]);
  place('canteenVending', 'canteen-vending-props', [{ x: 8.45, z: -7.2, yaw: -Math.PI / 2 }], [], () => {
    // 售货机屏幕发光背板 + 4 排立体货道隔板与饮品色块，增强远景生活质感并喂 Bloom
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.54, 0.88),
      new THREE.MeshStandardMaterial({ color: 0x101820, emissive: 0x9cd6e8, emissiveIntensity: 1.35, roughness: 0.38 }),
    );
    panel.name = 'canteen-vending-glow';
    panel.position.set(8.08, 1.32, -7.2);
    panel.rotation.y = -Math.PI / 2;
    panel.castShadow = false;
    root.add(panel);

    const shelfGeo = new THREE.BoxGeometry(1, 1, 1);
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.25 });
    const shelfParts: Part[] = [];
    const drinkColors = [0xd97d54, 0x6ea8c7, 0x8db576, 0xe0bd6c, 0xc96f82, 0x7cb8b0];
    for (let row = 0; row < 4; row += 1) {
      const y = 1.0 + row * 0.21;
      shelfParts.push({ p: [8.065, y, -7.2], s: [0.015, 0.018, 0.52], color: 0x2a3342 });
      for (let col = 0; col < 5; col += 1) {
        shelfParts.push({
          p: [8.068, y + 0.07, -7.39 + col * 0.095],
          s: [0.025, 0.11, 0.052],
          color: drinkColors[(row * 5 + col) % drinkColors.length],
        });
      }
    }
    const shelves = new THREE.InstancedMesh(shelfGeo, shelfMat, shelfParts.length);
    shelves.name = 'canteen-vending-shelves';
    const xform = new THREE.Object3D();
    const tint = new THREE.Color();
    shelfParts.forEach((part, idx) => {
      xform.position.set(...part.p);
      xform.scale.set(...part.s);
      xform.rotation.set(0, 0, 0);
      xform.updateMatrix();
      shelves.setMatrixAt(idx, xform.matrix);
      shelves.setColorAt(idx, tint.setHex(part.color ?? 0xffffff));
    });
    shelves.instanceMatrix.needsUpdate = true;
    if (shelves.instanceColor) shelves.instanceColor.needsUpdate = true;
    shelves.castShadow = false;
    shelves.receiveShadow = false;
    const releaseShelves = (): void => {
      shelves.dispose();
      shelfGeo.removeEventListener('dispose', releaseShelves);
    };
    shelfGeo.addEventListener('dispose', releaseShelves);
    root.add(shelves);
  });
  place('canteenClock', 'canteen-clock-props', [{ x: 0, y: 3.44, z: -9.82 }]);
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
  createStudentShadows(root, d);
  furniture(root, d, occluders);
  servingLine(root, d, occluders);
  props(root, d);
  mountKitProps(root);
  // C-39：左侧窗子的三道斜光与光柱里的尘埃。两者都不进 occluders、不进 nav——纯视觉，
  // 且 raycast 已置空，不会干扰三号窗口的视线遮挡判定。
  root.add(createLightSheets());
  root.add(createDustMotes());
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

interface RealStudentRig {
  container: THREE.Group;
  pose: THREE.Group;
  controller: CharacterAnimationController | null;
  clips: readonly string[];
  clipIndex: number;
  switchTimer: number;
  switchSec: number;
  baseYaw: number;
}

interface StudentMotion {
  castIndex: number;
  actor: THREE.Object3D;
  motion: THREE.Object3D;
  head: THREE.Object3D;
  rotation: THREE.Euler;
  headRotation: THREE.Euler;
  scale: THREE.Vector3;
  phase: number;
  stopped: boolean;
  targetYaw: number;
  real?: RealStudentRig;
}
interface CanteenSession {
  generation: number;
  context: SceneRuntimeContext;
  groups: Map<string, StudentMotion[]>;
  steam?: THREE.InstancedMesh;
  dust?: THREE.InstancedMesh;
  fans?: THREE.InstancedMesh;
  foliage?: THREE.Object3D;
  lightSheets?: THREE.Mesh;
  clockHour?: THREE.Object3D;
  clockMinute?: THREE.Object3D;
  clockSecond?: THREE.Object3D;
  time: number;
  unsubscribe?: () => void;
}
let session: CanteenSession | null = null;
const FAN_TRANSFORM = new THREE.Object3D();
const NOOP_RAYCAST = (): void => {};

function isBrowserRuntime(): boolean {
  return typeof window !== 'undefined'
    && typeof document !== 'undefined'
    && typeof document.baseURI === 'string'
    && /^https?:/i.test(document.baseURI);
}

/** 为无原生坐姿剪辑的 41 骨模型摆正坐姿，稳坐于 0.45m 餐椅并微微低头。 */
function applySeatedRigPose(actorRoot: THREE.Object3D, pose: THREE.Group): void {
  const aim = (name: string, tipName: string, dir: THREE.Vector3): void => {
    const bone = actorRoot.getObjectByName(name);
    const tip = actorRoot.getObjectByName(tipName);
    if (!bone || !tip || !bone.parent) return;
    actorRoot.updateWorldMatrix(true, true);
    const current = tip.getWorldPosition(new THREE.Vector3())
      .sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
    const rot = new THREE.Quaternion().setFromUnitVectors(current, dir.normalize())
      .multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
    bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rot));
  };
  for (const side of ['L', 'R']) {
    aim(`${side}_Thigh`, `${side}_Calf`, new THREE.Vector3(0, -0.08, 1).transformDirection(actorRoot.matrixWorld));
    aim(`${side}_Calf`, `${side}_Foot`, new THREE.Vector3(0, -1, 0).transformDirection(actorRoot.matrixWorld));
  }
  const hip = actorRoot.getObjectByName('Hip');
  if (hip) {
    actorRoot.updateWorldMatrix(true, true);
    const localHip = actorRoot.worldToLocal(hip.getWorldPosition(new THREE.Vector3()));
    pose.position.y += 0.62 - localHip.y;
  }
  const head = actorRoot.getObjectByName('Head');
  if (head) head.rotateX(0.14);
}

function disposeRealRig(record: StudentMotion): void {
  const real = record.real;
  if (!real) return;
  real.controller?.dispose();
  const skeletons = new Set<THREE.Skeleton>();
  real.container.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton);
  });
  skeletons.forEach((skeleton) => skeleton.dispose());
  real.container.removeFromParent();
  record.real = undefined;
  for (const child of record.actor.children) {
    child.visible = true;
  }
}

function mountRealCanteenStudent(current: CanteenSession, record: StudentMotion): void {
  const spec = CANTEEN_STUDENT_CAST[record.castIndex];
  if (!spec) return;
  const gen = current.generation;
  void loadCharacterModel(spec.modelId).then(() => {
    if (session !== current || gen !== canteenGeneration || record.real) return;
    const entry = getCharacterModel(spec.modelId);
    const container = new THREE.Group();
    container.name = 'canteen-real-actor';
    const pose = new THREE.Group();
    pose.name = 'canteen-real-pose';
    pose.rotation.y = entry.frontYawRad;
    const model = instantiateCharacterModel(spec.modelId);
    model.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = false;
        node.receiveShadow = true;
        node.raycast = NOOP_RAYCAST;
      }
    });
    pose.add(model);
    container.add(pose);
    // 隐藏程序化火柴人网格，但保留 motion/head 句柄兼容单测与状态同步
    for (const child of record.actor.children) child.visible = false;
    record.actor.add(container);

    const clips = getCharacterAnimations(spec.modelId);
    let controller: CharacterAnimationController | null = null;
    const playable = spec.clips.filter((name) => clips.some((clip) => clip.name === name));
    if (playable.length > 0) {
      controller = createCharacterAnimation(model, clips);
      controller.play(playable[0], { fadeIn: 0.25, timeScale: spec.seated ? 0.72 : 0.85, loop: true });
      controller.update(0.01);
      if (spec.seated && playable[0] === 'sit') {
        pose.position.y -= 0.04;
      }
    } else if (spec.seated) {
      applySeatedRigPose(record.actor, pose);
    }

    record.real = {
      container,
      pose,
      controller,
      clips: playable,
      clipIndex: 0,
      switchTimer: 0,
      switchSec: 6.5 + (record.castIndex % 4) * 1.1,
      baseYaw: 0,
    };
  }).catch(() => {
    // 弱网失败静默保留程序化人物兜底
  });
}

function updateFans(mesh: THREE.InstancedMesh, time: number): void {
  FAN_POSITIONS.forEach(([fx, fz], fanIdx) => {
    const spin = time * (1.35 + (fanIdx % 2) * 0.18) + fanIdx * 0.9;
    const base = fanIdx * 4;
    for (let b = 0; b < 2; b += 1) {
      FAN_TRANSFORM.position.set(fx, 4.0, fz);
      FAN_TRANSFORM.rotation.set(0, spin + b * (Math.PI / 2), 0);
      FAN_TRANSFORM.scale.set(1.35, 0.022, 0.14);
      FAN_TRANSFORM.updateMatrix();
      mesh.setMatrixAt(base + 2 + b, FAN_TRANSFORM.matrix);
    }
  });
  mesh.instanceMatrix.needsUpdate = true;
}

function updateClock(current: CanteenSession): void {
  if (!current.clockHour || !current.clockMinute || !current.clockSecond) return;
  // 傍晚 17:42:15 起实时平滑走动
  const totalSec = 17 * 3600 + 42 * 60 + 15 + current.time;
  const sec = totalSec % 60;
  const min = (totalSec / 60) % 60;
  const hr = (totalSec / 3600) % 12;
  current.clockSecond.rotation.z = -(sec / 60) * Math.PI * 2;
  current.clockMinute.rotation.z = -(min / 60) * Math.PI * 2;
  current.clockHour.rotation.z = -(hr / 12) * Math.PI * 2;
}

function clearRuntime(): void {
  if (!session) return;
  session.unsubscribe?.();
  for (const students of session.groups.values()) for (const record of students) {
    disposeRealRig(record);
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
    const current: CanteenSession = { generation: canteenGeneration, context, groups: new Map(), time: 0 };
    session = current;
    // 蒸汽、尘埃、吊扇、树冠、光束与挂钟指针句柄均从场景树取，不新增 actors 键。
    const crowdRoot = context.actors[CANTEEN_LOCATIONS.whispers[0].id]?.parent;
    const steam = crowdRoot?.getObjectByName('canteen-window-three-steam');
    if (steam instanceof THREE.InstancedMesh) current.steam = steam;
    const dust = crowdRoot?.getObjectByName('canteen-dust-motes');
    if (dust instanceof THREE.InstancedMesh) current.dust = dust;
    const fans = crowdRoot?.getObjectByName('canteen-ceiling-fans');
    if (fans instanceof THREE.InstancedMesh) current.fans = fans;
    const foliage = crowdRoot?.getObjectByName('canteen-tree-foliage');
    if (foliage) current.foliage = foliage;
    const lightSheets = crowdRoot?.getObjectByName('canteen-light-sheets');
    if (lightSheets instanceof THREE.Mesh) current.lightSheets = lightSheets;
    current.clockHour = crowdRoot?.getObjectByName('canteen-clock-hour') ?? undefined;
    current.clockMinute = crowdRoot?.getObjectByName('canteen-clock-minute') ?? undefined;
    current.clockSecond = crowdRoot?.getObjectByName('canteen-clock-second') ?? undefined;
    updateClock(current);

    let castIndex = 0;
    const shouldMountReal = isBrowserRuntime();
    for (const { id } of CANTEEN_LOCATIONS.whispers) {
      const records: StudentMotion[] = [];
      for (const [i, actor] of (context.actors[id]?.children ?? []).entries()) {
        const motion = actor.getObjectByName('canteen-student-motion');
        const head = actor.getObjectByName('canteen-student-head');
        const idx = castIndex;
        castIndex += 1;
        if (!motion || !head) continue;
        const record: StudentMotion = {
          castIndex: idx, actor, motion, head, rotation: motion.rotation.clone(), headRotation: head.rotation.clone(),
          scale: motion.scale.clone(), phase: i * 1.8, stopped: false, targetYaw: head.rotation.y,
        };
        records.push(record);
        if (shouldMountReal) mountRealCanteenStudent(current, record);
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
        if (record.real) {
          // 玩家靠近低语区时：真实 3D 角色停住起哄动作、平滑偏头转向凝视玩家
          const turnAlpha = 1 - Math.exp(-dt * 6);
          record.real.container.rotation.y += (record.targetYaw * 0.62 - record.real.container.rotation.y) * turnAlpha;
          record.real.controller?.update(dt * 0.12);
        }
      } else {
        const wave = Math.sin(session.time * 1.65 + record.phase);
        record.motion.rotation.z = record.rotation.z + wave * 0.012;
        record.motion.scale.y = record.scale.y * (1 + Math.sin(session.time * 2 + record.phase) * 0.004);
        record.head.rotation.y = record.headRotation.y + Math.sin(session.time * 0.9 + record.phase) * 0.07;
        if (record.real) {
          if (record.real.controller) {
            if (record.real.clips.length > 1) {
              record.real.switchTimer += dt;
              if (record.real.switchTimer >= record.real.switchSec) {
                record.real.switchTimer = 0;
                record.real.clipIndex = (record.real.clipIndex + 1) % record.real.clips.length;
                record.real.controller.play(record.real.clips[record.real.clipIndex], {
                  fadeIn: 0.45, timeScale: 0.85, loop: true,
                });
              }
            }
            record.real.controller.update(dt);
          } else {
            record.real.container.rotation.z = wave * 0.009;
          }
        }
      }
    }
    if (session.steam) updateSteam(session.steam, session.time);
    if (session.dust) updateDust(session.dust, session.time);
    if (session.fans) updateFans(session.fans, session.time);
    if (session.foliage) {
      session.foliage.position.z = Math.sin(session.time * 0.72) * 0.045;
      session.foliage.rotation.z = Math.sin(session.time * 0.58) * 0.006;
    }
    if (session.lightSheets && session.lightSheets.material instanceof THREE.MeshBasicMaterial) {
      session.lightSheets.material.opacity = 0.34 + Math.sin(session.time * 0.85) * 0.03;
    }
    updateClock(session);
  },
  exit(): void {
    // 先作废在途回调再释放本代场景的 instanceMatrix：共享几何与材质留给 resources 的道具缓存，
    // 同 key 的 S12→S13 切换只走 enter/clearRuntime，不经过这里，餐桌因此不会被重复挂载。
    canteenGeneration += 1;
    for (const mesh of canteenPropMeshes) mesh.dispose();
    canteenPropMeshes.length = 0;
    clearRuntime();
  },
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
    // 傍晚室内雾：深灰蓝略带紫，拉开食堂纵深，让远处低语人群与窗口更具空间距离感
    fog: { color: 0x363c4e, near: 14, far: 48 },
    build: buildCanteen,
  };
}
