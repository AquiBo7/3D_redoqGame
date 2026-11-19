# 素材与许可致谢（第一批 · UI 电影感重构）

> 与游戏内「致谢」入口（开始页 / 章节结尾）内容保持一致。新增第三方素材时，两处同步更新。
> 本版本**未使用**任何第三方贴图、模型、图标或音频，因此暂无 CC BY 署名义务。

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

## 项目自制内容

| 内容 | 说明 |
| --- | --- |
| 角色模型 `public/models/chr_*.glb` | 团队制作并经 gltf-transform meshopt 压缩（原始文件在 `art/raw/`） |
| 场景几何体与文字牌 | 全部由 `src/scenes3d/` 程序化生成 |
| 胶片颗粒与纸纹 | `src/ui/filmGrain.ts` 离屏 Canvas 生成，无第三方纹理 |
| 图标（静音 / 关闭 / 准星 / 箭头） | 自绘 SVG 与 CSS，未使用 game-icons.net |
| 音效与环境声 | `src/audio/audioManager.ts` Web Audio 合成，无第三方音频文件 |

## 后续使用第三方素材时的登记要求

- `art/third_party/` 目前为空；一旦引入 CC BY 素材（含 game-icons.net 图标），必须在此文件与游戏内致谢页同时登记**素材名、作者、来源链接、许可证**。
- CC0 素材（ambientCG / Poly Haven / Kenney / Quaternius 等）建议同样列出，便于评委核查。
