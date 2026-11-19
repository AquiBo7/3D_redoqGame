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

export function getSceneDefinition(sceneId: SceneId): WorldSceneDefinition {
  switch (sceneId) {
    case 'S1':
    case 'S2':
    case 'S3':
      return createRoomDefinition(sceneId);
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
  }
}

/** 运行时装（震动 / 演出 / 跟随 / 药袋隐藏）；同一 sceneKey 共享同一实例 */
export function getSceneRuntime(sceneId: SceneId): SceneRuntime | null {
  switch (sceneId) {
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
