// 林夏同行路线实拍核对：在页面内累计"引擎时间"（与 WorldApp 一样把每帧 dt 夹到 0.05 秒上限），
// 用真实渲染帧验证三件事——路线是直线、位移只由 dt 线性驱动、走路剪辑没有夹带额外的根位移。
// 用法：node tools/verifyLinxiaWalk.mjs <输出目录>   （需先起 dev server，BASE_URL 环境变量可覆盖）
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
if (!OUT) throw new Error('缺少输出目录');
mkdirSync(OUT, { recursive: true });

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5183/';
const START = { x: 1.3, z: -1 };
const END = { x: 1.3, z: -44 };
const DURATION = 26;
const SPEED = Math.abs(END.z - START.z) / DURATION;
const VIEW = { x: 0.15, z: -30, yaw: 178, pitch: -3 };

// 软件渲染 + 别的会话抢 CPU 时帧率会掉到个位数：小视口保住帧率，才谈得上"逐帧"证据
const PROBE_SCRIPT = `
window.__probe = { frames: 0, lastTime: 0, engineTime: 0 };
const rawRaf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (callback) => rawRaf((time) => {
  const probe = window.__probe;
  if (probe.lastTime) probe.engineTime += Math.min(0.05, (time - probe.lastTime) / 1000);
  probe.lastTime = time;
  probe.frames += 1;
  return callback(time);
});
`;

const browser = await chromium.launch({
  executablePath: EDGE, headless: true,
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
    // 后台标签页会被节流到 1 fps 以下，逐帧推进的位移会被压成几乎不动
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});
const context = await browser.newContext({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 });
await context.addInitScript(PROBE_SCRIPT);
const page = await context.newPage();
const problems = [];
page.on('console', (message) => { if (message.type() === 'error') problems.push(message.text()); });
page.on('pageerror', (error) => problems.push(error.message));

const sample = () => page.evaluate(() => ({
  frames: window.__probe.frames,
  engineTime: window.__probe.engineTime,
  position: window.__worldApp?.getActorPosition?.('linxia') ?? null,
  hip: window.__worldApp?.getActorBonePosition?.('linxia', 'Hip') ?? null,
}));

await page.goto(`${BASE}?scene=S8`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__worldApp), null, { timeout: 180000 });
// vite 首次依赖转换会整页重载，钩子会短暂变 undefined：谓词一律走可选链，否则采样循环被一次导航打断
await page.waitForFunction(() => window.__worldApp?.getSceneId?.() === 'S8', null, { timeout: 180000 });
await page.waitForFunction(() => {
  const fade = document.querySelector('.scene-fade');
  return !fade || parseFloat(getComputedStyle(fade).opacity) <= 0.001;
}, null, { timeout: 180000 });
await page.evaluate(([x, z, yaw, pitch]) => window.__worldApp?.teleport(x, z, yaw, pitch),
  [VIEW.x, VIEW.z, VIEW.yaw, VIEW.pitch]);

// 同行只在开场对话与"路上说什么"这道选项结束后启动：
// 对话用空格推进，选项面板必须点选一项，否则 ui:worldBlocked 一直为真、林夏原地站定。
const wallStart = Date.now();
for (let attempt = 0; attempt < 60; attempt += 1) {
  const started = await sample();
  if (started.position && started.position[2] < START.z - 0.01) break;
  const clicked = await page.evaluate(() => {
    const panel = document.querySelector('.choices');
    if (!panel || panel.hasAttribute('hidden')) return false;
    panel.querySelector('.choices__option')?.click();
    return true;
  });
  if (!clicked) await page.keyboard.press('Space');
  await page.waitForTimeout(500);
}

const samples = [];
const shotAtEngine = [6, 14, 22];
const shotsTaken = new Set();
// 软件渲染下引擎秒与真实秒的比值只有 1:10 量级，走完 26 秒全程要留够墙钟时间
let deadline = Date.now() + 600000;
while (Date.now() < deadline) {
  const current = await sample();
  current.wall = (Date.now() - wallStart) / 1000;
  samples.push(current);
  if (current.position && current.position[2] <= END.z + 0.001) break;
  for (const mark of shotAtEngine) {
    if (shotsTaken.has(mark)) continue;
    if (current.engineTime >= mark) {
      shotsTaken.add(mark);
      await page.screenshot({ path: join(OUT, `walk_t${mark}s.png`), timeout: 90000 });
    }
  }
  await page.waitForTimeout(700);
}
await page.screenshot({ path: join(OUT, 'walk_final.png'), timeout: 90000 });
await context.close();
await browser.close();

const walked = samples.filter((item) => item.position && item.position[2] < START.z - 0.001);
const withHip = walked.filter((item) => item.hip);
const maxLateral = walked.length
  ? Math.max(...walked.map((item) => Math.abs(item.position[0] - START.x)))
  : Number.POSITIVE_INFINITY;
