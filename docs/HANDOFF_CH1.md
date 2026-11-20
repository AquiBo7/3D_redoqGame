# 《一条截图》第一章 · 工程交接手册（HANDOFF_CH1）

> **交接快照时间**：2026-11-19 21:27（已对 `E:\3D_Qoder` 代码、类型检查与 `dist/` 产物逐项核实）
> **项目目标**：阿里巴巴天池 Hack4Good 竞赛（赛道 `532536`，截稿 **2026-11-30 18:00**）—— 网络暴力主题教育向第一人称 3D 叙事游戏（第一章：到校段 S1–S9）。
> **工作流分工**：本地源码固定在 `E:\3D_Qoder`；**开发 Agent（国际服 IDE）**负责编码、单测、构建、无头浏览器截图验证；**监督 Agent（Antigravity Tech Lead）**负责审查方案、抽查代码/截图抓穿帮、提供下一轮提示词与工具清单。

---

## 一、已验证的当前工程基线（第一阶段成果）

### 1.1 技术栈与运行校验
- **核心栈**：`vite@^8.3.8`、`typescript@^7.0.2`（`target: ES2020`）、`three@^0.187.0`、`gsap@^3.15.1`、`vitest@^5.1.1`。
- **工具链**：`@gltf-transform/cli@^4.5.1`、`playwright-core@^1.65.1`（已配置本地 headless Chromium 截图脚本，不依赖账号）。
- **类型检查**：`tsc --noEmit` 退出码 `0`（零类型错误）。
- **首屏与构建产物（`dist/`）**：
  - `index.html`（2.46 KB）+ `index-*.js`（902.8 KB）+ `index-*.css`（47.8 KB）+ 本地双中文字体子集 `yt-sans-400.woff2`（86.1 KB）& `yt-serif-600.woff2`（110.6 KB）≈ **1.15 MB**（远低于 `3 MB` 首屏红线）。
  - 懒加载独立块：`GLTFLoader`、`meshopt_decoder.module`、`modelViewer`、5 个角色 `.glb`。
- **功能入口（均已跑通）**：
  - 主游戏 3D 体验：`/`（原国服线上站点 `https://yitiaojietu-v8nf654yyg8.qoder.zone`，最近更新 `2026-11-19 21:04`）
  - 2D 降级兼容版：`/?lite=1`（WebGL 异常也会自动降级）
  - 5 角色 3D 检视台（含动作切换）：`/?modelViewer=1`
  - 队友手机 UI 独立联调台：`/?phonePreview=1`
  - 调试跳关与底层状态面板：`/?debug=1`（支持 `?scene=S1..S9`）

### 1.2 核心模块现状
- **`src/core/`**：`state.ts`、`saveStore.ts`（双 key 持久化＋断点续玩）、`sceneMachine.ts`（S1–S9 完整推进）、`gameEngine.ts`、`eventBus.ts`、`urlParams.ts`、`debugPanel.ts` —— 全部纯逻辑，零 `three` 引用。
- **`src/data/`**：`storySchema.ts`、`story.ch1.ts`（S1–S9 完整剧本、触发器、隐藏 `harm` 值）。
- **`src/world/`**：
  - `FirstPersonController.ts`（三重独立锁 `controlsLocked / cinematic / transitionLocked`；桌面 PointerLock + MC 风格十字准星 + `Shift` 单击开关疾跑 + ESC 释放提示；手机单指拖拽环视 + 轻点寻路）。
  - `InteractionSystem.ts`（交互光点、2 秒注视蓄力圈、区域触发、边缘目标箭头）、`CutscenePlayer.ts`（`s1-wake` / `s3-run` / `school-gate-panorama`）、`WorldApp.ts`（已升级至电影感清晨天空球、淡云层、IBL `PMREMGenerator`、轻 Bloom/晨光粒子、角色接触阴影、S4 后台静默预载 `linxia`/`father` 防胶囊回退）。
  - `resources.ts`（`GLTFLoader + MeshoptDecoder` 懒加载、`SkeletonUtils.clone`、身高标准化、共享资源销毁保护）、`modelViewer.ts`。
