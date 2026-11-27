import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildStreetSunsetSeascape,
  SEASCAPE_PALM_KEEP_OUTS,
  SEASCAPE_SUNSET_LIGHTING,
  SEASCAPE_SUNSET_PALETTE,
  tickStreetSeascape,
  type SeascapePalmKind,
  type SeascapeWaveState,
} from './streetSeascape';

const roots: THREE.Group[] = [];
let printed: string[] = [];

beforeEach(() => {
  printed = [];
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        fillRect: () => {},
        fillText: (text: string) => printed.push(text),
      }),
    }),
  });
});

afterEach(() => {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  for (const root of roots) {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
      }
    });
    root.clear();
  }
  roots.length = 0;
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  vi.unstubAllGlobals();
});

function build(): { root: THREE.Group; occluders: THREE.Object3D[]; wave: SeascapeWaveState } {
  const root = new THREE.Group();
  roots.push(root);
  const occluders: THREE.Object3D[] = [];
  const wave = buildStreetSunsetSeascape(root, occluders);
  expect(wave).not.toBeNull();
  root.updateMatrixWorld(true);
  return { root, occluders, wave: wave! };
}

function mesh<T extends THREE.Mesh>(root: THREE.Object3D, name: string): T {
  const object = root.getObjectByName(name);
  expect(object, name).toBeInstanceOf(THREE.Mesh);
  return object as T;
}

function instances(root: THREE.Object3D, name: string): THREE.InstancedMesh {
  const object = mesh(root, name);
  expect(object, name).toBeInstanceOf(THREE.InstancedMesh);
  return object as THREE.InstancedMesh;
}

function triangles(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  return index ? index.count / 3 : geometry.getAttribute('position').count / 3;
}

function matrixSnapshot(mesh: THREE.InstancedMesh): number[] {
  return Array.from(mesh.instanceMatrix.array);
}

function instanceColor(mesh: THREE.InstancedMesh, index: number): number {
  const color = new THREE.Color();
  mesh.getColorAt(index, color);
  return color.getHex();
}

function instanceBox(mesh: THREE.InstancedMesh, index: number): THREE.Box3 {
  mesh.geometry.computeBoundingBox();
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return mesh.geometry.boundingBox!.clone().applyMatrix4(matrix.premultiply(mesh.matrixWorld));
}

function distanceToKeepOut(x: number, z: number, index: number): number {
  const keepOut = SEASCAPE_PALM_KEEP_OUTS[index];
  const nearestX = THREE.MathUtils.clamp(x, keepOut.minX, keepOut.maxX);
  const nearestZ = THREE.MathUtils.clamp(z, keepOut.minZ, keepOut.maxZ);
  return Math.hypot(x - nearestX, z - nearestZ);
}

const SEGMENTS_PER_KIND: Record<SeascapePalmKind, number> = { A: 5, B: 6, C: 4, D: 5 };
const FRONDS_PER_CROWN: Record<SeascapePalmKind, number> = { A: 8, B: 9, C: 11, D: 7 };
const CROWNS_PER_KIND: Record<SeascapePalmKind, number> = { A: 1, B: 2, C: 1, D: 2 };

