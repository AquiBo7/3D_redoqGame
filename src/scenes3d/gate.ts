import * as THREE from 'three';
import { gsap } from 'gsap';
import type { SceneId } from '../data/storySchema';
import { sampleGroundHeight } from '../world/navMath';
import { getCharacterAnimations, hasCharacterModel } from '../world/resources';
import type { GroundSurface } from '../world/navMath';
import type {
  HotspotConfig,
  NavigationConfig,
  PanoramaAnchor,
  SceneRuntime,
  SceneRuntimeContext,
  SceneSpawn,
  WorldSceneDefinition,
} from '../world/worldSceneTypes';
import {
  addBox,
  createActorAnimation,
  createCharacterActor,
  createTextSign,
  findActorModelRoot,
  hasArmRig,
  poseHandsOnChestPhone,
  startIdleMotion,
  yawToward,
} from './shared';
import { createCharacterAnimation, posePiggybackPassenger, reverseClip } from './characterAnimation';
import type { CharacterAnimationController } from './characterAnimation';
import { createCampusMeadow, createFoliageWindMaterial } from './foliageWind';
import type { MeadowBed, WindTime } from './foliageWind';
import { createCanopyCardBatch } from './canopy';
import type { CanopyCardSpec } from './canopy';
import { canopyBudget, getQualityTier } from '../world/quality';
import type { XZ, Vec3 } from './shared';
import { buildGateMorningSkyAndHorizon } from './gateMorningSky';
import { appendBasketballHalfCourt } from './buildingSports';
import {
  createContactShadowDiscBatch,
  getBarkMaterial,
  getFoliageMaterial,
  getPavingMaterial,
  getPlasterMaterial,
  getWindowGlassMaterial,
} from './materials';

const gateWindTime: WindTime = { value: 0 };

type GateBox = [x: number, y: number, z: number, w: number, h: number, d: number];
type GateSign = [x: number, y: number, z: number, scaleX: number, scaleY: number, yaw: number];

function gateBoxes(
  parent: THREE.Object3D,
  name: string,
  boxes: GateBox[],
  material: THREE.Material,
  castShadow = false,
): THREE.InstancedMesh {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.InstancedMesh(geometry, material, boxes.length);
  const transform = new THREE.Object3D();
  boxes.forEach(([x, y, z, w, h, d], index) => {
    transform.position.set(x, y, z);
    transform.scale.set(w, h, d);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  });
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  geometry.addEventListener('dispose', () => mesh.dispose());
  parent.add(mesh);
  return mesh;
}

function gateDetailInstances(
  parent: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
  matrices: THREE.Matrix4[],
  castShadow = false,
  colors?: number[],
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((matrix, index) => {
    mesh.setMatrixAt(index, matrix);
    if (colors) mesh.setColorAt(index, new THREE.Color(colors[index]));
  });
  mesh.name = name;
  mesh.userData.campusDetail = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  geometry.addEventListener('dispose', () => mesh.dispose());
  parent.add(mesh);
  return mesh;
}

function gateDetailPose(
  x: number, y: number, z: number,
  sx = 1, sy = 1, sz = 1,
  rx = 0, ry = 0, rz = 0,
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
}

function gateDetailSegment(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  radius: number,
): THREE.Matrix4 {
  const start = new THREE.Vector3(...a);
  const end = new THREE.Vector3(...b);
  const direction = end.clone().sub(start);
  return new THREE.Matrix4().compose(
    start.add(end).multiplyScalar(0.5),
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()),
    new THREE.Vector3(radius, direction.length(), radius),
  );
}

function gateDetailSigns(
  parent: THREE.Object3D,
  name: string,
  text: string,
  width: number,
  height: number,
  signs: GateSign[],
  background: string,
  foreground: string,
): void {
  const source = createTextSign(text, width, height, { background, foreground });
  gateDetailInstances(parent, name, source.geometry, source.material,
    signs.map(([x, y, z, sx, sy, yaw]) => gateDetailPose(x, y, z, sx, sy, 1, 0, yaw)));
}

