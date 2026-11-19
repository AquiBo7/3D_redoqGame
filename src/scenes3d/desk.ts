// scenes3d/desk.ts —— S7 迎新登记帐篷与校内广场（仅表现层，不改剧情）
import * as THREE from 'three';
import type { SceneId } from '../data/storySchema';
import type { NavigationConfig, SceneRuntime, SceneRuntimeContext, SceneSpawn, WorldSceneDefinition } from '../world/worldSceneTypes';
import { SHARED_RESOURCE_FLAG } from '../world/resources';
import { createActorAnimation, createCharacterActor, createTextSign, startIdleMotion } from './shared';
import type { CharacterAnimationController } from './characterAnimation';
import { getBarkMaterial, getDocumentLabelMaterial, getFabricMaterial, getFoliageMaterial, getPavingMaterial, getPlasterMaterial, getWindowGlassMaterial } from './materials';
import { createCampusMeadow, createFoliageWindMaterial, type WindTime } from './foliageWind';

const DESK = { center: { x: 0, y: 0.4, z: -4 }, size: { w: 2.6, h: 0.8, d: 1 } } as const;
const REASON_FORM = { center: { x: 0, y: 0.83, z: -3.56 }, size: { w: 0.5, h: 0.02, d: 0.34 } } as const;
const MEDICINE_BAG = { center: { x: 1.15, y: 0.09, z: -3.15 }, size: { w: 0.3, h: 0.18, d: 0.22 } } as const;
const BACK_GATE_COLUMNS = [
  { center: { x: -1.9, y: 2.2, z: 2.6 }, size: { w: 0.7, h: 4.4, d: 0.7 } },
  { center: { x: 1.9, y: 2.2, z: 2.6 }, size: { w: 0.7, h: 4.4, d: 0.7 } },
] as const;
const STANDS = {
  volunteer: { x: 0, z: -4.68 },
  linxia: { x: 1.95, z: -3.1 },
  father: { x: 0, z: 4.8 },
} as const;
const SPAWN: SceneSpawn = { x: 0, z: -1.6, yaw: 0, pitchDeg: -6 };
const POST_X = [-1.75, 1.75];
const POST_Z = [-5.25, -3.25];
const NAV: NavigationConfig = {
  groundY: 0,
  bounds: { minX: -5, maxX: 5, minZ: -6.5, maxZ: 5.5 },
  obstacles: [
    { id: 'desk-desk', minX: -1.3, maxX: 1.3, minZ: -4.5, maxZ: -3.5, height: 0.8 },
    { id: 'desk-volunteer', minX: -0.45, maxX: 0.45, minZ: -5, maxZ: -4.35, height: 1.7 },
    { id: 'desk-linxia', minX: 1.55, maxX: 2.35, minZ: -3.5, maxZ: -2.7, height: 1.62 },
    ...BACK_GATE_COLUMNS.map((column, index) => ({
      id: `desk-column-${index}`,
      minX: column.center.x - column.size.w / 2, maxX: column.center.x + column.size.w / 2,
      minZ: column.center.z - column.size.d / 2, maxZ: column.center.z + column.size.d / 2, height: column.size.h,
    })),
    { id: 'desk-father', minX: -0.55, maxX: 0.55, minZ: 4.25, maxZ: 5.35, height: 1.78 },
    ...POST_X.flatMap((x, i) => POST_Z.map((z, j) => ({
      id: `desk-tent-post-${i}-${j}`, minX: x - 0.1, maxX: x + 0.1,
      minZ: z - 0.1, maxZ: z + 0.1, height: 3,
    }))),
    { id: 'desk-supply-box', minX: -3.25, maxX: -1.85, minZ: -4.88, maxZ: -3.62, height: 0.72 },
    { id: 'desk-welcome-stand', minX: 2.78, maxX: 3.92, minZ: -5.62, maxZ: -5.02, height: 2.15 },
  ],
};

type V3 = [number, number, number];
interface Part { p: V3; s: V3; r?: V3; color?: number }

