// scenes3d/room.ts —— 程序化暖调卧室（S1 起床 / S2 手机教学 / S3 出门）
// 坐标与站位全部数据化（ROOM_PROPS / SPAWN / PER_SCENE），后续替换正式 .glb 时只改 build 内部实现。

import * as THREE from 'three';
import type { SceneId } from '../data/storySchema';
import type { ObstacleAabb } from '../world/navMath';
import type {
  InteractableConfig,
  HotspotConfig,
  NavigationConfig,
  SceneSpawn,
  WorldSceneDefinition,
} from '../world/worldSceneTypes';
import { addBox, createMatteMaterial } from './shared';
import type { BoxSize, Vec3 } from './shared';
import { SHARED_RESOURCE_FLAG } from '../world/resources';
import {
  getDocumentLabelMaterial,
  getFabricMaterial,
  getPlasterMaterial,
  getWarmLampGlowMaterial,
  getWoodFloorMaterial,
} from './materials';

interface PropSpec {
  id: string;
  center: { x: number; y: number; z: number };
  size: BoxSize;
  color: number;
}

/** 房间道具坐标表（交互锚点直接引用这些位置，保证光点与几何体对齐） */
const ROOM_PROPS: Record<string, PropSpec> = {
  bed: { id: 'bed', center: { x: -2.85, y: 0.225, z: -3.1 }, size: { w: 1.05, h: 0.45, d: 2.2 }, color: 0xa8a3ae },
  pillow: { id: 'pillow', center: { x: -2.85, y: 0.52, z: -4.02 }, size: { w: 0.9, h: 0.14, d: 0.4 }, color: 0xd7d2c8 },
  desk: { id: 'desk', center: { x: 2.7, y: 0.375, z: -2.2 }, size: { w: 1.5, h: 0.75, d: 0.8 }, color: 0x8d8378 },
  chair: { id: 'chair', center: { x: 2.4, y: 0.23, z: -0.9 }, size: { w: 0.5, h: 0.46, d: 0.5 }, color: 0x8d8378 },
  chairBack: { id: 'chairBack', center: { x: 2.42, y: 0.83, z: -0.68 }, size: { w: 0.5, h: 0.74, d: 0.08 }, color: 0x8d8378 },
  suitcase: { id: 'suitcase', center: { x: 0.6, y: 0.275, z: 2.4 }, size: { w: 0.75, h: 0.55, d: 0.35 }, color: 0x7e8696 },
  door: { id: 'door', center: { x: 3.39, y: 1.1, z: 2.7 }, size: { w: 0.12, h: 2.2, d: 1.1 }, color: 0x6d5a48 },
};

const ROOM_WALLS = [
  { center: { x: 0, y: 1.4, z: 3.4 }, size: { w: 7.4, h: 2.8, d: 0.2 } },
  { center: { x: -3.5, y: 1.4, z: -1.5 }, size: { w: 0.2, h: 2.8, d: 9.8 } },
  { center: { x: 3.5, y: 1.4, z: -1.5 }, size: { w: 0.2, h: 2.8, d: 9.8 } },
] as const;

const BACK_WALL_SEGMENTS = [
  { center: { x: -1.3, y: 1.4, z: -6.4 }, size: { w: 4.8, h: 2.8, d: 0.2 } },
  { center: { x: 3.1, y: 1.4, z: -6.4 }, size: { w: 1.2, h: 2.8, d: 0.2 } },
  { center: { x: 1.8, y: 0.65, z: -6.4 }, size: { w: 1.4, h: 1.3, d: 0.2 } },
  { center: { x: 1.8, y: 2.65, z: -6.4 }, size: { w: 1.4, h: 0.3, d: 0.2 } },
] as const;

/** 窗（真实墙洞开口）：窗框 + 分隔窗扇 + 微反光玻璃 + 褶皱窗帘 */
const WINDOW = { center: { x: 1.8, y: 1.9, z: -6.32 }, size: { w: 1.4, h: 1.2, d: 0.06 } } as const;

/** S1/S2/S3 共用出生点（同 sceneKey 切换时不重置站位） */
const SPAWN: SceneSpawn = { x: -1.6, z: 0.2, yaw: 0.35, pitchDeg: -8 };

/** 房间障碍物：床、书桌、椅、行李箱 */
const OBSTACLES: ObstacleAabb[] = [
  { id: 'room-bed', minX: -3.38, maxX: -2.32, minZ: -4.2, maxZ: -2.0, height: 0.45 },
  { id: 'room-desk', minX: 1.95, maxX: 3.45, minZ: -2.6, maxZ: -1.8, height: 0.75 },
  { id: 'room-chair', minX: 2.15, maxX: 2.65, minZ: -1.15, maxZ: -0.65, height: 0.46 },
  { id: 'room-suitcase', minX: 0.23, maxX: 0.98, minZ: 2.22, maxZ: 2.57, height: 0.55 },
  { id: 'room-wastebasket', minX: -3.28, maxX: -2.88, minZ: -1.94, maxZ: -1.56, height: 0.34 },
];

const NAV: NavigationConfig = {
  groundY: 0,
  bounds: { minX: -3.3, maxX: 3.3, minZ: -6.2, maxZ: 3.2 },
  obstacles: OBSTACLES,
};

const TRIM_COLOR = 0x59412e;
const WOOD_COLOR = 0x8f7f6d;
const BOOK_COLORS = { brick: 0xa44735, forest: 0x365b44, yellow: 0xd7a841, lake: 0x397c89 } as const;

interface BoxPart { center: Vec3; size: BoxSize; rotationX?: number }

/** 现有清理入口释放几何时，同步释放实例矩阵/颜色缓冲；不需要修改 world。 */
function releaseInstancesWithGeometry(mesh: THREE.InstancedMesh): void {
  const release = () => {
    mesh.dispose();
    mesh.geometry.removeEventListener('dispose', release);
  };
  mesh.geometry.addEventListener('dispose', release);
}