function buildGateCampusDetails(
  parent: THREE.Object3D,
  stone: THREE.MeshStandardMaterial,
  trim: THREE.MeshStandardMaterial,
  dark: THREE.MeshStandardMaterial,
  glow: THREE.MeshStandardMaterial,
  bark: THREE.MeshStandardMaterial,
): void {
  const clay = new THREE.MeshStandardMaterial({ color: 0xb9694e, roughness: 0.94 });
  const ivory = new THREE.MeshStandardMaterial({ color: 0xf0e5cb, roughness: 0.91 });
  const soil = new THREE.MeshStandardMaterial({ color: 0x345e50, roughness: 1 });
  const glass = getWindowGlassMaterial();
  const canopyMaterial = createFoliageWindMaterial(getFoliageMaterial(), gateWindTime,
    { base: -1, height: 2, amplitude: 0.035 });
  const distantMaterial = createFoliageWindMaterial(getFoliageMaterial(), gateWindTime,
    { base: -1, height: 2, amplitude: 0.035 });
  distantMaterial.color.setHex(0xc3d0bf);
  const materials = { stone, trim, metal: dark, clay, ivory, soil, warm: glow, glass };
  const boxes: Record<keyof typeof materials, GateBox[]> = {
    stone: [], trim: [], metal: [], clay: [], ivory: [], soil: [], warm: [], glass: [],
  };
  const tubes: THREE.Matrix4[] = [];
  const wheels: THREE.Matrix4[] = [];
  const trunks: THREE.Matrix4[] = [];
  const canopyMatrices: THREE.Matrix4[] = [];
  const canopyColors: number[] = [];
  const distantMatrices: THREE.Matrix4[] = [];
  const distantColors: number[] = [];
  const meadowBeds: MeadowBed[] = [];
  const welcomeSigns: GateSign[] = [];

  for (const side of [-1, 1]) {
    const prefix = `gate-detail-${side < 0 ? 'west' : 'east'}`;

    const welcomeX = side * 7.65;
    boxes.clay.push([welcomeX, 1.57, 9.45, 1.85, 2.38, 0.12]);
    boxes.ivory.push([welcomeX, 2.82, 9.45, 2.04, 0.15, 0.23],
      [welcomeX, 0.56, 9.525, 1.63, 0.055, 0.025],
      [welcomeX, 1.19, 9.525, 1.63, 0.055, 0.025]);
    boxes.metal.push([welcomeX - 0.64, 0.46, 9.45, 0.075, 0.92, 0.11],
      [welcomeX + 0.64, 0.46, 9.45, 0.075, 0.92, 0.11],
      [welcomeX - 0.64, 0.065, 9.45, 0.3, 0.13, 0.84],
      [welcomeX + 0.64, 0.065, 9.45, 0.3, 0.13, 0.84]);
    welcomeSigns.push([welcomeX, 2.17, 9.518, 1, 1, 0]);
    for (let i = 0; i < 3; i += 1) {
      const x = side * 12;
      const z = [11.7, 4.4, -5.2][i];
      const flagX = x + side * 0.58;
      tubes.push(gateDetailSegment([x, 0.1, z], [x, 4.85, z], 0.042));
      boxes.trim.push([x, 0.11, z, 0.34, 0.22, 0.34]);
      boxes.ivory.push([flagX, 3.59, z, 1.04, 2.12, 0.045],
        [flagX, 4.7, z, 1.18, 0.075, 0.08]);
      boxes.clay.push([flagX, 2.65, z + 0.027, 1.04, 0.24, 0.012],
        [flagX, 4.23, z + 0.027, 1.04, 0.1, 0.012]);
      welcomeSigns.push([flagX, 3.62, z + 0.03, 0.64, 0.85, 0]);
    }

    for (const z of [10.3, -11.45]) {
      const x = side * 10.65;
      boxes.clay.push([x, 0.16, z, 3.5, 0.32, 2.3]);
      boxes.trim.push([x, 0.35, z, 3.66, 0.06, 2.46]);
      boxes.soil.push([x, 0.39, z, 3.28, 0.025, 2.09]);
      meadowBeds.push({ x, z, y: 0.407, width: 3.12, depth: 1.94, density: 58, flowers: 16 });
    }
    for (const z of [5.2, -7.7, -16.5]) {
      const x = side * 8.6;
      const bedGround = gateGround({ x, z });
      meadowBeds.push({ x, z: z + 1.13,
        y: 0.493 + bedGround - gateGround({ x, z: z + 1.13 }),
        width: 3.86, depth: 0.24, density: 80, flowers: 14 });
      meadowBeds.push({ x, z: z - 1.13,
        y: 0.493 + bedGround - gateGround({ x, z: z - 1.13 }),
        width: 3.86, depth: 0.24, density: 60, flowers: 0 });
    }
    boxes.soil.push([side * 14.8, 0.013, 12.1, 2.7, 0.032, 2.8],
      [side * 20.4, 0.013, 11, 6, 0.032, 9],
      [side * 22.2, 0.013, -13, 2.4, 0.032, 24]);
    meadowBeds.push(
      { x: side * 14.8, z: 12.1, y: 0.032, width: 2.35, depth: 2.45, density: 34, flowers: 14 },
      { x: side * 20.5, z: 10.7, y: 0.032, width: 5.3, depth: 5.7, density: 22, flowers: 16 },
      { x: side * 22.2, z: -13, y: 0.032, width: 2.08, depth: 23.4, density: 18, flowers: 18 },
    );

    const guideX = side * 10.9;
    boxes.metal.push([guideX - 0.76, 0.98, -9.9, 0.065, 1.96, 0.08],
      [guideX + 0.76, 0.98, -9.9, 0.065, 1.96, 0.08]);
    boxes.clay.push([guideX, 1.84, -9.9, 2.15, 0.83, 0.11]);
    boxes.ivory.push([guideX, 2.31, -9.9, 2.3, 0.075, 0.18]);
    gateDetailSigns(parent, `${prefix}-zone-labels`, side < 0 ? '报到服务' : '教学区', 1.95, 0.49,
      [[guideX, 1.86, -9.838, 1, 1, 0]], '#b9694e', '#f0e5cb');

    const parkingX = side * 15.2;
    boxes.ivory.push([parkingX, 0.018, 6.95, 6.2, 0.014, 0.06],
      [parkingX, 0.018, 9.65, 6.2, 0.014, 0.06],
      [parkingX - 3.1, 0.018, 8.3, 0.06, 0.014, 2.75],
      [parkingX + 3.1, 0.018, 8.3, 0.06, 0.014, 2.75]);
    boxes.metal.push([parkingX, 1.87, 10.4, 2.68, 0.67, 0.1],
      [parkingX - 0.94, 0.79, 10.4, 0.065, 1.58, 0.065],
      [parkingX + 0.94, 0.79, 10.4, 0.065, 1.58, 0.065]);
    gateDetailSigns(parent, `${prefix}-parking-labels`, '非机动车停放区', 2.48, 0.49,
      [[parkingX, 1.87, 10.458, 1, 1, 0]], '#475b58', '#f0e5cb');
    for (let i = 0; i < 5; i += 1) {
      const x = side * (13.2 + i);
      const z = 8.25 + (i % 2) * 0.15;
      const yaw = side * (0.12 + i * 0.035);
      const bike = gateDetailPose(x, 0, z, 1, 1, 1, 0, yaw);
      const segment = (a: readonly [number, number, number], b: readonly [number, number, number], radius = 0.025) =>
        tubes.push(bike.clone().multiply(gateDetailSegment(a, b, radius)));
      for (const wheelZ of [-0.68, 0.68]) {
        wheels.push(bike.clone().multiply(gateDetailPose(0, 0.37, wheelZ, 1, 1, 1, 0, Math.PI / 2)));
        for (let spoke = 0; spoke < 4; spoke += 1) {
          const angle = spoke * Math.PI / 4;
          const dy = Math.sin(angle) * 0.325;
          const dz = Math.cos(angle) * 0.325;
          segment([0, 0.37 - dy, wheelZ - dz], [0, 0.37 + dy, wheelZ + dz], 0.008);
        }
      }
      segment([0, 0.37, -0.68], [0, 0.43, 0]);
      segment([0, 0.37, -0.68], [0, 0.94, -0.25]);
      segment([0, 0.43, 0], [0, 0.94, -0.25]);
      segment([0, 0.94, -0.25], [0, 0.94, 0.48]);
      segment([0, 0.43, 0], [0, 0.94, 0.48]);
      segment([0, 0.94, 0.48], [0, 0.37, 0.68]);
      segment([0, 0.94, 0.48], [0, 1.19, 0.42]);
      segment([-0.29, 1.19, 0.42], [0.29, 1.19, 0.42], 0.022);
      segment([0, 0.92, -0.25], [0, 1.1, -0.31], 0.023);
      segment([0, 1.1, -0.47], [0, 1.1, -0.13], 0.055);
      segment([-0.16, 0.43, 0], [0.16, 0.43, 0], 0.015);
      tubes.push(gateDetailSegment([x - 0.28, 0.025, 7.04], [x - 0.28, 0.55, 7.04], 0.031),
        gateDetailSegment([x - 0.28, 0.55, 7.04], [x + 0.28, 0.55, 7.04], 0.031),
        gateDetailSegment([x + 0.28, 0.55, 7.04], [x + 0.28, 0.025, 7.04], 0.031));
    }
    for (const z of [2.15, 6.85, 8.1]) {
      const x = side * 11.3;
      tubes.push(gateDetailSegment([x, 0.06, z], [x, 0.76, z], 0.11));
      boxes.trim.push([x, 0.055, z, 0.3, 0.11, 0.3]);
      boxes.ivory.push([x, 0.62, z, 0.226, 0.1, 0.226]);
    }

    if (side < 0) {
      tubes.push(gateDetailSegment([-9.2, 2.82, -3.51], [-9.2, 0.37, -3.51], 0.055),
        gateDetailSegment([-9.2, 0.37, -3.51], [-9.2, 0.2, -3.86], 0.055),
        gateDetailSegment([-9.2, 2.82, -3.51], [-8.99, 2.82, -3.51], 0.055));
      for (const y of [0.58, 1.48, 2.38]) boxes.trim.push([-9.15, y, -3.51, 0.16, 0.065, 0.18]);
      boxes.metal.push([-9.078, 1.1, -2.2, 0.045, 2.2, 0.96],
        [-9.113, 1.06, -1.93, 0.025, 0.12, 0.035],
        [-8.75, 0.84, -1.058, 0.56, 0.32, 0.05]);
      boxes.ivory.push([-7.65, 1.09, -1.02, 2.4, 0.11, 0.2],
        [-9.105, 2.25, -2.2, 0.08, 0.1, 1.09],
        [-9.105, 1.1, -2.71, 0.08, 2.2, 0.07],
        [-9.105, 1.1, -1.69, 0.08, 2.2, 0.07]);
      for (const x of [-8.43, -7.68, -6.93]) {
        boxes.warm.push([x, 1.69, -1.058, 0.61, 0.76, 0.012]);
        boxes.ivory.push([x, 2.01, -1.041, 0.62, 0.07, 0.022]);
        boxes.metal.push([x, 1.39, -1.038, 0.085, 0.022, 0.028]);
      }
      boxes.warm.push([-6.198, 1.65, -2.79, 0.02, 0.7, 0.66],
        [-6.198, 1.65, -1.91, 0.02, 0.7, 0.66]);
      gateDetailSigns(parent, `${prefix}-booth-number`, '01', 0.46, 0.23,
        [[-8.75, 0.84, -1.026, 1, 1, 0]], '#475b58', '#f0e5cb');
    }

    const cx = side * 14.5;
    const cz = side < 0 ? -16 : -20;
    const height = side < 0 ? 9.2 : 10.8;
    const front = cz + 3;
    for (let x = cx - 6 + 1.4; x < cx + 6 - 0.8; x += 2.5) {
      for (const y of [1.7, 4.6, 7.5]) {
        boxes.ivory.push([x - 0.89, y, front + 0.105, 0.12, 2.18, 0.2],
          [x + 0.89, y, front + 0.105, 0.12, 2.18, 0.2],
          [x, y + 1.03, front + 0.105, 1.88, 0.12, 0.2]);
        boxes.clay.push([x, y - 1.01, front + 0.16, 1.95, 0.12, 0.32]);
      }
      if (side > 0) {
        boxes.metal.push([x, 9.73, front + 0.06, 1.38, 0.92, 0.12]);
        boxes.warm.push([x, 9.73, front + 0.14, 1.19, 0.73, 0.045]);
        boxes.ivory.push([x, 10.25, front + 0.09, 1.53, 0.1, 0.18]);
      }
    }
    for (const face of [-1, 1]) {
      const wallX = cx + face * 6;
      boxes.stone.push([wallX + face * 0.07, height / 2, cz - 2.83, 0.2, height, 0.34],
        [wallX + face * 0.07, height / 2, cz + 2.83, 0.2, height, 0.34]);
      for (const z of [cz - 1.64, cz + 0.92]) {
        for (const y of [1.7, 4.6, 7.5]) {
          boxes.metal.push([wallX + face * 0.065, y, z, 0.13, 1.95, 1.68],
            [wallX + face * 0.185, y, z, 0.035, 1.73, 0.05]);
          const panes = Math.round(y + z) % 3 === 0 ? boxes.warm : boxes.glass;
          panes.push([wallX + face * 0.14, y, z, 0.045, 1.72, 1.43]);
          boxes.ivory.push([wallX + face * 0.095, y, z - 0.86, 0.19, 2.13, 0.12],
            [wallX + face * 0.095, y, z + 0.86, 0.19, 2.13, 0.12],
            [wallX + face * 0.095, y + 1.02, z, 0.19, 0.12, 1.84]);
          boxes.clay.push([wallX + face * 0.15, y - 1.01, z, 0.3, 0.12, 1.93]);
        }
      }
      for (const y of [0.3, 3.05, 5.95, height - 0.12]) {
        boxes.trim.push([wallX + face * 0.14, y, cz, 0.32, 0.16, 6.3]);
      }
    }
    boxes.clay.push([cx, height + 0.29, cz - 2.96, 12.3, 0.12, 0.28],
      [cx, height + 0.29, cz + 2.96, 12.3, 0.12, 0.28]);

    // 右侧草坪留给 4 组棋盘式篮球半场，移开遮挡球场的两株树（保留左/前/远景树不减损天际线）
    const treeSpecs = side > 0
      ? [[14.4, 12.5, 0.98], [19, 6.6, 1.13], [24.2, -14.2, 1.04], [22, -26.4, 1.16]]
      : [[14.4, 12.5, 0.98], [19, 6.6, 1.13], [16.2, -5, 1.08], [22, -13, 1.04], [22, -26.4, 1.16]];
    const leafColors = [0x91ae64, 0x6e945c, 0xa3bb70, 0x537c65];
    for (const [treeIndex, [offsetX, z, scale]] of treeSpecs.entries()) {
      const x = side * offsetX;
      trunks.push(gateDetailPose(x, 1.95 * scale, z, 0.26 * scale, 3.9 * scale, 0.26 * scale));
      for (let branch = 0; branch < 3; branch += 1) {
        const angle = branch * 2.1 + treeIndex;
        trunks.push(gateDetailSegment([x, 2.45 * scale, z],
          [x + Math.cos(angle) * 0.92 * scale, 3.87 * scale, z + Math.sin(angle) * 0.92 * scale], 0.1 * scale));
      }
      for (let cluster = 0; cluster < 10; cluster += 1) {
        const angle = cluster * 2.4 + treeIndex * 0.7;
        const radius = cluster < 7 ? 1.08 : 0.43;
        canopyMatrices.push(gateDetailPose(x + Math.cos(angle) * radius * scale,
          (4.1 + (cluster % 3) * 0.61) * scale, z + Math.sin(angle) * radius * scale,
          1.42 * scale, (0.98 + (cluster % 2) * 0.25) * scale, 1.3 * scale,
          cluster * 0.26, angle, 0.09));
        canopyColors.push(leafColors[(treeIndex + cluster) % leafColors.length]);
      }
    }
    for (let layer = 0; layer < 4; layer += 1) {
      const x = side * [13.6, 19.1, 25.8, 32.6][layer];
      const z = [-39.2, -43.5, -47.5, -51.5][layer];
      const scale = 1.2 + layer * 0.26;
      for (let cluster = 0; cluster < 7; cluster += 1) {
        const angle = cluster * 2.4 + layer;
        distantMatrices.push(gateDetailPose(x + Math.cos(angle) * scale * 1.24,
          4.25 + (cluster % 3) * 0.83 + layer * 0.42, z + Math.sin(angle) * scale,
          1.65 * scale, (1.05 + (cluster % 2) * 0.23) * scale, 1.5 * scale,
          0.12, angle, 0.08));
        distantColors.push([0xa2b5a0, 0xb7c5aa, 0x8fae9e, 0xc1ccb7][(layer + cluster) % 4]);
      }
    }

  }
  for (const key of Object.keys(materials) as Array<keyof typeof materials>) {
    if (!boxes[key].length) continue;
    const mesh = gateBoxes(parent, `gate-detail-${key}`, boxes[key], materials[key],
      key === 'stone' || key === 'metal' || key === 'clay');
    mesh.userData.campusDetail = true;
  }
  gateDetailInstances(parent, 'gate-detail-tree-trunks', new THREE.CylinderGeometry(0.56, 1, 1, 8), bark, trunks, true);
  gateDetailInstances(parent, 'gate-detail-street-canopies', new THREE.IcosahedronGeometry(1, 1),
    canopyMaterial, canopyMatrices, true, canopyColors);
  gateDetailInstances(parent, 'gate-detail-distant-canopies', new THREE.IcosahedronGeometry(1, 0),
    distantMaterial, distantMatrices, false, distantColors);
  gateDetailInstances(parent, 'gate-detail-cycle-frames-and-street-metal', new THREE.CylinderGeometry(1, 1, 1, 7), dark, tubes);
  gateDetailInstances(parent, 'gate-detail-cycle-wheels', new THREE.TorusGeometry(0.337, 0.028, 5, 20), dark, wheels);
  gateDetailSigns(parent, 'gate-detail-welcome-labels', '欢迎新同学', 1.5, 0.48, welcomeSigns, '#f0e5cb', '#9e573e');
  const grassCount = meadowBeds.reduce((sum, bed) => sum + Math.floor(bed.width * bed.depth * (bed.density ?? 22)), 0);
  for (const bed of meadowBeds) {
    bed.density = (bed.density ?? 22) * 3000 / grassCount;
    bed.bladeWidth = 1.25;
  }
  createCampusMeadow(parent, 'gate-meadow', meadowBeds, gateWindTime);
}