/** 一次 build 内复用，绝不将局部几何标成全局缓存；几何释放连带释放实例 GPU 缓冲。 */
function createDetails() {
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const palette = new Map<string, THREE.MeshStandardMaterial>();
  const matte = (color: number, roughness = 0.88, metalness = 0): THREE.MeshStandardMaterial => {
    const key = `${color}:${roughness}:${metalness}`;
    let material = palette.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
      palette.set(key, material);
    }
    return material;
  };
  const box = (parent: THREE.Object3D, name: string, p: V3, s: V3, material: THREE.Material): THREE.Mesh => {
    const mesh = new THREE.Mesh(boxGeometry, material);
    mesh.name = name;
    mesh.position.set(...p);
    mesh.scale.set(...s);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const instances = (parent: THREE.Object3D, name: string, geometry: THREE.BufferGeometry,
    material: THREE.Material, parts: Part[], castShadow = true): THREE.InstancedMesh => {
    const mesh = new THREE.InstancedMesh(geometry, material, parts.length);
    const transform = new THREE.Object3D();
    parts.forEach((part, index) => {
      transform.position.set(...part.p);
      transform.scale.set(...part.s);
      transform.rotation.set(...(part.r ?? [0, 0, 0]));
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
      if (part.color !== undefined) mesh.setColorAt(index, new THREE.Color(part.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.name = name;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    if (material.userData.windTime) {
      mesh.boundingBox!.expandByScalar(0.09);
      mesh.boundingSphere!.radius += 0.09;
    }
    const release = (): void => {
      mesh.dispose();
      geometry.removeEventListener('dispose', release);
    };
    geometry.addEventListener('dispose', release);
    parent.add(mesh);
    return mesh;
  };
  const boxes = (parent: THREE.Object3D, name: string, material: THREE.Material, parts: Part[], castShadow = true) =>
    instances(parent, name, boxGeometry, material, parts, castShadow);
  const rods = (parent: THREE.Object3D, name: string, material: THREE.Material,
    segments: Array<{ a: V3; b: V3; radius: number; color?: number }>) => {
    const parts = segments.map(({ a, b, radius, color }): Part => {
      const start = new THREE.Vector3(...a);
      const end = new THREE.Vector3(...b);
      const direction = end.clone().sub(start);
      const rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion()
        .setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()));
      return { p: start.add(end).multiplyScalar(0.5).toArray() as V3,
        s: [radius, direction.length(), radius], r: [rotation.x, rotation.y, rotation.z], color };
    });
    return instances(parent, name, new THREE.CylinderGeometry(1, 1, 1, 8), material, parts);
  };
  return { matte, box, boxes, instances, rods };
}
type Details = ReturnType<typeof createDetails>;

function tint(source: THREE.MeshStandardMaterial, color: number): THREE.MeshStandardMaterial {
  const material = source.clone();
  delete material.userData[SHARED_RESOURCE_FLAG];
  material.color.setHex(color);
  return material;
}
function group(parent: THREE.Object3D, name: string): THREE.Group {
  const result = new THREE.Group();
  result.name = name;
  parent.add(result);
  return result;
}
function sign(parent: THREE.Object3D, name: string, text: string, width: number, height: number, p: V3,
  background = '#475b58', foreground = '#f1e8d2'): THREE.Mesh {
  const mesh = createTextSign(text, width, height, { background, foreground });
  mesh.name = name;
  mesh.position.set(...p);
  parent.add(mesh);
  return mesh;
}

/** 几何褶皱而非一块平盒：布纹 UV 保留，底边有自然高低与前后摆幅。 */
function drape(parent: THREE.Object3D, name: string, w: number, h: number, p: V3,
  material: THREE.Material, yaw = 0): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(w, h, Math.ceil(w * 22), 4);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const drop = (h / 2 - positions.getY(i)) / h;
    positions.setZ(i, Math.sin(x * 40) * 0.018 * (0.2 + drop));
    positions.setY(i, positions.getY(i) + Math.cos(x * 18) * 0.014 * drop * drop);
  }
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...p);
  mesh.rotation.y = yaw;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function buildTent(parent: THREE.Object3D, d: Details): THREE.Group {
  const tent = group(parent, 'desk-folding-tent');
  const metal = d.matte(0x34494a, 0.45, 0.65);
  d.boxes(tent, 'desk-tent-posts', metal, POST_X.flatMap((x) => POST_Z.map((z) => ({ p: [x, 1.5, z], s: [0.045, 3, 0.045] }))));
  d.boxes(tent, 'desk-tent-feet-and-joints', metal, POST_X.flatMap((x) => POST_Z.flatMap((z): Part[] => [
    { p: [x, 0.023, z], s: [0.18, 0.045, 0.18] },
    { p: [x, 2.88, z], s: [0.09, 0.13, 0.09] },
    { p: [x, 1.35, z], s: [0.065, 0.055, 0.065] },
  ])));
  const braces: Array<{ a: V3; b: V3; radius: number }> = [];
  for (const z of POST_Z) {
    braces.push({ a: [-1.75, 2.46, z], b: [1.75, 2.97, z], radius: 0.016 },
      { a: [-1.75, 2.97, z], b: [1.75, 2.46, z], radius: 0.016 });
  }
  for (const x of POST_X) {
    braces.push({ a: [x, 2.46, -5.25], b: [x, 2.97, -3.25], radius: 0.016 },
      { a: [x, 2.97, -5.25], b: [x, 2.46, -3.25], radius: 0.016 });
  }
  braces.push({ a: [-1.9, 3.38, -4.3], b: [1.9, 3.38, -4.3], radius: 0.022 });
  d.rods(tent, 'desk-tent-cross-braces', metal, braces);
  const green = tint(getFabricMaterial(), 0x475b58);
  const cream = tint(getFabricMaterial(), 0xe6dfca);
  green.side = cream.side = THREE.DoubleSide;
  // 两片微坡屋面，米白收边同样是有坡度的布面，而不是悬空横条。
  for (const [index, z] of [-5.55, -3.05].entries()) {
    for (const [part, x, width, material] of [
      ['green', 0, 3.7, green], ['cream-left', -1.915, 0.13, cream], ['cream-right', 1.915, 0.13, cream],
    ] as const) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        x - width / 2, 3.02, z, x + width / 2, 3.02, z,
        x + width / 2, 3.38, -4.3, x - width / 2, 3.38, -4.3,
      ], 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      geometry.setIndex([0, 1, 2, 0, 2, 3]);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `desk-tent-roof-${index}-${part}`;
      mesh.castShadow = mesh.receiveShadow = true;
      tent.add(mesh);
    }
  }
  for (const [name, width, p, yaw] of [
    ['front', 3.96, [0, 2.86, -3.05], 0], ['rear', 3.96, [0, 2.86, -5.55], Math.PI],
    ['left', 2.5, [-1.98, 2.86, -4.3], -Math.PI / 2], ['right', 2.5, [1.98, 2.86, -4.3], Math.PI / 2],
  ] as const) {
    drape(tent, `desk-tent-valance-${name}`, width, 0.32, [...p], green, yaw);
    drape(tent, `desk-tent-hem-${name}`, width, 0.055, [p[0], 2.723, p[2]], cream, yaw);
  }
  sign(tent, 'desk-registration-banner', '新生报到 · 迟到登记', 3.12, 0.26, [0, 2.875, -3.019]);
  return tent;
}

