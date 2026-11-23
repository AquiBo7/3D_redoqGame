// S4 双格分类桶：几何结构与摆位红线
// 桶身是程序化闭合回转体，这里量的是"实心、封闭、法线朝外、位置没动"四件事，不是好看与否。

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./materials', () => {
  // S4 的程序化贴图要真 2D Canvas，无头环境没有：整模块换成纯色哑光材质
  const material = () => new THREE.MeshStandardMaterial();
  return {
    createContactShadowDiscBatch: () => null,
    getAsphaltMaterial: material,
    getPavingMaterial: material,
    getPlasterMaterial: material,
    getBarkMaterial: material,
    getFoliageMaterial: material,
    getWindowGlassMaterial: material,
    getWoodFloorMaterial: material,
    getFacadeBrickMaterial: material,
    getFacadeConcreteMaterial: material,
    getFacadeTileMaterial: material,
    getFacadeWindowMaterial: material,
    getStoreInteriorMaterial: material,
  };
});

import { getSceneDefinition } from './index';

const roots: THREE.Group[] = [];
beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => null }) });
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
});
afterEach(() => {
  for (const root of roots) {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }
  roots.length = 0;
  vi.unstubAllGlobals();
});

function buildBins() {
  const root = new THREE.Group();
  roots.push(root);
  getSceneDefinition('S4').build(root);
  root.updateMatrixWorld(true);
  const found: Record<string, THREE.InstancedMesh> = {};
  root.traverse((object) => {
    if (object instanceof THREE.InstancedMesh && object.name.startsWith('street-bins')) {
      found[object.name] = object;
    }
  });
  return found;
}