/** 仅在一次 build 内复用单位盒几何与调色板；不打全局共享标记，随房间网格清理。 */
function createRoomDetails() {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const palette = new Map<string, THREE.MeshStandardMaterial>();
  const matte = (color: number, roughness = 0.92): THREE.MeshStandardMaterial => {
    const key = `${color}:${roughness}`;
    let material = palette.get(key);
    if (!material) { material = createMatteMaterial(color, roughness); palette.set(key, material); }
    return material;
  };
  const box = (parent: THREE.Object3D, name: string, center: Vec3, size: BoxSize,
    material: THREE.Material, castShadow = false): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(center.x, center.y, center.z);
    mesh.scale.set(size.w, size.h, size.d);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const batch = (parent: THREE.Object3D, name: string, parts: BoxPart[], material: THREE.Material): THREE.InstancedMesh => {
    const mesh = new THREE.InstancedMesh(geometry, material, parts.length);
    releaseInstancesWithGeometry(mesh);
    mesh.name = name;
    mesh.receiveShadow = true;
    const transform = new THREE.Object3D();
    parts.forEach((part, index) => {
      transform.position.set(part.center.x, part.center.y, part.center.z);
      transform.scale.set(part.size.w, part.size.h, part.size.d);
      transform.rotation.set(part.rotationX ?? 0, 0, 0);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    parent.add(mesh);
    return mesh;
  };
  return { box, batch, matte };
}
type RoomDetails = ReturnType<typeof createRoomDetails>;

/** 克隆只拥有染色材质；共享贴图仍由 materials 缓存管理，绝不修改其他场景墙色。 */
function tintForRoom(source: THREE.MeshStandardMaterial, color: number): THREE.MeshStandardMaterial {
  const material = source.clone();
  delete material.userData[SHARED_RESOURCE_FLAG];
  material.color.setHex(color);
  return material;
}

function addTexturedBox(
  parent: THREE.Object3D,
  center: Vec3,
  size: BoxSize,
  material: THREE.Material,
  castShadow = true,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.w, size.h, size.d), material);
  mesh.position.set(center.x, center.y, center.z);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

type LightQuad = [Vec3, Vec3, Vec3, Vec3];

/** 多块柔边光斑合成一个网格：百叶光纹只占墙 / 地板两个绘制批次。 */
function createSoftLightBatch(quads: LightQuad[], opacity: number): THREE.Mesh {
  const columns = 4;
  const rows = 8;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (const [nearLeft, nearRight, farLeft, farRight] of quads) {
    const offset = positions.length / 3;
    for (let row = 0; row <= rows; row += 1) {
      const v = row / rows;
      for (let column = 0; column <= columns; column += 1) {
        const u = column / columns;
        const nearX = nearLeft.x + (nearRight.x - nearLeft.x) * u;
        const nearY = nearLeft.y + (nearRight.y - nearLeft.y) * u;
        const nearZ = nearLeft.z + (nearRight.z - nearLeft.z) * u;
        const farX = farLeft.x + (farRight.x - farLeft.x) * u;
        const farY = farLeft.y + (farRight.y - farLeft.y) * u;
        const farZ = farLeft.z + (farRight.z - farLeft.z) * u;
        positions.push(
          nearX + (farX - nearX) * v,
          nearY + (farY - nearY) * v,
          nearZ + (farZ - nearZ) * v,
        );
        const alpha = Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * 0.72;
        colors.push(1, 1, 1, alpha);
      }
    }
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const a = offset + row * (columns + 1) + column;
        const b = a + 1;
        const c = a + columns + 1;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshBasicMaterial({
    color: 0xffdca8,
    vertexColors: true,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.raycast = () => {};
  return mesh;
}

function buildShell(parent: THREE.Object3D, occluders: THREE.Object3D[], details: RoomDetails): void {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 9.4),
    getWoodFloorMaterial({ repeatX: 2, repeatY: 12 }),
  );
  floor.name = 'room-oak-floor';
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -1.5);
  floor.receiveShadow = true;
  parent.add(floor);

  const plaster = getPlasterMaterial({ repeatX: 3, repeatY: 1 });
  const creamWall = tintForRoom(plaster, 0xf1ece1);
  const terracottaWall = tintForRoom(plaster, 0xc46d45);
  ROOM_WALLS.forEach((wall, index) => {
    const mesh = details.box(parent, `room-cream-wall-${index}`, wall.center, wall.size, creamWall);
    occluders.push(mesh);
  });
  BACK_WALL_SEGMENTS.forEach((wall, index) => {
    const mesh = details.box(parent, `room-terracotta-wall-${index}`, wall.center, wall.size, terracottaWall);
    occluders.push(mesh);
  });
  addTexturedBox(
    parent,
    { x: 0, y: 2.86, z: -1.5 },
    { w: 7.4, h: 0.12, d: 9.8 },
    getPlasterMaterial({ repeatX: 3, repeatY: 4 }),
    false,
  );

  for (const z of [-6.27, 3.27]) {
    details.box(parent, `room-dark-skirting-z-${z}`, { x: 0, y: 0.075, z },
      { w: 6.75, h: 0.15, d: 0.045 }, details.matte(TRIM_COLOR));
    addBox(parent, { x: 0, y: 2.71, z }, { w: 6.75, h: 0.09, d: 0.055 }, TRIM_COLOR, {
      castShadow: false,
    });
  }
  for (const x of [-3.37, 3.37]) {
    details.box(parent, `room-dark-skirting-x-${x}`, { x, y: 0.075, z: -1.5 },
      { w: 0.045, h: 0.15, d: 9.45 }, details.matte(TRIM_COLOR));
    addBox(parent, { x, y: 2.71, z: -1.5 }, { w: 0.055, h: 0.09, d: 9.45 }, TRIM_COLOR, {
      castShadow: false,
    });
    for (const z of [-6.25, 3.25]) {
      addBox(parent, { x, y: 1.4, z }, { w: 0.055, h: 2.8, d: 0.055 }, TRIM_COLOR, {
        castShadow: false,
      });
    }
  }
}

function buildWindow(parent: THREE.Object3D, details: RoomDetails): void {
  const frameColor = 0xd8d2c7;
  for (const x of [1.06, 2.54]) {
    addBox(parent, { x, y: 1.9, z: -6.25 }, { w: 0.065, h: 1.34, d: 0.09 }, frameColor);
  }
  for (const y of [1.24, 2.56]) {
    addBox(parent, { x: 1.8, y, z: -6.25 }, { w: 1.54, h: 0.065, d: 0.09 }, frameColor);
  }
  addBox(parent, { x: 1.8, y: 1.9, z: -6.23 }, { w: 0.038, h: 1.2, d: 0.055 }, frameColor);
  addBox(parent, { x: 1.8, y: 1.9, z: -6.23 }, { w: 1.4, h: 0.038, d: 0.055 }, frameColor);
  addBox(parent, { x: 1.8, y: 1.21, z: -6.18 }, { w: 1.68, h: 0.06, d: 0.24 }, frameColor);

  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(1.36, 1.16),
    new THREE.MeshStandardMaterial({
      color: 0xc7dbe2,
      roughness: 0.12,
      metalness: 0.32,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  glass.position.set(WINDOW.center.x, WINDOW.center.y, -6.34);
  glass.castShadow = false;
  parent.add(glass);

  const curtainMaterial = createMatteMaterial(0xc6bcac, 0.96);
  curtainMaterial.side = THREE.DoubleSide;
  for (const side of [-1, 1]) {
    const geometry = new THREE.PlaneGeometry(0.42, 1.58, 12, 12);
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const y = position.getY(index);
      position.setZ(index, Math.sin((x / 0.42 + 0.5) * Math.PI * 8) * 0.045 + Math.sin(y * 5) * 0.008);
    }
    geometry.computeVertexNormals();
    const curtain = new THREE.Mesh(geometry, curtainMaterial);
    curtain.position.set(WINDOW.center.x + side * 0.8, 1.91, -6.12);
    curtain.castShadow = false;
    curtain.receiveShadow = true;
    parent.add(curtain);
  }

  const curtainRod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 2.05, 8),
    new THREE.MeshStandardMaterial({ color: 0x7c7470, roughness: 0.7, metalness: 0.15 }),
  );
  curtainRod.rotation.z = Math.PI / 2;
  curtainRod.position.set(WINDOW.center.x, 2.73, -6.05);
  parent.add(curtainRod);
  for (const side of [-1, 1]) {
    const finial = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 8, 6),
      curtainRod.material,
    );
    finial.position.set(WINDOW.center.x + side * 1.04, 2.73, -6.05);
    parent.add(finial);
  }

  const exteriorGround = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 18),
    createMatteMaterial(0x969e98, 0.98),
  );
  exteriorGround.rotation.x = -Math.PI / 2;
  exteriorGround.position.set(0, -0.05, -14);
  exteriorGround.receiveShadow = true;
  parent.add(exteriorGround);
  addBox(parent, { x: 1.4, y: 2.6, z: -15 }, { w: 6.5, h: 5.2, d: 2 }, 0x9da8ac, {
    castShadow: false,
  });
  for (const x of [-0.7, 0.7, 2.1, 3.5]) {
    for (const y of [1.4, 2.7, 4]) {
      addBox(parent, { x, y, z: -13.98 }, { w: 0.55, h: 0.7, d: 0.025 }, 0x71838e, {
        castShadow: false,
      });
    }
  }

  // 窗外街道远处：1~2 个拖行李箱向校门方向行走的程序化极简剪影（零 GLB、不参与碰撞/注视）。
  const silhouetteMaterial = createMatteMaterial(0x39404a, 0.98);
  const addSilhouette = (x: number, z: number, flip: number): void => {
    const figure = new THREE.Group();
    figure.position.set(x, -0.05, z);
    figure.rotation.y = flip > 0 ? 0.16 : -0.16;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.78, 0.14), silhouetteMaterial);
    body.position.y = 0.62;
    body.rotation.x = 0.1;
    body.castShadow = false;
    figure.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.14, 0.13), silhouetteMaterial);
    head.position.set(0.01, 1.08, 0);
    head.castShadow = false;
    figure.add(head);
    for (const dx of [-0.07, 0.07]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.08), silhouetteMaterial);
      leg.position.set(dx, 0.28, dx > 0 ? 0.06 : -0.02);
      leg.castShadow = false;
      figure.add(leg);
    }
    const caseMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.28, 0.12), silhouetteMaterial);
    caseMesh.position.set(flip * 0.3, 0.16, -0.28);
    caseMesh.castShadow = false;
    figure.add(caseMesh);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.3), silhouetteMaterial);
    arm.position.set(flip * 0.14, 0.52, -0.15);
    arm.rotation.x = 0.5;
    arm.castShadow = false;
    figure.add(arm);
    parent.add(figure);
  };
  addSilhouette(1.7, -12.6, 1);
  addSilhouette(2.1, -13.2, -1);

  const blinds = new THREE.Group();
  blinds.name = 'room-venetian-blinds';
  parent.add(blinds);
  const blindWood = details.matte(0xb88750, 0.74);
  details.box(blinds, 'room-blind-headbox', { x: 1.8, y: 2.48, z: -6.16 },
    { w: 1.34, h: 0.075, d: 0.095 }, blindWood);
  details.batch(blinds, 'room-blind-slats', Array.from({ length: 11 }, (_, index) => ({
    center: { x: 1.8, y: 2.38 - index * 0.096, z: -6.15 },
    size: { w: 1.31, h: 0.018, d: 0.075 }, rotationX: -0.2,
  })), blindWood);
  details.batch(blinds, 'room-blind-ladder-cords', [1.32, 2.28].map((x) => ({
    center: { x, y: 1.89, z: -6.10 }, size: { w: 0.006, h: 1.1, d: 0.006 },
  })), details.matte(0xe3d3b8));
  details.box(blinds, 'room-blind-pull-cord', { x: 2.43, y: 1.73, z: -6.08 },
    { w: 0.005, h: 1.44, d: 0.005 }, details.matte(0xe3d3b8));
  details.box(blinds, 'room-blind-pull-toggle', { x: 2.43, y: 1.0, z: -6.08 },
    { w: 0.02, h: 0.045, d: 0.02 }, blindWood);

  const floorStripes: LightQuad[] = [];
  const wallStripes: LightQuad[] = [];
  for (let index = 0; index < 11; index += 1) {
    const z = index * 0.12;
    floorStripes.push([
      { x: 1.12, y: 0.014, z: -5.95 + z }, { x: 1.12, y: 0.014, z: -5.90 + z },
      { x: 3.3, y: 0.014, z: -4.30 + z }, { x: 3.3, y: 0.014, z: -4.25 + z },
    ]);
    const y = index * 0.085;
    wallStripes.push([
      { x: 3.393, y: 2.02 - y, z: -5.78 }, { x: 3.393, y: 1.975 - y, z: -5.78 },
      { x: 3.393, y: 1.22 - y, z: -4.58 }, { x: 3.393, y: 1.175 - y, z: -4.58 },
    ]);
  }
  for (const [name, quads, opacity] of [
    ['room-sun-stripes-floor', floorStripes, 0.68],
    ['room-sun-stripes-wall', wallStripes, 0.55],
  ] as const) {
    const stripes = createSoftLightBatch(quads, opacity);
    stripes.name = name;
    parent.add(stripes);
  }

  const dustPositions: number[] = [];
  for (let index = 0; index < 26; index += 1) {
    const t = index / 25;
    dustPositions.push(
      0.25 + ((index * 37) % 100) / 55,
      0.3 + ((index * 53) % 100) / 60,
      -5.8 + t * 3.5,
    );
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.Float32BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(
    dustGeometry,
    new THREE.PointsMaterial({
      color: 0xffe4b8,
      size: 0.012,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    }),
  );
  dust.name = 'room-window-light-dust';
  dust.raycast = () => {};
  parent.add(dust);
}