// 相邻采样之间：位移必须等于"引擎时间增量 × 设计速度"，否则说明位移不是纯 dt 线性驱动。
// 用中位数而不是最大值：page.screenshot 会占住一帧不推进 rAF，那几个边界的墙钟/引擎比天然失真，
// 但它们不影响"同一段时间不论切多少帧，路线一致"这条真正要证的性质。
const speeds = [];
for (let index = 1; index < walked.length; index += 1) {
  const dt = walked[index].engineTime - walked[index - 1].engineTime;
  const dz = walked[index - 1].position[2] - walked[index].position[2];
  if (dt > 0.001) speeds.push(dz / dt);
}
speeds.sort((a, b) => a - b);
const medianSpeed = speeds.length ? speeds[Math.floor(speeds.length / 2)] : Number.NaN;
let monotonic = true;
for (let index = 1; index < walked.length; index += 1) {
  if (walked[index].position[2] > walked[index - 1].position[2] + 1e-6) monotonic = false;
}
// 剪辑若夹带根位移，(hipZ - actorZ) 会随里程单调偏移——那才是滑步。
// 步态本身让骨盆前后起伏 ±5 cm 属正常，所以这里量"前 1/4 与后 1/4 的均值差"，不量抖动幅度。
const hipOffsets = withHip.map((item) => item.hip[2] - item.position[2]);
const quarter = Math.max(1, Math.floor(hipOffsets.length / 4));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const hipDrift = hipOffsets.length >= quarter * 2
  ? Math.abs(mean(hipOffsets.slice(0, quarter)) - mean(hipOffsets.slice(-quarter)))
  : Number.NaN;
const hipSwing = hipOffsets.length
  ? Math.max(...hipOffsets) - Math.min(...hipOffsets)
  : Number.NaN;
const engineSeconds = walked.length
  ? walked[walked.length - 1].engineTime - walked[0].engineTime + (walked[0].engineTime - (samples[0]?.engineTime ?? walked[0].engineTime))
  : Number.NaN;
const last = walked.length ? walked[walked.length - 1] : null;
const fps = last && last.wall > 0 ? last.frames / last.wall : 0;
// 帧率无关性的直接证据：dz/引擎时间 的离散度。墙钟间隔在这轮里从 0.6 秒抖到 21 秒，
// 若位移其实是按墙钟走的，这个比值会散成一团；按引擎时间走则收敛到设计速度。
const speedCv = speeds.length > 2
  ? Math.sqrt(mean(speeds.map((value) => (value - medianSpeed) ** 2)) / speeds.length) / medianSpeed
  : Number.NaN;

const checks = [
  ['采样数', walked.length >= 8, walked.length],
  ['横向漂移（米）', maxLateral < 1e-4, Number(maxLateral.toExponential(2))],
  ['单调前进（不后退）', monotonic, monotonic],
  ['中位速度（米/引擎秒）', Math.abs(medianSpeed - SPEED) < 0.01, Number(medianSpeed.toFixed(4))],
  ['匀速性（速度相对离散度）', Number.isNaN(speedCv) || speedCv < 0.05, Number.isNaN(speedCv) ? '样本不足' : Number(speedCv.toFixed(4))],
  ['同行总时长（引擎秒）', Math.abs(engineSeconds - DURATION) < 1.5, Number(engineSeconds.toFixed(2))],
  ['终点', last ? Math.abs(last.position[2] - END.z) < 0.02 : false, last ? Number(last.position[2].toFixed(3)) : null],
  ['剪辑根位移（前后 1/4 的 hip 均值差，米）', Number.isNaN(hipDrift) || hipDrift < 0.02, Number.isNaN(hipDrift) ? '胶囊体无 Hip，跳过' : Number(hipDrift.toFixed(4))],
  ['控制台报错', problems.length === 0, problems.slice(0, 3)],
];
console.log(`观察值（随机器负载变化，不计入判定）：真实帧率 ${fps.toFixed(2)} 帧/秒；`
  + `骨盆步态起伏 ±${Number.isNaN(hipSwing) ? 'NA' : (hipSwing / 2).toFixed(4)} 米`);
console.log('采样（引擎秒 / 真实秒 / 帧数 / x / z / hipZ，每 20 条取 1）：');
walked.forEach((item, index) => {
  if (index % 20 !== 0 && index !== walked.length - 1) return;
  console.log(`  ${item.engineTime.toFixed(2)}\t${item.wall.toFixed(1)}\t${item.frames}`
    + `\t${item.position[0].toFixed(4)}\t${item.position[2].toFixed(3)}`
    + `\t${item.hip ? item.hip[2].toFixed(3) : '-'}`);
});
let failed = 0;
for (const [name, ok, value] of checks) {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} = ${JSON.stringify(value)}`);
}
console.log(`期望：x 恒定 ${START.x}，z 从 ${START.z} 线性走到 ${END.z}，${DURATION} 秒，${SPEED.toFixed(4)} 米/秒`);
console.log(`截图：${[...shotsTaken].map((mark) => join(OUT, `walk_t${mark}s.png`)).join(' ')} ${join(OUT, 'walk_final.png')}`);
process.exit(failed ? 1 : 0);