- **`src/ui/`**：已完成第一批**清晨电影感 UI 重构**（本地双中文字体子集、程序化胶片颗粒 `filmGrain.ts`、全宽底部渐变对话栏、细线选项、无胶囊心声字幕、致谢弹窗 `credits.ts` + `docs/ASSET_CREDITS.md`、纸纹降级卡 `liteWorld.ts`、右上角静音按钮 `muteButton.ts`、手机调试台 `phonePreview.ts`）。**`phonePanel.ts` 的 `.ts` 外部接口保持原样，专等队友替换。**
- **`src/audio/audioManager.ts`**：纯 Web Audio 合成（零外部音频文件，含起床闹钟、手机提示音、脚步轻响、界面点击反馈、静音持久化）。
- **`src/scenes3d/` 场景美化进度**：
  - ✅ **`materials.ts`**（已建）：无缝程序化 PBR 材质库（沥青、人行道砖、粉刷墙、木地板、树皮、窗格玻璃等）。
  - ✅ **`room.ts`（S1–S3 旅馆房间）**：已完成精修（天花板、踢脚线、木地板、真窗洞窗帘光斑、床铺/手机/书桌台灯笔记本水杯/证件袋/带轮行李箱/木门，S1 首屏 0 GLB）。
  - ✅ **`street.ts`（S4 上学街道）**：已完成电影感高配升级（微湿反光柏油路、盲道黄砖、黑黄防撞柱、暖光发光便利店与自动贩卖机橱窗、电线杆与垂落电线网、多层蓬松树冠、远景围墙与教学楼剪影）。
  - ⏳ **`gate.ts`（S5–S6 校门台阶）**：已实装 3D 角色与林夏拆分行走动画，**尚未做高配建筑与环境细节精修**。
  - ⏳ **`desk.ts`（S7 迟到登记处）**：已实装 3D 角色与药袋隐藏逻辑，**尚未做高配环境与背景围合精修**。
  - ⏳ **`building.ts`（S8–S9 林荫路与 A 栋）**：已实装林夏 26s 原地骨骼走路跟随与回头看爸爸，**尚未做高配林荫路与教学楼精修**。

### 1.3 5 个 3D 角色模型现状
原档均保留在 `art/raw/`（只读），压缩版位于 `public/models/`，全员统一 `frontYawRad = -Math.PI / 2`（绕 Y 归正后正面朝 `+Z`）：

| ID | 角色 | 原档（`art/raw/`） | 输出（`public/models/`） | 规格与动画 |
|---|---|---|---|---|
| `linxia` | 林夏 | `女主-可动-双脚修复.glb` | `chr_linxia.glb`（1.33 MB） | ~33,148 面（含 152 面 `Shoe inner leather` 子网格）、41 根骨骼、5 条保留动画（`walk` 已原地化去除 Hip 1.5m Root Motion、`afraid`、`agree`、`greet_04`、`wave_goodbye_02`） |
| `father` | 爸爸 | `爸爸3d模型.glb` | `chr_father.glb`（1.00 MB） | ~33K 面、静态无骨骼、2048 贴图 |
| `ayuan` | 阿远/拍照男生 | `男同学1.glb` | `chr_ayuan.glb`（1.15 MB） | ~33K 面、静态无骨骼、2048 贴图 |
| `volunteer` | 迎新志愿者 | `女同学1.glb` | `chr_volunteer.glb`（0.38 MB） | ~33K 面、静态无骨骼、原始即 512 贴图 |
| `protagonist` | 主角“我” | `男主3d建模.glb` | `chr_protagonist.glb`（1.12 MB） | ~33K 面、静态无骨骼、2048 贴图（供检视台/备选） |

---

## 二、绝对不能踩的 8 条历史红线与已踩平的坑

1. **Three.js 0.187.0 硬约束**：严禁 `THREE.PCFSoftShadowMap`（只能 `THREE.PCFShadowMap`）；不确定 r187 API 必须先查 `context7` 或 `@types/three`。
2. **ES2020 语法硬约束**：禁用 `.at()`、`findLast`、`toSorted`、`Object.hasOwn` 等 ES2022+ 方法；`npm run build`（含 `tsc --noEmit`）必须零错误。
3. **模块边界**：`src/core/` 与 `src/ui/` 严禁 `import three`；跨模块通信一律走 `src/core/eventBus.ts`；严禁破坏 `sceneContract.test.ts` 与现有 `nav / spawn / interactables / hotspots / zones / GSAP` 契约。
4. **首屏与移动端性能**：首屏总资源 ≤ 3MB；`room.ts`（S1）首屏 **0 GLB 请求**；手机端 `pixelRatio ≤ 1.5`；所有贴底 UI 保留 `calc(48px + env(safe-area-inset-bottom))`，按钮热区 ≥ 44px。
5. **模型压缩与骨骼动画铁律**：
   - **严禁使用 `MeshoptSimplifier.simplifySloppy`**（会造成 ~40% 三角形 UV 跨岛撕裂花斑）；必须使用 `tools/compressModels.mjs` 的 `simplifyWithAttributes` 保护 `NORMAL + TEXCOORD_0` 并过 `uvCheck.mjs`（`>0.25` 撕裂必须为 0）。
   - 后续新增**带骨骼动画的 `.glb`**（例如爸爸或新角色）：必须走 `animated: true` 管线——保留 `JOINTS_0 / WEIGHTS_0 / Skin`，跳过 `<= targetTris` 的小补丁 primitive（防止多 primitive 共享顶点被破坏），检查并剥离 `walk` 根骨骼（`Hip/Pelvis`）的前进 Root Motion 转为原地循环，运行时用 `SkeletonUtils.clone` + `frustumCulled = false` + `AnimationMixer`。
