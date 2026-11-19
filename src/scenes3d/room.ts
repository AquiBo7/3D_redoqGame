// scenes3d/room.ts —— 旅馆房间灰盒（S1 起床 / S2 手机教学 / S3 出门）
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
import {
  getDocumentLabelMaterial,
  getPlasterMaterial,
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
];

const NAV: NavigationConfig = {
  groundY: 0,
  bounds: { minX: -3.3, maxX: 3.3, minZ: -6.2, maxZ: 3.2 },
  obstacles: OBSTACLES,
};

const TRIM_COLOR = 0xb4aa9b;
const WOOD_COLOR = 0x8f7f6d;

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

function createSoftLightQuad(
  nearLeft: Vec3,
  nearRight: Vec3,
  farLeft: Vec3,
  farRight: Vec3,
  opacity: number,
): THREE.Mesh {
  const columns = 4;
  const rows = 8;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

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
      const a = row * (columns + 1) + column;
      const b = a + 1;
      const c = a + columns + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
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

function buildShell(parent: THREE.Object3D, occluders: THREE.Object3D[]): void {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 9.4),
    getWoodFloorMaterial({ repeatX: 2, repeatY: 12 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -1.5);
  floor.receiveShadow = true;
  parent.add(floor);

  const wallMaterial = getPlasterMaterial({ repeatX: 3, repeatY: 1 });
  for (const wall of [...ROOM_WALLS, ...BACK_WALL_SEGMENTS]) {
    occluders.push(addTexturedBox(parent, wall.center, wall.size, wallMaterial));
  }
  addTexturedBox(
    parent,
    { x: 0, y: 2.86, z: -1.5 },
    { w: 7.4, h: 0.12, d: 9.8 },
    getPlasterMaterial({ repeatX: 3, repeatY: 4 }),
    false,
  );

  for (const z of [-6.27, 3.27]) {
    addBox(parent, { x: 0, y: 0.075, z }, { w: 6.75, h: 0.15, d: 0.045 }, TRIM_COLOR, {
      castShadow: false,
    });
    addBox(parent, { x: 0, y: 2.71, z }, { w: 6.75, h: 0.09, d: 0.055 }, TRIM_COLOR, {
      castShadow: false,
    });
  }
  for (const x of [-3.37, 3.37]) {
    addBox(parent, { x, y: 0.075, z: -1.5 }, { w: 0.045, h: 0.15, d: 9.45 }, TRIM_COLOR, {
      castShadow: false,
    });
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

function buildWindow(parent: THREE.Object3D): void {
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

  parent.add(
    createSoftLightQuad(
      { x: 1.25, y: 0.018, z: -6.12 },
      { x: 2.35, y: 0.018, z: -6.12 },
      { x: -0.35, y: 0.018, z: -1.75 },
      { x: 1.65, y: 0.018, z: -1.75 },
      0.58,
    ),
  );
  parent.add(
    createSoftLightQuad(
      { x: 1.34, y: 2.28, z: -6.08 },
      { x: 2.24, y: 2.28, z: -6.08 },
      { x: -0.12, y: 0.04, z: -2.05 },
      { x: 1.35, y: 0.04, z: -2.05 },
      0.12,
    ),
  );

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

  const duvetMaterial = createMatteMaterial(0xb9b6c0, 0.98);
  duvetMaterial.side = THREE.DoubleSide;
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
  duvet.position.set(-2.85, 0.47, -2.94);
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
  duvetSide.rotation.y = Math.PI / 2;
  duvetSide.position.set(-2.295, 0.34, -2.94);
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

  const fold = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, 0.96, 10),
    duvetMaterial,
  );
  fold.rotation.z = Math.PI / 2;
  fold.position.set(-2.85, 0.5, -3.69);
  fold.castShadow = true;
  parent.add(fold);
  parent.add(createPillow());
  parent.add(createPhone());
}

function buildLamp(parent: THREE.Object3D): void {
  const metal = new THREE.MeshStandardMaterial({ color: 0x6f767c, roughness: 0.62, metalness: 0.28 });
  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.03, 12), metal);
  lampBase.position.set(3.24, 0.765, -2.42);
  parent.add(lampBase);
  const lampPole = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.34, 8), metal);
  lampPole.position.set(3.24, 0.95, -2.42);
  parent.add(lampPole);
  const lampShade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.13, 0.15, 12, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0xd8cdb6,
      emissive: 0x8a7350,
      emissiveIntensity: 0.12,
      roughness: 0.9,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  );
  lampShade.position.set(3.24, 1.17, -2.42);
  parent.add(lampShade);
  const lampBulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffe6b8 }),
  );
  lampBulb.position.set(3.24, 1.1, -2.42);
  parent.add(lampBulb);
}