function buildTable(parent: THREE.Object3D, d: Details): THREE.Group {
  const table = group(parent, 'desk-registration-table');
  const metal = d.matte(0x536261, 0.48, 0.45);
  d.box(table, 'desk-tabletop', [DESK.center.x, 0.775, DESK.center.z], [DESK.size.w, 0.05, DESK.size.d], d.matte(0x8d7f6c));
  d.rods(table, 'desk-folding-table-legs', metal, [-1.08, 1.08].flatMap((x) => [
    { a: [x, 0.03, -3.65] as V3, b: [x, 0.75, -4.35] as V3, radius: 0.026 },
    { a: [x, 0.03, -4.35] as V3, b: [x, 0.75, -3.65] as V3, radius: 0.026 },
  ]));
  const cloth = tint(getFabricMaterial({ repeatX: 2 }), 0x748578);
  cloth.side = THREE.DoubleSide;
  d.box(table, 'desk-tablecloth-top', [0, 0.808, -4], [2.72, 0.016, 1.12], cloth);
  drape(table, 'desk-tablecloth-front', 2.72, 0.51, [0, 0.561, -3.454], cloth);
  drape(table, 'desk-tablecloth-left', 1.12, 0.51, [-1.36, 0.561, -4], cloth, -Math.PI / 2);
  drape(table, 'desk-tablecloth-right', 1.12, 0.51, [1.36, 0.561, -4], cloth, Math.PI / 2);
  const form = d.box(table, 'desk-reason-form', [REASON_FORM.center.x, REASON_FORM.center.y, REASON_FORM.center.z],
    [REASON_FORM.size.w, REASON_FORM.size.h, REASON_FORM.size.d], d.matte(0xe8e2d0));
  const printing = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.32), getDocumentLabelMaterial());
  printing.name = 'desk-form-print';
  printing.rotation.x = -Math.PI / 2;
  printing.position.set(0, 0.841, -3.56);
  table.add(printing);
  form.userData.hotspotId = 'reason-form';
  const heading = sign(table, 'desk-form-title', '迟到登记表', 0.3, 0.055, [0, 0.842, -3.67], '#e8e2d0', '#606759');
  heading.rotation.x = -Math.PI / 2;
  d.box(table, 'desk-register-book', [-0.58, 0.855, -3.62], [0.34, 0.04, 0.24], d.matte(0x7d5b52));
  d.box(table, 'desk-register-pages', [-0.58, 0.878, -3.62], [0.3, 0.006, 0.2], d.matte(0xe9e4d6));
  d.rods(table, 'desk-signature-pen', metal, [{ a: [0.255, 0.856, -3.5], b: [0.425, 0.856, -3.5], radius: 0.008 }]);
  d.boxes(table, 'desk-pen-clip-and-tip', d.matte(0xc6c9bb, 0.35, 0.65), [
    { p: [0.26, 0.856, -3.5], s: [0.012, 0.01, 0.01] }, { p: [0.385, 0.866, -3.5], s: [0.055, 0.004, 0.005] },
  ]);

  const triangle = group(table, 'desk-triangle-nameplate');
  const front = sign(triangle, 'desk-triangle-sign', '迟到登记处', 0.72, 0.272, [-0.12, 0.938, -4.14]);
  front.rotation.x = -Math.atan2(0.16, 0.22);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.272), d.matte(0xd5cfb9));
  back.material.side = THREE.DoubleSide;
  back.position.set(-0.12, 0.938, -4.3);
  back.rotation.x = Math.atan2(0.16, 0.22);
  triangle.add(back);
  d.box(triangle, 'desk-triangle-base', [-0.12, 0.825, -4.22], [0.72, 0.01, 0.32], d.matte(0xe4ddc6));

  for (const [stack, x, color] of [['teal', 0.59, 0x487d82], ['ochre', -0.76, 0xb58a46]] as const) {
    const books = group(table, `desk-guide-stack-${stack}`);
    const pages: Part[] = [];
    const covers: Part[] = [];
    for (let i = 0; i < 3; i += 1) {
      const y = 0.839 + i * 0.043;
      const px = x + (i % 2) * 0.018;
      pages.push({ p: [px, y, -4.13], s: [0.34, 0.031, 0.24] });
      covers.push({ p: [px, y - 0.018, -4.13], s: [0.36, 0.005, 0.26] },
        { p: [px, y + 0.018, -4.13], s: [0.36, 0.005, 0.26] },
        { p: [px - 0.177, y, -4.13], s: [0.006, 0.035, 0.26] });
    }
    d.boxes(books, `desk-guide-${stack}-white-pages`, d.matte(0xf1eddf), pages);
    d.boxes(books, `desk-guide-${stack}-covers`, d.matte(color), covers);
    const label = sign(books, `desk-guide-${stack}-title`, '新生报到指南', 0.29, 0.075, [x, 0.945, -4.13],
      stack === 'teal' ? '#487d82' : '#b58a46');
    label.rotation.x = -Math.PI / 2;
  }
  const holder = group(table, 'desk-stationery-holder');
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.057, 0.16, 12, 1, true), metal);
  cup.material.side = THREE.DoubleSide;
  cup.position.set(1.09, 0.902, -4.28);
  holder.add(cup);
  d.box(holder, 'desk-pen-cup-bottom', [1.09, 0.826, -4.28], [0.085, 0.008, 0.085], metal);
  d.rods(holder, 'desk-cup-stationery', d.matte(0xffffff, 0.55), Array.from({ length: 8 }, (_, i) => {
    const angle = i * 2.399;
    const x = 1.09 + Math.cos(angle) * 0.035;
    const z = -4.28 + Math.sin(angle) * 0.035;
    return { a: [x, 0.832, z] as V3, b: [x + Math.cos(angle) * 0.018, 1.085 + i % 3 * 0.025, z] as V3,
      radius: i % 3 === 0 ? 0.006 : 0.004, color: [0x3d535e, 0xc09653, 0x805c57][i % 3] };
  }));
  const flask = group(table, 'desk-volunteer-flask');
  d.instances(flask, 'desk-flask-body-and-lid', new THREE.CylinderGeometry(1, 1, 1, 16), metal, [
    { p: [-1.12, 0.958, -4.25], s: [0.065, 0.28, 0.065] },
    { p: [-1.12, 1.11, -4.25], s: [0.07, 0.024, 0.07] },
  ]);
  d.box(flask, 'desk-flask-grip', [-1.052, 0.996, -4.25], [0.032, 0.112, 0.022], metal);
  const clipboard = group(table, 'desk-volunteer-clipboard');
  d.box(clipboard, 'desk-clipboard-board', [0.47, 0.827, -4.43], [0.34, 0.016, 0.18], d.matte(0x9c815d));
  d.box(clipboard, 'desk-clipboard-paper', [0.47, 0.838, -4.43], [0.3, 0.006, 0.15], d.matte(0xeae6d7));
  d.box(clipboard, 'desk-clipboard-clip', [0.47, 0.846, -4.49], [0.09, 0.012, 0.024], metal);
  const lanyards = group(table, 'desk-lanyard-box');
  d.boxes(lanyards, 'desk-lanyard-tray', d.matte(0xd6cfb7), [
    { p: [0.96, 0.825, -3.83], s: [0.4, 0.014, 0.26] },
    { p: [0.96, 0.856, -3.963], s: [0.4, 0.062, 0.012] },
    { p: [0.96, 0.856, -3.697], s: [0.4, 0.062, 0.012] },
    { p: [0.754, 0.856, -3.83], s: [0.012, 0.062, 0.28] },
    { p: [1.166, 0.856, -3.83], s: [0.012, 0.062, 0.28] },
  ]);
  d.instances(lanyards, 'desk-lanyard-cord-loops', new THREE.TorusGeometry(0.043, 0.004, 4, 16), d.matte(0x427e79),
    Array.from({ length: 5 }, (_, i) => ({ p: [0.82 + i * 0.062, 0.84 + i * 0.004, -3.86], s: [1, 1.5, 1], r: [-Math.PI / 2, 0, 0] })));
  d.boxes(lanyards, 'desk-lanyard-cards', d.matte(0xf1ead8), Array.from({ length: 5 }, (_, i) => ({
    p: [0.82 + i * 0.062, 0.845 + i * 0.004, -3.77], s: [0.045, 0.005, 0.065],
  })));
  return table;
}

