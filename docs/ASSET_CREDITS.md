# 素材与许可致谢（第一批 · UI 电影感重构）

> 与游戏内「致谢」入口（开始页 / 章节结尾）内容保持一致。新增第三方素材时，两处同步更新。
> 字体为 SIL OFL 1.1；3D 道具为 Poly Haven CC0（无署名义务，但按评委可核查的原则全部列出）。
> **本版本没有任何 CC BY 素材**，因此不存在强制署名。

## 字体（SIL Open Font License 1.1）

| 素材 | 用途 | 来源 | 许可 |
| --- | --- | --- | --- |
| Noto Serif SC（字重 600） | 片名、标题、说话人名、心声字幕 | https://fonts.google.com/noto/specimen/Noto+Serif+SC ；npm 包 `@fontsource/noto-serif-sc@5.3.1` | SIL OFL 1.1 |
| Noto Sans SC（字重 400） | 正文、选项、手机界面 | https://fonts.google.com/noto/specimen/Noto+Sans+SC ；npm 包 `@fontsource/noto-sans-sc@5.3.1` | SIL OFL 1.1 |

- 两个字体均按本作用字**子集化后本地打包**：`public/fonts/yt-serif-600.woff2`、`public/fonts/yt-sans-400.woff2`，合计约 181KB，运行时不访问 Google Fonts / jsDelivr。
- 许可证原文随字体发布：`public/fonts/OFL.txt`（复制自 npm 包内 `LICENSE`）。
- 生成脚本：`node tools/buildFonts.mjs`（依赖 Python + fontTools 合并 fontsource 分片；清单 `tools/fonts-manifest.json` 供单测校验）。
- 已提前纳入第三批招牌用字（便利店 / 早餐 / 欢迎新同学 / 迎新报到 / A 栋 / 迟到登记等）。

## 开源运行时组件

| 组件 | 用途 | 许可 |
| --- | --- | --- |
| three.js 0.187.0 | 3D 渲染 | MIT License |
| GSAP 3.x | 镜头与过场时间轴 | GSAP 标准免费许可（未使用付费 Club 插件） |
| Vite / TypeScript / Vitest | 构建与测试 | MIT / Apache-2.0 / MIT |

## 第三方 3D 道具（CC0 · Poly Haven）

原始文件在 `art/props_raw/`（只读，不进构建），标准化成品在 `public/models/props/`。
获取：`node tools/fetchProps.mjs`；标准化：`blender --background --python tools/blender_prop_pipeline.py`；
来源与许可逐条留痕见 `art/props_raw/SOURCES.md`。

| 成品 | 源模型 | 用途 | 作者 | 来源 | 许可 |
| --- | --- | --- | --- | --- | --- |
| `prop_street_lamp.glb` | street_lamp_01 | S4 街道 / S8 林荫路 路灯 | Poly Haven | https://polyhaven.com/a/street_lamp_01 | CC0 1.0 |
| `prop_school_desk.glb` | SchoolDesk_01 | C2 教室 / S7 登记处 课桌 | Poly Haven | https://polyhaven.com/a/schooldesk_01 | CC0 1.0 |
| `prop_school_chair.glb` | SchoolChair_01 | C2 教室 课椅 | Poly Haven | https://polyhaven.com/a/schoolchair_01 | CC0 1.0 |
| `prop_bed.glb` | old_bed_frame | S1 旅馆房间 单人床 | Poly Haven | https://polyhaven.com/a/old_bed_frame | CC0 1.0 |
| `prop_trashcan.glb` | metal_trash_can | S4 街道 垃圾桶 | Poly Haven | https://polyhaven.com/a/metal_trash_can | CC0 1.0 |
| `prop_bench.glb` | painted_wooden_bench | S8 林荫路 长椅 | Poly Haven | https://polyhaven.com/a/painted_wooden_bench | CC0 1.0 |
| `prop_suitcase.glb` | vintage_suitcase | S1 热点「行李箱」 | Poly Haven | https://polyhaven.com/a/vintage_suitcase | CC0 1.0 |
| `prop_stationery.glb` | stationery_supplies | S7 登记桌 / C2 教室 文具书本 | Poly Haven | https://polyhaven.com/a/stationery_supplies | CC0 1.0 |
| `prop_canteen_set.glb` | painted_wooden_table + painted_wooden_chair_01 | S12 / S13 食堂 一桌四椅套装（`tools/blender_canteen_set.py` 合成并烘焙成单图集） | Poly Haven | https://polyhaven.com/a/painted_wooden_table | CC0 1.0 |

- CC0 允许商用、无需署名、无需额外声明；上表仅为评委核查留痕。
- 道具已挂载：清单在 `src/scenes3d/propManifest.ts`，各场景按位表用 InstancedMesh 换掉程序化家具；
  GLB 加载失败或被切走时场景保留程序化桌椅兜底，不会出现空洞。
- 树（行道树）没有采用 Poly Haven：其树是摄影测量扫描，1k 变体 60–100MB、上万片带 alpha 的叶卡，
  压到 500 面会糊成一团；按 `docs/美术优化素材与提示词包.md` 第六节 S8 的方案保持程序化 + InstancedMesh。

## 项目自制内容

| 内容 | 说明 |
| --- | --- |
| 角色模型 `public/models/chr_*.glb` | 团队制作并经 gltf-transform meshopt 压缩（原始文件在 `art/raw/`） |
| 场景几何体与文字牌 | 全部由 `src/scenes3d/` 程序化生成 |
| 胶片颗粒与纸纹 | `src/ui/filmGrain.ts` 离屏 Canvas 生成，无第三方纹理 |
| 图标（静音 / 关闭 / 准星 / 箭头） | 自绘 SVG 与 CSS，未使用 game-icons.net |
| 音效与环境声 | `src/audio/audioManager.ts` Web Audio 合成，无第三方音频文件 |

## 后续使用第三方素材时的登记要求

- 第三方素材统一放在 `art/props_raw/`（道具）与 `art/raw/`（角色原始），原始文件只读、不进 `public/`；`art/third_party/` 仍为空。一旦引入 CC BY 素材（含 game-icons.net 图标），必须在此文件与游戏内致谢页同时登记**素材名、作者、来源链接、许可证**。
- CC0 素材（ambientCG / Poly Haven / Kenney / Quaternius 等）建议同样列出，便于评委核查。