function createPillow(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(0.5, 16, 10);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index) / 0.5;
    const y = position.getY(index);
    const z = position.getZ(index) / 0.5;
    if (y > 0) {
      const dent = Math.exp(-(x * x + z * z) * 4) * 0.08 * (y / 0.5);
      position.setY(index, y - dent);
    }
  }
  geometry.computeVertexNormals();
  const pillow = new THREE.Mesh(geometry, createMatteMaterial(ROOM_PROPS.pillow.color, 0.98));
  pillow.scale.set(0.9, 0.14, 0.42);
  pillow.position.set(-2.85, 0.52, -4.02);
  pillow.castShadow = true;
  pillow.receiveShadow = true;
  return pillow;
}

function createPhone(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'room-bedside-phone';
  const halfW = 0.052;
  const halfH = 0.092;
  const radius = 0.013;
  const shape = new THREE.Shape();
  shape.moveTo(-halfW + radius, -halfH);
  shape.lineTo(halfW - radius, -halfH);
  shape.quadraticCurveTo(halfW, -halfH, halfW, -halfH + radius);
  shape.lineTo(halfW, halfH - radius);
  shape.quadraticCurveTo(halfW, halfH, halfW - radius, halfH);
  shape.lineTo(-halfW + radius, halfH);
  shape.quadraticCurveTo(-halfW, halfH, -halfW, halfH - radius);
  shape.lineTo(-halfW, -halfH + radius);
  shape.quadraticCurveTo(-halfW, -halfH, -halfW + radius, -halfH);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.012,
    bevelEnabled: true,
    bevelSegments: 1,
    steps: 1,
    bevelSize: 0.002,
    bevelThickness: 0.002,
    curveSegments: 3,
  });
  geometry.center();
  geometry.rotateX(-Math.PI / 2);
  const body = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0x20252a, roughness: 0.34, metalness: 0.42 }),
  );
  body.position.set(-2.85, 0.601, -4.02);
  body.castShadow = true;
  group.add(body);

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.087, 0.153),
    new THREE.MeshStandardMaterial({
      color: 0x8da7ae,
      emissive: 0x72919a,
      emissiveIntensity: 0.38,
      roughness: 0.16,
      metalness: 0.08,
    }),
  );
  screen.rotation.x = -Math.PI / 2;
  screen.position.set(-2.85, 0.611, -4.02);
  group.add(screen);
  return group;
}

