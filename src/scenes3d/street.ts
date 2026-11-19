// scenes3d/street.ts —— 上学街道（S4 自由移动开始）
// 进入 S4 后调度两次手机震动（间隔 ≥ 20s）；离开 S4 时 streetRuntime.exit() 必须清除未触发的定时器。

import * as THREE from 'three';
import type { SceneId } from '../data/storySchema';
import type { ObstacleAabb } from '../world/navMath';
import type {
  NavigationConfig,
  SceneRuntime,
  SceneRuntimeContext,
  SceneSpawn,
  WorldSceneDefinition,
} from '../world/worldSceneTypes';
import {
  addBox,
  addGround,
  createCharacterActor,
  createMatteMaterial,
  createTextSign,
  startIdleMotion,
  yawToward,
} from './shared';
import type { BoxSize, Vec3 } from './shared';
import {
  getAsphaltMaterial,
  getBarkMaterial,
  getFoliageMaterial,
  getPavingMaterial,
  getPlasterMaterial,
  getWindowGlassMaterial,
} from './materials';

interface BuildingSpec {
  center: Vec3;
  size: BoxSize;
  color: number;
}

/** 两侧街楼（低饱和体块），坐标数据化 */
const BUILDINGS: BuildingSpec[] = [
  { center: { x: -7, y: 3.5, z: 6 }, size: { w: 9, h: 7, d: 9 }, color: 0x9aa3a8 },
  { center: { x: -7, y: 4.5, z: -6 }, size: { w: 9, h: 9, d: 9 }, color: 0x8f989e },
  { center: { x: -7, y: 3, z: -18 }, size: { w: 9, h: 6, d: 9 }, color: 0xa2a9ad },
  { center: { x: -7, y: 4, z: -30 }, size: { w: 9, h: 8, d: 9 }, color: 0x959da3 },
  { center: { x: 7, y: 4, z: 0 }, size: { w: 9, h: 8, d: 9 }, color: 0x949da4 },
  { center: { x: 7, y: 3.2, z: -12 }, size: { w: 9, h: 6.4, d: 9 }, color: 0xa1a8ab },
  { center: { x: 7, y: 4.8, z: -24 }, size: { w: 9, h: 9.6, d: 9 }, color: 0x8d969c },
  { center: { x: 7, y: 3.6, z: -36 }, size: { w: 9, h: 7.2, d: 9 }, color: 0x9aa1a6 },
];

/** 路灯灯柱（XZ 位置） */
const LAMP_POSTS: Array<{ x: number; z: number }> = [
  { x: -3.2, z: 10 },
  { x: 3.2, z: 0 },
  { x: -3.2, z: -10 },
  { x: 3.2, z: -20 },
  { x: -3.2, z: -30 },
];

/** 行李 + 迎新志愿者 / 新生 3D 角色组合（两人面对面自然交谈，不机械同向） */
const STREET_NPCS = [
  {
    group: { x: 4.4, z: -7 },
    greeterModel: 'volunteer',
    greeterColor: 0x8f8578,
    studentModel: 'ayuan',
    studentColor: 0x8f9aa3,
    luggage: { x: 3.6, z: -7.6 },
  },
  {
    group: { x: -4.6, z: -24 },
    greeterModel: 'volunteer',
    greeterColor: 0x867d70,
    studentModel: 'ayuan',
    studentColor: 0x93a0a8,
    luggage: { x: -5.4, z: -24.6 },
  },
] as const;

const SPAWN: SceneSpawn = { x: 0, z: 14, yaw: 0, pitchDeg: -5 };

/** 校门台阶触发区（box，居中于街道尽头） */
const STAIRS_ZONE_CENTER = { x: 0, y: 0, z: -40.5 } as const;

const TARGET_GUIDE = { x: 0, y: 2.4, z: -40.5 } as const;

function buildingObstacles(): ObstacleAabb[] {
  return BUILDINGS.map((building, index) => ({
    id: `street-building-${index}`,
    minX: building.center.x - building.size.w / 2,
    maxX: building.center.x + building.size.w / 2,
    minZ: building.center.z - building.size.d / 2,
    maxZ: building.center.z + building.size.d / 2,
    height: building.size.h,
  }));
}

const NAV: NavigationConfig = {
  groundY: 0,
  bounds: { minX: -5.5, maxX: 5.5, minZ: -45.5, maxZ: 15.5 },
  obstacles: [
    ...buildingObstacles(),
    ...LAMP_POSTS.map((post, index) => ({
      id: `street-lamp-${index}`,
      minX: post.x - 0.22,
      maxX: post.x + 0.22,
      minZ: post.z - 0.22,
      maxZ: post.z + 0.22,
      height: 4,
    })),
    ...STREET_NPCS.map((npc, index) => ({
      id: `street-npc-${index}`,
      minX: npc.group.x - 0.55,
      maxX: npc.group.x + 0.55,
      minZ: npc.group.z - 0.55,
      maxZ: npc.group.z + 0.55,
      height: 1.8,
    })),
  ],
};

interface BoxInstanceSpec {
  position: Vec3;
  scale: Vec3;
  rotation?: Vec3;
}

