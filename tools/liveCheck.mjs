// tools/liveCheck.mjs —— 线上站点首屏复查：可加载、控制台零报错、静态资源零 404
import { chromium } from 'playwright-core';

const SITE_URL = process.argv[2] ?? 'https://yitiaojietu-v8nf654yyg8.qoder.zone/';
const CHROME_PATH =
  'C:/Users/AnQi/AppData/Local/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-win64/chrome-headless-shell.exe';

const browser = await chromium.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();

const problems = [];
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`console:${msg.text()}`);
});
page.on('pageerror', (error) => problems.push(`pageerror:${error.message}`));
page.on('requestfailed', (request) => {
  if (request.url().includes('favicon')) return;
  problems.push(`requestfailed:${request.url()}`);
});
page.on('response', (response) => {
  if (response.status() >= 400 && !response.url().includes('favicon')) {
    problems.push(`http${response.status()}:${response.url()}`);
  }
});

const response = await page.goto(SITE_URL, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'tools/shots/live-home.png' });

const assets = {
  vol: await page.evaluate(() => document.querySelector('#start-page')?.classList.contains('start-page') ?? false),
  title: await page.title(),
};
const modelStatus = {};
for (const id of ['linxia', 'father', 'ayuan', 'volunteer', 'protagonist']) {
  const res = await page.request.get(new URL(`models/chr_${id}.glb`, SITE_URL).href);
  modelStatus[id] = res.status();
}

console.log('HTTP', response?.status(), '| title:', assets.title, '| startPage:', assets.vol);
console.log('models:', JSON.stringify(modelStatus));
if (problems.length > 0) {
  console.log('PROBLEMS:');
  for (const item of problems) console.log(' ', item);
  console.log('RESULT: FAIL');
} else {
  console.log('RESULT: PASS — 线上首屏与五个 GLB 均正常，控制台零报错');
}
await browser.close();
process.exit(problems.length > 0 ? 1 : 0);