describe('S4 海滨落日椰树布局', () => {
  it('10 棵树按 2/5/3 分层，四种树型的干段、冠数与羽叶数量可由实例核验', () => {
    const { root, wave } = build();
    expect(wave.palms).toHaveLength(10);
    expect(wave.palms.filter((palm) => palm.layer === 'foreground')).toHaveLength(2);
    expect(wave.palms.filter((palm) => palm.layer === 'midground')).toHaveLength(5);
    expect(wave.palms.filter((palm) => palm.layer === 'far')).toHaveLength(3);
    expect(new Set(wave.palms.map((palm) => palm.kind))).toEqual(new Set(['A', 'B', 'C', 'D']));

    const foreground = wave.palms.filter((palm) => palm.layer === 'foreground');
    const midground = wave.palms.filter((palm) => palm.layer === 'midground');
    const far = wave.palms.filter((palm) => palm.layer === 'far');
    expect(Math.max(...foreground.map((palm) => palm.z))).toBeLessThan(Math.min(...midground.map((palm) => palm.z)));
    expect(Math.max(...midground.map((palm) => palm.z))).toBeLessThan(Math.min(...far.map((palm) => palm.z)));

    for (const palm of wave.palms) {
      expect(palm.crowns).toHaveLength(CROWNS_PER_KIND[palm.kind]);
    }
    const trunkCount = instances(root, 'street-seascape-palm-trunks-cast').count
      + instances(root, 'street-seascape-palm-trunks-contact').count;
    expect(trunkCount).toBe(wave.palms.reduce((sum, palm) => sum + SEGMENTS_PER_KIND[palm.kind], 0));

    const leafCounts = new Map(wave.palms.map((palm) => [palm.id, 0]));
    for (const motion of wave.leafMotions) {
      let nearest = wave.palms[0];
      let nearestDistance = Infinity;
      for (const palm of wave.palms) {
        for (const crown of palm.crowns) {
          const distance = Math.hypot(motion.transform.position.x - crown.x, motion.transform.position.z - crown.z);
          if (distance < nearestDistance) {
            nearest = palm;
            nearestDistance = distance;
          }
        }
      }
      expect(nearestDistance).toBeLessThan(0.001);
      leafCounts.set(nearest.id, (leafCounts.get(nearest.id) ?? 0) + 1);
    }
    for (const palm of wave.palms) {
      expect(leafCounts.get(palm.id)).toBe(palm.crowns.length * FRONDS_PER_CROWN[palm.kind]);
    }
    expect(wave.leafMotions).toHaveLength(128);
  });

  it('yaw、scale、tilt 与沙堆半径均由固定种子产生且严格落在需求区间', () => {
    const first = build();
    const second = build();
    expect(second.wave.palms).toEqual(first.wave.palms);
    expect(matrixSnapshot(instances(first.root, 'street-seascape-palm-leaves-cast')))
      .toEqual(matrixSnapshot(instances(second.root, 'street-seascape-palm-leaves-cast')));
    expect(first.wave.cloudMotions.map((motion) => motion.baseMatrix.toArray()))
      .toEqual(second.wave.cloudMotions.map((motion) => motion.baseMatrix.toArray()));

    for (const palm of first.wave.palms) {
      expect(palm.yaw).toBeGreaterThanOrEqual(0);
      expect(palm.yaw).toBeLessThan(Math.PI * 2);
      expect(palm.scale).toBeGreaterThanOrEqual(0.85);
      expect(palm.scale).toBeLessThanOrEqual(1.15);
      expect(palm.tiltDeg).toBeGreaterThanOrEqual(-18);
      expect(palm.tiltDeg).toBeLessThanOrEqual(18);
      expect(palm.moundRadius).toBeGreaterThanOrEqual(0.6);
      expect(palm.moundRadius).toBeLessThanOrEqual(1.0);
    }
    expect(new Set(first.wave.palms.map((palm) => palm.yaw)).size).toBeGreaterThan(1);
    expect(new Set(first.wave.palms.map((palm) => palm.scale)).size).toBeGreaterThan(1);
    expect(new Set(first.wave.palms.map((palm) => palm.tiltDeg)).size).toBeGreaterThan(1);
  });

  it('树干、沙堆与树冠避开全部 keep-out、中轴通道和夕阳 12m/±20° 禁植扇区', () => {
    const { root, wave } = build();
    const trunkMeshes = [
      instances(root, 'street-seascape-palm-trunks-cast'),
      instances(root, 'street-seascape-palm-trunks-contact'),
    ];
    const leafMeshes = [
      instances(root, 'street-seascape-palm-leaves-cast'),
      instances(root, 'street-seascape-palm-leaves-contact'),
    ];
    const obstacleBoxes = SEASCAPE_PALM_KEEP_OUTS.map((keepOut) => new THREE.Box3(
      new THREE.Vector3(keepOut.minX, 0, keepOut.minZ),
      new THREE.Vector3(keepOut.maxX, 8, keepOut.maxZ),
    ));
    const sunYaw = Math.atan2(8.5, 86);

    for (const palm of wave.palms) {
      expect(Math.abs(palm.x)).toBeGreaterThanOrEqual(1.5 + palm.moundRadius + 0.22);
      for (let index = 0; index < SEASCAPE_PALM_KEEP_OUTS.length; index += 1) {
        expect(distanceToKeepOut(palm.x, palm.z, index)).toBeGreaterThanOrEqual(palm.moundRadius + 0.22);
      }
      const dx = palm.x;
      const dz = palm.z - 15.5;
      const distance = Math.hypot(dx, dz);
      const angle = Math.abs(Math.atan2(
        Math.sin(Math.atan2(dx, dz) - sunYaw),
        Math.cos(Math.atan2(dx, dz) - sunYaw),
      ));
      const margin = Math.atan((palm.moundRadius + 0.22) / distance);
      expect(distance >= 12 + palm.moundRadius + 0.22
        || angle >= THREE.MathUtils.degToRad(20) + margin).toBe(true);
    }

    for (const batch of [...trunkMeshes, ...leafMeshes]) {
      for (let index = 0; index < batch.count; index += 1) {
        const box = instanceBox(batch, index);
        for (const obstacle of obstacleBoxes) expect(box.intersectsBox(obstacle)).toBe(false);
      }
    }
  });

  it('每棵树有 0.6～1.0m 接地沙堆，恰 4 棵投影且其余 6 棵使用接触阴影', () => {
    const { root, wave } = build();
    const mounds = instances(root, 'street-seascape-palm-mounds');
    const contacts = instances(root, 'street-seascape-palm-contacts');
    expect(mounds.count).toBe(10);
    expect(contacts.count).toBe(6);
    expect(mounds.castShadow).toBe(false);
    expect(mounds.receiveShadow).toBe(true);
    expect(contacts.castShadow).toBe(false);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    wave.palms.forEach((palm, index) => {
      mounds.getMatrixAt(index, matrix);
      position.setFromMatrixPosition(matrix);
      scale.setFromMatrixScale(matrix);
      expect(position.x).toBeCloseTo(palm.x, 5);
      expect(position.z).toBeCloseTo(palm.z, 5);
      expect(scale.x).toBeCloseTo(palm.moundRadius, 5);
      expect(scale.z).toBeCloseTo(palm.moundRadius, 5);
      expect(scale.y).toBeGreaterThanOrEqual(0.12);
      expect(scale.y).toBeLessThanOrEqual(0.18);
    });

    const casters = wave.palms.filter((palm) => palm.castShadow);
    expect(casters).toHaveLength(4);
    expect(casters.filter((palm) => palm.layer === 'foreground')).toHaveLength(2);
    expect(casters.filter((palm) => palm.layer === 'midground')).toHaveLength(2);
    expect(wave.palms.filter((palm) => palm.layer === 'far').every((palm) => !palm.castShadow)).toBe(true);
    expect(instances(root, 'street-seascape-palm-trunks-cast').castShadow).toBe(true);
    expect(instances(root, 'street-seascape-palm-leaves-cast').castShadow).toBe(true);
    expect(instances(root, 'street-seascape-palm-trunks-contact').castShadow).toBe(false);
    expect(instances(root, 'street-seascape-palm-leaves-contact').castShadow).toBe(false);
  });
});