function buildGateLandscape(parent: THREE.Object3D, occluders: THREE.Object3D[]): void {
  const stone = getPlasterMaterial({ repeatX: 2, repeatY: 2 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xb7b3a5, roughness: 0.86 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x475b58, roughness: 0.72, metalness: 0.18 });
  const brick = new THREE.MeshStandardMaterial({ color: 0x9a7869, roughness: 0.93 });
  const glow = new THREE.MeshStandardMaterial({
    color: 0xdfc592, emissive: 0xd7a763, emissiveIntensity: 0.38, roughness: 0.62,
  });
  const box = (name: string, specs: GateBox[], material: THREE.Material, shadow = false) =>
    gateBoxes(parent, name, specs, material, shadow);

  const forecourt = new THREE.Mesh(
    new THREE.PlaneGeometry(48, 68),
    getPavingMaterial({ repeatX: 20, repeatY: 28 }),
  );
  forecourt.rotation.x = -Math.PI / 2;
  forecourt.position.set(0, -0.012, -12);
  forecourt.receiveShadow = true;
  forecourt.name = 'gate-court-paving';
  parent.add(forecourt);

  const inlays: GateBox[] = [];
  for (const side of [-1, 1]) {
    inlays.push([side * 5.9, -0.006, -11, 0.16, 0.008, 48]);
    for (const z of [7, -4, -10, -16, -22]) {
      inlays.push([side * 9.4, -0.006, z, 6.9, 0.008, 0.15]);
    }
  }
  box('gate-paving-inlays', inlays, dark);

  const columnBands: GateBox[] = [];
  const columns: GateBox[] = GATE_COLUMNS.map(({ center, size }) =>
    [center.x, center.y, center.z, size.w, size.h, size.d]);
  occluders.push(box('gate-stone-columns', columns, stone, true));
  for (const x of [-1.7, 1.7]) {
    for (const y of [0.16, 3.93, 4.12]) {
      columnBands.push([x, y, 1.5, 0.92, y < 1 ? 0.3 : 0.12, 0.92]);
    }
    for (let y = 0.65; y < 3.9; y += 0.55) {
      columnBands.push([x, y, 1.857, 0.68, 0.014, 0.018]);
    }
  }
  columnBands.push([0, 4.49, 1.5, 5.3, 0.12, 0.95], [0, 4.59, 1.5, 5.65, 0.08, 1.04]);
  box('gate-stone-cornices', columnBands, trim, true);
  box('gate-copper-insets', [[-1.7, 2.08, 1.865, 0.25, 2.4, 0.02], [1.7, 2.08, 1.865, 0.25, 2.4, 0.02]], dark);

  const banner = createTextSign('迎新报到', 2.62, 0.58, { background: '#764e40', foreground: '#f1dfb9' });
  banner.position.set(0, 3.45, 1.92);
  parent.add(banner);
  box('gate-banner-frame', [[0, 3.77, 1.9, 2.8, 0.045, 0.065], [0, 3.13, 1.9, 2.8, 0.035, 0.06]], dark);
  box('gate-banner-hangers', [[-1.2, 3.94, 1.9, 0.018, 0.31, 0.018], [1.2, 3.94, 1.9, 0.018, 0.31, 0.018]], trim);

  const walls: GateBox[] = [];
  const caps: GateBox[] = [];
  const rails: GateBox[] = [];
  for (const side of [-1, 1]) {
    walls.push([side * 14.1, 0.35, 0.15, 16, 0.7, 0.5]);
    caps.push([side * 14.1, 0.74, 0.15, 16.2, 0.12, 0.65]);
    for (const x of [6.15, 11.45, 16.75, 22.05]) {
      walls.push([side * x, 1.23, 0.15, 0.65, 2.46, 0.75]);
      caps.push([side * x, 2.49, 0.15, 0.88, 0.13, 0.96]);
    }
    for (let x = 6.6; x < 21.7; x += 0.3) {
      rails.push([side * x, 1.4, 0.15, 0.035, 1.35, 0.045]);
    }
    for (const y of [1.05, 1.95]) rails.push([side * 14.1, y, 0.15, 15.4, 0.045, 0.065]);
    rails.push([side * 4.35, 3.99, 1.5, 3.7, 0.17, 0.45]);
    walls.push([side * 6.3, 2, 1.5, 0.72, 4, 0.72]);
    caps.push([side * 6.3, 4.07, 1.5, 0.95, 0.18, 0.95]);
  }
  box('gate-boundary-walls', walls, stone, true);
  box('gate-boundary-caps', caps, trim, true);
  box('gate-ironwork', rails, dark, true);

  const boothWallMat = new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.9 });
  const boothRoofMat = new THREE.MeshStandardMaterial({ color: 0x2f6b5a, roughness: 0.85 });
  const boothGlassMat = new THREE.MeshStandardMaterial({ color: 0x3c4a52, roughness: 0.18, metalness: 0.32 });
  const boothWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.82 });
  const benchWoodMat = new THREE.MeshStandardMaterial({ color: 0xa87a4f, roughness: 0.8 });
  const planterStoneMat = new THREE.MeshStandardMaterial({ color: 0x8e9598, roughness: 0.92 });
  const soilMat = new THREE.MeshStandardMaterial({ color: 0x345e50, roughness: 1 });

  const boothBodies: GateBox[] = [];
  const boothRoofs: GateBox[] = [];
  const boothWindows: GateBox[] = [];
  const boothFrames: GateBox[] = [];
  const boothFlags: GateBox[] = [];
  const boothChairs: GateBox[] = [];

  // S5 门楼左右对称门卫室（墙体 3.0×2.2×2.8m，坡顶深绿 #2f6b5a，深蓝玻璃 #3c4a52 + 白框，旗杆，门口椅子与「校园重地」牌）
  for (const side of [-1, 1] as const) {
    const bx = side * 7.65;
    const bz = -2.35;
    const innerX = bx - side * 1.52;
    boothBodies.push([bx, 1.4, bz, 3.0, 2.8, 2.2]);
    boothRoofs.push(
      [bx, 2.88, bz, 3.4, 0.18, 2.6],
      [bx, 3.02, bz, 2.75, 0.12, 2.05],
      [bx, 3.12, bz, 1.9, 0.1, 1.4],
    );
    // 门与窗（深蓝玻璃 + 白框）
    boothWindows.push(
      [bx, 1.64, bz + 1.11, 2.1, 0.96, 0.04],
      [innerX, 1.54, bz - 0.32, 0.04, 0.96, 0.92],
      [innerX, 1.12, bz + 0.56, 0.04, 2.1, 0.82],
    );
    for (const dx of [-1.06, -0.35, 0.35, 1.06]) {
      boothFrames.push([bx + dx, 1.64, bz + 1.14, 0.055, 1.04, 0.065]);
    }
    for (const y of [1.13, 2.15]) boothFrames.push([bx, y, bz + 1.14, 2.22, 0.07, 0.07]);
    for (const z of [bz - 0.78, bz + 0.14]) boothFrames.push([innerX - side * 0.02, 1.54, z, 0.065, 1.04, 0.055]);
    for (const y of [1.03, 2.05]) boothFrames.push([innerX - side * 0.02, y, bz - 0.32, 0.065, 0.07, 0.98]);
    // 门框白边
    boothFrames.push(
      [innerX - side * 0.02, 1.12, bz + 0.14, 0.07, 2.16, 0.06],
      [innerX - side * 0.02, 1.12, bz + 0.98, 0.07, 2.16, 0.06],
      [innerX - side * 0.02, 2.18, bz + 0.56, 0.07, 0.07, 0.9],
    );
    // 屋顶细旗杆（直径 0.04m，无旗面）
    boothFlags.push([bx, 3.85, bz, 0.04, 1.4, 0.04]);
    // 门口值班椅子剪影
    const chairX = innerX - side * 0.42;
    const chairZ = bz + 0.65;
    boothChairs.push(
      [chairX, 0.44, chairZ, 0.42, 0.05, 0.42],
      [chairX, 0.72, chairZ - 0.19, 0.42, 0.54, 0.05],
      [chairX - 0.18, 0.22, chairZ - 0.18, 0.04, 0.44, 0.04],
      [chairX + 0.18, 0.22, chairZ - 0.18, 0.04, 0.44, 0.04],
      [chairX - 0.18, 0.22, chairZ + 0.18, 0.04, 0.44, 0.04],
      [chairX + 0.18, 0.22, chairZ + 0.18, 0.04, 0.44, 0.04],
    );

    const boothLabel = createTextSign('值班室', 1.05, 0.28, { background: '#475b58', foreground: '#e4d9bb' });
    boothLabel.position.set(bx, 2.48, bz + 1.12);
    parent.add(boothLabel);

    const noticeSign = createTextSign('校园重地', 0.78, 0.24, { background: '#2f6b5a', foreground: '#f4f1e8' });
    noticeSign.position.set(innerX - side * 0.04, 1.65, bz - 0.32);
    noticeSign.rotation.y = -side * Math.PI / 2;
    parent.add(noticeSign);
  }
  box('gate-booth-body', boothBodies, boothWallMat, true);
  box('gate-booth-roof', boothRoofs, boothRoofMat, true);
  box('gate-booth-window', boothWindows, boothGlassMat);
  box('gate-booth-window-frames', boothFrames, boothWhiteMat);
  box('gate-booth-flagpoles', boothFlags, dark);
  box('gate-booth-chairs', boothChairs, dark, true);

  // 前景两侧圆形花坛（直径 2.2m，高 0.45m，石材 #8e9598，各配 3 团灌木球）与靠后长椅 2 张
  const forePlanterCylGeo = new THREE.CylinderGeometry(1.1, 1.14, 0.45, 16);
  const forePlanterMesh = new THREE.InstancedMesh(forePlanterCylGeo, planterStoneMat, 2);
  forePlanterMesh.name = 'gate-foreground-planters';
  forePlanterMesh.castShadow = true;
  forePlanterMesh.receiveShadow = true;
  const foreSoilGeo = new THREE.CylinderGeometry(0.96, 0.96, 0.05, 16);
  const foreSoilMesh = new THREE.InstancedMesh(foreSoilGeo, soilMat, 2);
  foreSoilMesh.name = 'gate-foreground-planter-soil';
  const foreShrubGeo = new THREE.IcosahedronGeometry(1, 0);
  const foreShrubs = new THREE.InstancedMesh(foreShrubGeo, getFoliageMaterial(), 6);
  foreShrubs.name = 'gate-foreground-shrubs';
  foreShrubs.castShadow = true;
  foreShrubs.receiveShadow = true;
  const pTransform = new THREE.Object3D();
  const pColor = new THREE.Color();
  const shrubGreens = [0x3f7a3c, 0x6c9a4a, 0x9cc06a];
  [-1, 1].forEach((side, pIdx) => {
    const fx = side * 6.75;
    const fz = 4.4;
    pTransform.position.set(fx, 0.225, fz);
    pTransform.rotation.set(0, 0, 0);
    pTransform.scale.set(1, 1, 1);
    pTransform.updateMatrix();
    forePlanterMesh.setMatrixAt(pIdx, pTransform.matrix);
    pTransform.position.set(fx, 0.455, fz);
    pTransform.updateMatrix();
    foreSoilMesh.setMatrixAt(pIdx, pTransform.matrix);
    for (let s = 0; s < 3; s += 1) {
      const a = s * 2.094 + pIdx * 0.7;
      pTransform.position.set(fx + Math.cos(a) * 0.46, 0.68 + (s % 2) * 0.08, fz + Math.sin(a) * 0.46);
      pTransform.scale.set(0.46, 0.36 + (s % 2) * 0.06, 0.44);
      pTransform.rotation.set(0, a, 0);
      pTransform.updateMatrix();
      foreShrubs.setMatrixAt(pIdx * 3 + s, pTransform.matrix);
      foreShrubs.setColorAt(pIdx * 3 + s, pColor.setHex(shrubGreens[s % shrubGreens.length]));
    }
  });
  for (const mesh of [forePlanterMesh, foreSoilMesh, foreShrubs]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }
  if (foreShrubs.instanceColor) foreShrubs.instanceColor.needsUpdate = true;
  forePlanterCylGeo.addEventListener('dispose', () => forePlanterMesh.dispose());
  foreSoilGeo.addEventListener('dispose', () => foreSoilMesh.dispose());
  foreShrubGeo.addEventListener('dispose', () => foreShrubs.dispose());
  parent.add(forePlanterMesh, foreSoilMesh, foreShrubs);

  // 2 张靠后广场休息长椅（不压人群通道）
  const rearBenchWood: GateBox[] = [];
  const rearBenchLegs: GateBox[] = [];
  for (const side of [-1, 1]) {
    const bx = side * 6.75;
    const bz = -0.35;
    rearBenchWood.push(
      [bx, 0.45, bz, 0.56, 0.07, 1.68],
      [bx + side * 0.24, 0.74, bz, 0.07, 0.34, 1.68],
    );
    for (const dz of [-0.66, 0.66]) {
      for (const dx of [-0.2, 0.2]) {
        rearBenchLegs.push([bx + dx, 0.22, bz + dz, 0.06, 0.44, 0.06]);
      }
    }
  }
  box('gate-rear-bench-seats', rearBenchWood, benchWoodMat, true);
  box('gate-rear-bench-legs', rearBenchLegs, dark, true);

  const fgContacts = createContactShadowDiscBatch('gate-foreground-contacts', [
    { x: -6.75, z: 4.4, radius: 1.32, y: 0.014 },
    { x: 6.75, z: 4.4, radius: 1.32, y: 0.014 },
    { x: -6.75, z: -0.35, radius: 0.9, y: 0.014 },
    { x: 6.75, z: -0.35, radius: 0.9, y: 0.014 },
    { x: -7.65, z: -2.35, radius: 1.75, y: 0.014 },
    { x: 7.65, z: -2.35, radius: 1.75, y: 0.014 },
  ]);
  if (fgContacts) parent.add(fgContacts);

  const planters: GateBox[] = [];
  const planterCaps: GateBox[] = [];
  const lawns: GateBox[] = [];
  for (const side of [-1, 1]) {
    for (const z of [5.2, -7.7, -16.5]) {
      planters.push([side * 8.6, 0.2, z, 4.25, 0.4, 2.8]);
      planterCaps.push([side * 8.6, 0.42, z, 4.42, 0.08, 2.96]);
      lawns.push([side * 8.6, 0.47, z, 4.03, 0.03, 2.59]);
    }
    lawns.push([side * 16.5, 0.015, -11, 10, 0.04, 20]);
  }
  box('gate-planter-walls', planters, brick, true);
  box('gate-planter-lips', planterCaps, trim);
  box('gate-planted-soil', lawns, new THREE.MeshStandardMaterial({ color: 0x345e50, roughness: 1 }));

  const trees = [
    [-9.4, 5.1, 1], [9.4, 5.1, 1.1], [-10, -8, 1.12], [10, -8, 1],
    [-6.8, -18, 0.95], [6.8, -18, 1.1], [-12, -26, 1.25], [13, -26, 1.1],
  ];
  const bark = getBarkMaterial({ repeatX: 2, repeatY: 3 });
  const canopyGeometry = new THREE.IcosahedronGeometry(1, 1);
  const crowns = new THREE.InstancedMesh(canopyGeometry,
    createFoliageWindMaterial(getFoliageMaterial(), gateWindTime, { base: -1, height: 2, amplitude: 0.035 }),
    trees.length * 9);
  const transform = new THREE.Object3D();
  const colors = [0x809267, 0x6e845c, 0x92a376, 0x5d785f];
  let instance = 0;
  for (const [treeIndex, [x, z, scale]] of trees.entries()) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.26, 3.9 * scale, 9), bark);
    trunk.position.set(x, 1.95 * scale, z);
    trunk.castShadow = true;
    parent.add(trunk);
    for (let cluster = 0; cluster < 9; cluster += 1) {
      const angle = cluster * 2.4 + treeIndex;
      const radius = cluster < 6 ? 1.05 : 0.45;
      transform.position.set(x + Math.cos(angle) * radius * scale, (4.25 + (cluster % 3) * 0.57) * scale, z + Math.sin(angle) * radius * scale);
      transform.scale.set(1.35 * scale, (0.95 + (cluster % 2) * 0.3) * scale, 1.25 * scale);
      transform.rotation.set(cluster * 0.32, angle, 0.1);
      transform.updateMatrix();
      crowns.setMatrixAt(instance, transform.matrix);
      crowns.setColorAt(instance, new THREE.Color(colors[(cluster + treeIndex) % colors.length]));
      instance += 1;
    }
  }
  crowns.name = 'gate-layered-canopies';
  crowns.castShadow = true;
  crowns.receiveShadow = true;
  crowns.instanceMatrix.needsUpdate = true;
  crowns.computeBoundingSphere();
  canopyGeometry.addEventListener('dispose', () => crowns.dispose());
  parent.add(crowns);

  // 校门树保留冠团做体积与投影，外面再套一层 alpha 卡片：圆弧轮廓由卡片的镂空边缘破掉，
  // 卡片按黄金角错开朝向，玩家一走动剪影就跟着变，读得出是一棵树而不是一团绿球。
  const gateTier = canopyBudget(getQualityTier());
  const gateGolden = Math.PI * (3 - Math.sqrt(5));
  const gateCardTints = [0xdfe7d6, 0xe9efe0, 0xd4dec9, 0xeef4e7];
  const canopyCards: CanopyCardSpec[] = [];
  for (const [treeIndex, [x, z, scale]] of trees.entries()) {
    const crownCenterY = 4.55 * scale;
    for (let card = 0; card < gateTier.cards; card += 1) {
      const t = (card + 0.5) / gateTier.cards;
      const angle = card * gateGolden * 2 + treeIndex * 1.37;
      const ring = 0.95 * scale * (0.35 + 0.65 * Math.sin(Math.PI * t));
      canopyCards.push({
        x: x + Math.cos(angle) * ring,
        y: crownCenterY + (t - 0.5) * 1.7 * scale,
        z: z + Math.sin(angle) * ring,
        scale: (2.5 + ((card * 5 + treeIndex) % 3) * 0.16) * scale,
        yaw: angle + Math.PI / 2,
        tilt: (card % 3 - 1) * 0.18,
        tint: gateCardTints[(treeIndex + card) % gateCardTints.length],
      });
    }
  }
  const leafCards = createCanopyCardBatch(canopyCards, {
    name: 'gate-canopy-cards',
    texture: { size: gateTier.textureSize, seed: 5, aniso: gateTier.anisotropy, density: 0.92 },
    alphaTest: gateTier.alphaTest,
    time: gateWindTime,
    sway: 0.035,
  });
  leafCards.userData.windTime = gateWindTime;
  parent.add(leafCards);

  const shrubGeometry = new THREE.IcosahedronGeometry(1, 0);
  const shrubs = new THREE.InstancedMesh(shrubGeometry, getFoliageMaterial(), 48);
  for (let i = 0; i < 48; i += 1) {
    const bed = Math.floor(i / 8);
    const side = bed < 3 ? -1 : 1;
    const z = [5.2, -7.7, -16.5][bed % 3];
    transform.position.set(side * 8.6 + ((i % 4) - 1.5) * 0.88, 0.77, z + (i % 8 < 4 ? -0.65 : 0.65));
    transform.scale.set(0.65, 0.45 + (i % 3) * 0.1, 0.6);
    transform.rotation.set(0, i * 1.7, 0);
    transform.updateMatrix();
    shrubs.setMatrixAt(i, transform.matrix);
    shrubs.setColorAt(i, new THREE.Color(colors[i % colors.length]));
  }
  shrubs.name = 'gate-planter-shrubs';
  shrubs.castShadow = true;
  shrubs.receiveShadow = true;
  shrubs.instanceMatrix.needsUpdate = true;
  shrubs.computeBoundingSphere();
  shrubGeometry.addEventListener('dispose', () => shrubs.dispose());
  parent.add(shrubs);

  const buildingBodies: GateBox[] = [[-14.5, 4.6, -16, 12, 9.2, 6], [14.5, 5.4, -20, 12, 10.8, 6], [0, 5.2, -34, 24, 10.4, 6]];
  box('gate-campus-buildings', buildingBodies, stone);
  const frames: GateBox[] = [];
  const windows: GateBox[] = [];
  const warmWindows: GateBox[] = [];
  const accents: GateBox[] = [];
  for (const [cx, cy, cz, width, height, depth] of buildingBodies) {
    const front = cz + depth / 2;
    for (let x = cx - width / 2 + 1.4; x < cx + width / 2 - 0.8; x += 2.5) {
      for (const y of [1.7, 4.6, 7.5]) {
        frames.push([x, y, front + 0.06, 1.66, 1.96, 0.13]);
        const panes = Math.round(x + y) % 5 === 0 ? warmWindows : windows;
        panes.push([x, y, front + 0.14, 1.42, 1.72, 0.05]);
        accents.push([x, y, front + 0.18, 0.055, 1.73, 0.04]);
      }
    }
    for (const y of [0.3, 3.05, 5.95, height - 0.15]) accents.push([cx, y, front + 0.12, width + 0.35, 0.17, 0.38]);
    accents.push([cx, cy * 2 + 0.13, cz, width + 0.4, 0.25, depth + 0.4]);
  }
  box('gate-campus-window-reveals', frames, dark);
  box('gate-campus-window-panes', windows, getWindowGlassMaterial());
  box('gate-campus-warm-windows', warmWindows, glow);
  box('gate-campus-floor-bands', accents, trim);
  box('gate-campus-entry', [[0, 1.65, -30.96, 3.4, 3.3, 0.1], [-14.5, 1.55, -12.94, 2.4, 3.1, 0.1]], dark);
  box('gate-campus-canopy', [[0, 3.6, -30, 5.8, 0.2, 2.6]], brick, true);

  const lampPosts: GateBox[] = [];
  const lampHeads: GateBox[] = [];
  const lampLids: GateBox[] = [];
  for (const [x, z] of [[6.1, 6.8], [-6.1, 6.8], [6.1, -11], [-6.1, -11], [6.1, -23], [-6.1, -23]]) {
    lampPosts.push([x, 1.65, z, 0.075, 3.3, 0.075], [x, 0.08, z, 0.21, 0.16, 0.21]);
    lampHeads.push([x, 3.4, z, 0.24, 0.26, 0.24]);
    lampLids.push([x, 3.55, z, 0.39, 0.055, 0.39], [x, 3.25, z, 0.32, 0.055, 0.32]);
  }
  box('gate-court-lamp-posts', lampPosts, dark, true);
  box('gate-court-lanterns', lampHeads, glow);
  box('gate-court-lamp-caps', lampLids, dark);

  box('gate-wayfinding-stand', [[6.4, 0.85, -3.4, 0.1, 1.7, 0.1], [6.4, 1.95, -3.43, 1.65, 0.95, 0.12]], dark, true);
  const wayfinding = createTextSign('教学区 ↑', 1.48, 0.42, { background: '#475b58', foreground: '#e8dfc9' });
  wayfinding.position.set(6.4, 2.12, -3.35);
  parent.add(wayfinding);
  const registration = createTextSign('报到处 →', 1.48, 0.35, { background: '#475b58', foreground: '#c8cbb4' });
  registration.position.set(6.4, 1.72, -3.35);
  parent.add(registration);

  buildGateCampusDetails(parent, stone, trim, dark, glow, bark);
}