function buildBed(parent: THREE.Object3D, occluders: THREE.Object3D[]): void {
  const bed = ROOM_PROPS.bed;
  for (const x of [bed.center.x - 0.42, bed.center.x + 0.42]) {
    for (const z of [bed.center.z - 0.91, bed.center.z + 0.91]) {
      addBox(parent, { x, y: 0.12, z }, { w: 0.08, h: 0.24, d: 0.08 }, WOOD_COLOR);
    }
  }
  addBox(parent, { x: -2.85, y: 0.2, z: -3.1 }, { w: 1.05, h: 0.16, d: 2.2 }, WOOD_COLOR);
  occluders.push(
    addBox(parent, { x: -2.85, y: 0.355, z: -3.1 }, { w: 1.02, h: 0.19, d: 2.12 }, 0xd2ccc4),
  );

  const textile = getFabricMaterial({ repeatX: 6, repeatY: 8 });
  const duvetMaterial = tintForRoom(textile, 0xcd705d);
  duvetMaterial.side = THREE.DoubleSide;
  const sheetMaterial = tintForRoom(textile, 0xfffcf5);
  sheetMaterial.side = THREE.DoubleSide;
  const duvetGeometry = new THREE.PlaneGeometry(1.1, 1.64, 12, 16);
  duvetGeometry.rotateX(-Math.PI / 2);
  const duvetPosition = duvetGeometry.getAttribute('position') as THREE.BufferAttribute;
  for (let index = 0; index < duvetPosition.count; index += 1) {
    const x = duvetPosition.getX(index);
    const z = duvetPosition.getZ(index);
    const wrinkles = Math.sin(x * 19 + z * 4) * 0.013 + Math.sin(z * 23 - x * 5) * 0.008;
    const dent = Math.exp(-((x + 0.08) ** 2 * 12 + (z - 0.1) ** 2 * 3)) * 0.026;
    duvetPosition.setY(index, wrinkles - dent);
  }
  duvetGeometry.computeVertexNormals();
  const duvet = new THREE.Mesh(duvetGeometry, duvetMaterial);
  duvet.name = 'room-coral-fabric-duvet';
  duvet.position.set(-2.85, 0.51, -2.94);
  duvet.castShadow = true;
  duvet.receiveShadow = true;
  parent.add(duvet);

  const sideGeometry = new THREE.PlaneGeometry(1.62, 0.3, 14, 4);
  const sidePosition = sideGeometry.getAttribute('position') as THREE.BufferAttribute;
  for (let index = 0; index < sidePosition.count; index += 1) {
    const x = sidePosition.getX(index);
    const y = sidePosition.getY(index);
    sidePosition.setZ(index, Math.sin(x * 18 + y * 4) * 0.006);
  }
  sideGeometry.computeVertexNormals();
  const duvetSide = new THREE.Mesh(sideGeometry, duvetMaterial);
  duvetSide.name = 'room-coral-duvet-drape';
  duvetSide.rotation.y = Math.PI / 2;
  duvetSide.position.set(-2.295, 0.36, -2.94);
  duvetSide.castShadow = true;
  parent.add(duvetSide);

  addBox(parent, { x: -2.85, y: 0.72, z: -4.26 }, { w: 1.1, h: 0.9, d: 0.08 }, WOOD_COLOR, {
    castShadow: false,
  });
  addBox(parent, { x: -2.85, y: 0.77, z: -4.205 }, { w: 0.88, h: 0.54, d: 0.025 }, 0x9a8a76, {
    castShadow: false,
  });
  addBox(parent, { x: -2.85, y: 1.16, z: -4.25 }, { w: 1.18, h: 0.08, d: 0.11 }, 0x84735f);
  for (const x of [-3.37, -2.33]) {
    addBox(parent, { x, y: 0.68, z: -4.25 }, { w: 0.07, h: 1.04, d: 0.1 }, 0x84735f);
  }

  const sheetGeometry = new THREE.PlaneGeometry(1.03, 0.22, 20, 4);
  sheetGeometry.rotateX(-Math.PI / 2);
  const sheetPosition = sheetGeometry.getAttribute('position') as THREE.BufferAttribute;
  for (let index = 0; index < sheetPosition.count; index += 1) {
    sheetPosition.setY(index, Math.sin(sheetPosition.getX(index) * 24) * 0.006);
  }
  sheetGeometry.computeVertexNormals();
  const sheet = new THREE.Mesh(sheetGeometry, sheetMaterial);
  sheet.name = 'room-white-folded-sheet';
  sheet.position.set(-2.85, 0.54, -3.61);
  sheet.receiveShadow = true;
  parent.add(sheet);
  const fold = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 1.03, 10),
    sheetMaterial,
  );
  fold.name = 'room-white-sheet-rolled-edge';
  fold.rotation.z = Math.PI / 2;
  fold.position.set(-2.85, 0.54, -3.69);
  fold.castShadow = true;
  parent.add(fold);
  parent.add(createPillow());
  parent.add(createPhone());
}