describe('S4 海滨落日色板与天空', () => {
  it('全部指定色实际用于几何或实例，椰叶只允许三种严格叶色', () => {
    const { root, wave } = build();
    const used = new Set<number>();
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshBasicMaterial || material instanceof THREE.MeshStandardMaterial) {
          used.add(material.color.getHex());
        }
      }
      if (object instanceof THREE.InstancedMesh && object.instanceColor) {
        for (let index = 0; index < object.count; index += 1) used.add(instanceColor(object, index));
      }
      const colorAttribute = object.geometry.getAttribute('color');
      if (colorAttribute) {
        const color = new THREE.Color();
        for (let index = 0; index < colorAttribute.count; index += 1) {
          used.add(color.fromBufferAttribute(colorAttribute, index).getHex());
        }
      }
    });
    const paletteColors: readonly number[] = Object.values(SEASCAPE_SUNSET_PALETTE);
    for (const color of paletteColors) expect(used.has(color), `#${color.toString(16)}`).toBe(true);

    const leafColors = new Set<number>([
      SEASCAPE_SUNSET_PALETTE.palmLeafDark,
      SEASCAPE_SUNSET_PALETTE.palmLeafMid,
      SEASCAPE_SUNSET_PALETTE.palmLeafLight,
    ]);
    for (const motion of wave.leafMotions) expect(leafColors.has(instanceColor(motion.mesh, motion.index))).toBe(true);
  });

  it('太阳为三层且外晕半径 3.2 倍、透明度 .25；7 道光柱与 5 组双色云避开太阳 8°', () => {
    const { root, wave } = build();
    const outer = mesh(root, 'street-seascape-sun-outer-glow');
    const inner = mesh(root, 'street-seascape-sun-inner-glow');
    const core = mesh(root, 'street-seascape-sun-core');
    const outerGeometry = outer.geometry as THREE.CircleGeometry;
    const coreGeometry = core.geometry as THREE.CircleGeometry;
    expect(outerGeometry.parameters.radius / coreGeometry.parameters.radius).toBeCloseTo(3.2, 6);
    expect((outer.material as THREE.MeshBasicMaterial).opacity).toBe(0.25);
    expect((outer.material as THREE.MeshBasicMaterial).color.getHex()).toBe(SEASCAPE_SUNSET_PALETTE.sunOuterGlow);
    expect((inner.material as THREE.MeshBasicMaterial).color.getHex()).toBe(SEASCAPE_SUNSET_PALETTE.sunInnerGlow);
    expect((core.material as THREE.MeshBasicMaterial).color.getHex()).toBe(SEASCAPE_SUNSET_PALETTE.sunCore);
    expect(outer.position.x).toBe(core.position.x);
    expect(outer.position.y).toBe(core.position.y);

    const shafts = instances(root, 'street-seascape-sun-light-shafts');
    expect(shafts.count).toBe(7);
    expect(wave.lightShafts).toHaveLength(7);
    expect(wave.lightShafts.every((motion) => motion.length > 0 && motion.width > 0)).toBe(true);

    const clouds = instances(root, 'street-seascape-sky-clouds');
    expect(clouds.count).toBe(5);
    expect(wave.cloudMotions).toHaveLength(5);
    const cloudColors = new Set<number>();
    const colorAttribute = clouds.geometry.getAttribute('color');
    const color = new THREE.Color();
    for (let index = 0; index < colorAttribute.count; index += 1) {
      cloudColors.add(color.fromBufferAttribute(colorAttribute, index).getHex());
    }
    expect(cloudColors).toEqual(new Set([SEASCAPE_SUNSET_PALETTE.cloudLit, SEASCAPE_SUNSET_PALETTE.cloudShadow]));

    const viewOrigin = new THREE.Vector3(0, 1.6, 15.5);
    const sunDirection = core.position.clone().sub(viewOrigin).normalize();
    clouds.geometry.computeBoundingBox();
    const bounds = clouds.geometry.boundingBox!;
    for (const motion of wave.cloudMotions) {
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          const corner = new THREE.Vector3(x, y, 0).applyMatrix4(motion.baseMatrix).sub(viewOrigin).normalize();
          expect(corner.angleTo(sunDirection)).toBeGreaterThanOrEqual(THREE.MathUtils.degToRad(8));
        }
      }
    }
  });

  it('照明与局部山雾导出指定颜色、强度、10°仰角和 .25 浓度', () => {
    const { wave } = build();
    expect(wave.lighting).toBe(SEASCAPE_SUNSET_LIGHTING);
    expect(wave.lighting.sunColor).toBe(0xffb877);
    expect(wave.lighting.sunIntensity).toBe(1.2);
    expect(wave.lighting.ambientColor).toBe(0x6e7fa8);
    expect(wave.lighting.ambientIntensity).toBe(0.45);
    const direction = new THREE.Vector3(...wave.lighting.sunDirection).normalize();
    expect(THREE.MathUtils.radToDeg(Math.asin(direction.y))).toBeCloseTo(10, 6);
    expect(wave.mountainFog.color.getHex()).toBe(0xe8a070);
    expect(wave.mountainFog.density).toBe(0.25);
  });
});

