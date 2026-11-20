import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHARED_RESOURCE_FLAG } from '../world/resources';
import { buildingRuntime, createBuildingDefinition } from './building';
import { disposeMaterialCache, getFoliageMaterial, getPavingMaterial, getPlasterMaterial } from './materials';
import { EventBus } from '../core/eventBus';
import type { ColorBloomUniforms } from './colorBloom';
import { sampleColorBloomReveal } from './colorBloom';

// 仅替代 Node 中不存在的 Canvas；场景、材质工厂、角色工厂和所有几何均使用真实实现。
beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {}, fillRect: () => {}, fillText: () => {},
      beginPath: () => {}, arc: () => {}, ellipse: () => {}, fill: () => {},
      moveTo: () => {}, lineTo: () => {}, closePath: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }),
    }),
  }) });
});

const roots: THREE.Group[] = [];
function disposeLocal(root: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  for (const geometry of geometries) if (!geometry.userData[SHARED_RESOURCE_FLAG]) geometry.dispose();
  for (const material of materials) if (!material.userData[SHARED_RESOURCE_FLAG]) material.dispose();
  root.clear();
}
afterEach(() => {
  buildingRuntime.exit();
  for (const root of roots) disposeLocal(root);
  roots.length = 0;
  disposeMaterialCache();
  vi.unstubAllGlobals();
});

function build(sceneId: 'S8' | 'S9' = 'S8') {
  const root = new THREE.Group();
  roots.push(root);
  const definition = createBuildingDefinition(sceneId);
  const built = definition.build(root);
  root.updateMatrixWorld(true);
  return { root, definition, built };
}

interface ActualPart {
  mesh: THREE.Mesh;
  index?: number;
  matrix: THREE.Matrix4;
  p: THREE.Vector3;
  size: THREE.Vector3;
  bounds: THREE.Box3;
  material: THREE.Material;
}
function actualParts(root: THREE.Object3D): ActualPart[] {
  const parts: ActualPart[] = [];
  root.traverse((mesh) => {
    if (!(mesh instanceof THREE.Mesh)) return;
    mesh.geometry.computeBoundingBox();
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const add = (matrix: THREE.Matrix4, index?: number): void => {
      const p = new THREE.Vector3();
      const size = new THREE.Vector3();
      matrix.decompose(p, new THREE.Quaternion(), size);
      parts.push({ mesh, index, matrix, p, size, bounds: mesh.geometry.boundingBox!.clone().applyMatrix4(matrix), material });
    };
    if (mesh instanceof THREE.InstancedMesh) {
      for (let i = 0; i < mesh.count; i += 1) {
        const matrix = new THREE.Matrix4();
        mesh.getMatrixAt(i, matrix);
        add(matrix.premultiply(mesh.matrixWorld), i);
      }
    } else add(mesh.matrixWorld.clone());
  });
  return parts;
}
function detailBoxes(parts: ActualPart[], hex: number): ActualPart[] {
  return parts.filter((part) => part.mesh.userData.campusDetail && part.mesh.geometry.type === 'BoxGeometry'
    && part.material instanceof THREE.MeshStandardMaterial && part.material.color.getHex() === hex);
}
function union(parts: ActualPart[]): THREE.Box3 {
  const bounds = new THREE.Box3();
  for (const part of parts) bounds.union(part.bounds);
  return bounds;
}
function ringOf(root: THREE.Object3D): THREE.InstancedMesh {
  const rings: THREE.Object3D[] = [];
  root.traverse((object) => { if (object.userData.horizonRing || object.name === 'building-horizon-ring') rings.push(object); });
  expect(rings).toHaveLength(1);
  expect(rings[0]).toBeInstanceOf(THREE.InstancedMesh);
  return rings[0] as THREE.InstancedMesh;
}

