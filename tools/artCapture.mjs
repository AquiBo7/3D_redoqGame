// 无头截图：按场景复用同一个页面，逐机位拍摄，输出 PNG + getRenderInfo() 读数
// 用法：node artCapture.mjs <输出目录> <标签前缀> [场景key过滤]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
const TAG = process.argv[3] || 'shot';
// 过滤支持逗号分隔多组（例如 s5,c2hand），一次浏览器启动跑完两组机位
const ONLY = (process.argv[4] || 'all').toLowerCase();
if (!OUT) throw new Error('缺少输出目录');
mkdirSync(OUT, { recursive: true });

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.env.BASE_URL || 'http://localhost:5178/';
const LAND = { width: 1440, height: 900 };
const PORT = { width: 390, height: 844 };

// 机位表：按 scene 分组，同场景只加载一次页面
const PLAN = [
  { scene: 'S12', shots: [
    { id: 's12_canteen',       x: 0,   z: 7.4,  yaw: 0,  vp: LAND },
    { id: 's12_canteen_line',  x: 0.4, z: -2.6, yaw: 0,  vp: LAND },
    { id: 's12_canteen_close', x: 2.2, z: -4.6, yaw: 0,  vp: LAND },
    { id: 's12_canteen_phone', x: 0,   z: 7.4,  yaw: 0,  vp: PORT },
    { id: 's12_canteen_garden', x: 2.0, z: -1.0, yaw: 90, vp: LAND },
  ] },
  { scene: 'S1', shots: [
    { id: 's1_window',       x: 1.8, z: -3.4, yaw: 0, vp: LAND },
    { id: 's1_window_phone', x: 1.8, z: -3.4, yaw: 0, vp: PORT },
  ] },
  { scene: 'S4', shots: [
    { id: 's4_street',     x: 0,   z: 12, yaw: 0, vp: LAND },
    { id: 's4_tree_close', x: 1.4, z: 5,  yaw: 0, vp: LAND },
    // 本轮可读性验收机位：售卖机三视角 / 窗户 / 路面 / 自行车 / 招牌 / 垃圾桶 / 电表箱 / 阴影射程两点 / 竖屏
    { id: 's4_vend_front', x: 0.56, z: -3.15, yaw: -90, pitch: -12, vp: LAND },
    { id: 's4_vend_side',  x: 0.7,  z: -1.7,  yaw: -43, pitch: -12, vp: LAND },
    { id: 's4_vend_far',   x: 0.5,  z: 4.85,  yaw: -11, pitch: -6,  vp: LAND },
    { id: 's4_windows',    x: 0.6,  z: -1,    yaw: 62,  pitch: 22,  vp: LAND },
    { id: 's4_road',       x: 0,    z: -8,    yaw: 0,   pitch: -46, vp: LAND },
    { id: 's4_road_close', x: 0,    z: -14.5, yaw: 0,   pitch: -58, vp: LAND },
    { id: 's4_bike',       x: 0.6,  z: 8.2,   yaw: -41, pitch: -6,  vp: LAND },
    { id: 's4_bike_close', x: 0.5,  z: 4.2,   yaw: -147, pitch: -6, vp: LAND },
    // 招牌正打：清晨早餐铺牌面在 (x −2.62, y 2.58, z −6.06) 朝 +x，机位沿法线退 3 m 再抬 17°
    { id: 's4_sign',       x: 1.9,  z: -3.0,  yaw: 76,  pitch: 10,  vp: LAND },
    { id: 's4_sign_close', x: 0.38, z: -6.06, yaw: 90,  pitch: 17,  vp: LAND },
    { id: 's4_bins',       x: 0.6,  z: -16.2, yaw: -40, pitch: -6,  vp: LAND },
    // 程序化分类桶三点：侧面全身 / 俯视投料口与遮檐 / 左侧黄桶正脸读丝印标志
    { id: 's4_bins_close', x: 0.35, z: -16.6, yaw: -52, pitch: -12, vp: LAND },
    { id: 's4_bins_mouth', x: 0.9,  z: -17.4, yaw: -63, pitch: -35, vp: LAND },
    { id: 's4_bins_left',  x: 0.5,  z: 5.6,   yaw: 58,  pitch: -14, vp: LAND },
    { id: 's4_meter',      x: -0.5, z: 6.5,   yaw: 43,  pitch: -4,  vp: LAND },
    { id: 's4_shadow_z0',  x: 0,    z: 0,     yaw: -20, pitch: -10, vp: LAND },
    { id: 's4_shadow_z30', x: 0,    z: -30,   yaw: 20,  pitch: -10, vp: LAND },
    { id: 's4_street_phone', x: 0,  z: 12,   yaw: 0, vp: PORT },
  ] },
  { key: 's4n', scene: 'S4', query: 'night=1', shots: [
    // 夜间路灯实拍：沿街轴线看灯序与地面光斑 / 灯笼近景看 bloom 辉光 / 俯视看光斑衰减 / 侧看墙面暖光洗墙
    { id: 's4n_axis', x: 0.35, z: 12, yaw: 0, pitch: -3, vp: LAND },
    { id: 's4n_lantern', x: 0.9, z: -9.2, yaw: 75, pitch: 26, vp: LAND },
    { id: 's4n_pool', x: 0.3, z: 8.5, yaw: 0, pitch: -28, vp: LAND },
    { id: 's4n_warm_wall', x: -0.3, z: -2.5, yaw: 62, pitch: -6, vp: LAND },
  ] },
  { scene: 'S8', shots: [
    { id: 's8_building_row',   x: 0,  z: 10, yaw: 0,  vp: LAND },
    { id: 's8_building_close', x: -3, z: 2,  yaw: 0,  vp: LAND },
    { id: 's8_tree_row',       x: 5.5, z: -14, yaw: 62, vp: LAND },
  ] },
  { scene: 'S5', shots: [
    { id: 's5_gate',       x: 0,  z: 14, yaw: 0,  vp: LAND },
    { id: 's5_gate_close', x: -6, z: 6,  yaw: 20, vp: LAND },
    { id: 's5_tree_close', x: -4.5, z: -5.5, yaw: 55, vp: LAND },
    // 持机者特写：机位沿"该角色看向 CROWD_LOOK_TARGET(0,2.8) 的视线"退到胸前 1.2~1.3 m，
    // pitch 按眼高 1.6 与胸口 1.15 的高差算；yaw 由 dir = (−sin θ, −cos θ) 反解
    { id: 's5_phone_left',  x: -2.43, z: 3.2,  yaw: 100, pitch: -21, vp: LAND },
    { id: 's5_phone_right', x: 3.26,  z: 1.76, yaw: -71, pitch: -20, vp: LAND },
    { id: 's5_typer_phone', x: -2.88, z: 6.86, yaw: 147, pitch: -21, vp: LAND },
  ] },
  { scene: 'S7', shots: [
    { id: 's7_desk', x: 0, z: 8, yaw: 0, vp: LAND },
  ] },
  { scene: 'C2', shots: [
    // 课桌列在 x=-7/-4，隔断墙在 x=+1：机位全部收到课桌列左侧，避开隔断与选择面板压住的底部带
    { id: 'c2_classroom',      x: -5.5, z: 7.5,  yaw: 0,   pitch: -8, vp: LAND },
    { id: 'c2_classroom_side', x: -8.4, z: 4.6,  yaw: -55, pitch: -6, vp: LAND },
    { id: 'c2_podium',         x: -4.5, z: -2.6, yaw: 0,   pitch: -6, vp: LAND },
  ] },
  { key: 'c2hand', scene: 'C2', shots: [
    // 林夏执笔手特写（她坐 (−6.99, 4.58) 朝 −Z，右手笔尖在 (−6.84, 4.2, 台面+0.04)）：
    // 机位 yaw 按"指向笔尖"反解（dir = (−sin θ, −cos θ)），pitch 按眼高 1.6 与台面 0.82 的高差算
    { id: 'c2_hand_tip',   x: -6.5,  z: 3.05, yaw: 163, pitch: -33, vp: LAND },
    { id: 'c2_hand_back',  x: -7.55, z: 3.35, yaw: 220, pitch: -35, vp: LAND },
    { id: 'c2_hand_seated', x: -5.35, z: 2.35, yaw: 141, pitch: -18, vp: LAND },
    // 微距三机位（0.5~0.8 m）：正前方看笔尖入纸、中线侧看轴线是否走在虎口、外侧看有没有再穿模。
    // yaw 一律按 θ = atan2(−dx, −dz) 反解（dx,dz 为机位指向右手腕 (−6.85, 4.38) 的水平分量），
    // pitch 按眼高 1.6 与手高 0.80 的高差算；上一版把 +Z 方向的机位写成了 33°，镜头朝反方向看。
    { id: 'c2_pen_front',  x: -6.85, z: 3.62, yaw: 180, pitch: -46, vp: LAND },
    { id: 'c2_pen_web',    x: -7.20, z: 4.05, yaw: 227, pitch: -59, vp: LAND },
    { id: 'c2_pen_out',    x: -6.50, z: 4.05, yaw: 133, pitch: -59, vp: LAND },
  ] },
  { key: 'c5', scene: 'C5', shots: [
    // 阿远（student-4）在 (8.2, 1.2) 朝 −X：机位取玩家接近点，正对他握在烘焙手掌上的橙色手机
    { id: 'c5_ayuan_phone', x: 6.8,  z: 1.2, yaw: -90, pitch: -33, vp: LAND },
    { id: 'c5_ayuan_wide',  x: 3.3,  z: 0.4, yaw: -99, pitch: -5,  vp: LAND },
  ] },
  { key: 'c6', scene: 'C6', shots: [
    // 夜楼梯间阿远在 (8.3, −1) 朝 +Z：橙色手机壳微光是认人线索，必须看清它贴在手上而不是悬在胸口
    { id: 'c6_ayuan_phone', x: 8.3, z: 0.6, yaw: 0, pitch: -30, vp: LAND },
  ] },
];