function buildSupplyBox(parent: THREE.Object3D, d: Details): THREE.Group {
  const box = group(parent, 'desk-open-supply-box');
  box.position.set(-2.55, 0, -4.25);
  const cardboard = d.matte(0xb39465);
  // 薄底 + 四壁 + 向外翻的四片箱翼，中央保留可射线穿入的真实空腔。
  d.box(box, 'desk-supply-bottom', [0, 0.025, 0], [0.88, 0.035, 0.7], cardboard);
  d.boxes(box, 'desk-supply-walls', cardboard, [
    { p: [0, 0.29, -0.35], s: [0.88, 0.53, 0.018] },
    { p: [0, 0.29, 0.35], s: [0.88, 0.53, 0.018] },
    { p: [-0.44, 0.29, 0], s: [0.018, 0.53, 0.7] },
    { p: [0.44, 0.29, 0], s: [0.018, 0.53, 0.7] },
  ]);
  d.boxes(box, 'desk-supply-open-flaps', cardboard, [
    { p: [0, 0.586, -0.475], s: [0.87, 0.012, 0.26], r: [0.23, 0, 0] },
    { p: [0, 0.586, 0.475], s: [0.87, 0.012, 0.26], r: [-0.23, 0, 0] },
    { p: [-0.565, 0.586, 0], s: [0.26, 0.012, 0.68], r: [0, 0, -0.23] },
    { p: [0.565, 0.586, 0], s: [0.26, 0.012, 0.68], r: [0, 0, 0.23] },
  ]);
  d.boxes(box, 'desk-supply-fold-seams', d.matte(0x8d754f), [
    { p: [-0.31, 0.294, 0.361], s: [0.006, 0.51, 0.003] },
    { p: [0.31, 0.294, 0.361], s: [0.006, 0.51, 0.003] },
    { p: [0, 0.062, 0.363], s: [0.86, 0.016, 0.004] },
  ]);
  d.boxes(box, 'desk-supply-packed-guide-pages', d.matte(0xece6d7), [
    { p: [-0.25, 0.105, 0], s: [0.18, 0.12, 0.39] }, { p: [0.26, 0.095, -0.09], s: [0.18, 0.1, 0.24] },
  ]);
  d.boxes(box, 'desk-supply-packed-guide-covers', d.matte(0x527b79), [
    { p: [-0.25, 0.169, 0], s: [0.2, 0.006, 0.41] }, { p: [0.26, 0.149, -0.09], s: [0.2, 0.006, 0.26] },
  ]);
  sign(box, 'desk-supply-label', '迎新物资', 0.58, 0.18, [0, 0.32, 0.365], '#d8c5a1', '#68563c');
  return box;
}