/** 台阶：6 级浅阶（总升 0.42m），从 z 6.0 到 2.7；台阶之上即校门前平地 */
const STEP_COUNT = 6;
const STEP_DEPTH = 0.55;
const STEP_RISE = 0.07;
const STEPS_Z_START = 6.0;

interface StepSpec {
  center: Vec3;
  size: { w: number; h: number; d: number };
}

const STEPS: StepSpec[] = Array.from({ length: STEP_COUNT }, (_, index) => ({
  center: {
    x: 0,
    y: STEP_RISE * (index + 1) / 2,
    z: STEPS_Z_START - STEP_DEPTH * (index + 0.5),
  },
  size: { w: 7, h: STEP_RISE * (index + 1), d: STEP_DEPTH },
}));

const LANDING_HEIGHT = STEP_COUNT * STEP_RISE;
const LANDING_EDGE = STEPS_Z_START - STEP_COUNT * STEP_DEPTH;
const GROUND_SURFACES: GroundSurface[] = [
  { minX: -24, maxX: 24, minZ: -46, maxZ: LANDING_EDGE, height: LANDING_HEIGHT },
  ...STEPS.map((step) => ({
    minX: -3.5, maxX: 3.5,
    minZ: step.center.z - STEP_DEPTH / 2, maxZ: step.center.z + STEP_DEPTH / 2,
    height: step.size.h,
  })),
  ...[[-24, -3.5], [3.5, 24]].map(([minX, maxX]) => ({
    minX, maxX, minZ: LANDING_EDGE, maxZ: STEPS_Z_START,
    height: LANDING_HEIGHT, slopeZ: -LANDING_HEIGHT / (STEPS_Z_START - LANDING_EDGE),
  })),
];