function buildCeilingLamp(parent: THREE.Object3D): void {
  const lamp = new THREE.Group();
  lamp.name = 'room-ceiling-lamp';
  lamp.position.set(0, 2.82, -1.6);
  parent.add(lamp);
  const brass = new THREE.MeshStandardMaterial({ color: 0xb89454, roughness: 0.48, metalness: 0.72, side: THREE.DoubleSide });
  const cream = createMatteMaterial(0xeee3ca, 0.82);
  cream.side = THREE.DoubleSide;
  for (const [name, geometry, material, y] of [
    ['room-lamp-canopy', new THREE.CylinderGeometry(0.09, 0.09, 0.04, 16), brass, -0.02],
    ['room-lamp-stem', new THREE.CylinderGeometry(0.009, 0.009, 0.45, 8), brass, -0.255],
    ['room-lamp-cream-shade', new THREE.CylinderGeometry(0.115, 0.25, 0.16, 24, 1, true), cream, -0.56],
    ['room-lamp-brass-shade', new THREE.CylinderGeometry(0.10, 0.215, 0.12, 24, 1, true), brass, -0.57],
  ] as const) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.y = y;
    mesh.receiveShadow = true;
    lamp.add(mesh);
  }
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), new THREE.MeshStandardMaterial({
    color: 0xffefd5, emissive: 0xffd27d, emissiveIntensity: 1.8, roughness: 0.3,
  }));
  bulb.name = 'room-lamp-emissive-bulb';
  bulb.position.y = -0.60;
  lamp.add(bulb);
  const glow = new THREE.Sprite(getWarmLampGlowMaterial());
  glow.name = 'room-lamp-soft-glow';
  glow.position.y = -0.62;
  glow.scale.set(0.48, 0.48, 1);
  glow.raycast = () => {};
  lamp.add(glow);
  const light = new THREE.PointLight(0xffcb82, 1.15, 9, 1.6);
  light.name = 'room-lamp-point-light';
  light.position.y = -0.62;
  light.castShadow = false;
  lamp.add(light);

  // 清晨柔和漫射窗光补光：消除室内偏灰感，保持暖明通透但不改变主吊灯参数
  const morningFill = new THREE.HemisphereLight(0xfff5e4, 0xcab69b, 0.24);
  morningFill.name = 'room-morning-window-fill';
  parent.add(morningFill);
}

/** 三片硬封皮合成一批，白纸内芯是真实实体而非封面上的白色贴片。 */
function buildHardback(parent: THREE.Object3D, details: RoomDetails, name: string,
  color: number, center: Vec3, thickness: number, height: number, stacked = false): THREE.Group {
  const book = new THREE.Group();
  book.name = name;
  book.position.set(center.x, center.y, center.z);
  if (stacked) book.rotation.z = Math.PI / 2;
  const d = 0.18;
  details.batch(book, `${name}-hard-covers`, [
    { center: { x: -thickness / 2, y: 0, z: 0 }, size: { w: 0.008, h: height, d } },
    { center: { x: thickness / 2, y: 0, z: 0 }, size: { w: 0.008, h: height, d } },
    { center: { x: 0, y: 0, z: -d / 2 }, size: { w: thickness, h: height, d: 0.01 } },
  ], details.matte(color));
  details.box(book, `${name}-white-pages`, { x: 0, y: 0, z: 0.004 },
    { w: thickness - 0.008, h: height - 0.018, d: d - 0.016 }, details.matte(0xfffcf3));
  parent.add(book);
  return book;
}

function buildShelves(parent: THREE.Object3D, details: RoomDetails): void {
  const shelves = new THREE.Group();
  shelves.name = 'room-staggered-shelves';
  parent.add(shelves);
  const wood = details.matte(0xa47748, 0.76);
  details.box(shelves, 'room-shelf-lower', { x: -0.9, y: 1.48, z: -6.09 },
    { w: 1.5, h: 0.055, d: 0.28 }, wood);
  details.box(shelves, 'room-shelf-upper', { x: -0.05, y: 1.76, z: -6.09 },
    { w: 1.45, h: 0.055, d: 0.28 }, wood);
  details.batch(shelves, 'room-shelf-wall-brackets', [
    { center: { x: -1.47, y: 1.40, z: -6.16 }, size: { w: 0.025, h: 0.14, d: 0.17 } },
    { center: { x: -0.33, y: 1.40, z: -6.16 }, size: { w: 0.025, h: 0.14, d: 0.17 } },
    { center: { x: -0.60, y: 1.68, z: -6.16 }, size: { w: 0.025, h: 0.14, d: 0.17 } },
    { center: { x: 0.51, y: 1.68, z: -6.16 }, size: { w: 0.025, h: 0.14, d: 0.17 } },
  ], details.matte(TRIM_COLOR));
  Object.entries(BOOK_COLORS).forEach(([key, color], index) => {
    const height = [0.25, 0.29, 0.23, 0.27][index];
    buildHardback(shelves, details, `room-shelf-book-${key}`, color,
      { x: -1.44 + index * 0.13, y: 1.511 + height / 2, z: -6.08 }, 0.074, height);
  });
  buildHardback(shelves, details, 'room-shelf-stacked-book-lake', BOOK_COLORS.lake,
    { x: -0.40, y: 1.824, z: -6.08 }, 0.064, 0.28, true);
  const upperBook = buildHardback(shelves, details, 'room-shelf-stacked-book-yellow', BOOK_COLORS.yellow,
    { x: -0.37, y: 1.89, z: -6.08 }, 0.052, 0.24, true);
  upperBook.rotation.y = 0.08;

  const plant = new THREE.Group();
  plant.name = 'room-shelf-potted-plant';
  plant.position.set(0.40, 1.788, -6.08);
  shelves.add(plant);
  const potMaterial = details.matte(0x424444, 0.92);
  potMaterial.side = THREE.DoubleSide;
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.064, 0.13, 12, 1, true), potMaterial);
  pot.name = 'room-plant-dark-gray-pot';
  pot.position.y = 0.065;
  plant.add(pot);
  details.box(plant, 'room-plant-pot-base', { x: 0, y: 0.008, z: 0 },
    { w: 0.09, h: 0.016, d: 0.09 }, potMaterial);
  const soil = new THREE.Mesh(new THREE.CircleGeometry(0.078, 12), details.matte(0x433529));
  soil.name = 'room-plant-soil';
  soil.rotation.x = -Math.PI / 2;
  soil.position.y = 0.116;
  plant.add(soil);
  details.batch(plant, 'room-plant-stems', [-0.025, 0, 0.026].map((x) => ({
    center: { x, y: 0.205, z: 0 }, size: { w: 0.005, h: 0.19, d: 0.005 },
  })), details.matte(0x516746));
  const leaves = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), details.matte(0x52804d), 9);
  releaseInstancesWithGeometry(leaves);
  leaves.name = 'room-plant-green-leaves';
  const transform = new THREE.Object3D();
  for (let index = 0; index < 9; index += 1) {
    const angle = index * 2.4;
    transform.position.set(Math.sin(angle) * 0.058, 0.19 + index * 0.013, Math.cos(angle) * 0.045);
    transform.scale.set(0.027, 0.065, 0.014);
    transform.rotation.set(0.4, angle, Math.sin(angle) * 0.9);
    transform.updateMatrix();
    leaves.setMatrixAt(index, transform.matrix);
  }
  leaves.instanceMatrix.needsUpdate = true;
  plant.add(leaves);
}

