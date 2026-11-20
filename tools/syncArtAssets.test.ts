import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync,
  statSync, truncateSync, unlinkSync, utimesSync, writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
// 与现有 tools 测试一致，直接导入无声明文件的 .mjs，不执行 CLI。
import { isCompletePng, readAssetPaths, syncArtAssets } from './syncArtAssets.mjs';

const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BYTES = 64 * 1024 * 1024;
// 完整的 1×1、8 位灰度带透明通道 PNG，包含 IHDR / IDAT / IEND 与正确 CRC。
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const OLD_TIME = new Date('2001-02-03T04:05:06.000Z');
const temporaryRoots: string[] = [];

type AssetPaths = Record<string, string>;
interface Fixture {
  root: string;
  manifest: string;
  output: string;
  paths: AssetPaths;
}

function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'sync-art-assets-'));
  temporaryRoots.push(root);
  mkdirSync(join(root, 'src/data'), { recursive: true });
  const manifest = join(root, 'src/data/assetManifest.ts');
  copyFileSync(join(SOURCE_ROOT, 'src/data/assetManifest.ts'), manifest);
  return {
    root,
    manifest,
    output: join(root, 'src/data/readyExternalAssets.json'),
    paths: readAssetPaths(root),
  };
}

function writeArt(fixture: Fixture, relative: string, bytes: Buffer): string {
  const path = join(fixture.root, 'public', relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  // 使用固定旧时间，避免同一时钟刻度内的重复写入导致 mtime 断言假通过。
  utimesSync(path, OLD_TIME, OLD_TIME);
  return path;
}

function snapshot(path: string): { bytes: Buffer; mtimeMs: number } {
  return { bytes: readFileSync(path), mtimeMs: statSync(path).mtimeMs };
}

function readReady(fixture: Fixture): AssetPaths {
  return JSON.parse(readFileSync(fixture.output, 'utf8')) as AssetPaths;
}

function damagedSignature(): Buffer {
  const bytes = Buffer.from(PNG);
  bytes[0] = 0;
  return bytes;
}

function damagedCrc(): Buffer {
  const bytes = Buffer.from(PNG);
  // 只破坏 IHDR 的 CRC，保留合法签名、尺寸、压缩数据及完整块结构。
  bytes[32] ^= 1;
  return bytes;
}

const INVALID_PNGS = [
  { name: '空文件', bytes: Buffer.alloc(0) },
  { name: '损坏的文件签名', bytes: damagedSignature() },
  { name: '只有文件签名', bytes: PNG.subarray(0, 8) },
  { name: '截断的像素数据块', bytes: PNG.subarray(0, 45) },
  { name: '缺失结束块', bytes: PNG.subarray(0, PNG.length - 12) },
  { name: '截断的结束块', bytes: PNG.subarray(0, PNG.length - 1) },
  { name: '错误的校验码', bytes: damagedCrc() },
];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('完整 PNG 校验', () => {
  it('接受有效的一像素 PNG，且不改写输入字节', () => {
    const before = Buffer.from(PNG);
    expect(PNG.readUInt32BE(16)).toBe(1);
    expect(PNG.readUInt32BE(20)).toBe(1);
    expect(isCompletePng(PNG)).toBe(true);
    expect(PNG).toEqual(before);
  });

  it.each(INVALID_PNGS)('拒绝$name且不改写输入字节', ({ bytes }) => {
    const before = Buffer.from(bytes);
    expect(isCompletePng(bytes)).toBe(false);
    expect(bytes).toEqual(before);
  });

  it('拒绝超过六十四兆字节的输入', () => {
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    PNG.copy(bytes);
    expect(isCompletePng(bytes)).toBe(false);
  });
});

describe('美术资产同步', () => {
  it('从真实清单读取二十二个唯一固定路径，缺图不创建占位文件', () => {
    const fixture = createFixture();
    const paths: AssetPaths = readAssetPaths(fixture.root);
    expect(Object.keys(paths)).toHaveLength(22);
    expect(new Set(Object.values(paths)).size).toBe(22);
    expect(paths).toEqual(readAssetPaths(SOURCE_ROOT));
    for (const path of Object.values(paths)) {
      expect(path).toMatch(/^\.\/art\/(portraits|cg|props|bg|trophies)\/[a-z0-9_]+\.png$/);
    }

    expect(syncArtAssets(fixture.root)).toEqual({ ready: {}, rejected: [], changed: true });
    expect(readFileSync(fixture.output, 'utf8')).toBe('{}\n');
    expect(existsSync(join(fixture.root, 'public'))).toBe(false);
  });

  it('二十二个有效图片全部登记，原 PNG 与源清单内容及修改时间保持不变', () => {
    const fixture = createFixture();
    const manifestBefore = snapshot(fixture.manifest);
    const originals = Object.values(fixture.paths).map((relative) => {
      const path = writeArt(fixture, relative, PNG);
      return { path, before: snapshot(path) };
    });

    expect(syncArtAssets(fixture.root)).toEqual({
      ready: fixture.paths, rejected: [], changed: true,
    });
    expect(readReady(fixture)).toEqual(fixture.paths);
    expect(readFileSync(fixture.output, 'utf8')).toBe(`${JSON.stringify(fixture.paths, null, 2)}\n`);
    for (const { path, before } of originals) expect(snapshot(path)).toEqual(before);
    expect(snapshot(fixture.manifest)).toEqual(manifestBefore);
  });

  it('删除已登记图片后从就绪清单移除，不重建图片且保留其他有效项', () => {
    const fixture = createFixture();
    const [[removedId, removedPath], [keptId, keptPath]] = Object.entries(fixture.paths);
    const removedFile = writeArt(fixture, removedPath, PNG);
    const keptFile = writeArt(fixture, keptPath, PNG);
    const keptBefore = snapshot(keptFile);
    expect(syncArtAssets(fixture.root).ready).toEqual({
      [removedId]: removedPath, [keptId]: keptPath,
    });

    unlinkSync(removedFile);
    expect(syncArtAssets(fixture.root)).toEqual({
      ready: { [keptId]: keptPath }, rejected: [], changed: true,
    });
    expect(readReady(fixture)).toEqual({ [keptId]: keptPath });
    expect(existsSync(removedFile)).toBe(false);
    expect(snapshot(keptFile)).toEqual(keptBefore);

    unlinkSync(keptFile);
    expect(syncArtAssets(fixture.root)).toEqual({ ready: {}, rejected: [], changed: true });
    expect(readReady(fixture)).toEqual({});
  });

  it('重复同步返回未变化，清单内容与修改时间均不变', () => {
    const fixture = createFixture();
    const [id, relative] = Object.entries(fixture.paths)[0];
    const path = writeArt(fixture, relative, PNG);
    const imageBefore = snapshot(path);
    expect(syncArtAssets(fixture.root).changed).toBe(true);
    utimesSync(fixture.output, OLD_TIME, OLD_TIME);
    const before = snapshot(fixture.output);

    for (let index = 0; index < 2; index += 1) {
      expect(syncArtAssets(fixture.root)).toEqual({
        ready: { [id]: relative }, rejected: [], changed: false,
      });
      expect(snapshot(fixture.output)).toEqual(before);
      expect(snapshot(path)).toEqual(imageBefore);
    }
  });

  it.each(INVALID_PNGS)('跳过$name，保留原文件且不影响有效图片登记', ({ bytes }) => {
    const fixture = createFixture();
    const [[validId, validPath], [, invalidPath]] = Object.entries(fixture.paths);
    writeArt(fixture, validPath, PNG);
    const invalidFile = writeArt(fixture, invalidPath, bytes);
    const before = snapshot(invalidFile);

    expect(syncArtAssets(fixture.root)).toEqual({
      ready: { [validId]: validPath }, rejected: [invalidPath], changed: true,
    });
    expect(readReady(fixture)).toEqual({ [validId]: validPath });
    expect(snapshot(invalidFile)).toEqual(before);
  });

  it('原先有效的图片损坏后移出就绪清单，保留损坏文件', () => {
    const fixture = createFixture();
    const [id, relative] = Object.entries(fixture.paths)[0];
    writeArt(fixture, relative, PNG);
    expect(syncArtAssets(fixture.root).ready).toEqual({ [id]: relative });
    const path = writeArt(fixture, relative, damagedCrc());
    const before = snapshot(path);
    expect(syncArtAssets(fixture.root)).toEqual({
      ready: {}, rejected: [relative], changed: true,
    });
    expect(readReady(fixture)).toEqual({});
    expect(snapshot(path)).toEqual(before);
  });

  it('拒绝超限文件与冒充 PNG 的目录，不删除或改写它们', () => {
    const fixture = createFixture();
    const [oversizedPath, directoryPath] = Object.values(fixture.paths);
    const oversizedFile = writeArt(fixture, oversizedPath, PNG);
    // 扩展临时文件，不在磁盘写入六十四兆测试图片内容。
    truncateSync(oversizedFile, MAX_BYTES + 1);
    utimesSync(oversizedFile, OLD_TIME, OLD_TIME);
    const before = statSync(oversizedFile);
    const directory = join(fixture.root, 'public', directoryPath);
    mkdirSync(directory, { recursive: true });

    expect(syncArtAssets(fixture.root)).toEqual({
      ready: {}, rejected: [oversizedPath, directoryPath], changed: true,
    });
    expect(readReady(fixture)).toEqual({});
    expect(statSync(oversizedFile).size).toBe(MAX_BYTES + 1);
    expect(statSync(oversizedFile).mtimeMs).toBe(before.mtimeMs);
    expect(statSync(directory).isDirectory()).toBe(true);
  });

  it('未知文件即使是有效 PNG 也不登记、不报告拒绝、不改写', () => {
    const fixture = createFixture();
    const path = writeArt(fixture, './art/portraits/unlisted_fixture.png', PNG);
    const before = snapshot(path);
    expect(syncArtAssets(fixture.root)).toEqual({ ready: {}, rejected: [], changed: true });
    expect(readReady(fixture)).toEqual({});
    expect(snapshot(path)).toEqual(before);
  });
});

describe('非法美术清单', () => {
  it.each([
    '无法识别数据块', '缺少条目', '多出条目', '重复路径', '重复编号', '越界路径',
  ])('%s时明确报错，不清空已有就绪清单', (kind) => {
    const fixture = createFixture();
    const [[firstId, firstPath], [secondId, secondPath]] = Object.entries(fixture.paths);
    const source = readFileSync(fixture.manifest, 'utf8');
    const invalidSources: Record<string, string> = {
      无法识别数据块: source.replace('export const ASSET_MANIFEST', 'const ASSET_MANIFEST'),
      缺少条目: source.replace(/^  [a-z][a-z0-9_]+: \{[\s\S]*?^  \},\r?\n/m, ''),
      多出条目: source.replace('} as const;', "  extra_fixture: { path: './art/props/extra_fixture.png' },\n} as const;"),
      重复路径: source.replace(firstPath, secondPath),
      重复编号: source.replace(`  ${firstId}: {`, `  ${secondId}: {`),
      越界路径: source.replace(firstPath, './art/portraits/../../outside.png'),
    };
    expect(invalidSources[kind]).not.toBe(source);
    writeFileSync(fixture.manifest, invalidSources[kind]);
    writeFileSync(fixture.output, `${JSON.stringify({ [firstId]: firstPath })}\n`);
    utimesSync(fixture.output, OLD_TIME, OLD_TIME);
    const before = snapshot(fixture.output);
    const expectedError = kind === '无法识别数据块'
      ? /无法识别 ASSET_MANIFEST 数据块/
      : /22 个唯一 ID 与固定相对 PNG 路径/;

    expect(() => readAssetPaths(fixture.root)).toThrow(expectedError);
    expect(() => syncArtAssets(fixture.root)).toThrow(expectedError);
    expect(snapshot(fixture.output)).toEqual(before);
  });
});

describe('模块导入与根目录隔离', () => {
  it('导入不执行命令行，显式根目录不依赖工作目录或脚本默认根目录', () => {
    const moduleFixture = createFixture();
    const targetFixture = createFixture();
    const cwdFixture = createFixture();
    const [id, relative] = Object.entries(targetFixture.paths)[0];
    writeArt(targetFixture, relative, PNG);
    // 子进程使用复制的原始实现：即使 CLI 防护回归，也只可能写入临时根目录。
    const script = join(moduleFixture.root, 'tools/syncArtAssets.mjs');
    mkdirSync(dirname(script), { recursive: true });
    copyFileSync(join(SOURCE_ROOT, 'tools/syncArtAssets.mjs'), script);
    const cwdBefore = process.cwd();
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      import { existsSync } from 'node:fs';
      const api = await import(${JSON.stringify(pathToFileURL(script).href)});
      assert.equal(existsSync(${JSON.stringify(moduleFixture.output)}), false);
      assert.equal(existsSync(${JSON.stringify(targetFixture.output)}), false);
      assert.equal(existsSync(${JSON.stringify(cwdFixture.output)}), false);
      assert.deepEqual(api.readAssetPaths(${JSON.stringify(targetFixture.root)}), ${JSON.stringify(targetFixture.paths)});
      assert.deepEqual(api.syncArtAssets(${JSON.stringify(targetFixture.root)}), {
        ready: ${JSON.stringify({ [id]: relative })}, rejected: [], changed: true,
      });
    `], { cwd: cwdFixture.root, encoding: 'utf8', timeout: 10000 });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(readReady(targetFixture)).toEqual({ [id]: relative });
    expect(existsSync(moduleFixture.output)).toBe(false);
    expect(existsSync(cwdFixture.output)).toBe(false);
    expect(process.cwd()).toBe(cwdBefore);
  });
});