function gateGround(position: XZ): number {
  return sampleGroundHeight(position, GROUND_SURFACES);
}

function groundGateLandscape(parent: THREE.Object3D): void {
  const matrix = new THREE.Matrix4();
  for (const object of parent.children) {
    if (object.name === 'gate-court-paving' || object.name === 'gate-paving-inlays') continue;
    if (object instanceof THREE.InstancedMesh) {
      for (let i = 0; i < object.count; i += 1) {
        object.getMatrixAt(i, matrix);
        matrix.elements[13] += gateGround({ x: matrix.elements[12], z: matrix.elements[14] });
        object.setMatrixAt(i, matrix);
      }
      object.instanceMatrix.needsUpdate = true;
      object.computeBoundingSphere();
    } else {
      object.position.y += gateGround(object.position);
    }
  }
  addBox(parent,
    { x: 0, y: LANDING_HEIGHT / 2, z: (LANDING_EDGE - 46) / 2 },
    { w: 48, h: LANDING_HEIGHT, d: LANDING_EDGE + 46 }, 0x9aa3a0,
    { castShadow: false });
  const landing = new THREE.Mesh(
    new THREE.PlaneGeometry(48, LANDING_EDGE + 46),
    getPavingMaterial({ repeatX: 20, repeatY: 20 }),
  );
  landing.rotation.x = -Math.PI / 2;
  landing.position.set(0, LANDING_HEIGHT + 0.001, (LANDING_EDGE - 46) / 2);
  landing.receiveShadow = true;
  parent.add(landing);
  for (const surface of GROUND_SURFACES.filter((item) => item.slopeZ !== undefined)) {
    const x = (surface.minX + surface.maxX) / 2;
    const z = (surface.minZ + surface.maxZ) / 2;
    const geometry = new THREE.PlaneGeometry(surface.maxX - surface.minX, surface.maxZ - surface.minZ);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i += 1) {
      positions.setY(i, gateGround({ x: x + positions.getX(i), z: z + positions.getZ(i) }));
    }
    geometry.computeVertexNormals();
    const ramp = new THREE.Mesh(geometry, getPavingMaterial({ repeatX: 8, repeatY: 2 }));
    ramp.position.set(x, 0, z);
    ramp.receiveShadow = true;
    parent.add(ramp);
  }
}

/** 校门门柱与横梁 */
const GATE_COLUMNS = [
  { center: { x: -1.7, y: 2.1, z: 1.5 }, size: { w: 0.7, h: 4.2, d: 0.7 } },
  { center: { x: 1.7, y: 2.1, z: 1.5 }, size: { w: 0.7, h: 4.2, d: 0.7 } },
  { center: { x: 0, y: 4.2, z: 1.5 }, size: { w: 4.9, h: 0.5, d: 0.6 } },
] as const;

/** 围观人群（含举手机拍照的新生），错落面向台阶中央；4 名围观者 + 2 名进校路人共 6 套互不重复的非主线同学模型 */
const CROWD_LOOK_TARGET: XZ = { x: 0, z: 2.8 };
const CROWD: Array<{
  position: Vec3;
  model: 'ayuan' | 'volunteer' | 'studentFemale' | 'studentMale' | 'studentMale2' | 'studentMale3' | 'studentFemale3' | 'studentFemale4';
  color: number;
  phone?: boolean;
  /** 面向台阶时的微偏角，避免机械同向排排站 */
  yawBias?: number;
}> = [
  { position: { x: -3.6, y: 0, z: 3.4 }, model: 'studentMale2', color: 0x8f9aa3, phone: true, yawBias: -0.18 },
  { position: { x: 3.8, y: 0, z: 3.0 }, model: 'studentFemale3', color: 0x93a0a8, yawBias: -0.65 },
  { position: { x: 4.4, y: 0, z: 1.4 }, model: 'studentFemale4', color: 0x8f9aa3, phone: true, yawBias: 0.4 },
  { position: { x: -4.0, y: 0, z: 1.0 }, model: 'studentMale3', color: 0x96a3ab, yawBias: 0.95 },
];

/** 台阶旁低头打字的男生（橙色手机壳是认人暗号，不做特写） */
const TYPER = { position: { x: -3.6, y: 0, z: 7.95 }, color: 0x7f8894 } as const;

export const GATE_WALKERS = [
  { id: 'student-walker', model: 'studentMale', x: -2.85, startZ: 8.2, endZ: -22, speed: 1.15, delay: 0, height: 1.7, color: 0x96a3ab, arrivedClip: 'fold_arms' },
  { id: 'student-walker-right', model: 'studentFemale', x: 2.85, startZ: 7.4, endZ: -24, speed: 1.08, delay: 1.4, height: 1.64, color: 0x93a0a8, arrivedClip: 'idle' },
] as const;

/** 合体胶囊起始位（台阶下）与拆分点（台阶顶平地） */
const CARRY_START = { x: 0.9, z: 5.4 } as const;
const HANDOFF_POINT = { x: -0.45, z: 2.45 } as const;
/**
 * 爸爸提袋跟完半步后的落点：贴到林夏步行线右侧约 0.8m，既跟得上又不挡住她。
 * 双骨架的袋子挂在身体两侧，father-bags 光点按这个落点摆到他手边。
 */
const FOLLOW_STOP = { x: -0.55, z: 0.9 } as const;
/** 交接后林夏自落脚点往校内偏左前方走的位移与耗时（0.8 倍速步态约 0.78m/s） */
const GIRL_WALK_RUN = { x: -0.45, z: -2.6 } as const;
const GIRL_WALK_SECONDS = 3.4;

/**
 * 下背后把父女整体转向侧面：林夏是被"背"着放下的，落点在爸爸与玩家摄像机之间，
 * 不转身的话放袋 / 拾袋全程她都会挡住爸爸，看起来像她手里提着两只袋子。
 */
const SIDE_YAW_RAD = -Math.PI / 2;

const SPAWN: SceneSpawn = { x: 0, z: 7.6, yaw: 0, pitchDeg: -4 };

/** S6 开场 CG 全景锚点：从台阶前缓缓拉远抬高，收下校门、横幅、台阶与人群 */
const PANORAMA_ANCHOR: PanoramaAnchor = {
  position: { x: 0, y: 3.6, z: 5.6 },
  lookAt: { x: 0, y: 1.7, z: 1.4 },
};

const NAV: NavigationConfig = {
  groundY: 0,
  surfaces: GROUND_SURFACES,
  bounds: { minX: -5.6, maxX: 5.6, minZ: -5.5, maxZ: 8.6 },
  obstacles: [
    ...GATE_COLUMNS.map((column, index) => ({
      id: `gate-column-${index}`,
      minX: column.center.x - column.size.w / 2,
      maxX: column.center.x + column.size.w / 2,
      minZ: column.center.z - column.size.d / 2,
      maxZ: column.center.z + column.size.d / 2,
      height: column.size.h,
    })),
    ...CROWD.map((person, index) => ({
      id: `gate-crowd-${index}`,
      minX: person.position.x - 0.4,
      maxX: person.position.x + 0.4,
      minZ: person.position.z - 0.4,
      maxZ: person.position.z + 0.4,
      height: 1.7,
    })),
    {
      id: 'gate-typer',
      minX: TYPER.position.x - 0.4,
      maxX: TYPER.position.x + 0.4,
      minZ: TYPER.position.z - 0.4,
      maxZ: TYPER.position.z + 0.4,
      height: 1.7,
    },
  ],
};

const HOTSPOTS: HotspotConfig[] = [
  { id: 'typer', position: { x: TYPER.position.x, y: 1.35, z: TYPER.position.z }, maxDistance: 18 },
  { id: 'handoff-moment', position: { x: -0.45, y: 1.45, z: 2.45 }, maxDistance: 16 },
  { id: 'father-bags', position: { x: -0.55, y: 0.6, z: 0.7 }, maxDistance: 15 },
  { id: 'guard-steps', position: { x: -5.85, y: 1.45, z: -1.65 }, maxDistance: 14 },
];

const BIRD_FLOCKS = [
  { cx: -11, cz: -14, y: 15.2, rx: 10, rz: 7, speed: 0.24 },
  { cx: 12, cz: -12, y: 16.4, rx: 11, rz: 8, speed: 0.21 },
  { cx: 0, cz: -26, y: 18.0, rx: 14, rz: 9, speed: 0.18 },
] as const;

let gateBirdsMesh: THREE.InstancedMesh | null = null;
const gateBirdScratch = new THREE.Object3D();