function buildWastebasket(parent: THREE.Object3D, details: RoomDetails, occluders: THREE.Object3D[]): void {
  const basket = new THREE.Group();
  basket.name = 'room-open-trapezoid-wastebasket';
  basket.position.set(-3.08, 0, -1.75);
  parent.add(basket);
  const positions: number[] = [];
  const indices: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    const offset = positions.length / 3;
    positions.push(...a, ...b, ...c, ...d);
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  };
  // 四壁外面、内面与窄顶边合成一体；中央开口没有任何盖面，底宽小于口宽。
  const ring = (x: number, z: number, y: number): number[][] => [
    [-x, y, -z], [-x, y, z], [x, y, z], [x, y, -z],
  ];
  const bottom = ring(0.11, 0.10, 0.02);
  const top = ring(0.18, 0.17, 0.34);
  const innerBottom = ring(0.098, 0.088, 0.02);
  const innerTop = ring(0.168, 0.158, 0.34);
  for (let side = 0; side < 4; side += 1) {
    const next = (side + 1) % 4;
    quad(bottom[side], bottom[next], top[next], top[side]);
    quad(innerBottom[next], innerBottom[side], innerTop[side], innerTop[next]);
    quad(top[side], top[next], innerTop[next], innerTop[side]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const shell = new THREE.Mesh(geometry, details.matte(0xab7b4e, 0.84));
  shell.name = 'room-wastebasket-hollow-shell';
  shell.castShadow = true;
  shell.receiveShadow = true;
  basket.add(shell);
  details.box(basket, 'room-wastebasket-bottom', { x: 0, y: 0.014, z: 0 },
    { w: 0.22, h: 0.018, d: 0.20 }, details.matte(0x805a38));
  occluders.push(basket);

  const paperGeometry = new THREE.IcosahedronGeometry(0.075, 1);
  const vertices = paperGeometry.getAttribute('position') as THREE.BufferAttribute;
  for (let index = 0; index < vertices.count; index += 1) {
    const x = vertices.getX(index), y = vertices.getY(index), z = vertices.getZ(index);
    // 同坐标同形变，保持重复顶点的折面闭合；非球体的白纸褶皱轮廓。
    const crease = 0.82 + 0.16 * Math.sin(x * 170 + y * 91 + z * 123);
    vertices.setXYZ(index, x * crease, y * crease, z * crease);
  }
  paperGeometry.computeVertexNormals();
  paperGeometry.computeBoundingBox();
  const paperMaterial = details.matte(0xfffcf6, 0.98);
  paperMaterial.flatShading = true;
  for (const [index, x, z, yaw] of [[1, -2.71, -1.62, 0.3], [2, -3.04, -1.30, -0.8]]) {
    const paper = new THREE.Mesh(paperGeometry, paperMaterial);
    paper.name = `room-crumpled-paper-${index}`;
    paper.rotation.y = yaw;
    paper.position.set(x, -paperGeometry.boundingBox!.min.y + 0.002, z);
    paper.castShadow = true;
    paper.receiveShadow = true;
    parent.add(paper);
  }
}

function buildDesk(parent: THREE.Object3D, occluders: THREE.Object3D[], details: RoomDetails): void {
  occluders.push(details.box(parent, 'room-desk-top', { x: 2.7, y: 0.715, z: -2.2 },
    { w: 1.5, h: 0.07, d: 0.8 }, details.matte(0xa17b51, 0.76), true));
  details.batch(parent, 'room-desk-legs', [2.03, 3.37].flatMap((x) => [-2.53, -1.87].map((z) => ({
    center: { x, y: 0.35, z }, size: { w: 0.07, h: 0.7, d: 0.07 },
  }))), details.matte(0x766b60));
  occluders.push(details.box(parent, 'room-desk-drawer-cabinet', { x: 3.17, y: 0.43, z: -2.2 },
    { w: 0.40, h: 0.52, d: 0.64 }, details.matte(0x926d46)));
  for (const [index, y] of [0.55, 0.30].entries()) {
    details.box(parent, `room-desk-drawer-front-${index + 1}`, { x: 3.17, y, z: -1.868 },
      { w: 0.38, h: 0.225, d: 0.025 }, details.matte(0xac8254));
    details.box(parent, `room-desk-black-handle-${index + 1}`, { x: 3.17, y, z: -1.845 },
      { w: 0.14, h: 0.02, d: 0.025 }, details.matte(0x242728, 0.78));
  }

  const screenMaterial = new THREE.MeshStandardMaterial({ color: 0x19272d, roughness: 0.28, metalness: 0.18 });
  for (const [index, x] of [2.28, 2.90].entries()) {
    const monitor = new THREE.Group();
    monitor.name = `room-monitor-${index + 1}`;
    parent.add(monitor);
    const frame = details.box(monitor, `room-monitor-${index + 1}-matte-frame`, { x, y: 1.10, z: -2.51 },
      { w: 0.54, h: 0.33, d: 0.04 }, details.matte(0x3e4345, 0.85));
    details.box(monitor, `room-monitor-${index + 1}-dark-screen`, { x, y: 1.102, z: -2.487 },
      { w: 0.493, h: 0.281, d: 0.006 }, screenMaterial);
    details.box(monitor, `room-monitor-${index + 1}-stand`, { x, y: 0.856, z: -2.52 },
      { w: 0.038, h: 0.17, d: 0.035 }, details.matte(0x3e4345, 0.85));
    details.box(monitor, `room-monitor-${index + 1}-foot`, { x, y: 0.759, z: -2.545 },
      { w: 0.21, h: 0.018, d: 0.10 }, details.matte(0x3e4345, 0.85));
    occluders.push(frame);
  }
  details.box(parent, 'room-keyboard-base', { x: 2.65, y: 0.765, z: -2.391 },
    { w: 0.43, h: 0.02, d: 0.105 }, details.matte(0x555957, 0.84));
  details.batch(parent, 'room-keyboard-keys', Array.from({ length: 36 }, (_, index) => ({
    center: { x: 2.466 + (index % 12) * 0.033, y: 0.780, z: -2.422 + Math.floor(index / 12) * 0.029 },
    size: { w: 0.025, h: 0.01, d: 0.022 },
  })), details.matte(0xb9bdb6, 0.84));
  const mouse = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), details.matte(0x414746, 0.7));
  mouse.name = 'room-desk-mouse';
  mouse.scale.set(0.036, 0.024, 0.055);
  mouse.position.set(3.04, 0.774, -2.28);
  parent.add(mouse);
  details.box(parent, 'room-mouse-wheel', { x: 3.04, y: 0.798, z: -2.295 },
    { w: 0.006, h: 0.004, d: 0.015 }, details.matte(0xb3b6af));
  const notebook = buildHardback(parent, details, 'room-red-notebook', BOOK_COLORS.brick,
    { x: 2.15, y: 0.774, z: -2.0 }, 0.035, 0.24, true);
  notebook.rotation.y = 0.04;

  const cupMaterial = details.matte(0xe4d9bf, 0.72);
  cupMaterial.side = THREE.DoubleSide;
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.045, 0.11, 12, 1, true), cupMaterial);
  cup.name = 'room-desk-mug';
  cup.position.set(3.23, 0.805, -1.99);
  cup.castShadow = true;
  parent.add(cup);
  const cupBottom = new THREE.Mesh(new THREE.CircleGeometry(0.045, 12), cupMaterial);
  cupBottom.name = 'room-mug-bottom';
  cupBottom.rotation.x = -Math.PI / 2;
  cupBottom.position.set(3.23, 0.752, -1.99);
  parent.add(cupBottom);
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.046, 12), details.matte(0x4a3b31, 0.5));
  coffee.name = 'room-mug-coffee';
  coffee.rotation.x = -Math.PI / 2;
  coffee.position.set(3.23, 0.854, -1.99);
  parent.add(coffee);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 12), cupMaterial);
  handle.name = 'room-mug-handle';
  handle.position.set(3.288, 0.81, -1.99);
  parent.add(handle);

  const bagMaterial = createMatteMaterial(0xc4b49a, 0.86);
  const documentBag = addBox(
    parent,
    { x: 2.7, y: 0.792, z: -2.2 },
    { w: 0.34, h: 0.06, d: 0.24 },
    0xc4b49a,
  );
  documentBag.name = 'document-bag';
  occluders.push(documentBag);
  const flapShape = new THREE.Shape([
    new THREE.Vector2(-0.17, 0.12),
    new THREE.Vector2(0.17, 0.12),
    new THREE.Vector2(0, -0.035),
  ]);
  const flapGeometry = new THREE.ShapeGeometry(flapShape);
  flapGeometry.rotateX(-Math.PI / 2);
  const flap = new THREE.Mesh(flapGeometry, bagMaterial);
  flap.name = 'document-bag-flap';
  flap.position.set(2.7, 0.824, -2.2);
  parent.add(flap);
  addBox(parent, { x: 2.7, y: 0.823, z: -2.08 }, { w: 0.34, h: 0.012, d: 0.018 }, 0xa89478, {
    castShadow: false,
  });
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.075), getDocumentLabelMaterial());
  label.name = 'document-bag-label';
  label.rotation.x = -Math.PI / 2;
  label.position.set(2.68, 0.827, -2.17);
  parent.add(label);
}

