// scenes3d/buildingCampusUpgrades.ts —— S7/S8 教学楼区视觉与文化补完：
// 1. 公益宣传展板（三白区展示板 + 普法竖版海报贴图）
// 2. 自行车车棚白色停车位标线 + 树梢/天空「人」字形飞鸟剪影
// 3. 「千问高中」校门牌匾/柱顶灯饰/红褐墙基勾边/校前广场砖线/旗杆红旗/门前花坛灌木
// 4. 第四层青绿山水天际远山 + 层间淡白雾带 + 清晨柔和晨阳与晨云

import * as THREE from 'three';
import { createTextSign } from './shared';
import { SHARED_RESOURCE_FLAG } from '../world/resources';

interface UpgradeBoxPart {
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

function addBatch(
  parent: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  parts: UpgradeBoxPart[],
  castShadow = true,
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
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  bindDispose(geometry, mesh);
  parent.add(mesh);
}

function createMockSafeCanvasMaterial(
  width: number,
  height: number,
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.MeshStandardMaterial {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) paint(ctx, width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.88,
    emissive: 0x8f7450,
    emissiveMap: tex,
    emissiveIntensity: 0.06,
  });
  mat.userData[SHARED_RESOURCE_FLAG] = false;
  mat.addEventListener('dispose', () => tex.dispose());
  return mat;
}