6. **GPU 资源销毁安全**：`WorldApp.disposeObjectTree` 必须跳过 `userData.sharedResource === true` 的模板与缓存材质；`PMREMGenerator.fromScene()` 返回的 `WebGLRenderTarget` 必须保留到 `WorldApp.dispose()` 再释放；非地面角色（如爸爸背上的 `carryLinxia`）不挂脚底接触阴影。
7. **队友手机 UI 对接契约**：严禁改动 `src/ui/phonePanel.ts` 给 `gameUi.ts` 暴露的接口签名（`open / hide / dispose / onAction`）以及 `eventBus.ts` 的 `ui:showPhone / ui:hidePhone / ui:phoneAction / ui:phoneVibrate` 协议。
8. **合规与内容安全**：全虚构（禁真实校名/品牌/真实 App 名如微信抖音微博）；禁具体辱骂词与自伤表述；正式界面绝不显示分数、对错或 `harm` 数值（仅 `?debug=1` 面板可见）。

---

## 三、第二阶段待办优化清单（接下来要干的事）

按优先级分批推进（每批完成后必须执行 `npm run test` + `npm run build` + 无头浏览器截图自检）：

### P0 · 剩余 3 个场景建筑与环境高配精修（对标 `room.ts` 与 `street.ts`）
1. **`src/scenes3d/gate.ts`（S5–S6 校门名场面）**：校门石柱雕饰、保安亭透暖光窗、铁艺围栏、高清「欢迎新同学 / 迎新报到」横幅与支架、台阶防滑条与磨损、校园内教学楼与蓬松大树景深（消除身后空灰地）、优化爸爸手提袋造型、校准左侧打字男生双脚贴地不穿模。
2. **`src/scenes3d/desk.ts`（S7 迟到登记处）**：搭实遮阳棚支架与篷布、桌布＋清晰可读登记簿＋笔筒水瓶、高辨识度药袋、校园广场围墙/建筑/绿植背景围合（消除背后大片空地）。
3. **`src/scenes3d/building.ts`（S8–S9 林荫路与 A 栋教学楼）**：多簇蓬松树冠＋穿过树叶的斑驳光影与飘落微尘、木条铁腿校园长椅、宣传栏、路灯暖晕、A 栋教学楼早自习亮暖光窗格与门廊雨棚；确保回头看校门口爸爸视线清晰不被树冠完全遮挡。

### P1 · 已知细节修补、穿模排查与操作手感优化
1. **`street.ts` 细节修正**：在最新截图 `tools/shots/cinematic-S4-shop-volunteer.png` 中，举牌志愿者的「新生报到 →」牌子右半边受便利店泛光影响偏白过曝且缺支架/握柄，需降低牌面亮度响应、补充握杆/立架并微调位置使其完全不挡身、不过曝。
2. **全局穿模与碰撞体检**：逐关检查 S1–S9 角色脚底贴地、手持道具（手机/袋子）不穿身、玩家滑动碰撞不卡墙角、S5 爸爸背林夏合体与拆分过渡更自然；根据用户反馈微调桌面/移动端视角灵敏度、交互判定距离或步速。

### P2 · 团队成果合入（随时插队）
1. **新人物动作导入**：团队若提供爸爸或其他角色的带骨骼动作 `.glb`（或从 Unity 用 Humanoid + UnityGLTF 转出的 In-Place `.glb`），放入 `art/raw/` 后按 `linxia` 管线压缩并接入 `characterAnimation.ts` + `AnimationMixer`。
2. **队友新版手机 UI / 情节合入**：通过 `/?phonePreview=1` 独立验收后替换 `src/ui/phonePanel.ts`（及按需对齐 `story.ch1.ts` 中的 `replyOptions` 与 `S4` 震动详情视图）。

### P3 · 终版收官与竞赛提交（Step 12，截止 11 月 30 日 18:00）
1. 编写项目根目录竞赛级 `README.md` 与清理仓库卫生（确认 `.gitignore` 忽略临时截图）。
2. 补齐 `docs/qoder-log/` 过程与成品截图（目前已有 4 张：`1.1.1agent文档规定.png`、`1.1.2骨架搭建.png`、`1.1.2黑盒搭建完成.png`、`1.1.3健全基础功能和建模.png`）。
3. 录制 2 分钟 1080p 演示视频并确认最终公网部署地址。

---

## 四·补、终版收官快照（2026-11-20，Phase D / F 完成）