function createBoxInstances(
  parent: THREE.Object3D,
  name: string,
  specs: BoxInstanceSpec[],
  material: THREE.Material,
  castShadow = false,
): THREE.InstancedMesh | null {
  if (specs.length === 0) return null;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, specs.length);
  const transform = new THREE.Object3D();
  specs.forEach((spec, index) => {
    transform.position.set(spec.position.x, spec.position.y, spec.position.z);
    transform.scale.set(spec.scale.x, spec.scale.y, spec.scale.z);
    const rotation = spec.rotation ?? { x: 0, y: 0, z: 0 };
    transform.rotation.set(rotation.x, rotation.y, rotation.z);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function createCylinderInstances(
  parent: THREE.Object3D,
  name: string,
  specs: BoxInstanceSpec[],
  material: THREE.Material,
  castShadow = false,
): THREE.InstancedMesh | null {
  if (specs.length === 0) return null;
  const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 10), material, specs.length);
  const transform = new THREE.Object3D();
  specs.forEach((spec, index) => {
    transform.position.set(spec.position.x, spec.position.y, spec.position.z);
    transform.scale.set(spec.scale.x, spec.scale.y, spec.scale.z);
    const rotation = spec.rotation ?? { x: 0, y: 0, z: 0 };
    transform.rotation.set(rotation.x, rotation.y, rotation.z);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function buildStreetGround(parent: THREE.Object3D): void {
  addGround(parent, 110, 0x74867b);

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(3.3, 76),
    getAsphaltMaterial({ repeatX: 2, repeatY: 32 }),
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.006, -22.5);
  road.receiveShadow = true;
  parent.add(road);

  const paving = getPavingMaterial({ repeatX: 2, repeatY: 32 });
  for (const side of [-1, 1]) {
    const sidewalk = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 61), paving);
    sidewalk.position.set(side * 2.07, 0.02, -15);
    sidewalk.receiveShadow = true;
    parent.add(sidewalk);
  }

  const curbSpecs: BoxInstanceSpec[] = [];
  const laneSpecs: BoxInstanceSpec[] = [];
  const crosswalkSpecs: BoxInstanceSpec[] = [];
  const tactileBases: BoxInstanceSpec[] = [];
  const tactileRibs: BoxInstanceSpec[] = [];
  for (const side of [-1, 1]) {
    curbSpecs.push({
      position: { x: side * 1.57, y: 0.055, z: -15 },
      scale: { x: 0.14, y: 0.11, z: 61 },
    });
    tactileBases.push({
      position: { x: side * 1.88, y: 0.067, z: -15 },
      scale: { x: 0.27, y: 0.014, z: 59 },
    });
    for (let z = 14; z >= -44; z -= 0.38) {
      tactileRibs.push({
        position: { x: side * 1.88, y: 0.078, z },
        scale: { x: 0.22, y: 0.01, z: 0.035 },
      });
    }
  }
  for (let z = 12; z >= -36; z -= 4) {
    laneSpecs.push({ position: { x: 0, y: 0.014, z }, scale: { x: 0.11, y: 0.012, z: 1.6 } });
  }
  for (let index = 0; index < 7; index += 1) {
    crosswalkSpecs.push({
      position: { x: -1.35 + index * 0.45, y: 0.016, z: -38.6 },
      scale: { x: 0.24, y: 0.014, z: 2.15 },
    });
  }
  const paint = createMatteMaterial(0xd8d3c4, 0.76);
  createBoxInstances(parent, 'street-curbs', curbSpecs, createMatteMaterial(0xaaa99f));
  createBoxInstances(parent, 'street-lane-dashes', laneSpecs, paint);
  createBoxInstances(parent, 'street-crosswalk', crosswalkSpecs, paint);
  createBoxInstances(parent, 'street-tactile-bases', tactileBases, createMatteMaterial(0xc8a83f, 0.82));
  createBoxInstances(parent, 'street-tactile-ribs', tactileRibs, createMatteMaterial(0xe0be52, 0.78));

  const drainBases: BoxInstanceSpec[] = [];
  const drainBars: BoxInstanceSpec[] = [];
  const guardPosts: BoxInstanceSpec[] = [];
  const guardRails: BoxInstanceSpec[] = [];
  for (const side of [-1, 1]) {
    for (const z of [8, -8, -24, -36]) {
      const x = side * 1.43;
      drainBases.push({ position: { x, y: 0.016, z }, scale: { x: 0.28, y: 0.018, z: 0.52 } });
      for (let index = 0; index < 6; index += 1) {
        drainBars.push({
          position: { x: x - 0.11 + index * 0.044, y: 0.03, z },
          scale: { x: 0.017, y: 0.018, z: 0.46 },
        });
      }
    }
    for (const centerZ of [-3, -29]) {
      guardRails.push({
        position: { x: side * 1.64, y: 0.46, z: centerZ },
        scale: { x: 0.045, y: 0.055, z: 3.4 },
      });
      for (const offsetZ of [-1.55, 0, 1.55]) {
        guardPosts.push({
          position: { x: side * 1.64, y: 0.27, z: centerZ + offsetZ },
          scale: { x: 0.045, y: 0.48, z: 0.045 },
        });
      }
    }
  }
  createBoxInstances(parent, 'street-drain-bases', drainBases, createMatteMaterial(0x252f33));
  createBoxInstances(parent, 'street-drain-bars', drainBars, createMatteMaterial(0x657273, 0.45));
  createBoxInstances(parent, 'street-guard-posts', guardPosts, createMatteMaterial(0x6f7e80, 0.45));
  createBoxInstances(parent, 'street-guard-rails', guardRails, createMatteMaterial(0x879497, 0.4));

  const bollards: BoxInstanceSpec[] = [];
  const bollardBands: BoxInstanceSpec[] = [];
  for (const side of [-1, 1]) {
    for (const z of [-36.9, -40.2]) {
      bollards.push({
        position: { x: side * 1.4, y: 0.35, z },
        scale: { x: 0.055, y: 0.7, z: 0.055 },
      });
      for (const y of [0.25, 0.47]) {
        bollardBands.push({
          position: { x: side * 1.4, y, z },
          scale: { x: 0.058, y: 0.11, z: 0.058 },
        });
      }
    }
  }
  createCylinderInstances(parent, 'street-bollards', bollards, createMatteMaterial(0x293033, 0.48), true);
  createCylinderInstances(parent, 'street-bollard-bands', bollardBands, createMatteMaterial(0xe1b746, 0.55));

  const manhole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 0.022, 24),
    createMatteMaterial(0x465256, 0.42),
  );
  manhole.position.set(-0.78, 0.02, -17.5);
  parent.add(manhole);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.29, 0.012, 5, 24),
    createMatteMaterial(0x788487, 0.38),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(-0.78, 0.035, -17.5);
  parent.add(ring);
}