/** 从真实三角面与水平面的交线推导角区间并求并集，验证所有方向连续覆盖，而非只检查中心点。 */
function expectContinuousLayer(ring: THREE.InstancedMesh, origin: THREE.Vector3, height: number, layer: number): void {
  const positions = ring.geometry.getAttribute('position');
  const indices = ring.geometry.index;
  const vertexCount = indices ? indices.count : positions.count;
  const intervals: Array<[number, number]> = [];
  const tau = Math.PI * 2;
  for (let instance = layer * 48; instance < (layer + 1) * 48; instance += 1) {
    const matrix = new THREE.Matrix4();
    ring.getMatrixAt(instance, matrix);
    matrix.premultiply(ring.matrixWorld);
    const center = new THREE.Vector3().setFromMatrixPosition(matrix);
    const centerAngle = Math.atan2(center.z - origin.z, center.x - origin.x);
    let minimum = Infinity;
    let maximum = -Infinity;
    for (let triangle = 0; triangle < vertexCount; triangle += 3) {
      const points = [0, 1, 2].map((offset) => new THREE.Vector3()
        .fromBufferAttribute(positions, indices ? indices.getX(triangle + offset) : triangle + offset).applyMatrix4(matrix));
      for (let edge = 0; edge < 3; edge += 1) {
        const a = points[edge];
        const b = points[(edge + 1) % 3];
        if ((a.y - height) * (b.y - height) > 0 || Math.abs(a.y - b.y) < 1e-9) continue;
        const point = a.clone().lerp(b, (height - a.y) / (b.y - a.y));
        let delta = Math.atan2(point.z - origin.z, point.x - origin.x) - centerAngle;
        while (delta > Math.PI) delta -= tau;
        while (delta < -Math.PI) delta += tau;
        minimum = Math.min(minimum, centerAngle + delta);
        maximum = Math.max(maximum, centerAngle + delta);
      }
    }
    expect(Number.isFinite(minimum), `layer ${layer}, instance ${instance}, y=${height}`).toBe(true);
    expect(maximum - minimum).toBeGreaterThan(0.02);
    expect(maximum - minimum).toBeLessThan(Math.PI);
    const start = ((minimum % tau) + tau) % tau;
    const end = start + maximum - minimum;
    if (end > tau) intervals.push([start, tau], [0, end - tau]);
    else intervals.push([start, end]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let covered = 0;
  for (const [start, end] of intervals) {
    expect(start, `layer ${layer}, from=${origin.x},${origin.z}, y=${height}, gap=${start - covered}`).toBeLessThanOrEqual(covered + 1e-6);
    covered = Math.max(covered, end);
  }
  expect(covered).toBeCloseTo(tau, 6);
}

describe('M3 模块6：教学楼真实几何封边', () => {
  it('两侧完整缺口都有连廊屋檐、双排方柱、砖墙栅栏、后高绿篱及相接配楼', () => {
    const { root } = build();
    const parts = actualParts(root);
    for (const side of [-1, 1]) {
      const roofs = detailBoxes(parts, 0x657568).filter((part) => Math.sign(part.p.x) === side
        && Math.abs(part.p.z + 47.2) < 0.01 && part.p.y > 3.4 && part.size.x > 13);
      expect(roofs).toHaveLength(1);
      expect(roofs[0].bounds.min.z).toBeLessThan(-48.9);
      expect(roofs[0].bounds.max.z).toBeGreaterThan(-45.4);
      const roofMeshes = Array.from(new Set(roofs.map((part) => part.mesh)));
      for (let x = 9; x <= 22; x += 0.25) {
        const ray = new THREE.Raycaster(new THREE.Vector3(side * x, 4, -47.2), new THREE.Vector3(0, -1, 0), 0, 1);
        const hits = ray.intersectObjects(roofMeshes);
        expect(hits.some((hit) => hit.object === roofs[0].mesh && hit.instanceId === roofs[0].index), `roof ${side}, x=${x}`).toBe(true);
      }
      const columns = detailBoxes(parts, 0xdfdac9).filter((part) => Math.sign(part.p.x) === side
        && part.size.y > 3.3 && part.size.y < 3.4 && part.size.x < 0.4
        && part.p.z > -48.6 && part.p.z < -45.8);
      expect(columns).toHaveLength(12);
      for (const z of [-45.85, -48.55]) {
        const xs = columns.filter((part) => Math.abs(part.p.z - z) < 0.01).map((part) => Math.abs(part.p.x)).sort((a, b) => a - b);
        expect(xs).toHaveLength(6);
        expect(xs[0]).toBeCloseTo(9.25);
        expect(xs[5]).toBeCloseTo(22);
        for (let i = 1; i < xs.length; i += 1) expect(xs[i] - xs[i - 1]).toBeCloseTo(2.55);
      }
      const wall = detailBoxes(parts, 0x96766a).filter((part) => Math.sign(part.p.x) === side && Math.abs(part.p.z + 49.3) < 0.01);
      expect(wall).toHaveLength(1);
      expect(wall[0].size.x).toBeCloseTo(13.3);
      expect(wall[0].bounds.max.y).toBeCloseTo(0.86);
      const bars = detailBoxes(parts, 0x414e49).filter((part) => Math.sign(part.p.x) === side
        && Math.abs(part.p.z + 49.3) < 0.01 && part.size.y > 1.1 && part.size.y < 1.2);
      expect(bars).toHaveLength(27);
      expect(union(bars).max.y).toBeGreaterThan(2.1);
      expect(union(bars).max.x - union(bars).min.x).toBeGreaterThan(13);
      const hedges = parts.filter((part) => part.mesh.userData.campusDetail && part.material.userData.windTime
        && Math.sign(part.p.x) === side && Math.abs(part.p.z + 50.95) < 0.01 && part.size.y > 3.4);
      expect(hedges).toHaveLength(9);
      const sorted = hedges.map((part) => part.bounds).sort((a, b) => a.min.x - b.min.x);
      for (let i = 1; i < sorted.length; i += 1) expect(sorted[i].min.x).toBeLessThan(sorted[i - 1].max.x);
      expect(union(hedges).max.y).toBeGreaterThan(3.7);
      expect(union(hedges).max.z).toBeLessThan(wall[0].bounds.min.z);
      const extension = detailBoxes(parts, 0xffffff).filter((part) => part.material === getPlasterMaterial({ repeatX: 3, repeatY: 2 })
        && Math.sign(part.p.x) === side && part.size.y > 8 && part.p.z < -40);
      expect(extension).toHaveLength(1);
      const originalWing = parts.find((part) => part.material === extension[0].material && !part.mesh.userData.campusDetail
        && Math.sign(part.p.x) === side && part.size.y > 10 && Math.abs(part.p.x) > 15)!;
      expect(originalWing).toBeDefined();
      expect(extension[0].bounds.intersectsBox(originalWing.bounds)).toBe(true);
      expect(extension[0].bounds.min.z).toBeLessThan(-53);
      expect(extension[0].bounds.intersectsBox(roofs[0].bounds)).toBe(true);
      const litWindows = detailBoxes(parts, 0xddc99b).filter((part) => Math.sign(part.p.x) === side
        && part.p.z < -40 && part.size.y > 1.4 && part.size.y < 1.6);
      expect(litWindows.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('两侧树后高矮乔灌木、双车棚、公告亭与球场剪影均为真实可见几何', () => {
    const { root } = build();
    const parts = actualParts(root);
    const tires = root.getObjectByName('building-bicycle-tires') as THREE.InstancedMesh;
    const rims = root.getObjectByName('building-bicycle-rims') as THREE.InstancedMesh;
    expect(tires.geometry).toBeInstanceOf(THREE.TorusGeometry);
    expect(tires.count).toBe(12);
    expect(rims.count).toBe(12);
    for (const side of [-1, 1]) {
      const trunks = root.getObjectByName(`building-second-row-trunks-${side}`) as THREE.InstancedMesh;
      const crowns = root.getObjectByName(`building-second-row-crowns-${side}`) as THREE.InstancedMesh;
      const shrubs = root.getObjectByName(`building-second-row-shrubs-${side}`) as THREE.InstancedMesh;
      expect(trunks.count).toBe(7);
      expect(crowns.count).toBe(35);
      expect(shrubs.count).toBe(21);
      const trees = parts.filter((part) => part.mesh === trunks);
      expect(Math.min(...trees.map((part) => part.p.z))).toBeLessThan(-53);
      expect(Math.max(...trees.map((part) => part.p.z))).toBeGreaterThan(-9);
      expect(new Set(trees.map((part) => part.size.y.toFixed(2))).size).toBeGreaterThanOrEqual(6);
      expect(Math.max(...trees.map((part) => part.size.y)) - Math.min(...trees.map((part) => part.size.y))).toBeGreaterThan(2.5);
      expect(Math.max(...trees.map((part) => Math.abs(part.p.x))) - Math.min(...trees.map((part) => Math.abs(part.p.x)))).toBeGreaterThan(12);
      expect((crowns.material as THREE.Material).userData.windTime).toBe((shrubs.material as THREE.Material).userData.windTime);
      const x = side < 0 ? -17.3 : 12.55;
      const z = side < 0 ? -13.5 : -9.7;
      const roof = detailBoxes(parts, 0x657568).filter((part) => Math.abs(part.p.x - x) < 0.01 && Math.abs(part.p.z - z) < 0.01);
      expect(roof).toHaveLength(1);
      expect(roof[0].size.x).toBeCloseTo(3.65);
      expect(roof[0].size.z).toBeCloseTo(7.4);
      expect(parts.filter((part) => part.mesh === tires && Math.sign(part.p.x) === side)).toHaveLength(6);
      const kiosk = root.getObjectByName(`building-announcement-kiosk-${side}`) as THREE.Mesh;
      expect(kiosk.geometry).toBeInstanceOf(THREE.PlaneGeometry);
      expect(kiosk.userData.campusDetail).toBe(true);
      const from = new THREE.Vector3(0.2, 1.56, kiosk.position.z);
      const ray = new THREE.Raycaster(from, kiosk.position.clone().sub(from).normalize(), 0, from.distanceTo(kiosk.position) + 0.1);
      const environment = root.children.filter((object) => !object.userData.actorModelId);
      const hits = ray.intersectObjects(environment, true);
      expect(hits[0]?.object, `kiosk ${side} 的公告面须能透过树干空隙看到`).toBe(kiosk);
      const kioskRoof = detailBoxes(parts, 0x657568).filter((part) => Math.abs(part.p.x - (kiosk.position.x + side * 0.071)) < 0.01
        && Math.abs(part.p.z - kiosk.position.z) < 0.01 && part.p.y > 2.6 && part.p.y < 2.8);
      expect(kioskRoof).toHaveLength(1);
      expect(kioskRoof[0].size.x).toBeCloseTo(1.94);
      expect(kioskRoof[0].size.z).toBeCloseTo(2.46);
      const boards = detailBoxes(parts, 0xdfdac9).filter((part) => Math.sign(part.p.x) === side
        && Math.abs(part.p.z + 11.2) < 0.01 && part.size.y > 0.9 && part.size.y < 1 && part.size.z > 1.5);
      expect(boards).toHaveLength(1);
      const poles = parts.filter((part) => part.mesh.userData.campusDetail && part.mesh.geometry.type === 'CylinderGeometry'
        && Math.sign(part.p.x) === side && part.size.y > 7.8 && part.p.z > -7 && part.p.z < -4);
      expect(poles).toHaveLength(2);
    }
    const hoops = root.getObjectByName('building-court-hoops') as THREE.InstancedMesh;
    expect(hoops.count).toBe(2);
    expect(hoops.geometry).toBeInstanceOf(THREE.TorusGeometry);
  });

  it('远景仅一个有体积的低面数实例批，三层山峰有起伏、青灰蓝黛绿渐变且融雾', () => {
    const { root, definition } = build();
    const ring = ringOf(root);
    expect(ring.name).toBe('building-horizon-ring');
    expect(ring.userData.horizonRing).toBe(true);
    expect(ring.userData.campusDetail).toBeUndefined();
    expect(ring.count).toBe(144);
    expect(Array.isArray(ring.material)).toBe(false);
    expect(ring.material).toBeInstanceOf(THREE.MeshLambertMaterial);
    const material = ring.material as THREE.MeshLambertMaterial;
    expect(material.flatShading).toBe(true);
    expect(material.fog).toBe(true);
    expect(material.transparent).toBe(false);
    expect(material.opacity).toBe(1);
    expect(material.depthWrite).toBe(true);
    expect(ring.castShadow).toBe(false);
    expect(ring.receiveShadow).toBe(false);
    expect(ring.geometry.groups).toHaveLength(0);
    const position = ring.geometry.getAttribute('position');
    const triangles = (ring.geometry.index ? ring.geometry.index.count : position.count) / 3;
    expect(triangles).toBe(32);
    expect(triangles * ring.count).toBe(4608);
    expect(triangles * ring.count).toBeLessThanOrEqual(5000);
    ring.geometry.computeBoundingBox();
    const size = ring.geometry.boundingBox!.getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(1.9);
    expect(size.z).toBeGreaterThan(1.9);
    expect(size.y).toBe(1);
    for (let i = 0; i < position.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(position, i);
      const b = new THREE.Vector3().fromBufferAttribute(position, i + 1);
      const c = new THREE.Vector3().fromBufferAttribute(position, i + 2);
      expect(b.sub(a).cross(c.sub(a)).length()).toBeGreaterThan(0.01);
    }
    const bounds = new THREE.Box3().setFromObject(ring);
    expect(bounds.min.x).toBeLessThan(-60);
    expect(bounds.max.x).toBeGreaterThan(60);
    expect(bounds.min.x).toBeGreaterThan(-66);
    expect(bounds.max.x).toBeLessThan(66);
    // 真实圆环不压缩 Z 轴：保留原 X 范围，必要外景边界扩展至约 z -89..41。
    expect(bounds.min.z).toBeGreaterThan(-90);
    expect(bounds.min.z).toBeLessThan(-88);
    expect(bounds.max.z).toBeGreaterThan(40);
    expect(bounds.max.z).toBeLessThan(42);
    expect(bounds.min.y).toBe(-4);
    const ringCenter = new THREE.Vector3().setFromMatrixPosition(ring.matrixWorld);
    expect(ringCenter.toArray()).toEqual([0, 0, -24]);
    expect(ring.scale.toArray()).toEqual([1, 1, 1]);
    expect(bounds.min.z).toBeCloseTo(bounds.min.x + ringCenter.z, 4);
    expect(bounds.max.z).toBeCloseTo(bounds.max.x + ringCenter.z, 4);
    const fog = new THREE.Color(definition.fog!.color);
    const colors = new Set<string>();
    const means: THREE.Color[] = [];
    const distances: number[] = [];
    for (let layer = 0; layer < 3; layer += 1) {
      const heights: number[] = [];
      const mean = new THREE.Color(0, 0, 0);
      let distance = 0;
      for (let i = layer * 48; i < (layer + 1) * 48; i += 1) {
        const matrix = new THREE.Matrix4();
        ring.getMatrixAt(i, matrix);
        const p = new THREE.Vector3();
        const s = new THREE.Vector3();
        matrix.premultiply(ring.matrixWorld);
        matrix.decompose(p, new THREE.Quaternion(), s);
        expect(Math.hypot(p.x - ringCenter.x, p.z - ringCenter.z)).toBeGreaterThanOrEqual(54.99);
        expect(Math.hypot(p.x - ringCenter.x, p.z - ringCenter.z)).toBeLessThanOrEqual(78);
        expect(s.z).toBeGreaterThan(3.5);
        heights.push(p.y + s.y);
        const color = new THREE.Color();
        ring.getColorAt(i, color);
        colors.add(color.getHexString());
        const hsl = color.clone().convertLinearToSRGB().getHSL({ h: 0, s: 0, l: 0 });
        expect(hsl.s).toBeLessThan(0.22);
        expect(hsl.h).toBeGreaterThan(0.36);
        expect(hsl.h).toBeLessThan(0.64);
        mean.add(color);
        distance += Math.hypot(color.r - fog.r, color.g - fog.g, color.b - fog.b);
      }
      expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(3);
      means.push(mean.multiplyScalar(1 / 48));
      distances.push(distance / 48);
    }
    expect(colors.size).toBeGreaterThan(50);
    expect(means[0].g).toBeGreaterThan(means[0].b);
    expect(means[2].b).toBeGreaterThan(means[2].g);
    expect(means[1].r).toBeGreaterThan(means[0].r);
    expect(means[2].r).toBeGreaterThan(means[1].r);
    expect(distances[1]).toBeLessThan(distances[0]);
    expect(distances[2]).toBeLessThan(distances[1]);
  });

  it('从出生点、路线中后段和爸爸处，地坪至视平线每个方向连续封边且有三重层次', () => {
    const { root } = build();
    const ring = ringOf(root);
    for (const z of [1.2, -24, -43, 8.6]) {
      const from = new THREE.Vector3(0.2, 1.6, z);
      for (const height of [0.02, 1.6, 3.2]) {
        for (let layer = 0; layer < 3; layer += 1) expectContinuousLayer(ring, from, height, layer);
      }
      for (let degree = 0; degree < 360; degree += 0.5) {
        const angle = degree * Math.PI / 180;
        const ray = new THREE.Raycaster(from, new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)), 0, 160);
        const hits = ray.intersectObject(ring);
        expect(new Set(hits.map((hit) => Math.floor(hit.instanceId! / 48))).size, `from z=${z}, degree=${degree}`).toBe(3);
        expect(hits[0].distance).toBeGreaterThan(10);
      }
    }
  }, 20000);

  it('全部近中景的完整变换几何及风幅避开 x±1.2，真实多起点爸爸回望与中央通行保持畅通', () => {
    const { root, built, definition } = build();
    const parts = actualParts(root).filter((part) => part.mesh.userData.campusDetail);
    expect(parts.length).toBeGreaterThan(1500);
    for (const part of parts) {
      const bounds = part.bounds.clone();
      if (part.material.userData.windTime) bounds.expandByScalar(part.mesh.userData.meadow ? 0.09 : 0.04);
      expect(bounds.min.x > 1.2 || bounds.max.x < -1.2, `${part.mesh.name}/${part.index}: ${bounds.min.x}..${bounds.max.x}`).toBe(true);
    }
    const environment = root.children.filter((object) => !Object.values(built.actors ?? {}).includes(object));
    for (const x of [-1.15, 0.2, 1.15]) {
      for (const z of [-1, -12, -25, -37, -43.5]) {
        for (const y of [0.95, 1.5, 1.7]) {
          const from = new THREE.Vector3(x, 1.6, z);
          const to = new THREE.Vector3(0, y, 8.6);
          const ray = new THREE.Raycaster(from, to.clone().sub(from).normalize(), 0, from.distanceTo(to) - 0.6);
          expect(ray.intersectObjects(environment, true), `father from=${x},${z}, target y=${y}`).toHaveLength(0);
        }
        const forward = new THREE.Raycaster(new THREE.Vector3(x, 0.7, z), new THREE.Vector3(0, 0, -1), 0, 0.3);
        expect(forward.intersectObjects(environment, true)).toHaveLength(0);
      }
    }
    expect(built.actors!.father.position.toArray()).toEqual([0, 0, 8.6]);
    expect(built.actors!.linxia.position.toArray()).toEqual([1.3, 0, -1]);
    expect(built.actors!.campusReader.userData).toMatchObject({ actorModelId: 'studentFemale', campusIdleClip: 'idle' });
    expect(built.actors!.campusObserver.userData).toMatchObject({ actorModelId: 'studentMale', campusIdleClip: 'fold_arms' });
    expect(definition.nav.bounds).toEqual({ minX: -5.8, maxX: 5.8, minZ: -49.2, maxZ: 9 });
    expect(definition.nav.obstacles.map((obstacle) => obstacle.id)).toEqual([
      'building-tree-0', 'building-tree-1', 'building-tree-2', 'building-tree-3', 'building-facade', 'building-father',
    ]);
    expect(definition.hotspots![0]).toMatchObject({ id: 'look-back-father', position: { x: 0, y: 1.5, z: 8.6 } });
    const s9 = createBuildingDefinition('S9');
    expect(s9.sceneKey).toBe(definition.sceneKey);
    expect(s9.build).toBe(definition.build);
    expect(s9.nav).toBe(definition.nav);
    expect(s9.hotspots).toEqual([]);
  });

  it('新增树共用原风时钟，场景卸载释放全部实例缓冲而不销毁或染色共享缓存', () => {
    const first = build();
    const second = build('S9');
    const foliage = getFoliageMaterial();
    const plaster = getPlasterMaterial({ repeatX: 3, repeatY: 2 });
    const originalColor = plaster.color.getHex();
    const cacheDisposed = vi.fn();
    foliage.addEventListener('dispose', cacheDisposed);
    plaster.addEventListener('dispose', cacheDisposed);
    const meadows = first.root.children.filter((object) => object.userData.meadow) as THREE.InstancedMesh[];
    const crown = first.root.getObjectByName('building-second-row-crowns-1') as THREE.InstancedMesh;
    const time = (crown.material as THREE.Material).userData.windTime as { value: number };
    expect(time).toBe((meadows[0].material as THREE.Material).userData.windTime);
    expect(foliage.userData.windTime).toBeUndefined();
    const previous = time.value;
    buildingRuntime.tick!(0.25);
    expect(time.value).toBeCloseTo(previous + 0.25);
    const ring = ringOf(first.root);
    const nextRing = ringOf(second.root);
    expect(ring.geometry).not.toBe(nextRing.geometry);
    expect(ring.material).not.toBe(nextRing.material);
    expect(ring.instanceMatrix.array).not.toBe(nextRing.instanceMatrix.array);
    const disposals: Array<{ mesh: THREE.InstancedMesh; dispose: ReturnType<typeof vi.fn> }> = [];
    first.root.traverse((mesh) => {
      if (!(mesh instanceof THREE.InstancedMesh)) return;
      const dispose = vi.fn();
      mesh.addEventListener('dispose', dispose);
      disposals.push({ mesh, dispose });
    });
    expect(disposals.length).toBeGreaterThan(20);
    disposeLocal(first.root);
    for (const { mesh, dispose } of disposals) expect(dispose, mesh.name).toHaveBeenCalledTimes(1);
    expect(cacheDisposed).not.toHaveBeenCalled();
    expect(getFoliageMaterial()).toBe(foliage);
    expect(getPlasterMaterial({ repeatX: 3, repeatY: 2 })).toBe(plaster);
    expect(plaster.color.getHex()).toBe(originalColor);
    expect(plaster.userData[SHARED_RESOURCE_FLAG]).toBe(true);
    expect(nextRing.instanceMatrix.count).toBe(144);
    foliage.removeEventListener('dispose', cacheDisposed);
    plaster.removeEventListener('dispose', cacheDisposed);
  });
});

function bloomOf(built: ReturnType<typeof build>['built']): ColorBloomUniforms {
  return built.actors!.bloomEnvironment.userData.colorBloomUniforms as ColorBloomUniforms;
}

describe('M4 模块8：林荫道景观漫染集成', () => {
  it('铺装、草地、花坛砖石、草花与树冠共用独立 Uniform，标识楼体与人物不染色', () => {
    const { root, built } = build();
    const uniforms = bloomOf(built);
    const materials = new Set<THREE.Material>();
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    const bloomed = Array.from(materials).filter((material) => material.userData.colorBloomUniforms);
    expect(bloomed.map((material) => material.name)).toEqual(expect.arrayContaining([
      'building-bloom-paving', 'building-bloom-pocket-paving', 'building-bloom-lawn',
      'building-bloom-planter-brick', 'building-bloom-planter-stone', 'building-bloom-planter-cap',
      'building-bloom-meadow-grass', 'building-bloom-meadow-flowers', 'building-bloom-canopies', 'building-bloom-shrubs',
    ]));
    for (const material of bloomed) {
      expect(material.userData.colorBloomUniforms).toBe(uniforms);
      expect(material.userData[SHARED_RESOURCE_FLAG]).toBeUndefined();
    }
    for (const actor of Object.values(built.actors!).filter((object) => object.userData.actorModelId)) {
      actor.traverse((object) => {
        if (object instanceof THREE.Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) expect(material.userData.colorBloomUniforms).toBeUndefined();
      });
    }
    for (const material of materials) {
      if (material.userData.colorBloomUniforms) continue;
      expect(material.customProgramCacheKey()).not.toContain('color-bloom');
    }
    expect(getPavingMaterial({ repeatX: 6, repeatY: 36 }).userData.colorBloomUniforms).toBeUndefined();
    expect(getFoliageMaterial().userData.colorBloomUniforms).toBeUndefined();
    expect(getPlasterMaterial({ repeatX: 3, repeatY: 2 }).userData.colorBloomUniforms).toBeUndefined();
    const parts = actualParts(root);
    expect(parts.filter((part) => part.material.userData.colorBloomUniforms && part.material.name.includes('planter-')).every((part) => part.p.y < 0.6)).toBe(true);
    expect(parts.filter((part) => part.material instanceof THREE.MeshStandardMaterial && part.material.map && part.size.y >= 7).every((part) => !part.material.userData.colorBloomUniforms)).toBe(true);
  });

  it('风场与草花梯度保留，漫染读取扰动后的实例世界位置并保留全部共享引用', () => {
    const { root, built } = build();
    const uniforms = bloomOf(built);
    for (const name of ['building-meadow-wind-grass', 'building-meadow-wind-flowers', 'building-second-row-crowns-1']) {
      const mesh = root.getObjectByName(name) as THREE.Mesh;
      const material = mesh.material as THREE.MeshLambertMaterial | THREE.MeshStandardMaterial;
      const template = material instanceof THREE.MeshLambertMaterial ? THREE.ShaderLib.lambert : THREE.ShaderLib.standard;
      const shader = { uniforms: {}, vertexShader: template.vertexShader, fragmentShader: template.fragmentShader } as Parameters<THREE.Material['onBeforeCompile']>[0];
      material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
      expect(material.customProgramCacheKey()).toContain('campus-wind-v1:');
      expect(material.customProgramCacheKey()).toContain(':color-bloom-v1');
      expect(shader.vertexShader).toContain('foliageWorldPosition.x += breeze;');
      expect(shader.vertexShader).toContain('vBloomWorldPos = foliageWorldPosition.xyz;');
      expect(shader.vertexShader.indexOf('vBloomWorldPos =')).toBeGreaterThan(shader.vertexShader.indexOf('foliageWorldPosition.z += breeze'));
      if (name.includes('grass')) expect(shader.fragmentShader.indexOf('diffuseColor.rgb *= mix(uMeadowBottom')).toBeLessThan(shader.fragmentShader.indexOf('float bloomDistance'));
      expect(shader.uniforms.uPlayerPos).toBe(uniforms.uPlayerPos);
      expect(shader.uniforms.uRevealedZ).toBe(uniforms.uRevealedZ);
    }
  });

  it('运行时读真实脚底和林夏，回头时历史色彩与朝霞进度不倒退，离场停止更新', () => {
    const { built } = build();
    const uniforms = bloomOf(built);
    const player = new THREE.Vector3(0.2, 0, 1.2);
    const atmosphere = vi.fn();
    const getter = vi.fn((target: THREE.Vector3) => target.copy(player));
    buildingRuntime.enter({ sceneId: 'S8', bus: new EventBus(), actors: built.actors!, setInteractableVisible: () => {}, getPlayerFeet: getter, setAtmosphereProgress: atmosphere });
    const playerUniform = uniforms.uPlayerPos, companionUniform = uniforms.uCompanionPos;
    player.set(-0.3, 0, -20);
    built.actors!.linxia.position.set(0.5, 0, -24);
    buildingRuntime.tick!(0.25);
    expect(uniforms.uPlayerPos.value.toArray()).toEqual([-0.3, 0, -20]);
    expect(uniforms.uCompanionPos.value.toArray()).toEqual([0.5, 0, -24]);
    expect(uniforms.uRevealedZ.value).toBe(-24);
    expect(atmosphere).toHaveBeenLastCalledWith(23 / 43);
    expect(sampleColorBloomReveal(8, -23, uniforms)).toBe(1);
    player.z = 6;
    built.actors!.linxia.position.z = -10;
    buildingRuntime.tick!(0.5);
    expect(uniforms.uRevealedZ.value).toBe(-24);
    expect(sampleColorBloomReveal(8, -23, uniforms)).toBe(1);
    expect(atmosphere).toHaveBeenLastCalledWith(23 / 43);
    expect(uniforms.uPlayerPos).toBe(playerUniform);
    expect(uniforms.uCompanionPos).toBe(companionUniform);
    expect(getter).toHaveBeenCalledTimes(3);
    expect(getter.mock.calls.every(([target]) => target === getter.mock.calls[0][0])).toBe(true);
    expect(uniforms.uBloomTime.value).toBe(0.75);
    buildingRuntime.exit();
    expect(atmosphere).toHaveBeenLastCalledWith(0);
    const calls = getter.mock.calls.length;
    buildingRuntime.tick!(1);
    expect(getter).toHaveBeenCalledTimes(calls);
    expect(uniforms.uBloomTime.value).toBe(0.75);
  });

  it('新建 S8/S9 不共用历史边界或材质；重进建立新钩子且只更新当前实例', () => {
    const first = build();
    const second = build('S9');
    const a = bloomOf(first.built), b = bloomOf(second.built);
    expect(a).not.toBe(b);
    for (const key of Object.keys(a) as Array<keyof ColorBloomUniforms>) expect(a[key]).not.toBe(b[key]);
    const context = (actors: Record<string, THREE.Object3D>, sceneId: 'S8' | 'S9', z: number) => ({
      sceneId, bus: new EventBus(), actors, setInteractableVisible: () => {},
      getPlayerFeet: (target: THREE.Vector3) => target.set(0, 0, z), setAtmosphereProgress: vi.fn(),
    });
    const old = context(first.built.actors!, 'S8', -39);
    buildingRuntime.enter(old);
    buildingRuntime.tick!(0.4);
    expect(a.uRevealedZ.value).toBe(-39);
    expect(b.uRevealedZ.value).toBe(-1);
    buildingRuntime.exit();
    const next = context(second.built.actors!, 'S9', 1.2);
    buildingRuntime.enter(next);
    buildingRuntime.tick!(0.2);
    expect(b.uRevealedZ.value).toBe(-1);
    expect(b.uBloomTime.value).toBe(0.2);
    expect(a.uBloomTime.value).toBe(0.4);
    expect(old.setAtmosphereProgress).toHaveBeenLastCalledWith(0);
    expect(next.setAtmosphereProgress).toHaveBeenLastCalledWith(0);
  });
});