function buildChairAndShirt(parent: THREE.Object3D, occluders: THREE.Object3D[]): void {
  occluders.push(
    addBox(parent, { x: 2.4, y: 0.43, z: -0.9 }, { w: 0.5, h: 0.06, d: 0.5 }, 0x8d8378),
  );
  for (const x of [2.2, 2.6]) {
    for (const z of [-1.1, -0.7]) {
      addBox(parent, { x, y: 0.21, z }, { w: 0.045, h: 0.42, d: 0.045 }, 0x766b60);
    }
  }
  const back = ROOM_PROPS.chairBack;
  occluders.push(addBox(parent, back.center, back.size, back.color));
  addBox(parent, { x: 2.42, y: 1.19, z: -0.68 }, { w: 0.56, h: 0.07, d: 0.1 }, 0x766b60);

  const shirt = new THREE.Group();
  shirt.name = 'culture-shirt';
  shirt.position.set(2.42, 1.06, -0.62);
  const shirtMaterial = createMatteMaterial(0xd9c98f, 0.98);
  shirtMaterial.side = THREE.DoubleSide;
  const bodyGeometry = new THREE.PlaneGeometry(0.38, 0.56, 8, 10);
  const bodyPosition = bodyGeometry.getAttribute('position') as THREE.BufferAttribute;
  for (let index = 0; index < bodyPosition.count; index += 1) {
    const x = bodyPosition.getX(index);
    const y = bodyPosition.getY(index);
    bodyPosition.setZ(index, Math.sin(x * 48 + y * 5) * 0.014 + Math.sin(y * 20) * 0.006);
  }
  bodyGeometry.computeVertexNormals();
  const body = new THREE.Mesh(bodyGeometry, shirtMaterial);
  body.position.y = -0.06;
  shirt.add(body);
  for (const side of [-1, 1]) {
    const sleeveGeometry = new THREE.PlaneGeometry(0.14, 0.2, 4, 4);
    const sleevePosition = sleeveGeometry.getAttribute('position') as THREE.BufferAttribute;
    for (let index = 0; index < sleevePosition.count; index += 1) {
      sleevePosition.setZ(index, Math.sin(sleevePosition.getY(index) * 24) * 0.012);
    }
    sleeveGeometry.computeVertexNormals();
    const sleeve = new THREE.Mesh(sleeveGeometry, shirtMaterial);
    sleeve.position.set(side * 0.215, 0.12, -0.005);
    sleeve.rotation.z = side * -0.48;
    shirt.add(sleeve);
  }
  const collar = new THREE.Mesh(
    new THREE.TorusGeometry(0.06, 0.009, 6, 14, Math.PI),
    createMatteMaterial(0xb9a974, 0.96),
  );
  collar.position.set(0, 0.215, 0.015);
  collar.rotation.z = Math.PI;
  shirt.add(collar);
  shirt.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  parent.add(shirt);
  occluders.push(shirt);
}