function buildStreetBuildings(parent: THREE.Object3D, occluders: THREE.Object3D[]): void {
  const wallMaterial = getPlasterMaterial({ repeatX: 3, repeatY: 2 });
  const glassMaterial = getWindowGlassMaterial();
  const frameMaterial = createMatteMaterial(0x4d5d61, 0.72);
  const trimMaterial = createMatteMaterial(0xaaa89e, 0.84);
  const metalMaterial = createMatteMaterial(0x58696c, 0.52);
  const awningMaterial = createMatteMaterial(0x526f68, 0.78);
  const stripeMaterial = createMatteMaterial(0xd7ceb5, 0.82);
  const copperMaterial = new THREE.MeshStandardMaterial({ color: 0x9a6c4d, roughness: 0.48, metalness: 0.55 });
  const storeBackMaterial = new THREE.MeshStandardMaterial({
    color: 0x8b694b,
    emissive: 0xffb96f,
    emissiveIntensity: 0.42,
    roughness: 0.82,
  });
  const storeGlowMaterial = new THREE.MeshStandardMaterial({
    color: 0xffe4af,
    emissive: 0xffc77d,
    emissiveIntensity: 2.5,
    roughness: 0.46,
  });
  const shopGlassMaterial = new THREE.MeshStandardMaterial({
    color: 0xbcd4d4,
    roughness: 0.16,
    metalness: 0.12,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
  });
  const frames: BoxInstanceSpec[] = [];
  const windows: BoxInstanceSpec[] = [];
  const mullions: BoxInstanceSpec[] = [];
  const sills: BoxInstanceSpec[] = [];
  const balconies: BoxInstanceSpec[] = [];
  const rails: BoxInstanceSpec[] = [];
  const airConditioners: BoxInstanceSpec[] = [];
  const acGrilles: BoxInstanceSpec[] = [];
  const awnings: BoxInstanceSpec[] = [];
  const awningStripes: BoxInstanceSpec[] = [];
  const valances: BoxInstanceSpec[] = [];
  const parapets: BoxInstanceSpec[] = [];
  const downpipes: BoxInstanceSpec[] = [];
  const storeFrames: BoxInstanceSpec[] = [];
  const shelves: BoxInstanceSpec[] = [];
  const goodsWarm: BoxInstanceSpec[] = [];
  const goodsCool: BoxInstanceSpec[] = [];
  const goodsLight: BoxInstanceSpec[] = [];
  const ceilingLights: BoxInstanceSpec[] = [];
  const shopNames = ['便利店', '早餐', '文具', '便利店', '早餐', '便利店', '便利店', '早餐'];
  const signBackgrounds = ['#f3d69b', '#efd0a1', '#e6d9b7', '#f0c995'];

  for (const [index, building] of BUILDINGS.entries()) {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(building.size.w, building.size.h, building.size.d),
      wallMaterial,
    );
    wall.position.set(building.center.x, building.center.y, building.center.z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    parent.add(wall);
    occluders.push(wall);

    const side = building.center.x > 0 ? -1 : 1;
    const faceX = building.center.x + side * 4.5;
    addBox(
      parent,
      { x: faceX + side * 0.018, y: 0.45, z: building.center.z },
      { w: 0.04, h: 0.9, d: 8.92 },
      building.color,
      { castShadow: false },
    );

    parapets.push(
      {
        position: { x: building.center.x, y: building.size.h + 0.17, z: building.center.z - 4.42 },
        scale: { x: 9, y: 0.34, z: 0.16 },
      },
      {
        position: { x: building.center.x, y: building.size.h + 0.17, z: building.center.z + 4.42 },
        scale: { x: 9, y: 0.34, z: 0.16 },
      },
      {
        position: { x: building.center.x - 4.42, y: building.size.h + 0.17, z: building.center.z },
        scale: { x: 0.16, y: 0.34, z: 9 },
      },
      {
        position: { x: building.center.x + 4.42, y: building.size.h + 0.17, z: building.center.z },
        scale: { x: 0.16, y: 0.34, z: 9 },
      },
    );
    for (const offsetZ of [-4.02, 4.02]) {
      downpipes.push({
        position: { x: faceX + side * 0.13, y: building.size.h / 2, z: building.center.z + offsetZ },
        scale: { x: 0.035, y: building.size.h, z: 0.035 },
      });
    }

    for (const offsetZ of [-2.65, 0, 2.65]) {
      for (const y of [3.25, 4.95, 6.65, 8.35]) {
        if (y + 0.62 >= building.size.h) continue;
        const z = building.center.z + offsetZ;
        frames.push({
          position: { x: faceX + side * 0.024, y, z },
          scale: { x: 0.045, y: 1.18, z: 1.1 },
        });
        windows.push({
          position: { x: faceX + side * 0.055, y, z },
          scale: { x: 0.035, y: 1.02, z: 0.9 },
        });
        mullions.push(
          {
            position: { x: faceX + side * 0.08, y, z },
            scale: { x: 0.025, y: 1.03, z: 0.035 },
          },
          {
            position: { x: faceX + side * 0.08, y, z },
            scale: { x: 0.025, y: 0.035, z: 0.9 },
          },
        );
        sills.push({
          position: { x: faceX + side * 0.11, y: y - 0.61, z },
          scale: { x: 0.24, y: 0.07, z: 1.14 },
        });
      }
    }

    const storeBack = new THREE.Mesh(new THREE.BoxGeometry(0.045, 1.52, 2.72), storeBackMaterial);
    storeBack.position.set(faceX + side * 0.04, 0.9, building.center.z);
    parent.add(storeBack);
    const shopGlass = new THREE.Mesh(new THREE.BoxGeometry(0.018, 1.48, 2.66), shopGlassMaterial);
    shopGlass.position.set(faceX + side * 0.41, 0.9, building.center.z);
    shopGlass.renderOrder = 2;
    parent.add(shopGlass);
    for (const offsetZ of [-1.36, 0, 1.36]) {
      storeFrames.push({
        position: { x: faceX + side * 0.43, y: 0.9, z: building.center.z + offsetZ },
        scale: { x: 0.055, y: 1.56, z: 0.055 },
      });
    }
    for (const y of [0.18, 1.64]) {
      storeFrames.push({
        position: { x: faceX + side * 0.43, y, z: building.center.z },
        scale: { x: 0.055, y: 0.055, z: 2.76 },
      });
    }
    for (const shelfY of [0.48, 0.87, 1.25]) {
      shelves.push({
        position: { x: faceX + side * 0.19, y: shelfY, z: building.center.z },
        scale: { x: 0.28, y: 0.055, z: 2.28 },
      });
      for (let item = 0; item < 10; item += 1) {
        const target = (item + index) % 3 === 0 ? goodsWarm : (item + index) % 3 === 1 ? goodsCool : goodsLight;
        target.push({
          position: {
            x: faceX + side * 0.3,
            y: shelfY + 0.13,
            z: building.center.z - 1.02 + item * 0.225,
          },
          scale: { x: 0.13, y: 0.2 + (item % 2) * 0.045, z: 0.13 },
        });
      }
    }
    ceilingLights.push({
      position: { x: faceX + side * 0.22, y: 1.57, z: building.center.z },
      scale: { x: 0.14, y: 0.045, z: 1.72 },
    });

    if (index === 1 || index === 3 || index === 5 || index === 6) {
      const z = building.center.z;
      balconies.push({
        position: { x: faceX + side * 0.36, y: 2.58, z },
        scale: { x: 0.72, y: 0.09, z: 2.2 },
      });
      for (let railIndex = 0; railIndex < 8; railIndex += 1) {
        rails.push({
          position: { x: faceX + side * 0.72, y: 2.9, z: z - 1.02 + railIndex * 0.29 },
          scale: { x: 0.035, y: 0.54, z: 0.035 },
        });
      }
      rails.push({
        position: { x: faceX + side * 0.72, y: 3.18, z },
        scale: { x: 0.05, y: 0.045, z: 2.18 },
      });
      for (const end of [-1, 1]) {
        rails.push({
          position: { x: faceX + side * 0.37, y: 3.18, z: z + end * 1.06 },
          scale: { x: 0.7, y: 0.045, z: 0.04 },
        });
      }
    }

    const acY = Math.min(building.size.h - 0.7, 4.15);
    const acZ = building.center.z + 1.35;
    airConditioners.push({
      position: { x: faceX + side * 0.2, y: acY, z: acZ },
      scale: { x: 0.36, y: 0.38, z: 0.58 },
    });
    for (const offsetY of [-0.1, 0, 0.1]) {
      acGrilles.push({
        position: { x: faceX + side * 0.39, y: acY + offsetY, z: acZ },
        scale: { x: 0.018, y: 0.025, z: 0.45 },
      });
    }
    const acPipe = new THREE.CatmullRomCurve3([
      new THREE.Vector3(faceX + side * 0.36, acY - 0.12, acZ + 0.2),
      new THREE.Vector3(faceX + side * 0.45, acY - 0.42, acZ + 0.32),
      new THREE.Vector3(faceX + side * 0.16, acY - 0.7, acZ + 0.5),
    ]);
    parent.add(new THREE.Mesh(new THREE.TubeGeometry(acPipe, 8, 0.012, 4, false), copperMaterial));

    awnings.push({
      position: { x: faceX + side * 0.41, y: 2.35, z: building.center.z },
      scale: { x: 0.84, y: 0.07, z: 2.78 },
      rotation: { x: 0, y: 0, z: -side * 0.12 },
    });
    for (let stripe = -3; stripe <= 3; stripe += 2) {
      awningStripes.push({
        position: { x: faceX + side * 0.41, y: 2.39, z: building.center.z + stripe * 0.36 },
        scale: { x: 0.84, y: 0.018, z: 0.18 },
        rotation: { x: 0, y: 0, z: -side * 0.12 },
      });
    }
    valances.push({
      position: { x: faceX + side * 0.81, y: 2.25, z: building.center.z },
      scale: { x: 0.055, y: 0.18, z: 2.78 },
    });
    for (const end of [-1, 1]) {
      addTubeBetween(
        parent,
        { x: faceX + side * 0.08, y: 1.96, z: building.center.z + end * 1.18 },
        { x: faceX + side * 0.78, y: 2.28, z: building.center.z + end * 1.18 },
        0.016,
        metalMaterial,
      );
    }

    addBox(
      parent,
      { x: faceX + side * 0.09, y: 1.84, z: building.center.z },
      { w: 0.14, h: 0.54, d: 1.98 },
      0xd9b67c,
      { castShadow: false },
    );
    const sign = createTextSign(shopNames[index], 1.8, 0.46, {
      background: signBackgrounds[index % signBackgrounds.length],
      foreground: '#5b5140',
    });
    sign.position.set(faceX + side * 0.17, 1.84, building.center.z);
    sign.rotation.y = side * Math.PI / 2;
    sign.castShadow = false;
    if (sign.material instanceof THREE.MeshStandardMaterial) {
      sign.material.emissive.set(0xffc27a);
      sign.material.emissiveMap = sign.material.map;
      sign.material.emissiveIntensity = 0.72;
    }
    parent.add(sign);

    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    if ((index === 0 || index === 4 || index === 5) && (!coarsePointer || index === 5)) {
      const light = new THREE.PointLight(0xffb866, 7, 4.6, 2);
      light.position.set(faceX + side * 0.9, 1.3, building.center.z);
      parent.add(light);
    }
  }

  createBoxInstances(parent, 'street-window-recesses', frames, frameMaterial);
  createBoxInstances(parent, 'street-window-glass', windows, glassMaterial);
  createBoxInstances(parent, 'street-window-mullions', mullions, trimMaterial);
  createBoxInstances(parent, 'street-window-sills', sills, trimMaterial);
  createBoxInstances(parent, 'street-balcony-slabs', balconies, trimMaterial, true);
  createBoxInstances(parent, 'street-balcony-rails', rails, metalMaterial);
  createBoxInstances(parent, 'street-ac-units', airConditioners, createMatteMaterial(0xaeb4ae, 0.65), true);
  createBoxInstances(parent, 'street-ac-grilles', acGrilles, frameMaterial);
  createBoxInstances(parent, 'street-shop-awnings', awnings, awningMaterial, true);
  createBoxInstances(parent, 'street-shop-awning-stripes', awningStripes, stripeMaterial);
  createBoxInstances(parent, 'street-shop-valances', valances, awningMaterial);
  createBoxInstances(parent, 'street-roof-parapets', parapets, trimMaterial, true);
  createCylinderInstances(parent, 'street-downpipes', downpipes, frameMaterial, true);
  createBoxInstances(parent, 'street-store-frames', storeFrames, frameMaterial);
  createBoxInstances(parent, 'street-store-shelves', shelves, createMatteMaterial(0x8c7357, 0.76));
  createBoxInstances(parent, 'street-store-goods-warm', goodsWarm, createMatteMaterial(0xc98462, 0.7));
  createBoxInstances(parent, 'street-store-goods-cool', goodsCool, createMatteMaterial(0x6e9b9a, 0.68));
  createBoxInstances(parent, 'street-store-goods-light', goodsLight, createMatteMaterial(0xd6bd75, 0.72));
  createBoxInstances(parent, 'street-store-ceiling-lights', ceilingLights, storeGlowMaterial);
}