describe('S4 海滨动态与资源约束', () => {
  it('反光带长 12m，以 0.5Hz、±0.08m 横移', () => {
    const { wave } = build();
    wave.reflectionBand.geometry.computeBoundingBox();
    const size = wave.reflectionBand.geometry.boundingBox!.getSize(new THREE.Vector3());
    expect(size.z).toBeCloseTo(12, 6);
    expect(wave.reflectionBand.position.x).toBe(wave.reflectionBaseX);
    tickStreetSeascape(wave, 0.5);
    expect(wave.reflectionBand.position.x).toBeCloseTo(wave.reflectionBaseX + 0.08, 6);
    tickStreetSeascape(wave, 1.5);
    expect(wave.reflectionBand.position.x).toBeCloseTo(wave.reflectionBaseX - 0.08, 6);
    tickStreetSeascape(wave, 2.5);
    expect(wave.reflectionBand.position.x).toBeCloseTo(wave.reflectionBaseX + 0.08, 6);
  });

  it('tick 驱动泡沫、叶片、光柱、反光带、云与光柱透明度；光柱每 8s 回到原位', () => {
    const { root, wave } = build();
    const shafts = instances(root, 'street-seascape-sun-light-shafts');
    tickStreetSeascape(wave, 0);
    const before = {
      foamZ: wave.foamBand.position.z,
      foamY: wave.foamBand.position.y,
      reflectionX: wave.reflectionBand.position.x,
      leaf: matrixSnapshot(wave.leafMotions[0].mesh),
      shaftRotation: wave.lightShafts[0].transform.rotation.z,
      cloud: wave.cloudMotions[0].matrix.toArray(),
      opacity: wave.lightShaftMaterial.opacity,
    };
    tickStreetSeascape(wave, 1.25);
    expect(wave.foamBand.position.z).not.toBe(before.foamZ);
    expect(wave.foamBand.position.y).not.toBe(before.foamY);
    expect(wave.reflectionBand.position.x).not.toBe(before.reflectionX);
    expect(matrixSnapshot(wave.leafMotions[0].mesh)).not.toEqual(before.leaf);
    expect(wave.lightShafts[0].transform.rotation.z).not.toBe(before.shaftRotation);
    expect(wave.cloudMotions[0].matrix.toArray()).not.toEqual(before.cloud);
    expect(wave.lightShaftMaterial.opacity).not.toBe(before.opacity);

    tickStreetSeascape(wave, 0);
    const shaftAngles = wave.lightShafts.map((motion) => motion.transform.rotation.z);
    const shaftMatrices = shafts.instanceMatrix.array.slice();
    tickStreetSeascape(wave, 8);
    wave.lightShafts.forEach((motion, index) => {
      expect(motion.transform.rotation.z).toBeCloseTo(shaftAngles[index], 6);
      const uploaded = new THREE.Matrix4();
      shafts.getMatrixAt(index, uploaded);
      motion.transform.updateMatrix();
      uploaded.elements.forEach((value, element) => {
        expect(value).toBeCloseTo(motion.transform.matrix.elements[element], 5);
      });
    });
    expect(shafts.instanceMatrix.array).toEqual(shaftMatrices);

    const opacities: number[] = [];
    for (let step = 0; step <= 80; step += 1) {
      tickStreetSeascape(wave, step / 10);
      opacities.push(wave.lightShaftMaterial.opacity);
    }
    const opacityRange = Math.max(...opacities) - Math.min(...opacities);
    expect(opacityRange).toBeGreaterThan(0.03);
    expect(opacityRange).toBeLessThanOrEqual(0.037);
    expect(() => tickStreetSeascape(null, 1)).not.toThrow();
    expect(() => tickStreetSeascape(wave, Number.NaN)).not.toThrow();
  });

  it('不新增 PointLight、HDR 或照片贴图，保留防波堤碰撞、警示牌、帆船灯塔远山与泡沫', () => {
    const { root, occluders, wave } = build();
    let pointLights = 0;
    const textures = new Set<THREE.Texture>();
    root.traverse((object) => {
      if (object instanceof THREE.PointLight) pointLights += 1;
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    });
    expect(pointLights).toBe(0);
    expect(textures.size).toBe(1);
    textures.forEach((texture) => expect(texture).toBeInstanceOf(THREE.CanvasTexture));
    expect(printed).toContain('海边 · 请勿翻越');
    expect(occluders).toHaveLength(1);
    expect(occluders[0]).toBe(mesh(root, 'street-seascape-seawall'));
    expect(instances(root, 'street-seascape-cyls').count).toBe(14);
    expect(instances(root, 'street-seascape-spheres').count).toBe(7);
    expect(root.getObjectByName('street-seascape-mountain')).toBeInstanceOf(THREE.Mesh);
    expect(wave.foamBand).toBe(mesh(root, 'street-seascape-foam-wave'));
    expect(root.getObjectByName('street-seascape-mountain-mist')).toBeInstanceOf(THREE.Mesh);
  });

  it('单几何不超过 2000 三角面、单模型不超过 2 材质，椰树全部实例化合批', () => {
    const { root, wave } = build();
    let meshCount = 0;
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      meshCount += 1;
      expect(triangles(object.geometry)).toBeLessThanOrEqual(2000);
      expect(Array.isArray(object.material) ? object.material.length : 1).toBeLessThanOrEqual(2);
      const positions = object.geometry.getAttribute('position');
      expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
    });
    expect(meshCount).toBeLessThan(60);

    const trunkCast = instances(root, 'street-seascape-palm-trunks-cast');
    const trunkContact = instances(root, 'street-seascape-palm-trunks-contact');
    const leafCast = instances(root, 'street-seascape-palm-leaves-cast');
    const leafContact = instances(root, 'street-seascape-palm-leaves-contact');
    expect(trunkCast.count + trunkContact.count).toBeLessThanOrEqual(wave.palms.length * 6);
    expect(leafCast.count + leafContact.count).toBeLessThanOrEqual(wave.palms.length * 2 * 11);
    const maxModelTriangles = 6 * triangles(trunkCast.geometry)
      + 2 * 11 * triangles(leafCast.geometry);
    expect(maxModelTriangles).toBeLessThanOrEqual(2000);
    const palmMaterials = new Set([
      trunkCast.material,
      trunkContact.material,
      leafCast.material,
      leafContact.material,
    ]);
    expect(palmMaterials.size).toBe(2);
    for (const batch of [trunkCast, trunkContact, leafCast, leafContact,
      instances(root, 'street-seascape-palm-mounds'), instances(root, 'street-seascape-palm-contacts')]) {
      expect(batch).toBeInstanceOf(THREE.InstancedMesh);
      expect(Array.isArray(batch.material)).toBe(false);
    }
  });
});