function buildDesk(parent: THREE.Object3D, occluders: THREE.Object3D[]): void {
  occluders.push(
    addBox(parent, { x: 2.7, y: 0.715, z: -2.2 }, { w: 1.5, h: 0.07, d: 0.8 }, 0x8d8378),
  );
  for (const x of [2.03, 3.37]) {
    for (const z of [-2.53, -1.87]) {
      addBox(parent, { x, y: 0.35, z }, { w: 0.07, h: 0.7, d: 0.07 }, 0x766b60);
    }
  }
  addBox(parent, { x: 3.13, y: 0.56, z: -2.2 }, { w: 0.43, h: 0.24, d: 0.65 }, 0x82766a);
  addBox(parent, { x: 3.13, y: 0.57, z: -1.862 }, { w: 0.14, h: 0.025, d: 0.025 }, 0x565a5c, {
    castShadow: false,
  });
  buildLamp(parent);

  const books = [
    { y: 0.77, color: 0x8b7a66, rotation: 0.12 },
    { y: 0.8, color: 0x6e7f8a, rotation: -0.06 },
  ];
  for (const book of books) {
    const group = new THREE.Group();
    group.position.set(2.12, book.y, -1.98);
    group.rotation.y = book.rotation;
    addBox(group, { x: 0, y: 0, z: 0 }, { w: 0.24, h: 0.026, d: 0.17 }, 0xd8d1c2, {
      castShadow: false,
    });
    addBox(group, { x: 0, y: 0.016, z: 0 }, { w: 0.252, h: 0.008, d: 0.18 }, book.color, {
      castShadow: false,
    });
    addBox(group, { x: 0, y: -0.016, z: 0 }, { w: 0.252, h: 0.008, d: 0.18 }, book.color, {
      castShadow: false,
    });
    parent.add(group);
  }
  const notebook = addBox(
    parent,
    { x: 2.13, y: 0.842, z: -1.98 },
    { w: 0.25, h: 0.024, d: 0.18 },
    0xb0a58f,
    { castShadow: false },
  );
  notebook.rotation.y = 0.04;
  addBox(parent, { x: 2.13, y: 0.856, z: -1.98 }, { w: 0.018, h: 0.004, d: 0.18 }, 0x716759, {
    castShadow: false,
  }).rotation.y = 0.04;

  const cupMaterial = createMatteMaterial(0xc9c4b8, 0.72);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.045, 0.11, 12, 1, true), cupMaterial);
  cup.position.set(2.22, 0.805, -2.43);
  cup.castShadow = true;
  parent.add(cup);
  const cupBottom = new THREE.Mesh(new THREE.CircleGeometry(0.045, 12), cupMaterial);
  cupBottom.rotation.x = -Math.PI / 2;
  cupBottom.position.set(2.22, 0.752, -2.43);
  parent.add(cupBottom);
  const coffee = new THREE.Mesh(
    new THREE.CircleGeometry(0.046, 12),
    createMatteMaterial(0x4a3b31, 0.5),
  );
  coffee.rotation.x = -Math.PI / 2;
  coffee.position.set(2.22, 0.854, -2.43);
  parent.add(coffee);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 12), cupMaterial);
  handle.position.set(2.278, 0.81, -2.43);
  parent.add(handle);

  const bagMaterial = createMatteMaterial(0xc4b49a, 0.86);
  const documentBag = addBox(
    parent,
    { x: 2.7, y: 0.792, z: -2.2 },
    { w: 0.34, h: 0.06, d: 0.24 },
    0xc4b49a,
  );
  occluders.push(documentBag);
  const flapShape = new THREE.Shape([
    new THREE.Vector2(-0.17, 0.12),
    new THREE.Vector2(0.17, 0.12),
    new THREE.Vector2(0, -0.035),
  ]);
  const flapGeometry = new THREE.ShapeGeometry(flapShape);
  flapGeometry.rotateX(-Math.PI / 2);
  const flap = new THREE.Mesh(flapGeometry, bagMaterial);
  flap.position.set(2.7, 0.824, -2.2);
  parent.add(flap);
  addBox(parent, { x: 2.7, y: 0.823, z: -2.08 }, { w: 0.34, h: 0.012, d: 0.018 }, 0xa89478, {
    castShadow: false,
  });
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.075), getDocumentLabelMaterial());
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
  buildShell(parent, occluders);
  buildWindow(parent);
  buildBed(parent, occluders);
  buildDesk(parent, occluders);
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
    },
    // 房间（首屏）不出现任何角色：保持零 GLB 加载，首屏资源预算红线
    requiredModels: [],
    interactables,
    hotspots,
    fog: { color: 0xb9c6d2, near: 5, far: 14 },
    build: buildRoom,
  };
}