/** 右侧校内草坪 2×2 棋盘式 4 片篮球半场 + 砖砌矮围边与修剪绿篱（全数收进 z<1.5 校门围栏内侧，≤3 DrawCall，树区完全净空） */
function buildGateBasketballCourts(parent: THREE.Object3D): void {
  const boxes: Array<{ p: readonly [number, number, number]; s: readonly [number, number, number]; c: number; r?: readonly [number, number, number] }> = [];
  const rods: Array<{ p: readonly [number, number, number]; s: readonly [number, number, number]; c: number; r?: readonly [number, number, number] }> = [];
  const gy = LANDING_HEIGHT + 0.024;
  const ly = LANDING_HEIGHT + 0.036;

  // 垫底浅石材广场底板 + 四片棋盘格半场（z ∈ [-15.3, +0.3]，严密避让 z=1.5 围栏与 z=-17 配楼）
  boxes.push({ p: [17.7, gy - 0.01, -7.5], s: [11.0, 0.016, 16.4], c: 0xb7b3a5 });
  const specs: Array<{ x: number; z: number; color: number; hoopDir: 1 | -1 }> = [
    { x: 15.1, z: -11.6, color: 0x3f6a52, hoopDir: -1 },
    { x: 20.3, z: -11.6, color: 0xa4553f, hoopDir: -1 },
    { x: 15.1, z: -3.4, color: 0xa4553f, hoopDir: 1 },
    { x: 20.3, z: -3.4, color: 0x3f6a52, hoopDir: 1 },
  ];
  for (const spec of specs) {
    appendBasketballHalfCourt(boxes, rods, spec.x, spec.z, gy, ly, {
      courtColor: spec.color,
      width: 4.55,
      depth: 7.4,
      hoopDir: spec.hoopDir,
    });
  }
  // 西侧与南侧砖砌低坛边框 + 矮绿篱（z=0.95 贴靠 z=1.5 围栏内侧，不穿铁栏杆）
  boxes.push(
    { p: [12.15, gy + 0.16, -7.5], s: [0.32, 0.34, 16.6], c: 0x9a7869 },
    { p: [17.7, gy + 0.16, 0.85], s: [11.4, 0.34, 0.32], c: 0x9a7869 },
  );

  const makeBatch = (
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    items: typeof boxes,
  ): void => {
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    const t = new THREE.Object3D();
    const c = new THREE.Color();
    items.forEach((item, idx) => {
      t.position.set(item.p[0], item.p[1], item.p[2]);
      t.scale.set(item.s[0], item.s[1], item.s[2]);
      if (item.r) t.rotation.set(item.r[0], item.r[1], item.r[2]);
      else t.rotation.set(0, 0, 0);
      t.updateMatrix();
      mesh.setMatrixAt(idx, t.matrix);
      mesh.setColorAt(idx, c.setHex(item.c));
    });
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    geometry.addEventListener('dispose', () => mesh.dispose());
    parent.add(mesh);
  };
  makeBatch('gate-courts-boxes', new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.84 }), boxes);
  makeBatch('gate-courts-rods', new THREE.CylinderGeometry(1, 1, 1, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.2 }), rods);

  const hedgeGeo = new THREE.IcosahedronGeometry(1, 0);
  const hedges: typeof boxes = [];
  for (let i = 0; i < 16; i += 1) {
    hedges.push({ p: [12.15, gy + 0.48, -15.0 + i * 0.98], s: [0.38, 0.36, 0.56], c: i % 2 ? 0x5c8456 : 0x6f9664 });
  }
  for (let i = 0; i < 10; i += 1) {
    hedges.push({ p: [12.8 + i * 1.02, gy + 0.48, 0.85], s: [0.56, 0.36, 0.38], c: i % 2 ? 0x5c8456 : 0x6f9664 });
  }
  makeBatch('gate-courts-hedge', hedgeGeo, getFoliageMaterial(), hedges);
}