> 本段为第一章之后续：五结局复盘、成就系统与队友 v0.6 四栏手机合入的终版状态。验证与提交已全部通过，未部署。

### 4B.1 剧情结局（`src/data/story.ending.ts` + `src/core/endingReview.ts` + `src/data/endingContent.ts`）
- 五结局按优先级归一：`joined > bystander > worst > best > middle`，前向跳转只写入一次最终结局，不回改前章数值。
- 最好结局含「夕阳教室递画 → 高信任送画 / 低信任未送画（线稿 CG）→ 三选回应 → 第一次轻笑 → 林夏发来消息 → 不可跳过定格句」完整演出。
- 回望页（`chapterEnd.ts/css`）呈现：CG 与标题、后记两栏、原生 `<details>` 足迹、四份林夏草稿（信任阈值 1/3/5/7）、五张现实行动卡、按结局的「再试一次」检查点回退按钮，以及「手机 · 草稿箱」回看入口。

### 4B.2 成就与章节选择（`src/data/achievements.ts` + `chapterPresets.ts` + `ui/achievementsPanel.ts`）
- 成就 A1–A5 对应五结局，A6「看见」在五结局齐备后追加解锁；3.2 秒受限 toast，重复通关不重复弹，A6 恒排最后。
- 标题页「章节选择」提供五章直达：第一至四章以明确预设覆盖式开新局，第五章为「一个月后」预览（不解锁成就、不覆盖正式存档）；结局页另有「返回标题 / 从头开始」。
- 元数据 `yitiaojietu.meta.v1` 与单局存档 `yitiaojietu.ch1.save.v1` 分层；新开一局会同步清理旧检查点（`ch2_canteen / ch3_morning / ch4_platform`）。

### 4B.3 队友 v0.6 四栏手机合入（`src/ui/phonePanel.ts/css` + `src/core/phonePresentation.ts`）
- 浅灰白机身、四栏【消息 / 校园墙 / 备忘录 / 我】，图标改为内联 SVG（不占用字体子集字形）；横屏 68px 左栏 + 右侧独立滚动，底部保留 48px 安全区。
- Lightbox 缩放 1×–3.2×（步长 0.55）、还原、拖拽平移、百分比热点静默记录（`left:69% top:37% width:16% height:38%`）与点赞幂等；E/Esc 在 Lightbox 打开时都只返回图片。
- 校园墙按时序呈现：S11 低热度裁切帖、S13 双图与 A/C 跟评心声、D4 原帖已删除（历史转发 214 未归零）＋搬运帖留存；备忘录含迎新指南与 C5 实际线索；「我」含 2026 级资料与结局草稿。
- 三张高清外部 PNG 落盘 `public/art/cg/`（校门全景 1200×896、同行照 1200×896、台阶裁切 417×417），其余 19 项插画仍为自包含 SVG 兜底；提取脚本 `tools/importPhoneV06Assets.mjs` 仅接受显式传入的 HTML 路径，不硬编码私密路径。

### 4B.4 验证与产物
- `npm run test`：52 文件 1484 项全绿；`npm run build`：零类型错误，首屏约 1.77MB（含双字体子集 327KB）。
- 浏览器验收（headless Chromium，全部 `problems: []`）：`verifyV05.mjs`（第一章 7 项）、`verifyChapter2.mjs`（第二章 4 项）、`verifyChapter34.mjs`（三四章 4 项）、`verifyInterior.mjs`（室内 6 项）、`verifyEnding.mjs`（五结局/成就/章节/草稿箱 10 项）。
- 关键截图位于 `tools/shots/final-phone-home.png`、`final-phone-lightbox.png`、`final-ending-best.png`（目录已 gitignore）。

---

## 四、切换国际服 IDE 与环境迁移注意点

1. **先建 Git 基线保护**（重要！当前 `E:\3D_Qoder` 尚未初始化 `.git`）：迁移前先在 `E:\3D_Qoder` 执行 `git init` 并做一次基线提交，确保任何新工具改坏都能秒回滚。
2. **规则与技能加载**：国际服打开 `E:\3D_Qoder` 后，核对 `AGENTS.md` 与 `.qoder/skills/`（`threejs-r187-guard`、`verify-and-deploy`）是否已自动生效；MCP 端重新启用 `context7`。
3. **线上部署文件保护（重要！）**：项目根目录的 `.一条截图.qoder.site` 绑定的是原国服账号的 `siteId`（`01a1eeb4-8b70-7640-87bb-f68fde539bb1`）。切换国际服前**先备份一份 `.一条截图.qoder.site`（不要直接覆盖删掉）**；国际服开发与本地 `npm run build` 产出的 `dist/` 是纯静态相对路径网站，若国际服账号无法更新国服旧站点，可在国际服发布独立预览站点或将最终 `dist/` 部署到任何兼容的静态托管地址。