function buildWelcomeStand(parent: THREE.Object3D, d: Details): THREE.Group {
  const stand = group(parent, 'desk-welcome-rollup');
  stand.position.set(3.35, 0, -5.32);
  const metal = d.matte(0x929d96, 0.38, 0.65);
  d.instances(stand, 'desk-rollup-base', new THREE.CylinderGeometry(1, 1, 1, 12), metal,
    [{ p: [0, 0.09, 0], s: [0.075, 1.08, 0.075], r: [0, 0, Math.PI / 2] }]);
  d.boxes(stand, 'desk-rollup-feet', metal, [
    { p: [-0.3, 0.03, 0], s: [0.065, 0.05, 0.56] }, { p: [0.3, 0.03, 0], s: [0.065, 0.05, 0.56] },
    { p: [0, 2.1, 0], s: [1.02, 0.035, 0.04] },
  ]);
  d.rods(stand, 'desk-rollup-back-mast', metal, [{ a: [0, 0.12, -0.12], b: [0, 2.1, -0.12], radius: 0.012 }]);
  d.box(stand, 'desk-rollup-fabric-panel', [0, 1.13, 0], [0.97, 1.93, 0.012], d.matte(0xe4e2cc));
  sign(stand, 'desk-welcome-headline', '欢迎新同学', 0.92, 0.32, [0, 1.86, 0.012]);
  sign(stand, 'desk-welcome-subtitle', '从这里，开启新的日常', 0.88, 0.14, [0, 1.58, 0.012], '#e4e2cc', '#526961');
  sign(stand, 'desk-welcome-directions', '登记 · 领册 · 入校', 0.88, 0.16, [0, 0.37, 0.012]);
  // 印刷式校园插画：楼体、窗格、步道，避免一块空白挂牌充当精装。
  d.boxes(stand, 'desk-rollup-campus-illustration', d.matte(0x709185), [
    { p: [0, 1.03, 0.012], s: [0.56, 0.43, 0.004] },
    { p: [0, 1.27, 0.012], s: [0.67, 0.055, 0.004] },
    { p: [0, 0.74, 0.012], s: [0.2, 0.15, 0.004] },
  ]);
  d.boxes(stand, 'desk-rollup-printed-windows', d.matte(0xe8dfb8), [-0.17, 0, 0.17].flatMap((x) => [0.96, 1.11].map((y) => ({
    p: [x, y, 0.016], s: [0.075, 0.075, 0.002],
  }))));
  return stand;
}