/** 竖版「学法守法 · 用法护己」普法海报贴图（仅使用 fillRect/fillText/arc 等基础原语，兼容测试 mock） */
export function createLawKioskMaterial(): THREE.MeshStandardMaterial {
  return createMockSafeCanvasMaterial(440, 320, (c, w, h) => {
    c.fillStyle = '#faf4e6';
    c.fillRect(0, 0, w, h);
    // 顶部天蓝+暖金双色标题条
    c.fillStyle = '#2c6ea8';
    c.fillRect(10, 10, w - 20, 52);
    c.fillStyle = '#f2b84b';
    c.fillRect(10, 62, w - 20, 6);

    c.fillStyle = '#ffffff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = 'bold 26px "Microsoft YaHei", sans-serif';
    c.fillText('学法守法 · 用法护己', w / 2, 36, w - 32);

    // 左侧天平/盾牌圆形图标
    c.fillStyle = '#e6f1fa';
    c.beginPath();
    c.arc(72, 138, 40, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#2c6ea8';
    c.beginPath();
    c.arc(72, 138, 32, 0, Math.PI * 2);
    c.fill();
    // 白色盾牌与天平剪影
    c.fillStyle = '#ffffff';
    c.fillRect(60, 122, 24, 24);
    c.fillRect(65, 144, 14, 10);
    c.fillStyle = '#f2b84b';
    c.fillRect(56, 126, 32, 4);

    // 醒目标语
    c.textAlign = 'left';
    c.fillStyle = '#1f364d';
    c.font = 'bold 17px "Microsoft YaHei", sans-serif';
    c.fillText('语言暴力也是刀，慎言方显修养高', 128, 104, w - 144);
    c.fillText('遭遇欺凌留证据，及时向师长举报', 128, 134, w - 144);
    c.fillStyle = '#c45b28';
    c.font = 'bold 16px "Microsoft YaHei", sans-serif';
    c.fillText('法律是保护自己的盾牌！', 128, 164, w - 144);

    // 中下部：三不原则 + 三秒自查法
    c.fillStyle = '#eef5ee';
    c.fillRect(14, 188, w - 28, 72);
    c.fillStyle = '#387d52';
    c.fillRect(14, 188, 6, 72);
    c.fillStyle = '#254a34';
    c.font = 'bold 14px "Microsoft YaHei", sans-serif';
    c.fillText('三不原则：不轻信陌生链接 · 不泄露个人信息 · 不随意扫码', 28, 210, w - 50);
    c.fillText('三秒自查：①暂停操作 ②向老师家长求助 ③拨打96110反诈专线', 28, 240, w - 50);

    // 底部热线
    c.fillStyle = '#2c6ea8';
    c.fillRect(10, h - 42, w - 20, 32);
    c.fillStyle = '#fff9eb';
    c.textAlign = 'center';
    c.font = 'bold 15px "Microsoft YaHei", sans-serif';
    c.fillText('反诈 96110 · 紧急报警 110 · 青少年心理热线 12355', w / 2, h - 26, w - 36);
  });
}

/** 三白贴纸区宣传展示板贴图（米黄板面 + 红棕边框 + 三个带黄色标题条的白色贴纸区） */
function createTriPanelBoardMaterial(): THREE.MeshStandardMaterial {
  return createMockSafeCanvasMaterial(600, 320, (c, w, h) => {
    c.fillStyle = '#f1e4c7';
    c.fillRect(0, 0, w, h);
    const cols: Array<{ title: string; line1: string; line2: string; badge: string; accent: string }> = [
      {
        title: '拒绝网络暴力',
        line1: '键盘伤人也是伤害',
        line2: '不造谣 · 不信谣 · 不网暴',
        badge: '网络不是法外之地',
        accent: '#e07a3c',
      },
      {
        title: '向校园霸凌说不',
        line1: '不做沉默旁观者',
        line2: '互助友爱 · 礼让解矛盾',
        badge: '未保法第39条护航',
        accent: '#4a9b68',
      },
      {
        title: '健康心态 · 阳光成长',
        line1: '有烦恼勇敢说出来',
        line2: '多份倾听 · 少份伤害',
        badge: '心理热线 12355',
        accent: '#3e84b8',
      },
    ];
    const cardW = 178;
    const gap = 16;
    const startX = 17;
    cols.forEach((col, i) => {
      const x = startX + i * (cardW + gap);
      // 白色贴纸区
      c.fillStyle = '#fffdf8';
      c.fillRect(x, 18, cardW, h - 36);
      // 黄色标题条
      c.fillStyle = '#f4c752';
      c.fillRect(x, 18, cardW, 44);
      c.fillStyle = '#3d2a1d';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = 'bold 18px "Microsoft YaHei", sans-serif';
      c.fillText(col.title, x + cardW / 2, 40, cardW - 14);

      // 圆形低多边形徽章
      c.fillStyle = col.accent;
      c.beginPath();
      c.arc(x + cardW / 2, 108, 28, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#ffffff';
      if (i === 0) {
        c.fillRect(x + cardW / 2 - 14, 98, 28, 18);
        c.fillStyle = '#d93829';
        c.fillRect(x + cardW / 2 - 12, 106, 24, 4);
      } else if (i === 1) {
        c.fillRect(x + cardW / 2 - 10, 96, 20, 22);
        c.fillStyle = '#d93829';
        c.fillRect(x + cardW / 2 - 12, 106, 24, 4);
      } else {
        c.beginPath();
        c.arc(x + cardW / 2 - 6, 104, 8, 0, Math.PI * 2);
        c.arc(x + cardW / 2 + 6, 104, 8, 0, Math.PI * 2);
        c.fill();
        c.fillRect(x + cardW / 2 - 8, 106, 16, 10);
      }

      c.fillStyle = '#2d353b';
      c.font = 'bold 16px "Microsoft YaHei", sans-serif';
      c.fillText(col.line1, x + cardW / 2, 164, cardW - 16);
      c.fillStyle = '#536069';
      c.font = '14px "Microsoft YaHei", sans-serif';
      c.fillText(col.line2, x + cardW / 2, 198, cardW - 16);

      c.fillStyle = col.accent;
      c.fillRect(x + 14, h - 72, cardW - 28, 32);
      c.fillStyle = '#ffffff';
      c.font = 'bold 13px "Microsoft YaHei", sans-serif';
      c.fillText(col.badge, x + cardW / 2, h - 56, cardW - 36);
    });
  });
}

export function buildBuildingCampusUpgrades(parent: THREE.Object3D): void {
  const boxes: UpgradeBoxPart[] = [];
  const rods: UpgradeBoxPart[] = [];
  const spheres: UpgradeBoxPart[] = [];

  /* --------------------------------------------------------------------------
   * 1. 三白区宣传展示板（米黄底板 + 红棕边框，置于东侧休息口袋旁 x = 8.4, z = -22.2，不挡通行）
   * ------------------------------------------------------------------------ */
  {
    const bx = 8.45;
    const bz = -22.2;
    rods.push(
      { p: [bx, 0.9, bz - 0.96], s: [0.045, 1.8, 0.045], c: 0x3b4448 },
      { p: [bx, 0.9, bz + 0.96], s: [0.045, 1.8, 0.045], c: 0x3b4448 },
    );
    boxes.push(
      { p: [bx, 0.06, bz - 0.96], s: [0.22, 0.12, 0.22], c: 0x454f54 },
      { p: [bx, 0.06, bz + 0.96], s: [0.22, 0.12, 0.22], c: 0x454f54 },
      // 红棕边框底板
      { p: [bx, 1.56, bz], s: [0.09, 1.38, 2.28], c: 0x8d4838 },
      // 顶帽
      { p: [bx, 2.28, bz], s: [0.16, 0.08, 2.38], c: 0x6e372b },
    );
    const triMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.14, 1.24), createTriPanelBoardMaterial());
    triMesh.name = 'building-tri-panel-board';
    triMesh.position.set(bx - 0.052, 1.56, bz);
    triMesh.rotation.y = -Math.PI / 2;
    parent.add(triMesh);
  }

  /* --------------------------------------------------------------------------
   * 2. 自行车棚地面 3 条浅白停车位标线 + 车棚旁分类垃圾桶与庭院小路灯
   * ------------------------------------------------------------------------ */
  for (const shelter of [{ x: 12.55, z: -9.7 }, { x: -17.3, z: -13.5 }]) {
    for (let slot = 0; slot < 4; slot += 1) {
      const sz = shelter.z - 3.3 + slot * 2.2;
      boxes.push({ p: [shelter.x, -0.008, sz], s: [2.6, 0.008, 0.055], c: 0xedf2ea });
    }
    // 车棚旁绿色/灰色分类垃圾桶
    const side = Math.sign(shelter.x);
    const binX = shelter.x - side * 1.95;
    const binZ = shelter.z + 3.45;
    boxes.push(
      { p: [binX, 0.34, binZ - 0.24], s: [0.34, 0.68, 0.34], c: 0x43915a },
      { p: [binX, 0.69, binZ - 0.24], s: [0.37, 0.06, 0.37], c: 0x2f6840 },
      { p: [binX, 0.34, binZ + 0.2], s: [0.34, 0.68, 0.34], c: 0x6f7a82 },
      { p: [binX, 0.69, binZ + 0.2], s: [0.37, 0.06, 0.37], c: 0x4b5359 },
    );
  }

  /* --------------------------------------------------------------------------
   * 3. 树梢上方与天空处「人」字形低多边形飞鸟剪影 ×5
   * ------------------------------------------------------------------------ */
  const birdSpots: Array<[number, number, number, number]> = [
    [-14, 11.2, -10.5, 0.45],
    [-12.2, 12.4, -12.8, 0.38],
    [-9.5, 13.8, -16.5, 0.42],
    [11.5, 12.6, -8.5, 0.44],
    [4.2, 16.5, 22.0, 0.62],
    [-6.5, 18.2, 26.0, 0.56],
    [8.8, 17.5, 28.0, 0.52],
  ];
  for (const [bx, by, bz, sc] of birdSpots) {
    boxes.push(
      { p: [bx - 0.42 * sc, by, bz], s: [0.85 * sc, 0.09 * sc, 0.09 * sc], r: [0, 0, 0.36], c: 0x35424f },
      { p: [bx + 0.42 * sc, by, bz], s: [0.85 * sc, 0.09 * sc, 0.09 * sc], r: [0, 0, -0.36], c: 0x35424f },
    );
  }

  /* --------------------------------------------------------------------------
   * 4. 「千问高中」校门细节补齐（横梁副牌 + 门柱牌匾 + 柱顶暖球灯 + 红褐墙基勾边 + 广场分格线 + 旗杆红旗 + 红砖花坛）
   *    注意：全部落在 |x| >= 6.4 或地面铺装，绝不阻塞中央通道 |x| <= 5.8！
   * ------------------------------------------------------------------------ */
  // 横梁下方校训副牌 + 门柱正面小匾
  const mottoSign = createTextSign('QIANWEN HIGH SCHOOL · 求知 · 明理 · 笃行', 4.2, 0.24, {
    background: '#4b5d54',
    foreground: '#f7eac8',
    resolution: 320,
  });
  mottoSign.position.set(0, 4.02, 13.62);
  mottoSign.rotation.y = Math.PI;
  parent.add(mottoSign);

  // 校前地面灰色方砖分格线与门槛线（z = 11.2 .. 14.5）
  for (let z = 11.0; z <= 14.2; z += 1.0) {
    boxes.push({ p: [0, -0.011, z], s: [11.2, 0.008, 0.05], c: 0xe6e8e1 });
  }
  boxes.push({ p: [0, -0.006, 13.6], s: [11.6, 0.025, 0.32], c: 0xb7beb6 });

  for (const side of [-1, 1]) {
    // 红褐色墙基浅色石材勾边
    boxes.push({ p: [side * 6.4, 1.12, 14.2], s: [0.9, 0.07, 1.08], c: 0xe4dfd1 });
    // 门柱顶端球形校徽暖灯
    rods.push({ p: [side * 6.4, 4.4, 14.2], s: [0.06, 0.38, 0.06], c: 0x414e49 });
    spheres.push({ p: [side * 6.4, 4.65, 14.2], s: [0.22, 0.22, 0.22], c: 0xf7e3a8 });
    // 门柱白底金字「千问高中」竖/横小匾
    const colPlaque = createTextSign('千问高中', 0.62, 0.24, {
      background: '#faf4e6',
      foreground: '#b47a28',
      resolution: 256,
    });
    colPlaque.position.set(side * 6.4, 2.35, 13.71);
    colPlaque.rotation.y = Math.PI;
    parent.add(colPlaque);

    // 门柱外侧红砖花坛 + 圆形绿植（|x| = 7.75, z = 12.6，不挡行道）
    const fx = side * 7.75;
    const fz = 12.6;
    boxes.push(
      { p: [fx, 0.2, fz], s: [1.55, 0.4, 1.35], c: 0x966e60 },
      { p: [fx, 0.42, fz], s: [1.66, 0.06, 1.46], c: 0xdfdac9 },
    );
    spheres.push(
      { p: [fx - 0.3, 0.68, fz], s: [0.42, 0.34, 0.42], c: 0x628c5c },
      { p: [fx + 0.32, 0.72, fz + 0.12], s: [0.38, 0.36, 0.38], c: 0x769f68 },
    );
  }

  // 右侧门柱旁深色旗杆 + 迎风飘扬的红旗（x = 7.35, z = 13.5）
  rods.push({ p: [7.35, 3.6, 13.4], s: [0.045, 7.2, 0.045], c: 0x3b4448 });
  spheres.push({ p: [7.35, 7.28, 13.4], s: [0.09, 0.09, 0.09], c: 0xf0c954 });
  boxes.push(
    { p: [8.05, 6.65, 13.4], s: [1.35, 0.85, 0.03], r: [0, 0.14, 0], c: 0xd93a2e },
    { p: [7.62, 6.82, 13.42], s: [0.16, 0.16, 0.04], r: [0, 0.14, 0], c: 0xf7d64a },
  );

  /* --------------------------------------------------------------------------
   * 5. 第四层天际远山剪影 + 层间淡白雾带 + 清晨柔和晨阳与晨云（z = 38..62 校门外及北侧）
   * ------------------------------------------------------------------------ */
  // 在三层青绿远山后方补充第 4 层淡蓝/淡紫极浅天际峰与山脚淡白雾带
  const mistyGroup = new THREE.Group();
  mistyGroup.name = 'building-sky-and-layer4';
  parent.add(mistyGroup);

  const farPeakMat = new THREE.MeshBasicMaterial({ color: 0xaabbd1, fog: false });
  for (let i = 0; i < 16; i += 1) {
    const ang = (i * Math.PI * 2) / 16 + 0.2;
    const rad = 74;
    const h = 19 + (i % 3) * 5.5;
    const peak = new THREE.Mesh(new THREE.ConeGeometry(13.5, h, 5), farPeakMat);
    peak.position.set(Math.cos(ang) * rad, h * 0.42 - 3, -24 + Math.sin(ang) * rad);
    mistyGroup.add(peak);
  }

  // 山脚淡白色半透明云雾带（校门方向 z = 34，与 A 栋方向 z = -82）
  const mistMat = new THREE.MeshBasicMaterial({
    color: 0xf8f6f2,
    transparent: true,
    opacity: 0.34,
    side: THREE.DoubleSide,
    fog: false,
  });
  for (const [mz, mw] of [[31, 140], [-79, 140]] as Array<[number, number]>) {
    const mist = new THREE.Mesh(new THREE.PlaneGeometry(mw, 5.5), mistMat);
    mist.position.set(0, 3.2, mz);
    mistyGroup.add(mist);
  }

  // 校门外方向（+Z）清晨天空柔和晨阳与淡白粉晨云（fog: false）
  const sunHalo = new THREE.Mesh(
    new THREE.CircleGeometry(9.5, 20),
    new THREE.MeshBasicMaterial({ color: 0xfff1cf, transparent: true, opacity: 0.28, side: THREE.DoubleSide, fog: false }),
  );
  sunHalo.position.set(18, 22, 54);
  sunHalo.rotation.y = Math.PI;
  mistyGroup.add(sunHalo);

  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(3.4, 18),
    new THREE.MeshBasicMaterial({ color: 0xfff8e2, side: THREE.DoubleSide, fog: false }),
  );
  sunDisc.position.set(18, 22, 53.6);
  sunDisc.rotation.y = Math.PI;
  mistyGroup.add(sunDisc);

  const skyClouds: UpgradeBoxPart[] = [];
  for (const [cx, cy, cz, cw, col] of [
    [-18, 24, 51, 12, 0xfcf8f4],
    [6, 27, 52, 10, 0xffffff],
    [24, 21, 50, 14, 0xfef0e4],
  ] as Array<[number, number, number, number, number]>) {
    skyClouds.push(
      { p: [cx, cy, cz], s: [cw, 1.8, 0.4], c: col },
      { p: [cx - cw * 0.15, cy + 0.9, cz - 0.1], s: [cw * 0.55, 1.1, 0.4], c: 0xffffff },
    );
  }
  addBatch(mistyGroup, 'building-morning-clouds', new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), skyClouds, false);

  addBatch(parent, 'building-upgrades-boxes', new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.84 }), boxes, true);
  addBatch(parent, 'building-upgrades-rods', new THREE.CylinderGeometry(1, 1, 1, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.22 }), rods, true);
  addBatch(parent, 'building-upgrades-spheres', new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78 }), spheres, true);
}