function buildVendingMachines(parent: THREE.Object3D): void {
  const glass = new THREE.MeshStandardMaterial({
    color: 0xa8c9cd,
    roughness: 0.16,
    metalness: 0.1,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
  });
  const panel = new THREE.MeshStandardMaterial({
    color: 0x34565c,
    emissive: 0x5f9b9b,
    emissiveIntensity: 0.5,
    roughness: 0.42,
  });
  const drinkColors = [0xe78a68, 0x78a9a0, 0xe2c064, 0x88a8c1];

  for (const buildingIndex of [0, 4, 5]) {
    const building = BUILDINGS[buildingIndex];
    const side = building.center.x > 0 ? -1 : 1;
    const faceX = building.center.x + side * 4.5;
    const z = building.center.z + 2.25;
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: buildingIndex === 4 ? 0xb76850 : 0x4f817d,
      roughness: 0.5,
      metalness: 0.28,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 1.55, 0.78), bodyMaterial);
    body.position.set(faceX + side * 0.28, 0.82, z);
    body.castShadow = true;
    parent.add(body);

    const display = new THREE.Mesh(new THREE.BoxGeometry(0.018, 1.03, 0.58), panel);
    display.position.set(faceX + side * 0.52, 0.91, z);
    parent.add(display);
    const drinks = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.035, 0.14, 0.1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.38, metalness: 0.18 }),
      12,
    );
    const transform = new THREE.Object3D();
    for (let index = 0; index < 12; index += 1) {
      const row = Math.floor(index / 4);
      const column = index % 4;
      transform.position.set(
        faceX + side * 0.54,
        0.58 + row * 0.29,
        z - 0.21 + column * 0.14,
      );
      transform.updateMatrix();
      drinks.setMatrixAt(index, transform.matrix);
      drinks.setColorAt(index, new THREE.Color(drinkColors[(index + buildingIndex) % drinkColors.length]));
    }
    drinks.instanceMatrix.needsUpdate = true;
    if (drinks.instanceColor) drinks.instanceColor.needsUpdate = true;
    parent.add(drinks);

    const front = new THREE.Mesh(new THREE.BoxGeometry(0.012, 1.04, 0.6), glass);
    front.position.set(faceX + side * 0.565, 0.91, z);
    front.renderOrder = 3;
    parent.add(front);
    const lightBar = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, 0.09, 0.62),
      new THREE.MeshStandardMaterial({
        color: 0xffd8a0,
        emissive: buildingIndex === 4 ? 0xff9c66 : 0x8fd6c8,
        emissiveIntensity: 1.8,
        roughness: 0.45,
      }),
    );
    lightBar.position.set(faceX + side * 0.54, 1.52, z);
    parent.add(lightBar);
  }
}

