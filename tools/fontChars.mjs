// tools/fontChars.mjs —— 统计游戏正式界面实际用字（字体子集与防缺字单测共用）
// 扫描剧本 / UI / 3D 场景文案与 index.html，去掉注释；core 调试面板不计入（仅开发可见，系统字体兜底）。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

const SOURCE_DIRS = ['src/data', 'src/ui', 'src/world', 'src/scenes3d'];
const SOURCE_FILES = ['index.html'];

/** 第三批场景招牌与横幅文字：提前纳入字库，避免 Canvas 招牌缺字 */
export const EXTRA_TEXT = [
  '便利店', '早餐', '欢迎新同学', '迎新报到', '新生报到', 'A 栋', '迟到登记', '登记簿',
  '姓名', '班级', '原因', '时间', '签字', '药店', '小票', '公告栏', '教学楼', '门卫室',
  '校园', '欢迎', '报到处', '值班', '请排队', '安全出口', '一楼', '水', '笔',
].join('');

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|css|html)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(path);
  }
  return out;
}

/** 去掉块注释 / 行注释 / HTML 注释；行注释仅匹配行首或空白后的 //，避免误伤 URL */
function stripComments(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

export function listSourceFiles() {
  const files = [];
  for (const dir of SOURCE_DIRS) walk(join(ROOT, dir), files);
  for (const file of SOURCE_FILES) files.push(join(ROOT, file));
  return files;
}

/** 返回排序后的码位数组：可打印 ASCII + 源码中出现的全部非 ASCII 字符 + 招牌预留字 */
export function collectCodepoints() {
  const set = new Set();
  for (let cp = 0x20; cp <= 0x7e; cp += 1) set.add(cp);

  const texts = listSourceFiles().map((file) => stripComments(readFileSync(file, 'utf8')));
  texts.push(EXTRA_TEXT);
  for (const text of texts) {
    for (const char of text) {
      const cp = char.codePointAt(0);
      if (cp === undefined || cp < 0x80) continue;
      // 跳过变体选择符、零宽字符与私用区
      if ((cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0xe000 && cp <= 0xf8ff)) continue;
      set.add(cp);
    }
  }
  return [...set].sort((a, b) => a - b);
}
