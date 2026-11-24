// scenes3d/propManifest.test.ts —— 道具清单契约：条数、相对路径、文件真实存在、高度与色温覆盖合法

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PROP_MODELS,
  PROP_TINT_METAL,
  PROP_TINT_NEUTRAL,
  PROP_TINT_PAPER,
  PROP_TINT_WOOD,
  getPropModel,
} from './propManifest';
import type { PropModelId } from './propManifest';

const TINTS = [PROP_TINT_WOOD, PROP_TINT_METAL, PROP_TINT_PAPER, PROP_TINT_NEUTRAL];

/** 本地脚本程序化建模的食堂套件与教学楼套件（成品色烘进顶点色，canteenSet 外 tint 必须中性白） */
const CANTEEN_KIT_IDS: PropModelId[] = [
  'canteenSet', 'canteenColumn', 'canteenTrayRack', 'canteenWindowBay', 'canteenVending', 'canteenClock',
];
const SCHOOL_KIT_IDS: PropModelId[] = [
  'schoolDeskUnit', 'schoolChairUnit', 'schoolLowLocker', 'schoolTallLocker', 'schoolBackpack',
  'schoolBulletin', 'schoolPodium', 'schoolSpeaker', 'schoolOfficeDesk', 'schoolFileCabinet',
  'schoolTreeA', 'schoolTreeB', 'schoolTreeC',
];
const LOCAL_KIT_IDS: PropModelId[] = [...CANTEEN_KIT_IDS, ...SCHOOL_KIT_IDS];

describe('PROP_MODELS 清单', () => {
  it('登记 public/models/props 下全部 27 件成品，id 不重复', () => {
    expect(PROP_MODELS).toHaveLength(27);
    const ids = PROP_MODELS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(27);
  });

  it('所有道具路径以 ./models/ 开头且为 .glb（禁止写死根路径）', () => {
    for (const entry of PROP_MODELS) {
      expect(entry.path.startsWith('./models/')).toBe(true);
      expect(entry.path.endsWith('.glb')).toBe(true);
      expect(entry.path.startsWith('/')).toBe(false);
    }
  });

  it('清单中的道具文件真实存在于 public/models/props/', () => {
    for (const entry of PROP_MODELS) {
      // 运行期相对路径基于站点根目录（vite public/），测试按项目根目录校验
      const file = resolve(process.cwd(), 'public', entry.path.slice('./'.length));
      expect(existsSync(file), `缺少道具文件：${entry.path}`).toBe(true);
    }
  });

  it('每件道具高度为正且落在道具合理区间（0.05m–5.0m）', () => {
    for (const entry of PROP_MODELS) {
      expect(entry.heightM).toBeGreaterThan(0.05);
      expect(entry.heightM).toBeLessThan(5);
    }
  });

  it('色温覆盖只允许木器 / 金属 / 纸张 / 中性四档，roughness 与 metalness 由成品自带', () => {
    for (const entry of PROP_MODELS) {
      expect(TINTS, `${entry.id} 的 tint 不在四档内`).toContain(entry.tint);
    }
    expect(getPropModel('bench').tint).toBe(PROP_TINT_WOOD);
    expect(getPropModel('streetLamp').tint).toBe(PROP_TINT_METAL);
    expect(getPropModel('stationery').tint).toBe(PROP_TINT_PAPER);
    // 本地套件顶点色自带成品色，tint 一律中性白防止二次偏色
    for (const id of LOCAL_KIT_IDS.filter((item) => item !== 'canteenSet')) {
      expect(getPropModel(id).tint, `${id} 的 tint 必须中性白`).toBe(PROP_TINT_NEUTRAL);
    }
    // 套装顶点色未烘固有色，是唯一例外：用木器档 tint 统一补浅木色
    expect(getPropModel('canteenSet').tint).toBe(PROP_TINT_WOOD);
  });

  it('小件文具与食堂全套件不投射阴影，其余大道具都投射', () => {
    // 食堂按逐节点断言禁止任何投影者（canteen.test.ts），套件因此只接收阴影；文具是桌面小件。
    const noCast: PropModelId[] = ['stationery', ...LOCAL_KIT_IDS];
    for (const id of noCast) expect(getPropModel(id).castShadow, `${id} 不应投射阴影`).toBe(false);
    for (const entry of PROP_MODELS) {
      if (noCast.includes(entry.id)) continue;
      expect(entry.castShadow, `${entry.id} 应投射阴影`).toBe(true);
    }
  });

  it('许可全部为 CC0 且来源可核查（无 CC BY，无署名义务）', () => {
    for (const entry of PROP_MODELS) {
      expect(entry.license).toBe('CC0 1.0');
      expect(entry.name.length).toBeGreaterThan(0);
      if ((CANTEEN_KIT_IDS as string[]).includes(entry.id)) {
        // 本地食堂脚本产物：作者与来源指向可复跑的生产脚本
        expect(entry.author).toBe('Local Blender Kit');
        expect(entry.source).toBe('local://tools/blender_canteen_kit.py');
      } else if ((SCHOOL_KIT_IDS as string[]).includes(entry.id)) {
        // 本地教学楼脚本产物：作者与来源指向可复跑的生产脚本
        expect(entry.author).toBe('Local Blender Kit');
        expect(entry.source).toBe('local://tools/blender_school_kit.py');
      } else {
        expect(entry.author).toBe('Poly Haven');
        expect(entry.source.startsWith('https://polyhaven.com/a/')).toBe(true);
      }
    }
  });

  it('本轮挂载用到的四个 id 均可取回，未知 id 抛错', () => {
    expect(getPropModel('streetLamp').path).toBe('./models/props/prop_street_lamp.glb');
    expect(getPropModel('trashcan').heightM).toBeCloseTo(0.851, 3);
    expect(getPropModel('schoolDesk').id).toBe('schoolDesk');
    expect(getPropModel('bench').id).toBe('bench');
    expect(() => getPropModel('nope' as never)).toThrow('未知道具模型');
  });
});