/** 3 群×7 只高空盘旋卡通飞鸟（单批次 InstancedMesh + GPU 着色器扇翅 + 2 只门楼栖息散落鸟） */
function buildGateSkyBirds(parent: THREE.Object3D): void {
  const positions = new Float32Array([
    // 细长机身菱柱 + 左右微翘滑翔翅
    0, 0.04, 0.22, -0.05, 0, -0.05, 0.05, 0, -0.05,
    0, 0.04, 0.22, 0.05, 0, -0.05, 0, -0.03, -0.22,
    0, 0.04, 0.22, 0, -0.03, -0.22, -0.05, 0, -0.05,
    // 左翼
    -0.04, 0.01, 0.08, -0.34, 0.1, -0.02, -0.04, 0.01, -0.08,
    -0.34, 0.1, -0.02, -0.58, 0.06, -0.14, -0.04, 0.01, -0.08,
    // 右翼
    0.04, 0.01, 0.08, 0.04, 0.01, -0.08, 0.34, 0.1, -0.02,
    0.34, 0.1, -0.02, 0.04, 0.01, -0.08, 0.58, 0.06, -0.14,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0xf4f0e8,
    roughness: 0.78,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = gateWindTime;
    shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float birdPhase = instanceMatrix[3][0] * 0.47 + instanceMatrix[3][2] * 0.39;
      #else
        float birdPhase = 0.0;
      #endif
      float wing = max(0.0, abs(position.x) - 0.05);
      transformed.y += sin(uTime * 6.8 + birdPhase) * wing * 0.42;`,
    );
  };
  material.customProgramCacheKey = () => 'gate-sky-birds-flap-v1';

  const count = BIRD_FLOCKS.length * 7;
  const birds = new THREE.InstancedMesh(geometry, material, count);
  birds.name = 'gate-sky-birds';
  birds.castShadow = false;
  birds.receiveShadow = false;
  birds.frustumCulled = false;
  birds.raycast = () => {};
  updateGateSkyBirds(0, birds);
  geometry.addEventListener('dispose', () => birds.dispose());
  parent.add(birds);
  gateBirdsMesh = birds;

  // 校门檐口栖息的两只静态散落剪影小鸟（合并 1 次绘制）
  const perchGeo = new THREE.IcosahedronGeometry(0.11, 0);
  const perchMat = new THREE.MeshStandardMaterial({ color: 0x3b484b, roughness: 0.8 });
  const perched = new THREE.InstancedMesh(perchGeo, perchMat, 2);
  perched.name = 'gate-perched-birds';
  const t = new THREE.Object3D();
  [[-1.85, 4.72, 1.5], [1.95, 4.72, 1.5]].forEach(([bx, by, bz], idx) => {
    t.position.set(bx, by, bz);
    t.scale.set(0.85, 0.72, 1.45);
    t.rotation.set(0, idx === 0 ? 0.5 : -0.6, 0);
    t.updateMatrix();
    perched.setMatrixAt(idx, t.matrix);
  });
  perched.instanceMatrix.needsUpdate = true;
  perchGeo.addEventListener('dispose', () => perched.dispose());
  parent.add(perched);
}

function updateGateSkyBirds(elapsedSec: number, mesh = gateBirdsMesh): void {
  if (!mesh) return;
  let idx = 0;
  for (const [flockIdx, flock] of BIRD_FLOCKS.entries()) {
    for (let b = 0; b < 7; b += 1) {
      const ang = elapsedSec * flock.speed + flockIdx * 2.1 + (b - 3) * 0.28;
      const offsetR = ((b % 3) - 1) * 1.4;
      const x = flock.cx + Math.cos(ang) * (flock.rx + offsetR);
      const z = flock.cz + Math.sin(ang) * (flock.rz + offsetR * 0.7);
      const y = flock.y + Math.sin(elapsedSec * 1.2 + b) * 0.45 + (b % 2) * 0.55;
      const dx = -Math.sin(ang) * flock.rx;
      const dz = Math.cos(ang) * flock.rz;
      gateBirdScratch.position.set(x, y, z);
      gateBirdScratch.rotation.set(0, Math.atan2(dx, dz), Math.sin(ang * 2) * 0.14);
      gateBirdScratch.scale.setScalar(0.85 + (b % 3) * 0.14);
      gateBirdScratch.updateMatrix();
      mesh.setMatrixAt(idx, gateBirdScratch.matrix);
      idx += 1;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
}

function buildGate(parent: THREE.Object3D): {
  occluders: THREE.Object3D[];
  actors: Record<string, THREE.Object3D>;
} {
  gateWindTime.value = 0;
  gateBirdsMesh = null;
  const occluders: THREE.Object3D[] = [];
  buildGateLandscape(parent, occluders);
  groundGateLandscape(parent);
  buildGateBasketballCourts(parent);
  buildGateSkyBirds(parent);
  buildGateMorningSkyAndHorizon(parent);
  for (const object of parent.children) {
    if (!(object instanceof THREE.InstancedMesh)
      || (!object.userData.campusDetail && object.name !== 'gate-layered-canopies')) continue;
    object.computeBoundingBox();
    object.computeBoundingSphere();
    object.boundingBox?.expandByScalar(0.09);
    if (object.boundingSphere) object.boundingSphere.radius += 0.09;
  }

  gateBoxes(
    parent,
    'gate-steps-body',
    STEPS.map((step) => [step.center.x, step.center.y, step.center.z, step.size.w, step.size.h, step.size.d]),
    new THREE.MeshStandardMaterial({ color: 0x9aa3a0, roughness: 0.9 }),
    false,
  );
  // 台阶前缘防滑条：随台阶抬升，仅 1.2cm 厚，合并为 InstancedMesh 以降低 DrawCall
  gateBoxes(
    parent,
    'gate-steps-antislip',
    STEPS.map((_, index) => [
      0,
      STEP_RISE * (index + 1) + 0.006,
      STEPS_Z_START - STEP_DEPTH * index - 0.035,
      6.9,
      0.012,
      0.06,
    ]),
    new THREE.MeshStandardMaterial({ color: 0xb7bcb6, roughness: 0.9 }),
    false,
  );

  // 围观人群：3D 角色错落面向台阶中央，部分举低饱和手机方块
  const crowdActors: Record<string, THREE.Object3D> = {};
  for (const [index, person] of CROWD.entries()) {
    const actor = createCharacterActor(person.model, 1.66, person.color, {
      yaw: yawToward(person.position, CROWD_LOOK_TARGET) + (person.yawBias ?? 0),
      props: person.phone ? [{ kind: 'phone', color: 0x9aa2ab }] : [],
    });
    actor.position.set(person.position.x, gateGround(person.position), person.position.z);
    parent.add(actor);
    occluders.push(actor);
    crowdActors[`crowd-${index}`] = actor;
  }

  // 台阶旁低头打字的男生：面向台阶、微前倾，胸前手持橙色手机壳方块
  const typer = createCharacterActor('ayuan', 1.68, TYPER.color, {
    yaw: yawToward(TYPER.position, { x: -0.2, z: 2.8 }),
    leanRad: 0.02,
    props: [{ kind: 'phone', color: 0xd98a4a, offset: { y: -0.04 } }],
  });
  typer.position.set(TYPER.position.x, gateGround(TYPER.position), TYPER.position.z);
  parent.add(typer);
  occluders.push(typer);

  // 值班室门前站岗的保安大爷（面朝校门入口通道）
  const securityGuard = createCharacterActor('securityGuard', 1.72, 0x3b4d63, {
    yaw: Math.PI * 0.42,
  });
  securityGuard.name = 'gate-security-guard';
  securityGuard.position.set(-5.85, gateGround({ x: -5.85, z: -1.65 }), -1.65);
  parent.add(securityGuard);
  occluders.push(securityGuard);

  // 合体：双骨架一体模型（父女+提袋+下背放袋），面向 -Z；仅在未加载真实 GLB 回退胶囊体时显示占位 carryLinxia
  const carryGroup = new THREE.Group();
  const carryFather = createCharacterActor('fatherCarry', 1.78, 0x8f8578, {
    yaw: Math.PI,
  });
  const carryLinxia = createCharacterActor('linxia', 1.62, 0xe8d9a8, { yaw: Math.PI });
  carryLinxia.position.set(0, 0.45, 0.3);
  carryLinxia.visible = !hasCharacterModel('fatherCarry');
  carryGroup.add(carryFather, carryLinxia);
  carryGroup.position.set(CARRY_START.x, gateGround(CARRY_START), CARRY_START.z);
  parent.add(carryGroup);

  // 交接后独立走路的林夏（初始隐藏，落点在演出里按骨架实时求解）
  const linxiaSolo = createCharacterActor('linxia', 1.62, 0xe8d9a8, { yaw: Math.PI });
  linxiaSolo.position.set(HANDOFF_POINT.x, gateGround(HANDOFF_POINT), HANDOFF_POINT.z);
  linxiaSolo.visible = false;

  parent.add(linxiaSolo);
  occluders.push(carryFather, carryLinxia);
  for (const path of GATE_WALKERS) {
    const walker = createCharacterActor(path.model, path.height, path.color, { yaw: Math.PI });
    walker.position.set(path.x, gateGround({ x: path.x, z: path.startZ }), path.startZ);
    parent.add(walker);
    crowdActors[path.id] = walker;
  }

  return {
    occluders,
    actors: {
      carryGroup,
      carryFather,
      carryLinxia,
      linxiaSolo,
      typer,
      securityGuard,
      ...crowdActors,
    },
  };
}

let performanceTimeline: gsap.core.Timeline | null = null;
/** 交接后林夏的骨骼动画控制器：走路 → 站定拘谨，退出场景时彻底释放 */
let linxiaAnimation: CharacterAnimationController | null = null;
let gateActors: Record<string, THREE.Object3D> = {};
const actorAnimations = new Map<string, CharacterAnimationController>();
const walkerStates = new Map<string, { delay: number; arrived: boolean }>();
const actorThrottleState = new Map<string, { accum: number; tick: number }>();
const gatePlayerFeet = new THREE.Vector3();
const girlLandingScratch = new THREE.Vector3();
let gatePlayerFeetGetter: ((target: THREE.Vector3) => THREE.Vector3) | undefined;
let gateIsModalBlocked: (() => boolean) | undefined;
let gateBusSubscriptions: Array<() => void> = [];
let carryPhase: 'walk' | 'wait' | 'dismount' | 'setdown' | 'pickup' | 'follow' | 'stand' = 'walk';
let linxiaWalking = false;
/**
 * 交接后林夏的步行（起点在交接那一刻由骨架实时求解，补间无法预知，故在 tick 里逐帧插值）
 * 负值表示这一段还没开始或已经走完
 */
const girlWalkFrom = new THREE.Vector3();
const girlWalkTo = new THREE.Vector3();
let girlWalkElapsed = -1;
let passengerPosed = false;
/** 林夏是否还挂在爸爸背上（合体骨架里的她的网格可见性，交接后转由 linxiaSolo 演出） */
let girlRidesBack = true;

/**
 * 合体骨架里父女是两套独立骨骼、两张独立网格，只切林夏网格的可见性，
 * 爸爸继续用同一套骨架走完拾袋、跟走与目送，不再换回无骨骼的静态模型。
 * 她的蒙皮网格名不带 Linxia_ 前缀（只有骨骼名带），所以按骨架归属判定。
 */
function setGirlRidesBack(visible: boolean): void {
  girlRidesBack = visible;
  gateActors.carryFather?.traverse((node) => {
    if (!(node instanceof THREE.SkinnedMesh)) return;
    if (node.skeleton.bones.some((bone) => bone.name.startsWith('Linxia_'))) node.visible = visible;
  });
}

/** 交接瞬间实时求解林夏的落脚点：骨架取她的盆骨，胶囊体回退态取占位角色 */
function resolveGirlLanding(): THREE.Vector3 {
  const carrier = gateActors.carryFather?.getObjectByName('Linxia_Pelvis') ?? gateActors.carryLinxia;
  if (carrier) return carrier.getWorldPosition(girlLandingScratch);
  return girlLandingScratch.set(HANDOFF_POINT.x, 0, HANDOFF_POINT.z);
}

/**
 * 爸爸的动画控制器：在共享剪辑之外补一份"放袋"倒放剪辑，
 * 用作他重新提起两只袋子的拾袋动作。
 */
function createCarryAnimation(actor: THREE.Object3D): CharacterAnimationController | null {
  const ref = findActorModelRoot(actor);
  if (!ref) return null;
  const clips = [...getCharacterAnimations(ref.modelId)];
  const setDown = clips.find((clip) => clip.name === 'CarryBags_SetDown');
  if (setDown) clips.push(reverseClip(setDown, 'CarryBags_PickUp'));
  return createCharacterAnimation(ref.root, clips);
}

function clearGateBusSubscriptions(): void {
  for (const unsub of gateBusSubscriptions) unsub();
  gateBusSubscriptions = [];
}

function consumeActorAnimationDt(
  id: string,
  actor: THREE.Object3D,
  dtSeconds: number,
  throttleWhenFar: boolean,
): number | null {
  if (!actor.visible) return null;
  if (!throttleWhenFar || !gatePlayerFeetGetter || !actorAnimations.has(id)) {
    const stale = actorThrottleState.get(id);
    if (stale && stale.accum > 0) {
      const total = dtSeconds + stale.accum;
      stale.accum = 0;
      return total;
    }
    return dtSeconds;
  }
  const dx = actor.position.x - gatePlayerFeet.x;
  const dz = actor.position.z - gatePlayerFeet.z;
  if (dx * dx + dz * dz <= 18 * 18) {
    const stale = actorThrottleState.get(id);
    if (stale && stale.accum > 0) {
      const total = dtSeconds + stale.accum;
      stale.accum = 0;
      return total;
    }
    return dtSeconds;
  }
  let state = actorThrottleState.get(id);
  if (!state) {
    state = { accum: 0, tick: 0 };
    actorThrottleState.set(id, state);
  }
  state.accum += dtSeconds;
  state.tick += 1;
  if (state.tick % 2 !== 0) return null;
  const total = state.accum;
  state.accum = 0;
  return total;
}

function disposeLinxiaAnimation(): void {
  linxiaAnimation?.dispose();
  linxiaAnimation = null;
}

function resetPerformanceState(actors: Record<string, THREE.Object3D>): void {
  const carry = actors.carryGroup;
  const carryLinxia = actors.carryLinxia;
  const linxia = actors.linxiaSolo;

  carryPhase = 'walk';
  carry.visible = true;
  carry.position.set(CARRY_START.x, gateGround(CARRY_START), CARRY_START.z);
  carry.rotation.set(0, 0, 0);
  actors.carryFather.rotation.set(0, Math.PI, 0);
  carryLinxia.rotation.set(0, Math.PI, 0);
  carryLinxia.visible = !hasCharacterModel('fatherCarry');
  setGirlRidesBack(true);
  girlWalkElapsed = -1;
  linxia.visible = false;
  linxia.position.set(HANDOFF_POINT.x, gateGround(HANDOFF_POINT), HANDOFF_POINT.z);
  linxia.rotation.set(0, Math.PI, 0);
}

function playPerformance(actors: Record<string, THREE.Object3D>, onReady: () => void): void {
  resetPerformanceState(actors);
  disposeLinxiaAnimation();
  passengerPosed = false;

  const carry = actors.carryGroup;
  const carryFather = actors.carryFather;
  const carryLinxia = actors.carryLinxia;
  const linxia = actors.linxiaSolo;

  const timeline = gsap.timeline();

  // 0–7s：沿台阶缓步上行（双骨架原生 CarryBags_Walk_Loop 驱动父女与提袋）
  timeline.to(carry.position, { x: HANDOFF_POINT.x, z: HANDOFF_POINT.z, duration: 7, ease: 'none' }, 0);
  // 胶囊体回退态保留轻微晃动，真实双骨架模型保持稳定不与骨骼位移叠冲
  if (!hasCharacterModel('fatherCarry')) {
    timeline.to(carry.rotation, { z: 0.04, yoyo: true, repeat: 5, duration: 1.05, ease: 'sine.inOut' }, 0);
    timeline.to(carryFather.rotation, { z: 0.03, yoyo: true, repeat: 5, duration: 1.05, ease: 'sine.inOut' }, 0);
    timeline.to(carryLinxia.rotation, { z: -0.022, yoyo: true, repeat: 6, duration: 0.95, ease: 'sine.inOut' }, 0.2);
  }

  // 7.0s：登顶平地——若开场台阶对话尚未结束，先原地停步等待，对话关闭后立刻播放下背与放袋
  timeline.add(() => {
    if (gateIsModalBlocked?.()) {
      carryPhase = 'wait';
      timeline.pause();
    } else {
      carryPhase = 'dismount';
    }
  }, 7.0);

  // 7.05–9.22s（2.17s）：原生下背动作 CarryBags_Dismount，同时把父女转向侧面
  timeline.add(() => {
    carryPhase = 'dismount';
  }, 7.05);
  timeline.to(carry.rotation, { y: SIDE_YAW_RAD, duration: 2.17, ease: 'sine.inOut' }, 7.05);

  // 9.22s：下背动作结束的一刻完成交接——合体骨架里的林夏换成能独立走路的林夏，
  // 她随即先迈步进校，爸爸才腾出手处理袋子，两人始终拉开距离，画面不会叠成一个身影
  timeline.add(() => {
    const landing = resolveGirlLanding();
    setGirlRidesBack(false);
    linxia.position.set(landing.x, gateGround(landing), landing.z);
    girlWalkFrom.set(landing.x, 0, landing.z);
    girlWalkTo.set(landing.x + GIRL_WALK_RUN.x, 0, landing.z + GIRL_WALK_RUN.z);
    girlWalkElapsed = 0;
    linxia.visible = true;
    linxiaAnimation = createActorAnimation(linxia);
    linxiaAnimation?.play('walk', { timeScale: 0.8, fadeIn: 0.2 });
    linxiaWalking = true;
    carryPhase = 'setdown';
  }, 9.22);

  // 9.22–11.48s（2.27s）：原生放袋动作 CarryBags_SetDown 把两只袋子放到地上（相位已由交接回调置好）
  // 11.48–13.75s（2.27s）：把放袋倒放成拾袋，他重新提起两只袋子
  timeline.add(() => {
    carryPhase = 'pickup';
  }, 11.48);

  // 13.75–14.75s：侧身只为让开视线，袋子回到手里后父女转回面向校内
  timeline.to(carry.rotation, { y: 0, duration: 1, ease: 'sine.inOut' }, 13.75);

  // 14.75–16.75s：爸爸提袋跟上半步，停到林夏步行线右侧目送
  timeline.add(() => {
    carryPhase = 'follow';
  }, 14.75);
  timeline.to(carry.position, { x: FOLLOW_STOP.x, z: FOLLOW_STOP.z, duration: 2, ease: 'none' }, 14.75);
  if (!hasCharacterModel('fatherCarry')) {
    timeline.to(carry.rotation, { z: 0.035, yoyo: true, repeat: 3, duration: 0.6, ease: 'sine.inOut' }, 14.75);
  }

  // 16.95s：林夏站定（拘谨）；爸爸停在校门口提袋目送
  timeline.add(() => {
    linxiaWalking = false;
    linxiaAnimation?.play('afraid', { timeScale: 0.25, fadeIn: 0.7 });
    carryPhase = 'stand';
    idleDisposers.push(startIdleMotion(carry, { breathAmp: 0.008, swayAmp: 0.01, period: 3.1 }));
    onReady();
  }, 16.95);

  performanceTimeline = timeline;
}

/** 站立角色的呼吸 / 微摆清理函数（enter 重启、exit 必杀，杜绝补间泄漏） */
let idleDisposers: Array<() => void> = [];

function stopIdleMotions(): void {
  for (const dispose of idleDisposers) dispose();
  idleDisposers = [];
}

function startGateIdleMotions(actors: Record<string, THREE.Object3D>): void {
  const ids = ['crowd-0', 'crowd-1', 'crowd-2', 'crowd-3', 'typer'];
  for (const [index, id] of ids.entries()) {
    const actor = actors[id];
    if (!actor) continue;
    idleDisposers.push(
      startIdleMotion(actor, {
        breathAmp: 0.005,
        swayAmp: 0.005,
        period: 2.6 + index * 0.23,
      }),
    );
  }
}

/** 围观人群与台阶旁打字男生：胸前竖屏手机的两位持机者（其余围观者不持机，走动画剪辑） */
const GATE_PHONE_HOLDERS = ['crowd-0', 'crowd-2', 'typer'];
/** 已摆好双手的角色；模型异步热替换前摆不上，摆成功后不再重复解算 */
const gatePhonePosed = new WeakSet<THREE.Object3D>();

function poseGatePhoneHolders(actors: Record<string, THREE.Object3D>): void {
  for (const id of GATE_PHONE_HOLDERS) {
    const actor = actors[id];
    if (!actor || gatePhonePosed.has(actor)) continue;
    // 阿远这类无骨骼静态网格：手臂烘焙死了，IK 永远摆不上，每拍重试只是白解矩阵。
    // 道具已由 createCharacterActor 改挂到手掌握点，这里直接认作处理完毕。
    if (findActorModelRoot(actor) && !hasArmRig(actor)) {
      gatePhonePosed.add(actor);
      continue;
    }
    if (poseHandsOnChestPhone(actor)) gatePhonePosed.add(actor);
  }
}

/** S5 运行时装：只播放一次演出；S6（同 sceneKey）不重播 */
export const gateRuntime: SceneRuntime = {
  enter(context: SceneRuntimeContext): void {
    gateActors = context.actors;
    gatePlayerFeetGetter = context.getPlayerFeet;
    gateIsModalBlocked = context.isModalBlocked;
    for (const path of GATE_WALKERS) {
      if (context.actors[path.id] && !walkerStates.has(path.id)) {
        walkerStates.set(path.id, { delay: path.delay, arrived: false });
      }
    }
    // 站立角色呼吸微动在 S5/S6 共用；重复 enter 先杀掉旧补间
    stopIdleMotions();
    startGateIdleMotions(context.actors);

    if (context.sceneId !== 'S5') return;
    clearGateBusSubscriptions();
    if (performanceTimeline) {
      performanceTimeline.kill();
      performanceTimeline = null;
    }
    const resumeIfWaiting = (): void => {
      if (carryPhase === 'wait' && performanceTimeline?.paused()) {
        carryPhase = 'dismount';
        performanceTimeline.resume();
      }
    };
    gateBusSubscriptions.push(
      context.bus.on('ui:dialogueEnd', ({ stepId }) => {
        if (stepId === 's5-stairs-dialogue') resumeIfWaiting();
      }),
      context.bus.on('ui:worldBlocked', ({ blocked }) => {
        if (!blocked) resumeIfWaiting();
      }),
    );
    playPerformance(context.actors, () => {
      context.bus.emit('ui:showObjective', { sceneId: 'S5' });
    });
  },

  tick(dtSeconds: number): void {
    gateWindTime.value += dtSeconds;
    updateGateSkyBirds(gateWindTime.value);
    // 持机者双手在模型热替换后才长出来，摆成功前每拍重试一次（成功后不再解算）
    poseGatePhoneHolders(gateActors);
    gatePlayerFeetGetter?.(gatePlayerFeet);
    const hasDualRig = hasCharacterModel('fatherCarry');
    if (gateActors.carryLinxia) {
      gateActors.carryLinxia.visible = !hasDualRig && girlRidesBack;
      if (!hasDualRig && !passengerPosed) {
        passengerPosed = posePiggybackPassenger(gateActors.carryLinxia);
      }
    }
    if (carryPhase === 'wait' && performanceTimeline?.paused() && !gateIsModalBlocked?.()) {
      carryPhase = 'dismount';
      performanceTimeline.resume();
    }
    if (girlWalkElapsed >= 0) {
      const t = Math.min(1, (girlWalkElapsed += dtSeconds) / GIRL_WALK_SECONDS);
      const girl = gateActors.linxiaSolo;
      if (girl) {
        girl.position.x = girlWalkFrom.x + (girlWalkTo.x - girlWalkFrom.x) * t;
        girl.position.z = girlWalkFrom.z + (girlWalkTo.z - girlWalkFrom.z) * t;
      }
      if (t >= 1) {
        // 走到台阶前停下等他，脚不能继续空转
        girlWalkElapsed = -1;
        if (linxiaWalking) {
          linxiaWalking = false;
          linxiaAnimation?.play('afraid', { timeScale: 0.25, fadeIn: 0.5 });
        }
      }
    }
    for (const id of ['carryGroup', 'linxiaSolo']) {
      const actor = gateActors[id];
      if (actor) actor.position.y = gateGround(actor.position);
    }
    const carryClip: { clip: string; timeScale: number; loop: boolean; fadeIn: number } =
      carryPhase === 'dismount'
        ? { clip: 'CarryBags_Dismount', timeScale: 1, loop: false, fadeIn: 0.18 }
        : carryPhase === 'setdown'
          ? { clip: 'CarryBags_SetDown', timeScale: 1, loop: false, fadeIn: 0.15 }
          : carryPhase === 'pickup'
            ? { clip: 'CarryBags_PickUp', timeScale: 1, loop: false, fadeIn: 0.15 }
            : carryPhase === 'stand'
              // 冻结在放袋首帧：直立提袋、膝盖微屈的目送站姿，替代无骨骼静态模型的直挺双腿
              ? { clip: 'CarryBags_SetDown', timeScale: 0, loop: true, fadeIn: 0.4 }
              : carryPhase === 'wait'
                ? { clip: 'CarryBags_Walk_Loop', timeScale: 0, loop: true, fadeIn: 0.2 }
                : { clip: 'CarryBags_Walk_Loop', timeScale: 0.9, loop: true, fadeIn: 0.25 };
    const clips: Array<[string, string, number, boolean, boolean, number]> = [
      ['carryFather', carryClip.clip, carryClip.timeScale, false, carryClip.loop, carryClip.fadeIn],
      ['crowd-1', 'idle', 0.7, true, true, 0.25],
      ['crowd-3', 'fold_arms', 0.65, true, true, 0.25],
      ['securityGuard', 'wave_goodbye_02', 0.68, true, true, 0.25],
    ];
    for (const path of GATE_WALKERS) {
      const actor = gateActors[path.id];
      const state = walkerStates.get(path.id);
      if (!actor || !state) continue;
      const movingSeconds = Math.max(0, dtSeconds - state.delay);
      state.delay = Math.max(0, state.delay - dtSeconds);
      actor.position.z = Math.max(path.endZ, actor.position.z - movingSeconds * path.speed);
      actor.position.y = gateGround(actor.position);
      state.arrived = actor.position.z <= path.endZ;
      clips.push([
        path.id,
        state.arrived || state.delay > 0 ? path.arrivedClip : 'walk',
        state.arrived ? 0.65 : 0.82,
        state.arrived,
        true,
        0.25,
      ]);
    }
    for (const [id, clip, timeScale, throttleWhenFar, loop, fadeIn] of clips) {
      const actor = gateActors[id];
      if (!actor || (id === 'carryFather' && !gateActors.carryGroup?.visible)) continue;
      const updateDt = consumeActorAnimationDt(id, actor, dtSeconds, throttleWhenFar);
      if (updateDt === null) continue;
      let animation = actorAnimations.get(id);
      if (!animation) {
        // 爸爸要额外一份倒放剪辑做拾袋，其余角色直接用资产自带的共享剪辑
        animation = (id === 'carryFather' ? createCarryAnimation(actor) : createActorAnimation(actor)) ?? undefined;
        if (animation) actorAnimations.set(id, animation);
      }
      animation?.play(clip, { timeScale, fadeIn, loop });
      animation?.update(updateDt);
    }
    if (gateActors.linxiaSolo?.visible) {
      if (!linxiaAnimation) {
        linxiaAnimation = createActorAnimation(gateActors.linxiaSolo);
        linxiaAnimation?.play(linxiaWalking ? 'walk' : 'afraid', { timeScale: linxiaWalking ? 0.8 : 0.25 });
      }
      linxiaAnimation?.update(dtSeconds);
    }
  },

  exit(): void {
    clearGateBusSubscriptions();
    gateBirdsMesh = null;
    walkerStates.clear();
    actorThrottleState.clear();
    gatePlayerFeetGetter = undefined;
    gateIsModalBlocked = undefined;
    carryPhase = 'walk';
    for (const animation of actorAnimations.values()) animation.dispose();
    actorAnimations.clear();
    gateActors = {};
    linxiaWalking = false;
    girlWalkElapsed = -1;
    stopIdleMotions();
    disposeLinxiaAnimation();
    if (performanceTimeline) {
      performanceTimeline.kill();
      performanceTimeline = null;
    }
  },
};

export function createGateDefinition(sceneId: SceneId): WorldSceneDefinition {
  const isS5 = sceneId === 'S5';

  return {
    sceneKey: 'gate',
    footstepSurface: 'stone',
    footstepActors: ['carryGroup', 'linxiaSolo', ...GATE_WALKERS.map((path) => path.id)],
    spawn: SPAWN,
    nav: NAV,
    // 围观（4 位差异化非主线同学）+ 2 位进校同学 + 打字男生（阿远）+ 父女合体骨架与交接后的林夏
    requiredModels: [
      'linxia',
      'fatherCarry',
      'ayuan',
      'studentFemale',
      'studentMale',
      'studentMale2',
      'studentMale3',
      'studentFemale3',
      'studentFemale4',
      'securityGuard',
    ],
    interactables: [],
    hotspots: isS5 ? HOTSPOTS : [],
    zones: isS5
      ? [
          {
            id: 'school-gate',
            kind: 'box',
            center: { x: 0, y: 0.9, z: 1.2 },
            size: { x: 5.6, y: 3.4, z: 2.4 },
          },
        ]
      : [],
    panoramaAnchor: PANORAMA_ANCHOR,
    fog: { color: 0xb9c6d2, near: 14, far: 60 },
    build: buildGate,
  };
}
