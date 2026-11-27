// scenes3d/gateMorningSky.ts —— 校门/图书馆广场区域（S5/S6）清晨天空渲染与地平线远景剪影
// 保留地面建筑与人物不动，为原本空旷的清晨地平线补全：
// 1. 天顶淡蓝 → 中天粉蓝 → 地平线暖粉橙三段渐变 + 奶油黄低空光晕
// 2. 柔和低多边形淡金晨阳 + 大范围柔光晕
// 3. 低多边形软白晨云（白 + 暖粉金边）+ 晨雾云带 + 「人」字形飞鸟剪影
// 4. 远处地平线教学楼轮廓 ×3 + 深绿低多边形树影一排 + 电线杆剪影 + 地面衔接薄雾带

import * as THREE from 'three';

interface SkyPart {
  p: readonly [number, number, number];
  s: readonly [number, number, number];
  c: number;
  r?: readonly [number, number, number];
}

function bindDispose(geometry: THREE.BufferGeometry, mesh: THREE.InstancedMesh): void {
  const release = (): void => {
    mesh.dispose();
    geometry.removeEventListener('dispose', release);
  };
  geometry.addEventListener('dispose', release);
}

function addSkyBatch(
  parent: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  parts: SkyPart[],
): void {
  if (parts.length === 0) {
    geometry.dispose();
    return;
  }
  const mesh = new THREE.InstancedMesh(geometry, material, parts.length);
  const t = new THREE.Object3D();
  const c = new THREE.Color();
  parts.forEach((part, idx) => {
    t.position.set(part.p[0], part.p[1], part.p[2]);
    t.scale.set(part.s[0], part.s[1], part.s[2]);
    if (part.r) t.rotation.set(part.r[0], part.r[1], part.r[2]);
    else t.rotation.set(0, 0, 0);
    t.updateMatrix();
    mesh.setMatrixAt(idx, t.matrix);
    mesh.setColorAt(idx, c.setHex(part.c));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  bindDispose(geometry, mesh);
  parent.add(mesh);
}

export function buildGateMorningSkyAndHorizon(parent: THREE.Object3D): void {
  const group = new THREE.Group();
  group.name = 'gate-morning-sky-horizon';
  parent.add(group);

  const boxes: SkyPart[] = [];
  const spheres: SkyPart[] = [];

  /* --------------------------------------------------------------------------
   * 1. 远景地平线轮廓（接上空旷广场：教学楼剪影 ×3 + 深绿树影 + 淡色电线杆 + 薄雾）
   * 放在校内建筑与远山背后（z = -56..-68，横跨 x ∈ [-95, 95]）
   * 以及东西两侧远景延展，确保往左/右/前看都不再是一片空地平线
   * ------------------------------------------------------------------------ */
  const silhouettes: Array<[number, number, number, number, number, number]> = [
    [-42, -62, 16, 11.5, 6, 0x8ea0b5],
    [-21, -66, 14, 9.2, 6, 0x9aa9bc],
    [22, -65, 16, 10.6, 6, 0x8d9fb4],
    [45, -61, 18, 12.2, 6, 0x8899ae],
    // 西侧广场远方教学楼剪影（在地面延伸方向 x = -52..-68）
    [-64, -18, 8, 10.5, 18, 0x93a3b6],
    [-66, 4, 8, 9.2, 14, 0x9caac0],
    // 东侧远方剪影
    [64, -16, 8, 10.8, 18, 0x93a3b6],
  ];
  for (const [bx, bz, bw, bh, bd, col] of silhouettes) {
    boxes.push({ p: [bx, bh / 2 - 0.1, bz], s: [bw, bh, bd], c: col });
    boxes.push({ p: [bx, bh + 0.15, bz], s: [bw + 0.5, 0.35, bd + 0.5], c: 0x7b8ea3 });
  }

  // 一排深绿低多边形远景树影（沿地平线 z = -54..-58 及西侧 x = -54）
  for (let i = -7; i <= 7; i += 1) {
    if (Math.abs(i) <= 1) continue;
    const tx = i * 8.2;
    const tz = -55.5 - (Math.abs(i) % 2) * 2.2;
    spheres.push({ p: [tx, 2.2, tz], s: [2.6, 2.2, 2.4], c: i % 2 === 0 ? 0x5c7868 : 0x6b8673 });
    spheres.push({ p: [tx + 1.4, 1.8, tz + 0.6], s: [1.8, 1.6, 1.8], c: 0x627e6c });
  }
  for (let z = -34; z <= 14; z += 7.5) {
    spheres.push({ p: [-54, 2.1, z], s: [2.5, 2.1, 2.5], c: 0x5f7b6b });
    spheres.push({ p: [54, 2.1, z], s: [2.5, 2.1, 2.5], c: 0x5f7b6b });
  }

  // 淡色电线杆 / 路灯剪影
  for (const [px, pz] of [[-34, -52], [-18, -53], [19, -53], [36, -52], [-50, -10], [-50, 6]]) {
    boxes.push(
      { p: [px, 3.2, pz], s: [0.16, 6.4, 0.16], c: 0x7b8996 },
      { p: [px, 6.2, pz], s: [1.1, 0.1, 0.1], c: 0x7b8996 },
    );
  }

  // 地平线极淡薄雾带（衔接广场地面与天空，覆盖北侧及西/东远端）
  const mistMat = new THREE.MeshBasicMaterial({
    color: 0xf9ede6,
    transparent: true,
    opacity: 0.36,
    side: THREE.DoubleSide,
  });
  for (const [mx, my, mz, mw, mh, ry] of [
    [0, 2.1, -69, 180, 5.2, 0],
    [-70, 2.1, -18, 140, 5.2, Math.PI / 2],
    [70, 2.1, -18, 140, 5.2, Math.PI / 2],
  ] as Array<[number, number, number, number, number, number]>) {
    const mist = new THREE.Mesh(new THREE.PlaneGeometry(mw, mh), mistMat);
    mist.position.set(mx, my, mz);
    mist.rotation.y = ry;
    group.add(mist);
  }

  /* --------------------------------------------------------------------------
   * 2. 清晨三段渐变天空幕 + 奶油黄低空光晕 + 柔和晨阳 + 晨云 + 飞鸟
   * 围绕北面 (z = -76) 及西/东侧 (x = ±76) 布置，保证任何视角都看到有层次的清晨天空
   * ------------------------------------------------------------------------ */
  const skyPlanes: Array<{ x: number; z: number; ry: number; w: number }> = [
    { x: 0, z: -76, ry: 0, w: 190 },
    { x: -76, z: -18, ry: Math.PI / 2, w: 150 },
    { x: 76, z: -18, ry: -Math.PI / 2, w: 150 },
  ];
  const skyBands: Array<[number, number, number]> = [
    [0, 12, 0xf3cabd],  // 地平线暖粉橙
    [12, 24, 0xbed4e8], // 中天粉蓝
    [24, 46, 0x8bb8df], // 天顶淡蓝
  ];
  for (const sp of skyPlanes) {
    for (const [y0, y1, col] of skyBands) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(sp.w, y1 - y0 + 0.5),
        new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, fog: false }),
      );
      m.position.set(sp.x, (y0 + y1) / 2, sp.z);
      m.rotation.y = sp.ry;
      group.add(m);
    }
  }

  // 奶油黄低空柔光晕 + 偏右上角柔和低多边形晨阳（淡金/奶白）
  const sunX = 16;
  const sunY = 14.5;
  const sunZ = -74.6;
  const lowGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(96, 12),
    new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.28, side: THREE.DoubleSide, fog: false }),
  );
  lowGlow.position.set(sunX * 0.5, 6.2, sunZ - 0.2);
  group.add(lowGlow);

  const sunHalo = new THREE.Mesh(
    new THREE.CircleGeometry(10.5, 20),
    new THREE.MeshBasicMaterial({ color: 0xfff3d4, transparent: true, opacity: 0.32, side: THREE.DoubleSide, fog: false }),
  );
  sunHalo.position.set(sunX, sunY, sunZ);
  group.add(sunHalo);

  const morningSun = new THREE.Mesh(
    new THREE.CircleGeometry(3.6, 18),
    new THREE.MeshBasicMaterial({ color: 0xfff8e2, side: THREE.DoubleSide, fog: false }),
  );
  morningSun.position.set(sunX, sunY, sunZ + 0.2);
  group.add(morningSun);

  // 低多边形软白晨云 ×4（白 + 暖粉金底边）+ 晨雾云带 ×2
  const clouds: Array<[number, number, number, number, number, number]> = [
    [-26, 20, -73.2, 13, 2.2, 0xfdf8f4],
    [-8, 25, -73.0, 10, 1.8, 0xffffff],
    [28, 19, -73.2, 14, 2.0, 0xfff2e6],
    [-16, 11, -73.4, 22, 1.1, 0xfbe5d8], // 晨雾云带
    [6, 9.5, -73.4, 18, 1.0, 0xfce9dc],  // 晨雾云带
  ];
  for (const [cx, cy, cz, cw, ch, col] of clouds) {
    boxes.push({ p: [cx, cy, cz], s: [cw, ch, 0.4], c: col });
    if (ch > 1.4) {
      boxes.push({ p: [cx - cw * 0.14, cy + ch * 0.48, cz + 0.1], s: [cw * 0.52, ch * 0.65, 0.4], c: 0xffffff });
    }
  }
  // 西侧天空加两组软白云（照顾左侧广场视角）
  for (const [cz, cy, cw] of [[-24, 18, 12], [2, 22, 14]]) {
    boxes.push({ p: [-74.2, cy, cz], s: [0.4, 2.0, cw], c: 0xfdf8f4 });
    boxes.push({ p: [-74.1, cy + 1.0, cz + 1.2], s: [0.4, 1.3, cw * 0.55], c: 0xffffff });
  }

  // 天空右上方「人」字形飞鸟剪影 ×4
  for (const [bx, by, sc] of [[10, 23, 0.78], [13.5, 25.2, 0.66], [17.2, 22.8, 0.72], [20.5, 26.5, 0.6]]) {
    boxes.push(
      { p: [bx - 0.5 * sc, by, -72.2], s: [1.0 * sc, 0.13 * sc, 0.1], r: [0, 0, 0.34], c: 0x3f4c5c },
      { p: [bx + 0.5 * sc, by, -72.2], s: [1.0 * sc, 0.13 * sc, 0.1], r: [0, 0, -0.34], c: 0x3f4c5c },
    );
  }

  addSkyBatch(group, 'gate-morning-sky-boxes', new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), boxes);
  addSkyBatch(group, 'gate-morning-sky-spheres', new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), spheres);
}
