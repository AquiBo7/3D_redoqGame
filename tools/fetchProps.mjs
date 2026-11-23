// tools/fetchProps.mjs —— 拉取 Poly Haven 全站 CC0 道具，转成单体 .glb 落到 art/props_raw/
//
// Poly Haven 的 glTF 变体是「.gltf + 外部 .bin + 贴图」的散件包，本脚本按 API 给的清单
// 把散件原样下到 .tmp/props_raw_staging/，再用 @gltf-transform 合成项目需要的单文件 .glb，
// 并写出 art/props_raw/SOURCES.md 记录作者 / 来源 / 许可证（CC0 无需署名，但按 docs 建议留痕）。
//
// 用法：node tools/fetchProps.mjs            # 只下缺失文件
//       node tools/fetchProps.mjs --force    # 重新下载全部
// 原始素材只进 art/props_raw/，产物由 tools/blender_prop_pipeline.py 生成，本脚本不碰 public/。

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = join(PROJECT_ROOT, 'art', 'props_raw');
const STAGING_DIR = join(PROJECT_ROOT, '.tmp', 'props_raw_staging');
/** Poly Haven 贴图档位：道具只需要 1k，更大的档位会把原始包撑到上百 MB */
const TEX_VARIANT = '1k';

/**
 * 清单里的 polyhaven id 均可在 https://polyhaven.com/models 打开核对，全部 CC0。
 * 未收录树：Poly Haven 的树是摄影测量扫描（1k 变体 60–100MB、上万片 alpha 叶卡），
 * 减到 500 面只会糊成一团；按 docs 第六节 S8 的方案，行道树保持程序化 + InstancedMesh。
 */
export const PROPS = [
  { file: 'prop_street_lamp.glb', polyhaven: 'street_lamp_01', author: 'Poly Haven', note: '路灯（S4 街道 / S8 林荫路）' },
  { file: 'prop_school_desk.glb', polyhaven: 'SchoolDesk_01', author: 'Poly Haven', note: '课桌（C2 教室 / S7 登记处）' },
  { file: 'prop_school_chair.glb', polyhaven: 'SchoolChair_01', author: 'Poly Haven', note: '课椅（C2 教室）' },
  { file: 'prop_bed.glb', polyhaven: 'old_bed_frame', author: 'Poly Haven', note: '单人床（S1 旅馆房间）' },
  { file: 'prop_trashcan.glb', polyhaven: 'metal_trash_can', author: 'Poly Haven', note: '垃圾桶（S4 街道）' },
  { file: 'prop_bench.glb', polyhaven: 'painted_wooden_bench', author: 'Poly Haven', note: '长椅（S8 林荫路）' },
  { file: 'prop_suitcase.glb', polyhaven: 'vintage_suitcase', author: 'Poly Haven', note: '行李箱（S1 热点 suitcase）' },
  { file: 'prop_stationery.glb', polyhaven: 'stationery_supplies', author: 'Poly Haven', note: '文具书本（S7 登记桌 / C2 教室）' },
  { file: 'prop_canteen_table_raw.glb', polyhaven: 'painted_wooden_table', author: 'Poly Haven', note: '食堂餐桌原始素材（与餐椅同族，进 tools/blender_canteen_set.py 合成）' },
  // 餐桌与餐椅取自同一作者的同一家具族，合成四人位套装时底图色调天然一致，不需要额外统一色温。
  { file: 'prop_canteen_chair_raw.glb', polyhaven: 'painted_wooden_chair_01', author: 'Poly Haven', note: '食堂餐椅（与餐桌同族，进 tools/blender_canteen_set.py 合成）' },
];

const url = (polyhaven) => `https://api.polyhaven.com/files/${polyhaven}`;
const SOURCE_URL = (polyhaven) => `https://polyhaven.com/a/${polyhaven.toLowerCase()}`;
const LICENSE_URL = 'https://creativecommons.org/publicdomain/zero/1.0/';

async function getJson(path, cacheKey) {
  const cached = join(STAGING_DIR, `${cacheKey}.files.json`);
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, 'utf8'));
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Poly Haven API ${response.status}：${path}`);
  const json = await response.json();
  writeFileSync(cached, JSON.stringify(json));
  return json;
}

async function download(to, from) {
  if (existsSync(to) && readFileSync(to).byteLength > 0) return;
  const response = await fetch(from);
  if (!response.ok) throw new Error(`下载 ${response.status}：${from}`);
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, Buffer.from(await response.arrayBuffer()));
}

/** 下载散件包（.gltf + .bin + 贴图），返回主 .gltf 的绝对路径 */
async function fetchBundle(prop) {
  const files = await getJson(url(prop.polyhaven), prop.polyhaven);
  const bundle = files.gltf?.[TEX_VARIANT]?.gltf;
  if (!bundle?.url) throw new Error(`${prop.polyhaven} 没有 ${TEX_VARIANT} glTF 变体`);
  const dir = join(STAGING_DIR, prop.polyhaven);
  const main = join(dir, `${prop.polyhaven}_${TEX_VARIANT}.gltf`);
  await download(main, bundle.url);
  for (const [name, entry] of Object.entries(bundle.include ?? {})) {
    await download(join(dir, name), entry.url);
  }
  return main;
}

async function run() {
  const force = process.argv.slice(2).includes('--force');
  mkdirSync(RAW_DIR, { recursive: true });
  mkdirSync(STAGING_DIR, { recursive: true });
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const rows = [];
  for (const prop of PROPS) {
    const out = join(RAW_DIR, prop.file);
    if (!force && existsSync(out)) {
      rows.push({ ...prop, mb: statSync(out).size / 1024 ** 2, skipped: true });
      console.log(`[已存在] ${prop.file}`);
      continue;
    }
    const main = await fetchBundle(prop);
    const doc = await io.read(main);
    await io.write(out, doc);
    rmSync(dirname(main), { recursive: true, force: true });
    rows.push({ ...prop, mb: statSync(out).size / 1024 ** 2 });
    console.log(`[原始道具] ${prop.file}：${rows[rows.length - 1].mb.toFixed(2)} MiB ← ${prop.polyhaven}`);
  }

  const lines = [
    '# art/props_raw 第三方道具来源',
    '',
    '> 由 `node tools/fetchProps.mjs` 生成，全部 CC0（无需署名），原始文件只读、不进 `public/`。',
    '> 标准化产物见 `public/models/props/`，流水线见 `tools/blender_prop_pipeline.py`。',
    '',
    '| 原始文件 | Poly Haven id | 用途 | 体积 | 作者 | 来源 | 许可证 |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.file} | ${row.polyhaven} | ${row.note} | ${row.mb.toFixed(2)} MiB | ${row.author} | [页面](${SOURCE_URL(row.polyhaven)}) | [CC0](${LICENSE_URL}) |`,
    );
  }
  writeFileSync(join(RAW_DIR, 'SOURCES.md'), `${lines.join('\n')}\n`);
  console.log(`\n[来源记录] ${join(RAW_DIR, 'SOURCES.md')}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? `[阻断] ${error.message}` : error);
  process.exitCode = 1;
});
