// core/urlParams.ts —— 轻量 URL 参数解析
// 支持：?debug=1（调试面板）/ ?lite=1（2D 降级体验）/ ?modelViewer=1（模型查看页）
//       ?phonePreview=1（手机界面独立调试入口）
//       ?role=bystander|victim|perpetrator（多周目视角测试）
//       ?scene=S1–S9（直达场景测试）
// 本模块属于 core，严格禁止 import three.js。

import { isRole, isSceneId } from '../data/storySchema';
import type { Role, SceneId } from '../data/storySchema';

export interface UrlParams {
  /** 调试模式：显示状态变量与选择记录 */
  debug: boolean;
  /** 2D 降级体验：不启用 3D，用文字场景卡与按钮推进剧情 */
  lite: boolean;
  /** 模型查看页 */
  modelViewer: boolean;
  /** 手机界面独立调试入口：只挂载手机面板，不跑 3D 与剧情流程 */
  phonePreview: boolean;
  /** 多周目视角测试，默认旁观者 */
  role: Role;
  /** 指定进入的场景编号，如 S1；未指定或非法时为 null */
  scene: SceneId | null;
}

const FALSE_VALUES = new Set(['0', 'false', 'off', 'no']);

function toFlag(value: string | null): boolean {
  if (value === null) return false;
  return !FALSE_VALUES.has(value.trim().toLowerCase());
}

/** 解析 URL 查询串（默认读取当前页面 location.search，测试时可传入固定字符串） */
export function parseUrlParams(search: string = window.location.search): UrlParams {
  const params = new URLSearchParams(search);
  const rawRole = params.get('role')?.trim().toLowerCase() ?? '';
  const rawScene = params.get('scene')?.trim().toUpperCase() ?? '';

  return {
    debug: toFlag(params.get('debug')),
    lite: toFlag(params.get('lite')),
    modelViewer: toFlag(params.get('modelViewer')),
    phonePreview: toFlag(params.get('phonePreview')),
    role: isRole(rawRole) ? rawRole : 'bystander',
    scene: isSceneId(rawScene) ? rawScene : null,
  };
}