/** 顶点位置量化成 key：挤出体的侧壁与端盖不共享索引，只能按坐标判邻接 */
function keyOf(x: number, y: number, z: number): string {
  return `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
}

interface Triangles {
  a: Float32Array;
  b: Float32Array;
  c: Float32Array;
}

function trianglesOf(geometry: THREE.BufferGeometry): Triangles {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const index = geometry.getIndex();
  const count = (index ? index.count : position.count) - 2;
  const a = new Float32Array(Math.ceil(count / 3) * 3);
  const b = new Float32Array(a.length);
  const c = new Float32Array(a.length);
  let tri = 0;
  for (let i = 0; i < count; i += 3) {
    const read = (slot: number): [number, number, number] => {
      const v = index ? index.getX(i + slot) : i + slot;
      return [position.getX(v), position.getY(v), position.getZ(v)];
    };
    const pa = read(0);
    const pb = read(1);
    const pc = read(2);
    a[tri * 3] = pa[0]; a[tri * 3 + 1] = pa[1]; a[tri * 3 + 2] = pa[2];
    b[tri * 3] = pb[0]; b[tri * 3 + 1] = pb[1]; b[tri * 3 + 2] = pb[2];
    c[tri * 3] = pc[0]; c[tri * 3 + 1] = pc[1]; c[tri * 3 + 2] = pc[2];
    tri += 1;
  }
  return { a, b, c };
}

/**
 * 每条无向边必须恰好被两个三角形反向使用：缺面、破洞、翻折碎片都会破坏这个条件。
 * 回转体在转轴处会产生零面积三角形（三个顶点里有两个重合），它们不构成面，先剔除再判邻接。
 */
function edgeReport(geometry: THREE.BufferGeometry): { boundary: number; nonManifold: number } {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const index = geometry.getIndex();
  const key = (v: number): string => keyOf(position.getX(v), position.getY(v), position.getZ(v));
  const uses = new Map<string, number>();
  const total = index ? index.count : position.count;
  for (let i = 0; i < total; i += 3) {
    const loop = [index ? index.getX(i) : i, index ? index.getX(i + 1) : i + 1, index ? index.getX(i + 2) : i + 2];
    const keys = loop.map(key);
    if (keys[0] === keys[1] || keys[1] === keys[2] || keys[0] === keys[2]) continue;
    for (let s = 0; s < 3; s += 1) {
      const from = keys[s];
      const to = keys[(s + 1) % 3];
      const edge = from < to ? `${from}|${to}` : `${to}|${from}`;
      uses.set(edge, (uses.get(edge) ?? 0) + 1);
    }
  }
  let boundary = 0;
  let nonManifold = 0;
  uses.forEach((count) => {
    if (count === 1) boundary += 1;
    else if (count > 2) nonManifold += 1;
  });
  return { boundary, nonManifold };
}

/** 沿 +X 的奇偶射线求交，判一个点是否落在闭合网格内部 */
function isInside(mesh: Triangles, point: THREE.Vector3): boolean {
  let hits = 0;
  const triangles = mesh.a.length / 3;
  for (let t = 0; t < triangles; t += 1) {
    const ax = mesh.a[t * 3]; const ay = mesh.a[t * 3 + 1]; const az = mesh.a[t * 3 + 2];
    const dx = mesh.b[t * 3] - ax; const dy = mesh.b[t * 3 + 1] - ay; const dz = mesh.b[t * 3 + 2] - az;
    const ex = mesh.c[t * 3] - ax; const ey = mesh.c[t * 3 + 1] - ay; const ez = mesh.c[t * 3 + 2] - az;
    const det = dy * ez - ey * dz;
    if (Math.abs(det) < 1e-12) continue;
    const py = point.y - ay;
    const pz = point.z - az;
    const s = (py * ez - ey * pz) / det;
    if (s < 0 || s > 1) continue;
    const u = (dy * pz - py * dz) / det;
    if (u < 0 || s + u > 1) continue;
    if (ax + dx * s + ex * u > point.x) hits += 1;
  }
  return hits % 2 === 1;
}

/**
 * 逐三角形验证"法线朝外"：取面心，沿面法线外移必须在实体外、内移必须在实体内。
 * 用面法线而不是顶点法线：挤出件在棱边上做了顶点平滑，顶点法线被相邻两面平均后
 * 会斜着指向体外，判据会误报；面法线才对应"这张片的正反"。
 */
function inwardNormalCount(geometry: THREE.BufferGeometry): number {
  const mesh = trianglesOf(geometry);
  const triangles = mesh.a.length / 3;
  const epsilon = 0.0015;
  let wrong = 0;
  const out = new THREE.Vector3();
  const inn = new THREE.Vector3();
  for (let t = 0; t < triangles; t += 1) {
    const ax = mesh.a[t * 3]; const ay = mesh.a[t * 3 + 1]; const az = mesh.a[t * 3 + 2];
    const dx = mesh.b[t * 3] - ax; const dy = mesh.b[t * 3 + 1] - ay; const dz = mesh.b[t * 3 + 2] - az;
    const ex = mesh.c[t * 3] - ax; const ey = mesh.c[t * 3 + 1] - ay; const ez = mesh.c[t * 3 + 2] - az;
    let nx = dy * ez - dz * ey;
    let ny = dz * ex - dx * ez;
    let nz = dx * ey - dy * ex;
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-9) continue;
    nx /= length; ny /= length; nz /= length;
    const cx = ax + (dx + ex) / 3;
    const cy = ay + (dy + ey) / 3;
    const cz = az + (dz + ez) / 3;
    out.set(cx + nx * epsilon, cy + ny * epsilon, cz + nz * epsilon);
    inn.set(cx - nx * epsilon, cy - ny * epsilon, cz - nz * epsilon);
    if (isInside(mesh, out) || !isInside(mesh, inn)) wrong += 1;
  }
  return wrong;
}

function colorAt(geometry: THREE.BufferGeometry, index: number): THREE.Color {
  const color = geometry.getAttribute('color') as THREE.BufferAttribute;
  return new THREE.Color().setRGB(color.getX(index), color.getY(index), color.getZ(index));
}

describe('S4 分类垃圾桶几何', () => {
  it('六只桶按原位表摆放：BIN_SPOTS 三点 × 沿街道轴线 ±0.46，两色各三只', () => {
    const bins = buildBins();
    const expected = [
      { x: -2.1, z: [3.54, 4.46] },
      { x: 2.1, z: [-18.46, -17.54] },
      { x: -2.1, z: [-33.46, -32.54] },
    ];
    const seen: Array<[number, number]> = [];
    for (const name of ['street-bins-body-recyclable', 'street-bins-body-other']) {
      const mesh = bins[name];
      expect(mesh, name).toBeTruthy();
      expect(mesh.count).toBe(3);
      const transform = new THREE.Matrix4();
      for (let i = 0; i < mesh.count; i += 1) {
        mesh.getMatrixAt(i, transform);
        const position = new THREE.Vector3().setFromMatrixPosition(transform);
        seen.push([Math.round(position.x * 100) / 100, Math.round(position.z * 100) / 100]);
        expect(Math.round(position.y * 1e4)).toBe(0);
      }
    }
    seen.sort((l, r) => l[1] - r[1] || l[0] - r[0]);
    const wanted = expected
      .map((spot) => [spot.x, spot.z[0]] as [number, number], )
      .concat(expected.map((spot) => [spot.x, spot.z[1]] as [number, number]))
      .sort((l, r) => l[1] - r[1] || l[0] - r[0]);
    expect(seen).toEqual(wanted);
  });

  it('桶身是闭合实心回转体：无开口边、法线全部朝外、底面贴 y=0', () => {
    const bins = buildBins();
    for (const name of ['street-bins-body-recyclable', 'street-bins-body-other']) {
      const geometry = bins[name].geometry;
      const edges = edgeReport(geometry);
      expect(edges.boundary, `${name} 边界开口边`).toBe(0);
      expect(edges.nonManifold, `${name} 非流形边`).toBe(0);
      expect(inwardNormalCount(geometry), `${name} 反法线顶点`).toBe(0);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      expect(Math.round(box.min.y * 1e4)).toBe(0);
      expect(box.max.y).toBeCloseTo(0.757, 3);
      expect(Math.abs(box.min.x)).toBeCloseTo(0.301, 3);
      let nan = 0;
      const position = geometry.getAttribute('position');
      for (let i = 0; i < position.count; i += 1) {
        if (!Number.isFinite(position.getX(i)) || !Number.isFinite(position.getY(i)) || !Number.isFinite(position.getZ(i))) nan += 1;
      }
      expect(nan).toBe(0);
    }
  });

  it('桶身上下等径直筒，口沿水平切平有厚度，投料口内凹可见深度且不穿孔', () => {
    const bins = buildBins();
    const geometry = bins['street-bins-body-recyclable'].geometry;
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    // 外皮肤（半径 > 0.26、还没到桶口的那一段）只允许出现在两个高度上，且两处半径完全相同 = 上下等径直筒
    const wallRows = new Map<string, Set<string>>();
    let deepestMouthY = Infinity;
    let innerFloorExists = false;
    let rimFlatPoints = 0;
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      const radius = Math.hypot(x, z);
      if (radius > 0.26 && y > 0.02 && y < 0.73) {
        const row = keyOf(0, y, 0);
        if (!wallRows.has(row)) wallRows.set(row, new Set());
        wallRows.get(row)!.add(keyOf(radius, 0, 0));
      }
      if (radius < 0.2 && y > 0.3 && y < 0.6) deepestMouthY = Math.min(deepestMouthY, y);
      if (radius < 1e-6 && Math.abs(y - 0.585) < 1e-6) innerFloorExists = true;
      if (Math.abs(y - 0.757) < 1e-6 && radius > 0.24) rimFlatPoints += 1;
    }
    expect([...wallRows.keys()].sort()).toEqual([keyOf(0, 0.024, 0), keyOf(0, 0.712, 0)]);
    wallRows.forEach((radii) => {
      expect(radii.size).toBe(1);
      expect(Number([...radii][0].split(',')[0]) / 1e4).toBeCloseTo(0.28, 4);
    });
    // 内底封闭成一张圆面（轴心处有顶点），比口沿低 17 cm：看得见深度
    expect(innerFloorExists).toBe(true);
    expect(deepestMouthY).toBeCloseTo(0.585, 3);
    expect(0.757 - deepestMouthY).toBeGreaterThan(0.15);
    // 口沿顶面水平切平，且环面从内缘铺到外缘（厚度 3–4 cm）
    expect(rimFlatPoints).toBeGreaterThan(20);
  });

  it('遮檐接在桶顶靠墙一侧并向前悬出盖住投料口，侧面盒体吃进桶壁不悬空', () => {
    const bins = buildBins();
    const visor = bins['street-bins-visor'];
    expect(visor.count).toBe(6);
    visor.geometry.computeBoundingBox();
    const vb = visor.geometry.boundingBox!;
    // 后端埋到桶壁外沿（与口沿环带相交，不是悬浮薄壳），前端自由边悬在投料口上方但不越出桶口
    expect(vb.min.z).toBeLessThan(-0.3);
    expect(vb.max.z).toBeGreaterThan(0.15);
    expect(vb.max.z).toBeLessThan(0.238);
    // 檐面贴着桶顶拱起（基线 0.74 + 矢高 0.09），不抬成悬在半空的大板
    expect(vb.max.y).toBeGreaterThan(0.82);
    expect(vb.max.y).toBeLessThan(0.86);
    expect(vb.min.y).toBeLessThan(0.757);
    // 等厚：任意方位上的弧面厚度都约 26 mm（含 6 mm 倒角），宽度收在桶径之内
    expect(vb.max.x).toBeCloseTo(0.241, 3);
    let edges = edgeReport(visor.geometry);
    expect(edges.boundary, '遮檐边界开口边').toBe(0);
    expect(edges.nonManifold, '遮檐非流形边').toBe(0);
    expect(inwardNormalCount(visor.geometry), '遮檐反法线顶点').toBe(0);

    const box = bins['street-bins-flap-box'];
    expect(box.count).toBe(6);
    box.geometry.computeBoundingBox();
    const bb = box.geometry.boundingBox!;
    // 盒体沿街道方向凸出：内缘埋进桶壁（< 外壁半径 0.28），外缘露出 7 cm，且不越到桶面前后
    expect(bb.min.x).toBeLessThan(0.28);
    expect(bb.max.x).toBeGreaterThan(0.32);
    expect(Math.abs(bb.min.z)).toBeLessThan(0.1);
    expect(Math.abs(bb.max.z)).toBeLessThan(0.1);
    edges = edgeReport(box.geometry);
    expect(edges.boundary, '侧盒边界开口边').toBe(0);
    expect(edges.nonManifold, '侧盒非流形边').toBe(0);
    expect(inwardNormalCount(box.geometry), '侧盒反法线顶点').toBe(0);
  });

  it('两只桶分色：可回收暖黄、其他草绿，竖向渐变上浅下深，投料口内壁压成深色', () => {
    const bins = buildBins();
    const srgb = (color: THREE.Color): [number, number, number] =>
      [color.r, color.g, color.b].map((v) =>
        Math.min(1, Math.max(0, v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)),
      ) as [number, number, number];

    /** 朝街一侧（本地 +Z，两道侧向柔光带之间）的外壁探针，读到的就是纯竖向渐变色 */
    const wall = (name: string, y: number): [number, number, number] => {
      const position = bins[name].geometry.getAttribute('position') as THREE.BufferAttribute;
      const match = (x: number, z: number): boolean => Math.hypot(x, z) > 0.27 && z > 0.26 && Math.abs(x) < 0.02;
      for (const probeY of [y, y - 0.001, y + 0.001]) {
        for (let i = 0; i < position.count; i += 1) {
          if (Math.abs(position.getY(i) - probeY) < 1e-6 && match(position.getX(i), position.getZ(i))) {
            return srgb(colorAt(bins[name].geometry, i));
          }
        }
      }
      throw new Error(`${name} 找不到 y=${y} 的外壁探针顶点`);
    };

    const hex = (channel: [number, number, number]): string =>
      `#${channel.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;

    // 竖向渐变：顶部暖亮黄 #F5CB4A、底部琥珀橙 #DFA019（±3.5% 微磨砂抖动，逐通道容差 0.05）
    const yellowTargets = { top: [0xf5, 0xcb, 0x4a], bottom: [0xdf, 0xa0, 0x19] };
    const greenTargets = { top: [0x63, 0xc4, 0x2a], bottom: [0x3e, 0x9b, 0x10] };
    const closeTo = (actual: number[], wanted: number[], tolerance: number): boolean =>
      actual.every((v, i) => Math.abs(v - wanted[i] / 255) <= tolerance);
    const yellowTop = wall('street-bins-body-recyclable', 0.024);
    expect(closeTo(yellowTop, yellowTargets.bottom, 0.05), hex(yellowTop)).toBe(true);
    // 外壁只在 y = 0.024 / 0.712 有顶点：取口沿下方那一圈验证渐变上端确实更亮
    const yellowUp = wall('street-bins-body-recyclable', 0.712);
    expect(closeTo(yellowUp, yellowTargets.top, 0.06), hex(yellowUp)).toBe(true);
    expect(yellowUp[0]).toBeGreaterThan(yellowTop[0]);
    const greenLow = wall('street-bins-body-other', 0.024);
    expect(closeTo(greenLow, greenTargets.bottom, 0.05), hex(greenLow)).toBe(true);
    const greenUp = wall('street-bins-body-other', 0.712);
    expect(closeTo(greenUp, greenTargets.top, 0.06), hex(greenUp)).toBe(true);
    // 两只桶绝不能同色
    expect(hex(greenUp)).not.toBe(hex(yellowUp));
    expect(greenUp[1]).toBeGreaterThan(greenUp[0]);

    // 口沿环面 / 投料口内壁是不参与抖动与高光的纯色
    const flat = (name: string, test: (x: number, y: number, z: number, r: number) => boolean): string => {
      const geometry = bins[name].geometry;
      const position = geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < position.count; i += 1) {
        const x = position.getX(i);
        const y = position.getY(i);
        const z = position.getZ(i);
        if (test(x, y, z, Math.hypot(x, z))) return hex(srgb(colorAt(geometry, i)));
      }
      throw new Error(`${name} 找不到探针顶点`);
    };
    expect(flat('street-bins-body-recyclable', (x, y, z, r) => Math.abs(y - 0.757) < 1e-6 && r > 0.26 && r < 0.29 && z > 0.26 && Math.abs(x) < 0.02)).toBe('#6b4a22');
    expect(flat('street-bins-body-other', (x, y, z, r) => Math.abs(y - 0.757) < 1e-6 && r > 0.26 && r < 0.29 && z > 0.26 && Math.abs(x) < 0.02)).toBe('#2f5a1c');
    expect(flat('street-bins-body-recyclable', (_x, y, _z, r) => Math.abs(y - 0.585) < 1e-6 && r < 0.1)).toBe('#33261a');
    expect(flat('street-bins-body-other', (_x, y, _z, r) => Math.abs(y - 0.585) < 1e-6 && r < 0.1)).toBe('#1b2e10');
  });
});