function buildCampus(parent: THREE.Object3D, d: Details, time: WindTime): void {
  const paving = new THREE.Mesh(new THREE.PlaneGeometry(52, 48), getPavingMaterial({ repeatX: 20, repeatY: 18 }));
  paving.name = 'desk-campus-paving';
  paving.rotation.x = -Math.PI / 2;
  paving.position.z = -14;
  paving.receiveShadow = true;
  parent.add(paving);
  const seams: Part[] = [];
  for (let z = -36; z <= 8; z += 4) seams.push({ p: [0, 0.002, z], s: [50, 0.003, 0.018] });
  for (let x = -24; x <= 24; x += 4) seams.push({ p: [x, 0.002, -14], s: [0.018, 0.003, 46] });
  d.boxes(parent, 'desk-paving-inset-joints', d.matte(0x797d70), seams, false);
  const beds = group(parent, 'desk-side-planters');
  const bricks: Part[] = [];
  const caps: Part[] = [];
  for (const side of [-1, 1]) {
    const x = side * 6.5;
    d.box(beds, `desk-planter-soil-${side}`, [x, 0.14, -13], [2, 0.28, 20], d.matte(0x524a39));
    for (let row = 0; row < 3; row += 1) {
      for (let z = -22.6; z < -3; z += 0.64) {
        for (const edge of [-1.05, 1.05]) bricks.push({ p: [x + edge, 0.06 + row * 0.115, z + row % 2 * 0.12], s: [0.18, 0.105, 0.6] });
      }
      for (const z of [-23, -3]) for (let dx = -0.75; dx <= 0.8; dx += 0.5) {
        bricks.push({ p: [x + dx, 0.06 + row * 0.115, z], s: [0.48, 0.105, 0.18] });
      }
    }
    caps.push({ p: [x - 1.05, 0.36, -13], s: [0.25, 0.08, 20.2] },
      { p: [x + 1.05, 0.36, -13], s: [0.25, 0.08, 20.2] });
  }
  d.boxes(beds, 'desk-planter-masonry-bricks', d.matte(0x997d68), bricks);
  d.boxes(beds, 'desk-planter-stone-caps', d.matte(0xc0bba6), caps);
  createCampusMeadow(parent, 'desk-campus', [-1, 1].map((side) => ({
    x: side * 6.5, z: -13, width: 1.7, depth: 19.5, y: 0.29, density: 18, flowers: 38,
  })), time);
  const foliage = createFoliageWindMaterial(getFoliageMaterial(), time, { base: -1, height: 2, amplitude: 0.055 });
  foliage.color.setHex(0x6f965a);
  const shrubs: Part[] = [];
  const trunks: Part[] = [];
  const crowns: Part[] = [];
  const branches: Array<{ a: V3; b: V3; radius: number }> = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 16; i += 1) shrubs.push({ p: [side * 6.5, 0.64, -4.5 - i * 1.1],
      s: [0.56, 0.35 + i % 3 * 0.045, 0.53], color: [0x9ebc79, 0x799662, 0xb2c58e][i % 3] });
    for (const z of [-9, -15, -21, -34]) {
      const x = side * (z === -34 ? 19 : 9);
      trunks.push({ p: [x, 2, z], s: [0.21, 4, 0.21] });
      for (const dx of [-0.7, 0.7]) {
        branches.push({ a: [x, 2.5, z], b: [x + dx, 4.25, z - 0.4], radius: 0.075 });
        crowns.push({ p: [x + dx, 4.7, z - 0.4], s: [1.35, 1.65, 1.35], color: dx < 0 ? 0x9cae74 : 0x71976c });
      }
      crowns.push({ p: [x, 5.45, z], s: [1.35, 1.5, 1.3], color: 0x8baa73 });
    }
  }
  d.instances(parent, 'desk-campus-tree-trunks', new THREE.CylinderGeometry(0.7, 1, 1, 8), getBarkMaterial({ repeatY: 3 }), trunks);
  d.rods(parent, 'desk-campus-tree-branches', getBarkMaterial(), branches);
  d.instances(parent, 'desk-campus-tree-crowns', new THREE.SphereGeometry(1, 9, 7), foliage, crowns);
  d.instances(parent, 'desk-campus-shrubs', new THREE.SphereGeometry(1, 8, 6), foliage, shrubs);
  const poles: Part[] = [];
  const lanterns: Part[] = [];
  const capsAndFeet: Part[] = [];
  for (const x of [-4.8, 4.8]) for (const z of [-10, -18, -23]) {
    poles.push({ p: [x, 1.65, z], s: [0.045, 3.3, 0.045] });
    lanterns.push({ p: [x, 3.2, z], s: [0.24, 0.38, 0.24] });
    capsAndFeet.push({ p: [x, 0.12, z], s: [0.21, 0.24, 0.21] }, { p: [x, 3.42, z], s: [0.32, 0.055, 0.32] });
    for (const dx of [-0.12, 0.12]) capsAndFeet.push({ p: [x + dx, 3.2, z], s: [0.023, 0.4, 0.26] });
  }
  const metal = d.matte(0x405552, 0.48, 0.6);
  d.instances(parent, 'desk-courtyard-lamp-poles', new THREE.CylinderGeometry(1, 1, 1, 8), metal, poles);
  const glow = d.matte(0xe7d6ab, 0.35);
  glow.emissive.setHex(0xe8c982);
  glow.emissiveIntensity = 0.32;
  d.boxes(parent, 'desk-courtyard-lantern-glass', glow, lanterns);
  d.boxes(parent, 'desk-courtyard-lantern-frames', metal, capsAndFeet);
  for (const side of [-1, 1]) {
    const board = group(parent, `desk-notice-board-${side}`);
    board.position.set(side * 10.7, 0, -17);
    d.box(board, 'desk-notice-board-backing', [0, 1.65, 0], [2.5, 1.55, 0.12], metal);
    d.boxes(board, 'desk-notice-board-frame', d.matte(0x9eaa98, 0.5, 0.4), [
      { p: [0, 2.46, 0], s: [2.7, 0.1, 0.34] },
      { p: [-1.2, 0.6, 0], s: [0.065, 1.2, 0.065] }, { p: [1.2, 0.6, 0], s: [0.065, 1.2, 0.065] },
    ]);
    sign(board, 'desk-notice-title', '校园活动 · 新生指南', 2.28, 0.28, [0, 2.22, 0.069]);
    d.boxes(board, 'desk-notice-posters', d.matte(0xe8dfc5), [-0.8, 0, 0.8].map((x) => ({ p: [x, 1.6, 0.07], s: [0.62, 0.82, 0.006] })));
    sign(board, 'desk-notice-poster-1', '社团见面日', 0.59, 0.16, [-0.8, 1.82, 0.075], '#e8dfc5', '#786551');
    sign(board, 'desk-notice-poster-2', '图书借阅指南', 0.59, 0.16, [0, 1.82, 0.075], '#e8dfc5', '#526961');
    sign(board, 'desk-notice-poster-3', '校园漫步', 0.59, 0.16, [0.8, 1.82, 0.075], '#e8dfc5', '#786551');
    d.boxes(board, 'desk-notice-poster-lines', d.matte(0xb7b29d), [-0.8, 0, 0.8].flatMap((x) => [1.3, 1.45, 1.6].map((y) => ({
      p: [x, y, 0.075], s: [0.45, 0.025, 0.003],
    }))));
    const guide = group(parent, `desk-campus-wayfinding-${side}`);
    guide.position.set(side * 4.4, 0, -12.3);
    d.rods(guide, 'desk-guide-post', metal, [{ a: [0, 0, 0], b: [0, 2.6, 0], radius: 0.035 }]);
    sign(guide, 'desk-guide-teaching', '教学区 ↑', 1.12, 0.3, [0, 2.35, 0.045]);
    sign(guide, 'desk-guide-library', side < 0 ? '阅览室 ←' : '活动中心 →', 1.12, 0.3, [0, 1.98, 0.045]);
  }
  buildSchool(parent, d);
}

