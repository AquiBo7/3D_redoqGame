// scenes3d/index.ts —— 独立 3D 场景注册表（S1–S9）
// 约定：room / street / gate / desk / building 各自独立成文件、互不修改。
// 3D 场景只通过 core 事件总线（enterZone / gazeHotspot / interact 等）通知状态变化，
// 不直接 import core 的状态模块，也不被 ui 直接调用。
// 同一 sceneKey 的多个场景（S1-3 / S5-6 / S8-9）共用同一 build 函数，保证切 sceneId 不重建几何体。

import type { SceneId } from '../data/storySchema';
import type { SceneRuntime, WorldSceneDefinition } from '../world/worldSceneTypes';
import { buildingRuntime, createBuildingDefinition } from './building';
import { createDeskDefinition, deskRuntime } from './desk';
import { createGateDefinition, gateRuntime } from './gate';
import { createRoomDefinition } from './room';
import { createStreetDefinition, streetRuntime } from './street';

let canteen: typeof import('./canteen') | null = null;
let canteenLoad: Promise<void> | null = null;
let interior: typeof import('./schoolInterior') | null = null;
let interiorLoad: Promise<void> | null = null;
const INTERIOR_SCENES: readonly SceneId[] = ['C2', 'C4', 'C5', 'C6', 'D1', 'D6'];

export function isSceneModuleReady(sceneId: SceneId): boolean {
  if (INTERIOR_SCENES.includes(sceneId)) return interior !== null;
  return !['S12', 'S13'].includes(sceneId) || canteen !== null;
}

export function prepareSceneModule(sceneId: SceneId): Promise<void> {
  if (isSceneModuleReady(sceneId)) return Promise.resolve();
  if (INTERIOR_SCENES.includes(sceneId)) {
    interiorLoad ??= import('./schoolInterior').then((module) => { interior = module; });
    return interiorLoad;
  }
  canteenLoad ??= import('./canteen').then((module) => { canteen = module; });
  return canteenLoad;
}

const buildNarrativeStage: WorldSceneDefinition['build'] = () => ({ occluders: [] });

export function getSceneDefinition(sceneId: SceneId): WorldSceneDefinition {
  if (INTERIOR_SCENES.includes(sceneId)) {
    if (!interior) throw new Error('教学楼室内模块尚未加载');
    return interior.createSchoolInteriorDefinition(sceneId);
  }
  switch (sceneId) {
    case 'S1':
    case 'S2':
    case 'S3':
      return createRoomDefinition(sceneId);
    case 'S12':
    case 'S13':
      if (!canteen) throw new Error('食堂模块尚未加载');
      return canteen.createCanteenDefinition(sceneId);
    case 'S4':
      return createStreetDefinition(sceneId);
    case 'S5':
    case 'S6':
      return createGateDefinition(sceneId);
    case 'S7':
      return createDeskDefinition(sceneId);
    case 'S8':
    case 'S9':
      return createBuildingDefinition(sceneId);
    default:
      return {
        sceneKey: 'stage2d', spawn: { x: 0, z: 0 },
        nav: { bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 }, obstacles: [] },
        build: buildNarrativeStage,
      };
  }
}

/** 运行时装（震动 / 演出 / 跟随 / 药袋隐藏）；同一 sceneKey 共享同一实例 */
export function getSceneRuntime(sceneId: SceneId): SceneRuntime | null {
  if (INTERIOR_SCENES.includes(sceneId)) return interior?.schoolInteriorRuntime ?? null;
  switch (sceneId) {
    case 'S12':
    case 'S13':
      return canteen?.canteenRuntime ?? null;
    case 'S4':
      return streetRuntime;
    case 'S5':
    case 'S6':
      return gateRuntime;
    case 'S7':
      return deskRuntime;
    case 'S8':
    case 'S9':
      return buildingRuntime;
    default:
      return null;
  }
}