function buildStreetTrees(parent: THREE.Object3D): void {
  const trees = [
    { x: -1.9, z: 9 },
    { x: 1.9, z: 3 },
    { x: -1.9, z: -14 },
    { x: 1.9, z: -27 },
  ];
  const clusterOffsets = [
    { x: -0.24, y: 2.38, z: -0.22, s: 0.42 },
    { x: 0.18, y: 2.45, z: 0.24, s: 0.5 },
    { x: -0.08, y: 2.62, z: 0.38, s: 0.43 },
    { x: 0.25, y: 2.72, z: -0.28, s: 0.46 },
    { x: -0.3, y: 2.83, z: 0.12, s: 0.38 },
    { x: 0.04, y: 2.94, z: -0.04, s: 0.52 },
    { x: 0.32, y: 3.08, z: 0.18, s: 0.36 },
    { x: -0.2, y: 3.18, z: -0.25, s: 0.4 },
    { x: 0.08, y: 3.38, z: 0.1, s: 0.38 },
    { x: -0.04, y: 3.55, z: -0.06, s: 0.28 },
  ];
  const pitBorders: BoxInstanceSpec[] = [];
  const bark = getBarkMaterial({ repeatX: 2, repeatY: 3 });
  const crowns = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    getFoliageMaterial({ repeatX: 2, repeatY: 2 }),
    trees.length * clusterOffsets.length,
  );
  const transform = new THREE.Object3D();
  let crownIndex = 0;

  for (const [treeIndex, tree] of trees.entries()) {
    addBox(parent, { x: tree.x, y: 0.065, z: tree.z }, { w: 0.62, h: 0.035, d: 0.7 }, 0x514c3e, {
      castShadow: false,
    });
    for (const side of [-1, 1]) {
      pitBorders.push(
        {
          position: { x: tree.x + side * 0.34, y: 0.1, z: tree.z },
          scale: { x: 0.06, y: 0.1, z: 0.76 },
        },
        {
          position: { x: tree.x, y: 0.1, z: tree.z + side * 0.38 },
          scale: { x: 0.74, y: 0.1, z: 0.06 },
        },
      );
    }
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.12, 2.25, 9), bark);
    trunk.position.set(tree.x, 1.17, tree.z);
    trunk.castShadow = true;
    parent.add(trunk);

    const inward = tree.x > 0 ? -1 : 1;
    for (const branch of [
      { x: inward * 0.27, y: 2.6, z: -0.25 },
      { x: -inward * 0.18, y: 2.75, z: 0.28 },
      { x: inward * 0.12, y: 3.02, z: 0.08 },
    ]) {
      addTubeBetween(
        parent,
        { x: tree.x, y: 1.55, z: tree.z },
        { x: tree.x + branch.x, y: branch.y, z: tree.z + branch.z },
        0.032,
        bark,
      );
    }

    for (const [clusterIndex, cluster] of clusterOffsets.entries()) {
      const scale = cluster.s * (0.92 + ((treeIndex + clusterIndex) % 4) * 0.055);
      transform.position.set(tree.x + cluster.x * inward, cluster.y, tree.z + cluster.z);
      transform.scale.set(scale * 0.88, scale, scale * 1.08);
      transform.rotation.set(clusterIndex * 0.31, treeIndex * 0.72 + clusterIndex * 0.47, 0.1);
      transform.updateMatrix();
      crowns.setMatrixAt(crownIndex, transform.matrix);
      const palette = [0x6d8564, 0x7f936d, 0x91a174, 0x627c62];
      crowns.setColorAt(crownIndex, new THREE.Color(palette[(treeIndex + clusterIndex) % palette.length]));
      crownIndex += 1;
    }
  }

  createBoxInstances(parent, 'street-tree-pit-borders', pitBorders, createMatteMaterial(0x99998e));
  crowns.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  crowns.name = 'street-tree-leaf-clusters';
  crowns.castShadow = true;
  crowns.receiveShadow = true;
  parent.add(crowns);
}