/** 本场景独立背景，不调用或修改 building 场景；窗玻璃缩进、窗台凸出，三层楼与连廊封边。 */
function buildSchool(parent: THREE.Object3D, d: Details): void {
  const school = group(parent, 'desk-three-storey-school');
  const plaster = tint(getPlasterMaterial({ repeatX: 4, repeatY: 3 }), 0xddd2b9);
  const frames: Part[] = [];
  const reveals: Part[] = [];
  const glass: Part[] = [];
  const warm: Part[] = [];
  const reflections: Part[] = [];
  const trims: Part[] = [];
  for (const [wing, x, z, width, depth, columns] of [
    ['main', 0, -29, 18, 6, 8], ['left', -15, -27.5, 11, 7, 5], ['right', 15, -27.5, 11, 7, 5],
  ] as const) {
    d.box(school, `desk-school-${wing}-mass`, [x, 4.65, z], [width, 9.3, depth], plaster);
    const front = z + depth / 2;
    for (let floor = 0; floor < 3; floor += 1) {
      const y = 1.65 + floor * 3;
      trims.push({ p: [x, floor * 3 + 0.3, front + 0.075], s: [width + 0.1, 0.18, 0.15] });
      for (let col = 0; col < columns; col += 1) {
        const px = x + (col - (columns - 1) / 2) * 2;
        reveals.push({ p: [px, y, front + 0.012], s: [1.48, 1.84, 0.035] });
        const pane = { p: [px, y, front + 0.042] as V3, s: [1.22, 1.57, 0.022] as V3 };
        if ((floor * 7 + col + (wing === 'left' ? 2 : 0)) % 5 === 0) warm.push(pane);
        else glass.push(pane);
        frames.push({ p: [px - 0.69, y, front + 0.11], s: [0.12, 1.85, 0.2] },
          { p: [px + 0.69, y, front + 0.11], s: [0.12, 1.85, 0.2] },
          { p: [px, y + 0.87, front + 0.11], s: [1.5, 0.12, 0.2] },
          { p: [px, y - 0.89, front + 0.17], s: [1.56, 0.14, 0.32] },
          { p: [px, y, front + 0.092], s: [0.035, 1.58, 0.07] },
          { p: [px, y + 0.18, front + 0.092], s: [1.23, 0.035, 0.07] });
        reflections.push({ p: [px + 0.36, y + 0.36, front + 0.056], s: [0.085, 0.65, 0.004], r: [0, 0, -0.18] });
      }
    }
    trims.push({ p: [x, 9.35, z], s: [width + 0.4, 0.16, depth + 0.4] });
  }
  d.boxes(school, 'desk-school-window-recesses', d.matte(0x59665e), reveals);
  d.boxes(school, 'desk-school-reflective-glass', getWindowGlassMaterial(), glass);
  const warmGlass = tint(getWindowGlassMaterial(), 0xe3b66c);
  warmGlass.emissive.setHex(0xefc284);
  warmGlass.emissiveIntensity = 0.4;
  d.boxes(school, 'desk-school-warm-interior-windows', warmGlass, warm);
  d.boxes(school, 'desk-school-window-frames-and-sills', d.matte(0xb2b7a7, 0.64, 0.12), frames);
  d.boxes(school, 'desk-school-window-sky-reflections', d.matte(0xbfcfd0, 0.12, 0.4), reflections, false);
  d.boxes(school, 'desk-school-floor-and-roof-trims', d.matte(0x8c9788), trims);
  d.boxes(school, 'desk-school-entrance-glass-doors', getWindowGlassMaterial(), [
    { p: [-0.6, 1.2, -25.72], s: [1.15, 2.4, 0.045] }, { p: [0.6, 1.2, -25.72], s: [1.15, 2.4, 0.045] },
  ]);
  const metal = d.matte(0x475b58, 0.42, 0.5);
  d.boxes(school, 'desk-school-door-frames', metal, [-1.22, 0, 1.22].map((x) => ({ p: [x, 1.2, -25.66], s: [0.07, 2.4, 0.1] })));
  d.box(school, 'desk-school-entry-rain-canopy', [0, 2.75, -25.1], [4.2, 0.12, 2], metal);
  sign(school, 'desk-school-entry-name', '教学楼', 1.7, 0.36, [0, 3.08, -25.79]);
  d.boxes(school, 'desk-school-covered-walkway-roofs', metal, [
    { p: [-9.85, 2.7, -23.8], s: [4.1, 0.14, 1.8] }, { p: [9.85, 2.7, -23.8], s: [4.1, 0.14, 1.8] },
  ]);
  d.boxes(school, 'desk-school-colonnade-posts', plaster, [-11.4, -9.6, -8.1, 8.1, 9.6, 11.4].map((x) => ({
    p: [x, 1.3, -23.1], s: [0.18, 2.6, 0.18],
  })));
  d.boxes(school, 'desk-campus-enclosing-walls', plaster, [
    { p: [-22.5, 0.85, -18], s: [0.35, 1.7, 28] }, { p: [22.5, 0.85, -18], s: [0.35, 1.7, 28] },
    { p: [0, 0.85, -35], s: [45, 1.7, 0.35] },
  ]);
  d.boxes(school, 'desk-campus-wall-copings', d.matte(0x879383), [
    { p: [-22.5, 1.75, -18], s: [0.48, 0.1, 28] }, { p: [22.5, 1.75, -18], s: [0.48, 0.1, 28] },
    { p: [0, 1.75, -35], s: [45, 0.1, 0.48] },
  ]);
}