function buildSuitcase(parent: THREE.Object3D, occluders: THREE.Object3D[]): void {
  const suitcase = ROOM_PROPS.suitcase;
  occluders.push(
    addBox(parent, { x: 0.6, y: 0.32, z: 2.4 }, { w: 0.75, h: 0.46, d: 0.35 }, suitcase.color),
  );
  addBox(parent, { x: 0.6, y: 0.32, z: 2.215 }, { w: 0.62, h: 0.34, d: 0.025 }, 0x8991a0);
  addBox(parent, { x: 0.6, y: 0.32, z: 2.197 }, { w: 0.025, h: 0.4, d: 0.012 }, 0x626b79, {
    castShadow: false,
  });
  for (const x of [0.29, 0.91]) {
    for (const y of [0.14, 0.49]) {
      for (const z of [2.22, 2.58]) {
        addBox(parent, { x, y, z }, { w: 0.12, h: 0.09, d: 0.055 }, 0x606873);
      }
    }
  }
  const wheelMaterial = createMatteMaterial(0x34393f, 0.72);
  for (const x of [0.34, 0.86]) {
    for (const z of [2.28, 2.52]) {
      addBox(parent, { x, y: 0.085, z }, { w: 0.045, h: 0.08, d: 0.045 }, 0x626b79);
      const wheel = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), wheelMaterial);
      wheel.scale.set(0.8, 1, 0.65);
      wheel.position.set(x, 0.05, z);
      wheel.castShadow = true;
      parent.add(wheel);
    }
  }
  const rodMaterial = new THREE.MeshStandardMaterial({ color: 0x8f969c, roughness: 0.35, metalness: 0.65 });
  for (const x of [0.43, 0.77]) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 8), rodMaterial);
    rod.position.set(x, 0.77, 2.51);
    parent.add(rod);
  }
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.4, 8), wheelMaterial);
  handle.rotation.z = Math.PI / 2;
  handle.position.set(0.6, 1.02, 2.51);
  parent.add(handle);
  addBox(parent, { x: 0.6, y: 0.565, z: 2.4 }, { w: 0.24, h: 0.035, d: 0.08 }, 0x4d555f);
}

function buildDoor(parent: THREE.Object3D, occluders: THREE.Object3D[]): void {
  const door = ROOM_PROPS.door;
  occluders.push(addBox(parent, door.center, door.size, door.color));
  for (const z of [2.09, 3.31]) {
    addBox(parent, { x: 3.29, y: 1.14, z }, { w: 0.1, h: 2.28, d: 0.1 }, 0x7c6a58);
  }
  addBox(parent, { x: 3.29, y: 2.27, z: 2.7 }, { w: 0.1, h: 0.1, d: 1.32 }, 0x7c6a58);
  for (const y of [0.6, 1.57]) {
    addBox(parent, { x: 3.322, y, z: 2.7 }, { w: 0.022, h: 0.65, d: 0.76 }, 0x76634f);
    for (const z of [2.3, 3.1]) {
      addBox(parent, { x: 3.305, y, z }, { w: 0.025, h: 0.71, d: 0.035 }, 0x8a7560, {
        castShadow: false,
      });
    }
    for (const offsetY of [-0.345, 0.345]) {
      addBox(parent, { x: 3.305, y: y + offsetY, z: 2.7 }, { w: 0.025, h: 0.035, d: 0.84 }, 0x8a7560, {
        castShadow: false,
      });
    }
  }
  const metal = new THREE.MeshStandardMaterial({ color: 0xa3a7a5, roughness: 0.3, metalness: 0.72 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.055, 10), metal);
  base.rotation.z = Math.PI / 2;
  base.position.set(3.295, 1.03, 2.29);
  parent.add(base);
  const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.15, 8), metal);
  lever.rotation.x = Math.PI / 2;
  lever.position.set(3.255, 1.03, 2.35);
  parent.add(lever);
}

function buildRoom(parent: THREE.Object3D): { occluders: THREE.Object3D[] } {
  const occluders: THREE.Object3D[] = [];
  const details = createRoomDetails();
  buildShell(parent, occluders, details);
  buildWindow(parent, details);
  buildCeilingLamp(parent);
  buildShelves(parent, details);
  buildBed(parent, occluders);
  buildDesk(parent, occluders, details);
  buildWastebasket(parent, details, occluders);
  buildChairAndShirt(parent, occluders);
  buildSuitcase(parent, occluders);
  buildDoor(parent, occluders);
  return { occluders };
}

/** S1：只点枕边手机；窗户 / 文化衫 / 行李箱为观察热点 */
const S1_INTERACTABLES: InteractableConfig[] = [
  { id: 'phone', position: { x: -2.85, y: 0.66, z: -4.02 }, lightOffsetY: 0.24, maxDistance: 5 },
];

const S1_HOTSPOTS: HotspotConfig[] = [
  { id: 'window', position: { x: 1.8, y: 1.9, z: -6.25 }, maxDistance: 9, maxAngleDeg: 12 },
  { id: 'culture-shirt', position: { x: 2.42, y: 1.06, z: -0.62 }, maxDistance: 8 },
  { id: 'suitcase', position: { x: 0.6, y: 0.55, z: 2.4 }, maxDistance: 8 },
];

/** S3：文化衫与证件袋可点击带走（非必须），随后进入快跑过场 */
const S3_INTERACTABLES: InteractableConfig[] = [
  { id: 'culture-shirt', position: { x: 2.42, y: 1.06, z: -0.62 }, maxDistance: 3.5 },
  { id: 'document-bag', position: { x: 2.7, y: 0.84, z: -2.2 }, maxDistance: 3.5 },
];

export function createRoomDefinition(sceneId: SceneId): WorldSceneDefinition {
  const interactables =
    sceneId === 'S1' ? S1_INTERACTABLES : sceneId === 'S3' ? S3_INTERACTABLES : [];
  const hotspots = sceneId === 'S1' ? S1_HOTSPOTS : [];

  return {
    sceneKey: 'room',
    footstepSurface: 'wood',
    spawn: SPAWN,
    nav: NAV,
    exitAnchor: {
      position: { x: ROOM_PROPS.door.center.x, y: 1.6, z: ROOM_PROPS.door.center.z },
      stopDistance: 0.85,
      preparationMs: 4200,
    },
    // 房间（首屏）不出现任何角色：保持零 GLB 加载，首屏资源预算红线
    requiredModels: [],
    interactables,
    hotspots,
    // 拉远并柔化室内雾距，消除近景冷灰雾罩，仅让窗外远景柔和融天
    fog: { color: 0xe6dfd2, near: 16, far: 44 },
    build: buildRoom,
  };
}
