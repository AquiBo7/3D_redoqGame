---
name: threejs-r187-guard
description: Enforces Three.js r187 API compatibility, ES2020 target rules, core/world boundaries, mobile safety padding, and content safety rules in 《一条截图》. Use whenever writing or modifying 3D scenes, UI, or core logic.
---

# Three.js r187 与项目红线守卫

在《一条截图》中编写或修改 3D 场景（`src/scenes3d/`、`src/world/`）、UI（`src/ui/`）或 core 逻辑（`src/core/`）时，逐条对照本清单。以下均为本项目实测铁律，不得以"看起来能跑"为由放宽。

## 1. Three.js 0.187.0 API 兼容

项目锁定 `three@0.187.0`，只允许使用该版本存在的 API。

- **禁止 `THREE.PCFSoftShadowMap`**：该常量已在 r187 移除，使用会导致阴影类型设置无效或运行时报错。
- 阴影统一使用 `THREE.PCFShadowMap`：

```ts
// 正确
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

// 禁止
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
```

- 不确定某个 API 是否存在于 0.187.0 时，先用 context7 MCP 查询官方文档，不要凭记忆写。查询关键词示例：`three.js WebGLRenderer shadowMap type`、`three r187 migration`。
- 已知被移除或改名的 API 不得使用；升级前先确认 `@types/three@0.187.0` 的声明存在对应类型。

## 2. ES2020 目标限制

`tsconfig.json` 的 `target` 与 `lib` 均为 **ES2020**，Vite `build.target` 也是 `es2020`。禁止使用 ES2022+ 语法与方法。

- **禁止 `Array.prototype.at()`**，改用标准下标访问：

```ts
// 禁止
const last = list.at(-1);

// 正确
const last = list[list.length - 1];
```

- 同类禁止项：`findLast` / `findLastIndex`、`toSorted` / `toReversed` / `toSpliced` / `with`、`Object.hasOwn`、类字段之外的 ES2022+ 新特性。
- 也不要用较新的 `Array.prototype.group()`、`Promise.withResolvers()` 等更高版本 API。
- 拿不准时以 `tsc --noEmit` 通过为准（`npm run build` 已包含）。

## 3. 模块边界：core 不 import three

- `src/core/` **严格禁止** `import three`（包括 `import * as THREE from 'three'`、`three/...` 子路径、`@types/three` 运行时依赖）。
- `src/core/` 只负责剧情状态机、存档、事件总线、调试面板，保持纯逻辑、可在无 WebGL 环境运行与单测。
- 跨模块通信一律走 core 事件总线，禁止模块间直接 import 调用：
  - 3D 场景 → core：`enterZone` / `gazeHotspot` / `interact` 等事件。
  - ui → core：只订阅 core 状态渲染，不反向驱动 3D。
  - `src/world/`、`src/scenes3d/` 不得直接修改剧情状态。

违反边界等同于架构回退，必须改回事件总线。

## 4. 移动端与安全区

- 所有贴底 UI（对话框、选项、手机界面、按钮）必须预留 **至少 48px** 底部空间，并叠加安全区：

```css
padding-bottom: calc(48px + env(safe-area-inset-bottom));
padding-left: env(safe-area-inset-left);
padding-right: env(safe-area-inset-right);
```

- `renderer.setPixelRatio()` 在手机端上限 **1.5**：

```ts
const dpr = window.matchMedia('(pointer: coarse)').matches
  ? Math.min(window.devicePixelRatio, 1.5)
  : Math.min(window.devicePixelRatio, 2);
renderer.setPixelRatio(dpr);
```

- 竖屏必须可进入且不卡死；横屏第一人称是主体验，但竖屏不能白屏或崩溃。

## 5. 内容与合规红线

- 全部虚构：**禁止真实人名、校名、真实品牌与应用名**。使用"迎新群""备忘录"等通用称呼。
- 评论、弹幕、聊天记录一律概括表达：**禁止具体辱骂词与自伤内容**。
- **正式界面不得显示分数、对错、伤害值或 harm 值**，仅调试面板可见。
- 新增文案后自查：无真实主体、无具体侮辱/自伤表述、无量化伤害展示。

## 提交前自检

1. 全局搜索确认无 `PCFSoftShadowMap`、`.at(`、`findLast`、`toSorted`、`Object.hasOwn`。
2. 确认 `src/core/` 下无任何 `from 'three'`。
3. 确认贴底 UI 含 `safe-area-inset-bottom` 且底部留白 ≥ 48px。
4. 运行 `npm run build` 通过后才算完成。