function buildDesk(parent: THREE.Object3D): { occluders: THREE.Object3D[]; actors: Record<string, THREE.Object3D> } {
  const d = createDetails();
  const environment = group(parent, 'desk-campus-environment');
  const time: WindTime = { value: 0 };
  environment.userData.windTime = time;
  buildCampus(environment, d, time);
  const tent = buildTent(environment, d);
  const table = buildTable(environment, d);
  const supplies = buildSupplyBox(environment, d);
  const welcome = buildWelcomeStand(environment, d);
  const occluders: THREE.Object3D[] = [tent, table, supplies, welcome];
  // 所有袋身和标签作为同一拾取对象，state.picked 后不会残留十字悬浮在地上。
  const medicineBag = group(parent, 'desk-medicine-bag');
  medicineBag.position.set(MEDICINE_BAG.center.x, MEDICINE_BAG.center.y, MEDICINE_BAG.center.z);
  d.box(medicineBag, 'desk-medicine-bag-body', [0, 0, 0], [MEDICINE_BAG.size.w, MEDICINE_BAG.size.h, MEDICINE_BAG.size.d], d.matte(0xc7b98f));
  d.box(medicineBag, 'desk-medicine-label', [0, 0.093, 0], [0.18, 0.005, 0.14], d.matte(0xe9e3d3));
  d.boxes(medicineBag, 'desk-medicine-cross', d.matte(0xb45a52), [
    { p: [0, 0.098, 0], s: [0.1, 0.004, 0.024] }, { p: [0, 0.098, 0], s: [0.024, 0.004, 0.1] },
  ]);
  occluders.push(medicineBag);
  for (const [index, column] of BACK_GATE_COLUMNS.entries()) {
    occluders.push(d.box(parent, `desk-back-gate-column-${index}`, [column.center.x, column.center.y, column.center.z],
      [column.size.w, column.size.h, column.size.d], d.matte(0x8d949a)));
  }
  const volunteer = createCharacterActor('volunteer', 1.7, 0xb08a72, { yaw: 0 });
  volunteer.position.set(STANDS.volunteer.x, 0, STANDS.volunteer.z);
  const linxia = createCharacterActor('linxia', 1.62, 0xe8d9a8, { yaw: -0.8 });
  linxia.position.set(STANDS.linxia.x, 0, STANDS.linxia.z);
  const father = createCharacterActor('father', 1.78, 0x8f8578, { yaw: Math.PI, props: [
    { kind: 'bag', color: 0x9b8f78, side: 'left' }, { kind: 'bag', color: 0x9b8f78, side: 'right' },
  ] });
  father.position.set(STANDS.father.x, 0, STANDS.father.z);
  const studentWalker = createCharacterActor('studentFemale', 1.65, 0x718d83, { yaw: Math.PI });
  studentWalker.position.set(-3.4, 0, -13.5);
  const studentReader = createCharacterActor('studentMale', 1.7, 0x8d846c, { yaw: Math.PI / 2 });
  studentReader.position.set(4, 0, -19.7);
  parent.add(volunteer, linxia, father, studentWalker, studentReader);
  occluders.push(volunteer, linxia, father, studentWalker, studentReader);
  return { occluders, actors: { medicineBag, volunteer, linxia, father, studentWalker, studentReader, deskEnvironment: environment } };
}

let stateSubscription: (() => void) | null = null;
let idleDisposers: Array<() => void> = [];
interface AnimatedActor { actor: THREE.Object3D; clip: string; timeScale: number; controller: CharacterAnimationController | null }
let animatedActors: AnimatedActor[] = [];
let walker: THREE.Object3D | null = null;
let windTime: WindTime | null = null;

function clearRuntime(): void {
  stateSubscription?.();
  stateSubscription = null;
  idleDisposers.forEach((dispose) => dispose());
  idleDisposers = [];
  animatedActors.forEach(({ controller }) => controller?.dispose());
  animatedActors = [];
  walker = null;
  windTime = null;
}
function updateAnimation(record: AnimatedActor, dt: number): void {
  // 预载超时后的模型热替换仍可补上原生动画；不改脚底外层位置。
  if (!record.controller) {
    record.controller = createActorAnimation(record.actor);
    record.controller?.play(record.clip, { timeScale: record.timeScale, fadeIn: 0.6 });
  }
  record.controller?.update(dt);
}

export const deskRuntime: SceneRuntime = {
  enter(context: SceneRuntimeContext): void {
    if (context.sceneId !== 'S7') return;
    clearRuntime();
    windTime = (context.actors.deskEnvironment?.userData.windTime as WindTime | undefined) ?? null;
    for (const [index, id] of ['volunteer', 'linxia', 'father'].entries()) {
      const actor = context.actors[id];
      if (actor) idleDisposers.push(startIdleMotion(actor, { breathAmp: 0.005, swayAmp: 0.004, period: 2.7 + index * 0.3 }));
    }
    walker = context.actors.studentWalker ?? null;
    for (const [id, clip, timeScale] of [['linxia', 'afraid', 0.45], ['studentWalker', 'walk', 0.7], ['studentReader', 'fold_arms', 0.8]] as const) {
      const actor = context.actors[id];
      if (!actor) continue;
      const record: AnimatedActor = { actor, clip: id === 'studentWalker' && actor.position.z <= -17.5 ? 'idle' : clip, timeScale, controller: null };
      animatedActors.push(record);
      updateAnimation(record, 0);
    }
    stateSubscription = context.bus.on('state:changed', ({ state }) => {
      if (state.picked) {
        if (context.actors.medicineBag) context.actors.medicineBag.visible = false;
        context.setInteractableVisible('medicine-bag', false);
      }
    });
  },
  tick(dtSeconds: number): void {
    if (dtSeconds <= 0) return;
    if (windTime) windTime.value += dtSeconds;
    if (walker) {
      walker.position.z = Math.max(-17.5, walker.position.z - 0.62 * dtSeconds);
      walker.position.y = NAV.groundY ?? 0;
      const record = animatedActors.find(({ actor }) => actor === walker);
      if (record && walker.position.z <= -17.5 && record.clip !== 'idle') {
        record.clip = 'idle';
        record.controller?.play('idle', { fadeIn: 0.4, timeScale: 0.8 });
      }
    }
    animatedActors.forEach((record) => updateAnimation(record, dtSeconds));
  },
  exit: clearRuntime,
};

export function createDeskDefinition(_sceneId: SceneId): WorldSceneDefinition {
  return {
    sceneKey: 'desk',
    spawn: SPAWN,
    nav: NAV,
    requiredModels: ['volunteer', 'linxia', 'father', 'studentFemale', 'studentMale'],
    interactables: [{ id: 'medicine-bag', position: MEDICINE_BAG.center, lightOffsetY: 0.3, hitRadius: 0.4, maxDistance: 3.5 }],
    hotspots: [{ id: 'reason-form', position: { x: 0, y: 0.85, z: -3.56 }, maxDistance: 8 }],
    fog: { color: 0xb9c6d2, near: 12, far: 44 },
    build: buildDesk,
  };
}
