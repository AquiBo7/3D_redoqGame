// scenes3d/streetResidential.ts —— S4 左侧外转角纯装饰居民楼
// 6m×8m 两层抹灰楼，檐口 6.5m、脊高 8.2m；仅生活痕迹，无任何商业元素。
// 全部盒体共用一个实例化哑光材质，暖黄窗灯单独一个自发光材质，总材质数 2。

import * as THREE from 'three';

export const RESIDENTIAL_FOOTPRINT = {
  centerX: -15.6,
  centerZ: 11.5,
  widthX: 6,
  depthZ: 8,
  eaveY: 6.5,
  ridgeY: 8.2,
  minX: -18.6,
  maxX: -12.6,
  minZ: 7.5,
  maxZ: 15.5,
} as const;

interface BoxSpec {
  position: [number, number, number];
  size: [number, number, number];
  color: number;
}

function bindDispose(group: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material): void {
  group.addEventListener('removed', () => {
    geometry.dispose();
    material.dispose();
  });
}

function createBoxBatch(
  name: string,
  specs: readonly BoxSpec[],
  geometry: THREE.BoxGeometry,
  material: THREE.MeshStandardMaterial,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, specs.length);
  mesh.name = name;
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  specs.forEach((spec, index) => {
    matrix.compose(
      new THREE.Vector3(...spec.position),
      new THREE.Quaternion(),
      new THREE.Vector3(...spec.size),
    );
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, color.setHex(spec.color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const release = (): void => {
    mesh.dispose();
    geometry.removeEventListener('dispose', release);
  };
  geometry.addEventListener('dispose', release);
  return mesh;
}

function createGableRoofGeometry(): THREE.BufferGeometry {
  const x = RESIDENTIAL_FOOTPRINT.widthX / 2;
  const z = RESIDENTIAL_FOOTPRINT.depthZ / 2;
  const eave = RESIDENTIAL_FOOTPRINT.eaveY;
  const ridge = RESIDENTIAL_FOOTPRINT.ridgeY;
  const positions = new Float32Array([
    // 南山墙
    -x, eave, z, x, eave, z, 0, ridge, z,
    // 北山墙
    x, eave, -z, -x, eave, -z, 0, ridge, -z,
    // 东坡
    x, eave, z, x, eave, -z, 0, ridge, -z,
    x, eave, z, 0, ridge, -z, 0, ridge, z,
    // 西坡
    -x, eave, -z, -x, eave, z, 0, ridge, z,
    -x, eave, -z, 0, ridge, z, 0, ridge, -z,
    // 底面
    -x, eave, -z, x, eave, -z, x, eave, z,
    -x, eave, -z, x, eave, z, -x, eave, z,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function buildStreetResidentialBuilding(
  parent: THREE.Object3D,
  occluders: THREE.Object3D[],
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'street-residential-building';
  group.position.set(RESIDENTIAL_FOOTPRINT.centerX, 0, RESIDENTIAL_FOOTPRINT.centerZ);

  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const matte = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  bindDispose(group, boxGeometry, matte);

  const wall = 0xd8d2c4;
  const plinth = 0x4a4f52;
  const frame = 0x5a5248;
  const glass = 0x3a4a55;
  const wood = 0x6b4a32;
  const metal = 0x6a6f72;

  const shell: BoxSpec[] = [
    { position: [0, 3.25, 0], size: [5, 6.5, 7.8], color: wall },
    { position: [2.52, 0.275, 0], size: [0.04, 0.55, 8], color: plinth },
    { position: [-2.52, 0.275, 0], size: [0.04, 0.55, 8], color: plinth },
    { position: [0, 0.275, 3.98], size: [6, 0.55, 0.04], color: plinth },
    { position: [0, 0.275, -3.98], size: [6, 0.55, 0.04], color: plinth },
    { position: [2.53, 6.44, 0], size: [0.06, 0.12, 8], color: 0xc9c2b2 },
    { position: [-2.53, 6.44, 0], size: [0.06, 0.12, 8], color: 0xc9c2b2 },
    { position: [0, 6.44, 3.97], size: [6, 0.12, 0.06], color: 0xc9c2b2 },
    { position: [0, 6.44, -3.97], size: [6, 0.12, 0.06], color: 0xc9c2b2 },
    { position: [2.53, 1.1, 1.65], size: [0.06, 2.2, 0.08], color: frame },
    { position: [2.53, 1.1, 2.75], size: [0.06, 2.2, 0.08], color: frame },
    { position: [2.53, 2.24, 2.2], size: [0.06, 0.08, 1.18], color: frame },
    { position: [2.54, 1.05, 2.2], size: [0.04, 2.1, 1.0], color: wood },
    { position: [2.57, 1.05, 2.55], size: [0.03, 0.06, 0.12], color: 0xc9a86a },
    { position: [2.7, 0.06, 2.2], size: [0.3, 0.12, 1.1], color: 0x9a958a },
    { position: [2.53, 1.15, -3.2], size: [0.06, 2.3, 0.08], color: frame },
    { position: [2.53, 1.15, -1.6], size: [0.06, 2.3, 0.08], color: frame },
    { position: [2.53, 2.34, -2.4], size: [0.06, 0.08, 1.68], color: frame },
    { position: [2.57, 0.35, -2.4], size: [0.03, 0.08, 0.3], color: metal },
    { position: [2.53, 1.7, -0.6], size: [0.06, 1.2, 0.06], color: frame },
    { position: [2.53, 1.7, 0.6], size: [0.06, 1.2, 0.06], color: frame },
    { position: [2.53, 2.3, 0], size: [0.06, 0.06, 1.26], color: frame },
    { position: [2.53, 1.1, 0], size: [0.06, 0.06, 1.26], color: frame },
    { position: [2.54, 1.7, 0], size: [0.03, 1.1, 1.1], color: glass },
    { position: [2.6, 1.06, 0], size: [0.16, 0.06, 1.3], color: 0xb9b2a2 },
    { position: [2.54, 1.35, 3.1], size: [0.08, 0.3, 0.4], color: 0x4a6a7a },
    { position: [2.58, 1.42, 3.1], size: [0.02, 0.04, 0.28], color: 0x2a3a44 },
    { position: [2.53, 1.8, 1.1], size: [0.06, 0.9, 0.7], color: 0x5a4a3a },
    { position: [2.55, 3.25, 3.7], size: [0.08, 6.5, 0.08], color: metal },
    { position: [2.55, 0.1, 3.7], size: [0.1, 0.2, 0.12], color: metal },
    { position: [-2.65, 2.6, -3], size: [0.06, 1.2, 0.06], color: metal },
    { position: [-2.65, 2.6, 3], size: [0.06, 1.2, 0.06], color: metal },
    { position: [-2.65, 3.2, 0], size: [0.03, 0.03, 6], color: 0x8a8f92 },
    { position: [-2.68, 2.9, -2], size: [0.04, 0.5, 0.4], color: 0x7a9ab0 },
    { position: [-2.68, 2.9, -0.7], size: [0.04, 0.5, 0.4], color: 0xc9a0a0 },
    { position: [-2.68, 2.9, 0.7], size: [0.04, 0.5, 0.4], color: 0xa0b98a },
    { position: [-2.68, 2.9, 2], size: [0.04, 0.5, 0.4], color: 0xd9c9a0 },
    { position: [-2.6, 5.6, -3.2], size: [0.05, 0.8, 0.05], color: metal },
    { position: [-2.6, 5.4, -3.2], size: [0.04, 0.04, 0.8], color: metal },
    { position: [-2.6, 5.7, -3.2], size: [0.04, 0.04, 0.65], color: metal },
    { position: [-2.6, 6.0, -3.2], size: [0.04, 0.04, 0.5], color: metal },
    { position: [-2.76, 0.35, 3.4], size: [0.45, 0.7, 0.5], color: 0x3a6a4a },
    { position: [-2.76, 0.72, 3.4], size: [0.48, 0.06, 0.54], color: 0x2a4a3a },
  ];
  for (let i = 0; i < 8; i += 1) {
    shell.push({
      position: [2.54, 0.25 + i * 0.28, -2.4],
      size: [0.04, 0.22, 1.5],
      color: i % 2 === 0 ? 0x8a8f92 : 0x7a7f82,
    });
  }
  for (const z of [-2.4, 0, 2.4]) {
    shell.push(
      { position: [2.53, 4.7, z - 0.6], size: [0.06, 1.3, 0.06], color: frame },
      { position: [2.53, 4.7, z + 0.6], size: [0.06, 1.3, 0.06], color: frame },
      { position: [2.53, 5.35, z], size: [0.06, 0.06, 1.26], color: frame },
      { position: [2.53, 4.05, z], size: [0.06, 0.06, 1.26], color: frame },
      { position: [2.6, 4.02, z], size: [0.16, 0.06, 1.3], color: 0xb9b2a2 },
    );
    if (z !== 0) {
      shell.push({ position: [2.54, 4.7, z], size: [0.03, 1.15, 1.1], color: glass });
    }
  }
  const shellMesh = createBoxBatch('residential-shell', shell, boxGeometry, matte);
  group.add(shellMesh);
  occluders.push(shellMesh);

  const planters: BoxSpec[] = [];
  for (const z of [-2.4, 2.4]) {
    planters.push(
      { position: [2.64, 4.14, z], size: [0.16, 0.18, 0.34], color: 0x9a5a3a },
      { position: [2.64, 4.24, z], size: [0.14, 0.03, 0.3], color: 0x4a3a2a },
      { position: [2.64, 4.34, z - 0.1], size: [0.08, 0.16, 0.08], color: 0x3e8a46 },
      { position: [2.64, 4.36, z], size: [0.08, 0.2, 0.08], color: 0x4fa05a },
      { position: [2.64, 4.34, z + 0.1], size: [0.08, 0.16, 0.08], color: 0x2f6b3a },
    );
  }
  group.add(createBoxBatch('residential-window-planter', planters, boxGeometry, matte));

  group.add(createBoxBatch('residential-doormat', [
    { position: [2.66, 0.015, 2.2], size: [0.28, 0.03, 0.9], color: 0x7a5a42 },
  ], boxGeometry, matte));

  group.add(createBoxBatch('residential-bench', [
    { position: [2.78, 0.32, 0.9], size: [0.42, 0.06, 0.9], color: 0x8a6a4a },
    { position: [2.6, 0.62, 0.9], size: [0.06, 0.5, 0.9], color: 0x8a6a4a },
    { position: [2.9, 0.15, 0.55], size: [0.06, 0.3, 0.06], color: 0x5a4a3a },
    { position: [2.66, 0.15, 0.55], size: [0.06, 0.3, 0.06], color: 0x5a4a3a },
    { position: [2.9, 0.15, 1.25], size: [0.06, 0.3, 0.06], color: 0x5a4a3a },
    { position: [2.66, 0.15, 1.25], size: [0.06, 0.3, 0.06], color: 0x5a4a3a },
  ], boxGeometry, matte));

  group.add(createBoxBatch('residential-faded-poster', [
    { position: [2.56, 1.8, 1.1], size: [0.02, 0.78, 0.63], color: 0xc9b89a },
    { position: [2.57, 1.95, 0.92], size: [0.01, 0.22, 0.18], color: 0xb07a6a },
    { position: [2.57, 1.95, 1.27], size: [0.01, 0.22, 0.18], color: 0x7a9a8a },
    { position: [2.57, 1.6, 1.1], size: [0.01, 0.18, 0.45], color: 0xa09a8a },
  ], boxGeometry, matte));

  const roofGeometry = createGableRoofGeometry();
  const roof = new THREE.InstancedMesh(roofGeometry, matte, 1);
  roof.name = 'residential-roof';
  roof.setMatrixAt(0, new THREE.Matrix4());
  roof.setColorAt(0, new THREE.Color(0x4a4f52));
  roof.instanceMatrix.needsUpdate = true;
  if (roof.instanceColor) roof.instanceColor.needsUpdate = true;
  roof.castShadow = true;
  roof.receiveShadow = true;
  group.add(roof);
  occluders.push(roof);
  const releaseRoof = (): void => {
    roof.dispose();
    roofGeometry.removeEventListener('dispose', releaseRoof);
  };
  roofGeometry.addEventListener('dispose', releaseRoof);
  bindDispose(group, roofGeometry, matte);

  const warmMaterial = new THREE.MeshStandardMaterial({
    color: 0xffe3b0,
    emissive: 0xffc978,
    emissiveIntensity: 1.1,
    roughness: 0.6,
  });
  const warmWindow = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.15, 1.1), warmMaterial);
  warmWindow.name = 'residential-warm-window';
  warmWindow.position.set(2.545, 4.7, 0);
  group.add(warmWindow);
  bindDispose(group, warmWindow.geometry, warmMaterial);

  parent.add(group);
  return group;
}