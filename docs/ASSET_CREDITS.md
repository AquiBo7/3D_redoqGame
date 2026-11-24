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

- CC0 允许商用、无需署名、无需额外声明；上表仅为评委核查留痕。
- 道具已挂载：清单在 `src/scenes3d/propManifest.ts`，各场景按位表用 InstancedMesh 换掉程序化家具；
  GLB 加载失败或被切走时场景保留程序化桌椅兜底，不会出现空洞。

## 本地 Blender 程序化套件（自制 · CC0 1.0）

由仓库内可复跑的 Blender Python 脚本直接建模、射线烘焙顶点色 AO（`COLOR_0`）并经 `@gltf-transform/cli meshopt` 压缩输出至 `public/models/props/`，零外部贴图依赖：

| 成品 | 生产脚本 | 用途 | 许可 |
| --- | --- | --- | --- |
| `prop_canteen_set.glb` | `tools/blender_canteen_kit.py` | S12 / S13 食堂 连体四人桌椅套装 | CC0 1.0 |
| `prop_canteen_column.glb` | `tools/blender_canteen_kit.py` | S12 / S13 食堂 竖条纹凹槽大柱 | CC0 1.0 |
| `prop_canteen_tray_rack.glb` | `tools/blender_canteen_kit.py` | S12 / S13 食堂 不锈钢多层餐盘回收架 | CC0 1.0 |
| `prop_canteen_window_bay.glb` | `tools/blender_canteen_kit.py` | S12 / S13 食堂 落地高窗框带暖气片 | CC0 1.0 |
| `prop_canteen_vending.glb` | `tools/blender_canteen_kit.py` | S12 / S13 食堂 无品牌发光售货机 | CC0 1.0 |
| `prop_canteen_clock.glb` | `tools/blender_canteen_kit.py` | S12 / S13 食堂 端墙圆形挂钟 | CC0 1.0 |
| `prop_school_desk_unit.glb` | `tools/blender_school_kit.py` | C2–D6 教学楼 倒角暖木弯管双人课桌（掏空书斗） | CC0 1.0 |
| `prop_school_chair_unit.glb` | `tools/blender_school_kit.py` | C2–D6 教学楼 微弧胶合板弯管课椅 | CC0 1.0 |
| `prop_school_low_locker.glb` | `tools/blender_school_kit.py` | C2–D6 教学楼 走廊 2×4 八门百叶储物矮柜 | CC0 1.0 |
| `prop_school_tall_locker.glb` | `tools/blender_school_kit.py` | C2–D6 教学楼 双门铁皮百叶储物高柜 | CC0 1.0 |
| `prop_school_backpack.glb` | `tools/blender_school_kit.py` | C2–D6 教学楼 学生通勤双肩书包 | CC0 1.0 |
| `prop_school_bulletin.glb` | `tools/blender_school_kit.py` | C2–D6 教学楼 木框绿绒课程表公告栏 | CC0 1.0 |
| `prop_school_podium.glb` | `tools/blender_school_kit.py` | C2–D6 教学楼 挡书围边斜顶立式讲桌 | CC0 1.0 |
| `prop_school_speaker.glb` | `tools/blender_school_kit.py` | C2–D6 教学楼 壁挂圆网罩广播音箱 | CC0 1.0 |
| `prop_school_office_desk.glb` | `tools/blender_school_kit.py` | C3 1F 辅导员办公室 胡桃木办公桌组合（含台灯与显示器） | CC0 1.0 |
| `prop_school_file_cabinet.glb` | `tools/blender_school_kit.py` | C3 1F 辅导员办公室 上玻下铁双节档案文件柜 | CC0 1.0 |
| `prop_school_tree_a.glb` / `_b.glb` / `_c.glb` | `tools/blender_school_kit.py` | 教学楼窗外庭院 伞状 / 偏侧 / 高窄三型阔叶香樟树 | CC0 1.0 |

## 项目自制内容

| 内容 | 说明 |
| --- | --- |
| 角色模型 `public/models/chr_*.glb` 与立绘/CG | 团队制作并经 gltf-transform meshopt 压缩（原始文件在 `art/raw/`） |
| 场景建筑壳体、地面程序纹理与文字标牌 | 由 `src/scenes3d/` 生成，并与上述 Poly Haven 道具及本地 Blender 套件实例化组合 |
| 胶片颗粒与纸纹 | `src/ui/filmGrain.ts` 离屏 Canvas 生成，无第三方纹理 |
| 图标（静音 / 关闭 / 准星 / 箭头） | 自绘 SVG 与 CSS，未使用 game-icons.net |
| 音效与环境声 | `src/audio/audioManager.ts` Web Audio 合成，无第三方音频文件 |

## 后续使用第三方素材时的登记要求

- 第三方素材统一放在 `art/props_raw/`（道具）与 `art/raw/`（角色原始），原始文件只读、不进 `public/`；`art/third_party/` 仍为空。一旦引入 CC BY 素材（含 game-icons.net 图标），必须在此文件与游戏内致谢页同时登记**素材名、作者、来源链接、许可证**。
- CC0 素材（ambientCG / Poly Haven / Kenney / Quaternius 等）建议同样列出，便于评委核查。