function buildStreetLamps(parent: THREE.Object3D, occluders: THREE.Object3D[]): void {
  const metal = new THREE.MeshStandardMaterial({ color: 0x626c70, roughness: 0.68, metalness: 0.32 });
  const shadeMaterial = createMatteMaterial(0x717a76, 0.72);
  const glowMaterial = new THREE.MeshStandardMaterial({
    color: 0xffe1a8,
    emissive: 0xffc875,
    emissiveIntensity: 1.8,
    roughness: 0.5,
    metalness: 0,
  });
  for (const post of LAMP_POSTS) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 4, 8), metal);
    pole.position.set(post.x, 2, post.z);
    pole.castShadow = true;
    parent.add(pole);
    occluders.push(pole);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.18, 8), metal);
    base.position.set(post.x, 0.09, post.z);
    parent.add(base);
    const headX = post.x - Math.sign(post.x) * 1.15;
    addTubeBetween(
      parent,
      { x: post.x, y: 4.02, z: post.z },
      { x: headX, y: 4.02, z: post.z },
      0.025,
      metal,
    );
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.22, 0.18, 10, 1, true), shadeMaterial);
    shade.position.set(headX, 4.1, post.z);
    parent.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 7), glowMaterial);
    bulb.position.set(headX, 3.99, post.z);
    parent.add(bulb);
  }
}

function addTubeBetween(
  parent: THREE.Object3D,
  from: Vec3,
  to: Vec3,
  radius: number,
  material: THREE.Material,
): void {
  const start = new THREE.Vector3(from.x, from.y, from.z);
  const end = new THREE.Vector3(to.x, to.y, to.z);
  const direction = end.clone().sub(start);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 6), material);
  tube.position.copy(start).add(end).multiplyScalar(0.5);
  tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  tube.castShadow = true;
  parent.add(tube);
}

function buildUtilityPoles(parent: THREE.Object3D): void {
  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x4a5150, roughness: 0.78, metalness: 0.08 });
  const wireMaterial = new THREE.MeshBasicMaterial({ color: 0x263238 });
  const ceramicMaterial = new THREE.MeshStandardMaterial({ color: 0xa9c0bd, roughness: 0.3, metalness: 0.08 });
  const yellowMaterial = createMatteMaterial(0xd8ae38, 0.58);
  const blackMaterial = createMatteMaterial(0x252b2c, 0.62);
  const poles: BoxInstanceSpec[] = [];
  const crossarms: BoxInstanceSpec[] = [];
  const insulators: BoxInstanceSpec[] = [];
  const yellowBands: BoxInstanceSpec[] = [];
  const blackBands: BoxInstanceSpec[] = [];
  const zPositions = [11, -5, -21, -37];

  for (const side of [-1, 1]) {
    const x = side * 2.3;
    for (const z of zPositions) {
      poles.push({ position: { x, y: 3.1, z }, scale: { x: 0.072, y: 6.2, z: 0.072 } });
      crossarms.push({ position: { x, y: 5.72, z }, scale: { x: 0.9, y: 0.075, z: 0.09 } });
      for (const offsetX of [-0.32, 0.32]) {
        insulators.push({
          position: { x: x + offsetX, y: 5.84, z },
          scale: { x: 0.045, y: 0.16, z: 0.045 },
        });
      }
      for (let band = 0; band < 6; band += 1) {
        const target = band % 2 === 0 ? yellowBands : blackBands;
        target.push({
          position: { x, y: 0.24 + band * 0.17, z },
          scale: { x: 0.085, y: 0.17, z: 0.085 },
        });
      }
    }

    for (let span = 0; span < zPositions.length - 1; span += 1) {
      for (const offsetX of [-0.32, 0.32]) {
        const startZ = zPositions[span];
        const endZ = zPositions[span + 1];
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(x + offsetX, 5.92, startZ),
          new THREE.Vector3(x + offsetX, 5.48, startZ * 0.66 + endZ * 0.34),
          new THREE.Vector3(x + offsetX, 5.48, startZ * 0.34 + endZ * 0.66),
          new THREE.Vector3(x + offsetX, 5.92, endZ),
        ]);
        parent.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.008, 3, false), wireMaterial));
      }
    }
  }

  for (const z of [-5, -21]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-2.62, 5.75, z),
      new THREE.Vector3(0, 5.08, z + 0.25),
      new THREE.Vector3(2.62, 5.75, z),
    ]);
    parent.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.007, 3, false), wireMaterial));
  }

  createCylinderInstances(parent, 'street-utility-poles', poles, poleMaterial, true);
  createBoxInstances(parent, 'street-utility-crossarms', crossarms, poleMaterial, true);
  createCylinderInstances(parent, 'street-utility-insulators', insulators, ceramicMaterial);
  createCylinderInstances(parent, 'street-utility-yellow-bands', yellowBands, yellowMaterial);
  createCylinderInstances(parent, 'street-utility-black-bands', blackBands, blackMaterial);
}