const browser = await chromium.launch({
  executablePath: EDGE, headless: true,
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
    // 无头页面在后台会被节流到 1 fps 以下，走位 / 呼吸一类的按时间推进动画会被压成几乎不动
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  ],
});

const records = [];
const wanted = ONLY.split(',').map((key) => key.trim()).filter(Boolean);
for (const group of PLAN) {
  // 同一场景可以挂多组机位（例如白天的 S4 与 ?night=1 的夜景 S4），用 key 区分过滤
  const filterKey = (group.key || group.scene).toLowerCase();
  if (!wanted.includes('all') && !wanted.includes(filterKey)) continue;
  const context = await browser.newContext({ viewport: LAND, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  // 别的会话在写 src/ 时，vite 会随时整页重载：本组必须能"重载后续拍"，否则一轮里全是废图
  const ready = async () => {
    // 角色 GLB 在 swiftshader 下要拉几十秒，等 load 会白等；只等 DOM，后面用 __worldApp 兜底
    await page.goto(`${BASE}?scene=${group.scene}${group.query ? `&${group.query}` : ''}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__worldApp), null, { timeout: 180000 });
    // vite 首次依赖转换会整页重载，钩子会短暂变 undefined：谓词一律走可选链
    await page.waitForFunction((id) => window.__worldApp?.getSceneId?.() === id, group.scene, { timeout: 180000 });
    // 首屏黑幕淡入必须真正结束，否则整片压暗，前后对比失去意义
    // swiftshader 下过场靠真实帧推进，1440×900 淡入要 2 分钟，超时留 5 分钟余量
    await page.waitForFunction(() => {
      const fade = document.querySelector('.scene-fade');
      return !fade || parseFloat(getComputedStyle(fade).opacity) <= 0.001;
    }, null, { timeout: 300000 });
  };

  const shotOnce = async (s) => {
    await page.setViewportSize(s.vp);
    await page.evaluate(([x, z, y, p]) => window.__worldApp?.teleport(x, z, y, p), [s.x, s.z, s.yaw, s.pitch ?? null]);
    await page.waitForTimeout(1600);
    const info = await page.evaluate(() => window.__worldApp?.getRenderInfo?.() ?? null);
    // 场景被重载打断时 drawables 只剩个位数：这不是构图问题，是页面还没建好
    if (!info || info.drawables < 8) throw new Error(`场景未就绪（drawables=${info ? info.drawables : 'null'}）`);
    await page.screenshot({ path: join(OUT, `${TAG}_${s.id}.png`), timeout: 90000 });
    return info;
  };

  try {
    await ready();
    for (const s of group.shots) {
      // 单个机位失败（swiftshader 下 screenshot 会等字体，偶发挂住）不能带走整组
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const info = await shotOnce(s);
          records.push({ id: s.id, scene: group.scene, info, problems: problems.slice(0, 3) });
          console.log(`${s.id} ${JSON.stringify(info)} ${problems.length ? 'ERR:' + problems[0].slice(0, 90) : 'ok'}`);
          break;
        } catch (shotErr) {
          if (attempt === 2) {
            records.push({ id: s.id, scene: group.scene, error: String(shotErr).slice(0, 160) });
            console.log(`${s.id} SHOT-FAILED ${String(shotErr).slice(0, 120)}`);
            break;
          }
          console.log(`${s.id} 重试（重载打断：${String(shotErr).slice(0, 70)}）`);
          await ready();
        }
      }
    }
  } catch (err) {
    records.push({ scene: group.scene, error: String(err).slice(0, 220), problems: problems.slice(0, 3) });
    console.log(`${group.scene} FAILED ${String(err).slice(0, 160)}`);
  }
  await context.close();
}
await browser.close();
writeFileSync(join(OUT, `${TAG}_renderinfo.json`), JSON.stringify(records, null, 2));
console.log('DONE');