function buildStreetProps(parent: THREE.Object3D): void {
  const binMaterial = createMatteMaterial(0x596c67, 0.82);
  const lidMaterial = createMatteMaterial(0x465650, 0.76);
  for (const position of [
    { x: -2.08, z: 4 },
    { x: 2.08, z: -18 },
    { x: -2.08, z: -33 },
  ]) {
    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.48, 10), binMaterial);
    bin.position.set(position.x, 0.3, position.z);
    bin.castShadow = true;
    parent.add(bin);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 10), lidMaterial);
    lid.position.set(position.x, 0.57, position.z);
    parent.add(lid);
  }

  const bicycleMaterial = new THREE.MeshStandardMaterial({ color: 0x6d8583, roughness: 0.62, metalness: 0.3 });
  const tireMaterial = createMatteMaterial(0x303638, 0.88);
  const wheelGeometry = new THREE.TorusGeometry(0.31, 0.024, 6, 18);
  for (const z of [5.95, 7.05]) {
    const wheel = new THREE.Mesh(wheelGeometry, tireMaterial);
    wheel.rotation.y = Math.PI / 2;
    wheel.position.set(2.08, 0.38, z);
    wheel.castShadow = true;
    parent.add(wheel);
  }
  const rear = { x: 2.08, y: 0.38, z: 7.05 };
  const front = { x: 2.08, y: 0.38, z: 5.95 };
  const crank = { x: 2.08, y: 0.44, z: 6.55 };
  const seat = { x: 2.08, y: 0.88, z: 6.75 };
  const handle = { x: 2.08, y: 0.92, z: 6.12 };
  for (const [from, to] of [
    [rear, crank],
    [crank, front],
    [crank, seat],
    [seat, rear],
    [seat, handle],
    [handle, front],
  ] as const) {
    addTubeBetween(parent, from, to, 0.018, bicycleMaterial);
  }
  addBox(parent, { x: 2.08, y: 0.91, z: 6.78 }, { w: 0.16, h: 0.045, d: 0.25 }, 0x3f4646);
  addTubeBetween(
    parent,
    { x: 1.94, y: 0.98, z: 6.08 },
    { x: 2.22, y: 0.98, z: 6.08 },
    0.015,
    bicycleMaterial,
  );

  const signPole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.8, 7), bicycleMaterial);
  signPole.position.set(-2.1, 0.96, -34);
  parent.add(signPole);
  const trafficSign = createTextSign('学校区域', 0.74, 0.34, {
    background: '#687d86',
    foreground: '#f1ede2',
  });
  trafficSign.position.set(-2.1, 1.86, -34);
  trafficSign.castShadow = false;
  parent.add(trafficSign);
}

function buildStreetFarEnclosure(parent: THREE.Object3D, occluders: THREE.Object3D[]): void {
  const wallMaterial = getPlasterMaterial({ repeatX: 3, repeatY: 1 });
  const campusGround = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 55),
    createMatteMaterial(0x718276, 0.96),
  );
  campusGround.rotation.x = -Math.PI / 2;
  campusGround.position.set(0, -0.015, -57);
  campusGround.receiveShadow = true;
  parent.add(campusGround);
  const campusPath = new THREE.Mesh(
    new THREE.PlaneGeometry(5.4, 26),
    getPavingMaterial({ repeatX: 4, repeatY: 18 }),
  );
  campusPath.rotation.x = -Math.PI / 2;
  campusPath.position.set(0, 0.008, -56.5);
  campusPath.receiveShadow = true;
  parent.add(campusPath);

  const sidePillars: BoxInstanceSpec[] = [];
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(8.6, 2.5, 0.36), wallMaterial);
    wall.position.set(side * 6.25, 1.25, -44.85);
    wall.castShadow = true;
    wall.receiveShadow = true;
    parent.add(wall);
    occluders.push(wall);
    addBox(parent, { x: side * 6.25, y: 2.55, z: -44.85 }, { w: 8.75, h: 0.12, d: 0.48 }, 0x969c96);

    addBox(
      parent,
      { x: side * 5.85, y: 0.72, z: -14.5 },
      { w: 0.28, h: 1.44, d: 61 },
      0x87958b,
      { castShadow: true },
    );
    addBox(
      parent,
      { x: side * 5.85, y: 1.47, z: -14.5 },
      { w: 0.38, h: 0.09, d: 61 },
      0xa3aaa0,
      { castShadow: false },
    );
    for (let z = 14; z >= -44; z -= 5.8) {
      sidePillars.push({
        position: { x: side * 5.85, y: 0.88, z },
        scale: { x: 0.48, y: 1.76, z: 0.48 },
      });
    }
  }
  createBoxInstances(parent, 'street-side-wall-pillars', sidePillars, createMatteMaterial(0x919b91), true);

  const sideWings = [
    { center: { x: -11, y: 4.5, z: 13 }, size: { w: 9, h: 9, d: 11 } },
    { center: { x: 11, y: 5, z: 12 }, size: { w: 9, h: 10, d: 13 } },
    { center: { x: -13, y: 5.5, z: -15 }, size: { w: 10, h: 11, d: 18 } },
    { center: { x: 13, y: 4.5, z: -18 }, size: { w: 10, h: 9, d: 17 } },
    { center: { x: -12, y: 5, z: -42 }, size: { w: 11, h: 10, d: 15 } },
    { center: { x: 12, y: 6, z: -43 }, size: { w: 11, h: 12, d: 16 } },
  ];
  for (const wing of sideWings) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(wing.size.w, wing.size.h, wing.size.d), wallMaterial);
    mesh.position.set(wing.center.x, wing.center.y, wing.center.z);
    mesh.receiveShadow = true;
    parent.add(mesh);
    addBox(
      parent,
      { x: wing.center.x, y: wing.size.h + 0.16, z: wing.center.z },
      { w: wing.size.w + 0.25, h: 0.32, d: wing.size.d + 0.25 },
      0x7d8b86,
      { castShadow: false },
    );
  }

  const school = new THREE.Mesh(new THREE.BoxGeometry(22, 10, 8), wallMaterial);
  school.position.set(0, 5, -65);
  school.receiveShadow = true;
  parent.add(school);
  addBox(parent, { x: 0, y: 10.25, z: -65 }, { w: 22.6, h: 0.5, d: 8.6 }, 0x778c91, {
    castShadow: false,
  });
  addBox(parent, { x: 0, y: 1.1, z: -60.94 }, { w: 3.2, h: 2.2, d: 0.12 }, 0x536f75, {
    castShadow: false,
  });
  const schoolWindows: BoxInstanceSpec[] = [];
  for (const x of [-8.5, -6, -3.5, 3.5, 6, 8.5]) {
    for (const y of [2.3, 4.5, 6.7, 8.5]) {
      schoolWindows.push({
        position: { x, y, z: -60.94 },
        scale: { x: 1.15, y: 1.25, z: 0.08 },
      });
    }
  }
  createBoxInstances(parent, 'street-distant-school-windows', schoolWindows, getWindowGlassMaterial());

  const silhouettes = [
    { center: { x: -16, y: 5, z: -57 }, size: { w: 10, h: 10, d: 10 }, color: 0x718b8d },
    { center: { x: 16, y: 6, z: -60 }, size: { w: 11, h: 12, d: 10 }, color: 0x7c9294 },
    { center: { x: 0, y: 6, z: -79 }, size: { w: 18, h: 12, d: 8 }, color: 0x879c9c },
  ];
  for (const building of silhouettes) {
    addBox(parent, building.center, building.size, building.color, { castShadow: false });
  }

  occluders.push(addBox(parent, { x: -1.6, y: 2.1, z: -44.8 }, { w: 0.7, h: 4.2, d: 0.7 }, 0x7f8f92));
  occluders.push(addBox(parent, { x: 1.6, y: 2.1, z: -44.8 }, { w: 0.7, h: 4.2, d: 0.7 }, 0x7f8f92));
  occluders.push(addBox(parent, { x: 0, y: 4.15, z: -44.8 }, { w: 4.6, h: 0.5, d: 0.6 }, 0x7f8f92));
}

function buildStreetEnvironment(parent: THREE.Object3D, occluders: THREE.Object3D[]): void {
  buildStreetGround(parent);
  buildStreetBuildings(parent, occluders);
  buildVendingMachines(parent);
  buildStreetTrees(parent);
  buildStreetLamps(parent, occluders);
  buildUtilityPoles(parent);
  buildStreetProps(parent);
  buildStreetFarEnclosure(parent, occluders);
}

function buildStreet(parent: THREE.Object3D): {
  occluders: THREE.Object3D[];
  actors: Record<string, THREE.Object3D>;
} {
  const occluders: THREE.Object3D[] = [];
  const actors: Record<string, THREE.Object3D> = {};
  buildStreetEnvironment(parent, occluders);

  // 行李与迎新志愿者 / 新生（面对面交谈，站位与碰撞盒保持不变）
  for (const [index, npc] of STREET_NPCS.entries()) {
    const studentPos = { x: npc.group.x - 0.75, z: npc.group.z + 0.15 };
    const greeter = createCharacterActor(npc.greeterModel, 1.72, npc.greeterColor, {
      yaw: yawToward(npc.group, studentPos),
    });
    greeter.position.set(npc.group.x, 0, npc.group.z);
    const student = createCharacterActor(npc.studentModel, 1.62, npc.studentColor, {
      yaw: yawToward(studentPos, npc.group),
    });
    student.position.set(studentPos.x, 0, studentPos.z);
    const luggage = addBox(
      parent,
      { x: npc.luggage.x, y: 0.28, z: npc.luggage.z },
      { w: 0.55, h: 0.56, d: 0.36 },
      0x7e8696,
    );
    parent.add(greeter, student);
    occluders.push(greeter, student, luggage);
    actors[`npc-${index}-greeter`] = greeter;
    actors[`npc-${index}-student`] = student;
  }

  // 举牌放在角色右身侧并略朝向玩家，角色站位、朝向与交互数据保持不变
  const volunteer = createCharacterActor('volunteer', 1.66, 0xb08a72, { yaw: -0.3 });
  volunteer.position.set(1.95, 0, -13);
  const sign = createTextSign('新生报到 →', 1.28, 0.48);
  sign.position.set(1.18, 1.12, -12.72);
  sign.rotation.y = -0.18;
  parent.add(volunteer, sign);
  occluders.push(volunteer, sign);
  actors['sign-volunteer'] = volunteer;

  return { occluders, actors };
}

/** 手机震动预告文案（概括表达，无真实应用名） */
const VIBRATION_PREVIEWS = {
  'street-vibration-1': '迎新群：@所有人 新生报到 9:00 截止，请抓紧～',
  'street-vibration-2': '迎新群：有人@你，快看群消息。',
} as const;

const vibrationTimers: number[] = [];
/** 站立 NPC 的呼吸 / 微摆清理函数，exit 必杀避免补间泄漏 */
let idleDisposers: Array<() => void> = [];

function stopIdleMotions(): void {
  for (const dispose of idleDisposers) dispose();
  idleDisposers = [];
}

function startStreetIdleMotions(actors: Record<string, THREE.Object3D>): void {
  let index = 0;
  for (const id of [
    'npc-0-greeter',
    'npc-0-student',
    'npc-1-greeter',
    'npc-1-student',
    'sign-volunteer',
  ]) {
    const actor = actors[id];
    if (!actor) continue;
    idleDisposers.push(
      startIdleMotion(actor, {
        breathAmp: 0.005,
        swayAmp: 0.004,
        period: 2.7 + index * 0.27,
      }),
    );
    index += 1;
  }
}

/** S4 运行时装：进入后 4s / 26s 各震动一次（间隔 22s ≥ 20s）；离开或销毁时清空定时器 */
export const streetRuntime: SceneRuntime = {
  enter(context: SceneRuntimeContext): void {
    if (context.sceneId !== 'S4') return;
    stopIdleMotions();
    startStreetIdleMotions(context.actors);
    const schedule: Array<{ id: keyof typeof VIBRATION_PREVIEWS; delayMs: number }> = [
      { id: 'street-vibration-1', delayMs: 4000 },
      { id: 'street-vibration-2', delayMs: 26000 },
    ];
    for (const item of schedule) {
      vibrationTimers.push(
        window.setTimeout(() => {
          context.bus.emit('ui:phoneVibrate', {
            vibrationId: item.id,
            preview: VIBRATION_PREVIEWS[item.id],
          });
        }, item.delayMs),
      );
    }
  },

  exit(): void {
    stopIdleMotions();
    for (const timer of vibrationTimers) window.clearTimeout(timer);
    vibrationTimers.length = 0;
  },
};

export function createStreetDefinition(_sceneId: SceneId): WorldSceneDefinition {
  return {
    sceneKey: 'street',
    spawn: SPAWN,
    nav: NAV,
    // 进 S4 时按需预载：举牌志愿者 + 路边与新生交谈的志愿者 / 阿远
    requiredModels: ['volunteer', 'ayuan'],
    zones: [
      {
        id: 'stairs',
        kind: 'box',
        center: STAIRS_ZONE_CENTER,
        size: { x: 10, y: 3, z: 9 },
      },
    ],
    targetGuides: [{ id: 's4-gate-guide', position: TARGET_GUIDE }],
    fog: { color: 0xb9c6d2, near: 16, far: 68 },
    build: buildStreet,
  };
}
