# 《一条截图》v0.5 全剧本自驱工程执行总纲（EXECUTION_PLAN_V05）

> **致开发 Agent（gptastra6.2）的最高执行指令**：
> 本文件与 `AGENTS.md`、`docs/GDD_ch1_到校段.md`（已更新为 v0.5 全五章剧本）、`docs/HANDOFF_CH1.md` 共同构成最高工程契约。
> **当前任务模式为【全流程自驱连续交付】**：所有设计分歧与数值阈值均已在本手册中拍板定稿，**严禁中途停下反问用户设计细节**。请按本手册的 **Phase A → Phase B → Phase C → Phase D → Phase E → Phase F** 顺序连续编码、编写单测、构建校验并做阶段性 `git commit`，直至全五章（S1–S14、C1–C6、D1–D6、E1 五结局 + 成就 A1–A6 + 双小游戏 + 3D 食堂/教学楼室内 + 降级模式）100% 跑通！

---

## 一、MCP 与 Skill 自动调用铁律（Agent 必读）

在推进以下任何阶段时，你必须主动读取并触发项目内置的 Skills 与 MCP：

1. **编写或修改任何 3D / UI / Core 代码前**：
   - 自动遵循 `.qoder/skills/threejs-r187-guard/SKILL.md`：
     - **Three.js 0.187.0**：严禁 `THREE.PCFSoftShadowMap`（只能用 `THREE.PCFShadowMap`）；对任何拿不准的 Three.js r187 API 或 Shader/PostProcessing 用法，**主动调用 `context7` MCP** 查询官方文档。
     - **ES2020 语法硬约束**：严禁 `.at()`、`findLast`、`findLastIndex`、`toSorted`、`toReversed`、`Object.hasOwn` 等 ES2022+ API。
     - **模块边界**：`src/core/` 与 `src/ui/` **严格禁止 `import three`**；跨模块通信一律走 `src/core/eventBus.ts`；严禁破坏 `src/scenes3d/sceneContract.test.ts` 与 `src/ui/phonePanel.ts` 暴露给 `gameUi.ts` 的外部方法签名（`open / hide / dispose / onAction`）。
     - **安全区与性能**：贴底 UI 保留 `calc(48px + env(safe-area-inset-bottom))`，按钮热区 `≥ 44px`；手机端 `pixelRatio <= 1.5`；首屏 `S1` 保持 **0 GLB 请求**、首屏总包 `≤ 3 MB`。
2. **每完成一个 Phase（以及最终交付）时**：
   - 自动遵循 `.qoder/skills/verify-and-deploy/SKILL.md`：
     - 依次执行 `npm run test`（必须 0 failed）与 `npm run build`（含 `tsc --noEmit` 必须 0 error）；
     - 阶段验收通过后执行一次中文语义化 `git commit`（注意：**切勿覆盖或删除 `.一条截图.qoder.site`**）；
     - 在 Phase E/F 完成时运行 Playwright 无头浏览器回归脚本，验证控制台零 Error、零 404。

---

## 二、已拍板定稿的核心数值与判定基准（零歧义直接写死到数据/状态层）

### 2.1 状态变量全集（`StoryState` in `src/core/state.ts` & `src/data/storySchema.ts`）

| 字段名 | 类型 | 初始值 | 作用域与说明 |
| --- | --- | --- | --- |
| `momReply` | `string \| null` | `null` | S2 回复妈妈的内容 |
| `phoneIgnored` | `number` | `0` | 忽略手机震动或选择看手机逃避的次数 |
| `seenBag` | `boolean` | `false` | S5 观察到爸爸的两个大袋子 |
| `seenHandoff` | `boolean` | `false` | S5 观察到放下林夏的瞬间 |
| `noticedTyper` | `boolean` | `false` | S5 观察到台阶旁低头打字的橙壳手机男生 |
| `handedPen` | `boolean` | `false` | S7 把笔递给林夏 |
| `reasonText` | `string \| null` | `null` | S7 主角填写的迟到原因 |
| `seenCrossedOut` | `boolean` | `false` | S7 注意到林夏划掉了“脚崴了” |
| `picked` | `boolean` | `false` | S7 捡起了林夏掉落的药袋（含 07:52 药店小票） |
| `seenFatherWatching` | `boolean` | `false` | S8 回头看见爸爸站在校门口守望 |
| `noticedPhoneBehind` | `boolean` | `false` | S8 同行路上注意到路人举着手机拍这边 |
| `noticedPhoto` | `boolean` | `false` | S9 在迎新群合照大图里点击找到了台阶上的浅黄小背影 |
| `likedPhoto` | `boolean` | `false` | S9 点赞了迎新群合照 |
| `roommateReply` | `string \| null` | `null` | S11 对室友小陈递来手机帖子的回应文案 |
| `pointedOut` | `boolean` | `false` | S11 说出了“这是我们班的吧”（`harm + 3`） |
| `canteenSeen` | `number` | `0` | S12 食堂打饭沿途留意到低语/目光的次数（0–3） |
| `postChoice` | `'explain' \| 'wait' \| 'joke' \| null` | `null` | S14 面对同行照爆发的三选一 |
| `addedHer` | `boolean` | `false` | S14 选“等等”后是否主动加了林夏说明情况 |
| `listened` | `boolean` | `false` | S14 聊天中是否倾听/陪伴了林夏（`trust + 2`） |
| `evidence` | `boolean` | `false` | 是否在 `picked && trust >= 1` 时获林夏同意保存药店小票证据 |
| `seat` | `'beside' \| 'front' \| 'far' \| null` | `null` | C2 教室选座（旁边 `trust + 1` / 前面 / 远处） |
| `teacherTalked` | `boolean` | `false` | C3 是否向周老师说明或决定先问林夏 |
| `tellTeacher` | `'told' \| 'ask_her' \| 'think' \| null` | `null` | C3 对周老师的回答（`'think'` 为旁观线条件之一） |
| `askedAboutFather` | `boolean` | `false` | C4 楼梯间是否询问林夏关于爸爸出面的事 |
| `fatherKnows` | `boolean` | `false` | 爸爸是否知道帖子（固定为 `false`） |
| `clues` | `string[]` | `[]` | C5 备忘录自动记录的线索列表 |
| `wrongAsks` | `number` | `0` | C5 二楼走廊辨认点错无辜同学的次数（上限 3，每次 `harm + 2`） |
| `foundAyuanWay` | `'recognize' \| 'relay' \| 'shout' \| null` | `null` | C5 找到阿远的方式（优先级：`shout > recognize > relay`） |
| `yuanState` | `'unprepared' \| 'guarded' \| 'hostile' \| null` | `null` | 阿远在 D1 的开场状态 |
| `yuanScore` | `number` | `0` | D1–D2 说服阿远得分（`unprepared` 起始 `+1`，`guarded` `0`，`hostile` `-1`） |
| `yuanKeys` | `string[]` | `[]` | D2 三轮选择的隐藏类型记录（`'fact' \| 'empathy' \| 'company' \| 'force' \| 'noise'`） |
| `route` | `'team' \| 'deleteOnly' \| 'breakdown' \| null` | `null` | D2 结束后的第四章路线 |
| `postDeleted` | `boolean` | `false` | D3 阿远是否当面删帖 |
| `joined` | `boolean` | `false` | D3 阿远是否加入并肩补救 |
| `phrase` | `string \| null` | `null` | D4 面对“删不回”时玩家表态的那句话 |
| `stage1Tries` | `number` | `0` | 小游戏阶段一尝试次数 |
| `crystalHits` | `number` | `0` | 小游戏水晶被击中次数 |
| `kills` | `number` | `0` | 小游戏击败评论气泡数量 |
| `helpedByAyuan` | `boolean` | `false` | D5 保护水晶是否有阿远协防 |
| `apologized` | `boolean` | `false` | D6 阿远是否向林夏当面道歉（`harm - 10`） |
| `soloRepair` | `boolean` | `false` | D6 是否走了独自补救线 |
| `trust` | `number` | `0` | 林夏对你的信任值 |
| `harm` | `number` | `20` | 隐藏伤害值（仅驱动画面暗角与调试面板，绝不在正式 UI 显示数字） |
| `ending` | `'joined' \| 'bystander' \| 'worst' \| 'best' \| 'middle' \| null` | `null` | 最终触发的结局 ID |
| `log` | `LogEntry[]` | `[]` | 玩家全流程选择与观察日志（供足迹回放使用） |

### 2.2 伤害值（`harm`）与画面暗角（`vignette.ts`）总规则
- **增减事件**：
  - 初始：`20`
  - S11 说“这是我们班的吧”（`pointedOut = true`）：`+3`
  - S14 选“解释”（被回嘲）：`+3`
  - S14 清气泡小游戏 / D5 保护水晶小游戏：水晶/防线每次受击 `+1`（单局小游戏上限 `+8`）；每击败 5 只气泡 `-1`（单局小游戏下限 `-4`）
  - C5 公开喊话（`shout`）：`+10`
  - C5 走廊辨认点错：每次 `+2`（上限 `+6`）
  - D2 出现“逼迫”谈崩：`+15`
  - D6 入队线阿远完成道歉：`-10`
- **画面暗角（Vignette）四档映射**：
  - `harm < 30`：无暗角（`opacity: 0`）
  - `30 <= harm < 50`：轻度暗角（`opacity: 0.28`）
  - `50 <= harm < 70`：中度暗角（`opacity: 0.52`）
  - `harm >= 70`：重度压迫暗角（`opacity: 0.78`）

### 2.3 信任值（`trust`）来源与解锁阈值
- **加减来源**：
  - S7 递笔 `+1`；S7 捡药袋并交还 `+1`
  - S14 解释线林夏主动加你 `+2`；聊天中选择温和倾听/陪伴（`listened = true`）`+2`；询问保存药店小票证据（需 `picked && trust >= 1`）`+1`
  - C2 教室选坐她旁边（`seat = 'beside'`）`+1`
  - C4 楼梯间回应她：“好，听你的。” `+2`；“那我再想别的办法。” `+1`；“可是他说清楚了，大家就信了。” `-1`
- **解锁阈值**：
  - 保存并能在 D2 出示药店小票证据（`evidence = true`）：需 `picked === true && trust >= 1`
  - 林夏的草稿箱 4 条目解锁：分别在 `trust >= 1`、`trust >= 3`、`trust >= 5`、`trust >= 7` 解锁
  - 最好结局（`best`）林夏在教室撕下完整的画送给你：需 `trust >= 5`（若 `< 5` 则只点头不送画，草稿箱第 3 条显示“想画给他，但……”）

---

## 三、美术资产“零代码热替换”协议（`src/data/assetManifest.ts`）

为了让美术队友随时产出 AI/手绘立绘与 CG 后无需修改业务代码即可一键替换，同时保证**替换前浏览器控制台 0 个 404 报错**，请按以下规范实现 `src/data/assetManifest.ts` 与 `tools/syncArtAssets.mjs`：

### 3.1 固定美术文件路径契约（位于 `public/art/`）

| 资源 ID (`AssetId`) | 固定放置路径（`public/` 下相对路径） | 用途与画面规格说明 | 未放图时的内置程序化兜底 |
| --- | --- | --- | --- |
| `portrait_linxia_casual` | `./art/portraits/linxia_casual.png` | 林夏立绘（浅黄外套便服、低头克制害羞、无真实品牌名牌） | 浅黄外套少女剪影 Canvas/SVG |
| `portrait_linxia_smile` | `./art/portraits/linxia_smile.png` | 林夏微笑立绘（仅最好结局 `18.1` 送画时第一次轻轻笑了一下） | 暖光浅黄少女微扬嘴角剪影 |
| `portrait_father` | `./art/portraits/father.png` | 林夏爸爸立绘（朴实、沉默） | 沉稳父亲剪影 Canvas/SVG |
| `portrait_xiaochen` | `./art/portraits/xiaochen.png` | 室友小陈立绘（随和男生剪影/插画） | 室友男生剪影 Canvas/SVG |
| `portrait_ayuan` | `./art/portraits/ayuan.png` | 阿远立绘（手持橙色手机壳的别班男生） | 橙色点缀男生剪影 Canvas/SVG |
| `portrait_teacher` | `./art/portraits/teacher.png` | 辅导员周老师立绘（温和干练） | 辅导员剪影 Canvas/SVG |
| `portrait_volunteer` | `./art/portraits/volunteer.png` | 迎新志愿者立绘 | 志愿者剪影 Canvas/SVG |
| `portrait_protagonist` | `./art/portraits/protagonist.png` | 男主立绘（仅用于同行照片、足迹回放、画中并肩背影，3D 不露脸） | 少年背影/侧影剪影 |
| `cg_s6_gate_panorama` | `./art/cg/s6_gate_panorama.png` | S6 开场全景 CG & S9 迎新群合照（台阶一角有爸爸背浅黄外套女生的极小背影） | 程序化清晨校门全景插画（含可点击台阶背影热区） |
| `cg_s11_post_crop` | `./art/cg/s11_post_crop.png` | S11 帖子第一张图（裁剪自 S6 台阶一角，爸爸背着浅黄外套女生背影） | 程序化台阶背人局部裁剪插画 |
| `cg_s13_walk_together` | `./art/cg/s13_walk_together.png` | S13 帖子新增同行照片（林荫道上男主与穿浅黄外套的林夏并肩自己走路的背影） | 程序化林荫道双人并肩背影插画 |
| `cg_ending_best_drawing` | `./art/cg/ending_best_drawing.png` | 最好结局全屏 CG《林夏的画》（铅笔淡彩风：晨光台阶上两人并肩，远处校门外爸爸提袋守望，角落一点橙色） | 程序化铅笔淡彩手绘风台阶双人画作 |
| `cg_ending_middle_sketch` | `./art/cg/ending_middle_sketch.png` | 中间结局全屏 CG《未画完的速写》（夕阳课桌摊开速写本，半幅空无一人的台阶铅笔线稿，纸角橡皮擦痕与铅笔） | 程序化夕阳课桌未完成铅笔线稿插画 |
| `cg_ending_bystander_seat` | `./art/cg/ending_bystander_seat.png` | 旁观结局画面《空座位》（夕阳下最后一排空荡的课桌椅） | 程序化夕阳空课桌插画 |
| `prop_pharmacy_receipt` | `./art/props/pharmacy_receipt.png` | 药店小票小图（打印时间 `07:52`，跌打消肿药贴，无真实药店名） | 程序化高拟真热敏纸药店小票 |
| `prop_late_form` | `./art/props/late_form.png` | 迟到登记表小图（“林夏”原因栏划掉“脚崴了”改为“路上耽搁了”） | 程序化手写划痕迟到登记表 |
| `bg_dorm_morning` | `./art/bg/dorm_morning.png` | S11 / C1 宿舍 2D 舞台背景 | 程序化清晨宿舍光影背景 |
| `bg_office_afternoon` | `./art/bg/office_afternoon.png` | C3 辅导员办公室午后逆光 2D 舞台背景 | 程序化午后逆光百叶窗办公室背景 |
| `bg_stairwell_echo` | `./art/bg/stairwell_echo.png` | C4 楼梯间 2D 舞台背景 | 程序化安静楼梯间光影背景 |
| `bg_platform_sunset` | `./art/bg/platform_sunset.png` | D1 / D2 侧楼梯平台夕阳逆光 2D 舞台背景 | 程序化夕阳逆光楼梯平台背景 |
| `trophy_gold` | `./art/trophies/trophy_gold.png` | 成就系统金色奖杯图标（A1、A6） | 精致扁平金色奖杯 SVG DataURL |
| `trophy_silver` | `./art/trophies/trophy_silver.png` | 成就系统银色奖杯图标（A2、A3、A4、A5） | 精致扁平银色奖杯 SVG DataURL |

### 3.2 零 404 热替换工作机制
1. 在 `src/data/assetManifest.ts` 中维护 `READY_EXTERNAL_ASSETS: Partial<Record<AssetId, string>>`（初始为空对象 `{}`），并提供统一渲染辅助函数 `renderAssetImage(assetId: AssetId, container: HTMLElement)`：
   - 若 `READY_EXTERNAL_ASSETS[assetId]` 存在，则加载该图片 URL（并挂 `onerror` 自动回退到内置 Canvas/SVG 程序化插画）；
   - 若不存在，则**直接同步生成内置的高审美 Canvas/SVG 程序化插画/DataURL**，绝不向不存在的 `.png` 发起网络请求（从而保证开发期与无头测试期 **100% 零 404**！）。
2. 编写脚本 `tools/syncArtAssets.mjs` 并在 `package.json` 的 `"prebuild"`（或 `"sync:art"`）中自动执行：
   - 脚本扫描 `public/art/` 下上述 22 个固定路径是否存在真实图片文件（大小 > 0）；
   - 凡是已放入的文件，自动更新写入 `src/data/readyExternalAssets.json`（被 `assetManifest.ts` 导入）；
   - 同时在 `public/art/README_美术替换说明.md` 中写明上述表格，队友把画好的 `.png` 放进对应路径后，只需运行 `npm run build`（自动触发 `syncArtAssets.mjs`），所有新立绘与 CG 立即生效！

---

## 四、Phase A ～ Phase F 自驱分步实施规格

请严格按以下 6 个阶段依次推进，每完成一个阶段运行 `npm run test && npm run build` 并 `git commit`：

### Phase A：底层 Schema 扩容 + 第一章 v0.5 补完 + 暗角/字幕/美术热替换基建
1. **Schema 与存档扩容**：
   - 更新 `src/data/storySchema.ts`、`src/core/state.ts`、`src/core/saveStore.ts`：
     - `SCENE_IDS` 扩展为 `['S1','S2','S3','S4','S5','S6','S7','S8','S9','S10','S11','S12','S13','S14','C1','C2','C3','C4','C5','C6','D1','D2','D3','D4','D5','D6','E1']`；
     - `SceneKey` 扩展为 `'room' | 'street' | 'gate' | 'desk' | 'building' | 'canteen' | 'interior' | 'stage2d'`；
     - `SpeakerId` 扩展为 `'linxia' | 'father' | 'volunteer' | 'mom' | 'xiaochen' | 'ayuan' | 'teacher' | 'admin' | 'passerby'`；
     - `StoryState` 补齐第二节表 2.1 的全部字段，并在 `StoryEffect` 中支持 `pushClue?: string | string[]`、`pushYuanKey?: string`；
     - `saveStore.ts` 向下兼容读取旧存档（缺失的新字段自动用 `createInitialStoryState()` 默认值补齐），并在 `MetaProgress` 中新增 `achievements: string[]`、`unlockAchievement(id: string)`，以及章节检查点存档 `saveCheckpoint(key: 'ch2_canteen' | 'ch3_morning' | 'ch4_platform', save: ChapterSave)` 与 `loadCheckpoint(key)`。
2. **美术热替换基建**：
   - 创建 `src/data/assetManifest.ts`、`src/data/readyExternalAssets.json`、`tools/syncArtAssets.mjs` 与 `public/art/README_美术替换说明.md`，实现 22 个美术资产的高审美 Canvas/SVG 程序化默认生成与自动扫描热替换。
3. **第一章（S1–S9）3 处 v0.5 对齐**：
   - `S2` 手机锁屏时间改为 `'8:40'`；
   - `S8`（`src/scenes3d/building.ts` 与 `story.ch1.ts`）：在林荫路侧方新增一名举手机拍风景的路人及观察热点 `phone-behind`，注视触发 `noticedPhoneBehind = true` 及观察字幕 `"路边有同学正举着手机拍林荫道，镜头晃过你们这边。"`；
   - `S9`：将迎新群消息升级为学姐发的 `"开学第一天照片合集～"`（附带群友评论 `"我在左边！"`、`"好多人啊。"`），在 `phonePanel.ts` 中支持点击放大查看合照（渲染 `cg_s6_gate_panorama`，点击台阶上浅黄色外套小背影热区时发出 `ui:phoneAction` 静默记录 `noticedPhoto = true`；点击点赞按钮记录 `likedPhoto = true`），关闭手机后平滑进入 `S10`。
4. **全局暗角（`src/ui/vignette.ts`）与黑屏字幕（`src/ui/intertitle.ts`）**：
   - 实现 `vignette.ts` 监听 `harm` 变化呈现四档暗角；
   - 实现黑屏逐行淡入淡出字幕（支持 `StoryStep` 新增 `kind: 'intertitle', lines: string[], lineDurationMs?: number, skippable?: boolean`），并用其实装 `S10`（入学几天 7 行字幕）。

### Phase B：第二章（S10–S14）全流程 + 校园墙帖子视图 + 清气泡小游戏
1. **手机面板扩展校园墙帖子与可点击评论（`src/ui/phonePanel.ts`）**：
   - 在 `PhoneSection` 中新增 `kind: 'post'`（支持帖子标题、发布时间、图片 `AssetId`、浏览数/评论数、匿名评论列表【含点赞数、跟评缩进、点击指定评论触发 `ui:showCaption` 心声字幕】、底部可选操作按钮）。
   - 注意保持 `PhonePanelView` 暴露给 `gameUi.ts` 的 `open / hide / dispose / onAction` 签名不变！
2. **第二章剧本（S10–S14）完整配置**：
   - `S11`（宿舍·室友小陈递手机）：若 `noticedPhoto` 为真先出心声 `"这是那张合照的一角。"`；展示低热度帖子（`cg_s11_post_crop`）；四选一反应（选 `"这是我们班的吧。"` 记 `pointedOut = true, harm + 3`）。
   - `S12`（食堂打饭）：进入 S12 时自动保存 `'ch2_canteen'` 检查点快照。先确保 `liteWorld.ts` 与 3D 均支持 3 个旁听点（每次记 `canteenSeen + 1`）与“三号窗口”打饭交互。
   - `S13`（爆发：同行照片）：展示高热度帖子（`cg_s13_walk_together`，浏览 4,820 · 评论 136，4 条匿名评论 A/B/C/D），支持点击匿名用户 A 和 C 的评论触发心声字幕，关闭或看完后出心声 `"……那是你。"` 进入 `S14`。
   - `S14`（三选一与分支）：
     - 选 **解释**：`postChoice = 'explain', harm + 3`，展示尖锐回嘲 → 林夏主动加你好友聊天（`trust + 2`），对话中选温和倾听（`listened = true, trust + 2`），若 `picked && trust >= 1` 可选保存药店小票证据（`evidence = true, trust + 1`）→ 启动**清气泡小游戏** → 进入 `C1`；
     - 选 **等等**：`postChoice = 'wait'`，可选是否主动加林夏（加她记 `addedHer = true`，简短疏离对话；若 `picked && trust >= 1` 亦可询问保留小票证据）→ 进入 `C1`；
     - 选 **玩笑**：`postChoice = 'joke', ending = 'joined'` → 播放 5 行参与者结局黑幕字幕 → 进入 `E1` 结局结算页（解锁成就 `A5`，支持一键“回到食堂，再试一次”读取 `'ch2_canteen'` 快照重玩）。
3. **Canvas 2D 清气泡小游戏（`src/ui/minigame/bubbleGame.ts`）**：
   - 在 `StoryStep` 新增 `kind: 'minigame', game: 'bubble' | 'crystal'`；
   - 实现轻量两阶段清气泡拦截玩法（阶段一约 15 秒拦截飘向中央浅黄光点的灰蓝“……”气泡，阶段二 10 秒气泡加速涌入的短促剧情杀），结算按受击/击败数更新 `harm`。

### Phase C：第三章（C1–C6）+ 第四章（D1–D6）+ 2D 叙事舞台 + 保护水晶小游戏
1. **2D 叙事舞台组件（`src/ui/stage2d.ts`）**：
   - 当 `sceneKey === 'stage2d'`（或 3D 场景切入 2D 对话阶段）时，展示对应场景的氛围背景（`bg_dorm_morning` / `bg_office_afternoon` / `bg_stairwell_echo` / `bg_platform_sunset`）、说话人立绘/剪影与证据小图弹出层（如 D2 出示 `prop_pharmacy_receipt` 07:52 药店小票）。
2. **第三章（C1–C6）完整剧情与旁观线判定**：
   - 进入 `C1` 时先播放转场字幕 `"第二天"` + 帖子数字滚动上涨，并自动保存 `'ch3_morning'` 检查点快照。
   - 完整实现 `C1`（小陈愧疚/安慰分支）、`C2`（教室选座 `beside / front / far` + 林夏画速写本铺垫）、`C3`（周老师办公室午后逆光三选一）、**旁观线三条件判定**（若 `seat === 'far' && tellTeacher === 'think'` 且玩家选择不去楼梯间 → 直接设 `ending = 'bystander'` 进入 `E1` 结局页，支持“回到第二天，再试一次”读取 `'ch3_morning'` 快照）、`C4`（楼梯间听林夏接爸爸电话 + 她的决定三选一）、`C5`（备忘录自动写入 `clues` + 找发布者三路径【二楼走廊 6 人辨认 `wrongAsks` / 管理员转达 / 校园墙公开喊话陷阱】）、`C6`（夜晚楼梯间橙色手机壳亮起）。
3. **第四章（D1–D6）完整剧情与保护水晶高潮小游戏**：
   - 转场字幕 `"第三天，放学后"` → `D1` 侧楼梯平台按 `yuanState` 呈现阿远开场反应并初始化 `yuanScore`（`+1 / 0 / -1`）；
   - `D2` 三轮四选一说服阿远（界面隐藏类型，记录 `yuanKeys` 与 `yuanScore`；第二轮在 `evidence` 或 `picked && trust >= 1` 时替换事实选项并弹出药店小票小图；第三轮在 `pointedOut` 为真时切换镜像反问词）：
     - 若任一轮选 `force`（逼迫）→ `route = 'breakdown', harm + 15, ending = 'worst'`，弹出提示 `"你刚才的做法，和他发帖时一样。"` 直接进入 `E1` 最差结局；
     - 若无逼迫且满足入队条件（三轮依次 `fact -> empathy -> company` 或全正向且 `yuanScore >= 2`）→ `route = 'team', joined = true, postDeleted = true`；
     - 其余无逼迫组合 → `route = 'deleteOnly', joined = false, postDeleted = true`。
   - `D3` 当面删帖（手机原帖变灰“该内容已删除”）→ `D4` 删不回（展示群截图与搬运帖仍在，二选一记录 `phrase`）→ `D5` **保护水晶小游戏（`src/ui/minigame/crystalGame.ts`）**：
     - 手机屏幕溶解过渡到 Canvas 2D 横版/竖版自适应战场：中央浅黄水晶（完整/裂纹/碎裂三态，无数字血条），玩家剪影左右移动（桌面 `A/D` 或方向键移动 + `Space/J/点击` 攻击；触屏左下角左右方向键 + 右下角大攻击键）；
     - `joined === true` 时橙色小人阿远自动在另一侧协防（`helpedByAyuan = true`）；
     - 三种灰蓝“……”评论怪：小气泡（1 击）、带刺大气泡（2 击）、阶段二分裂怪（击碎分裂为 2 个小气泡）；
     - 阶段一（击败 20 只过关）：失败可点“再试一次”（`stage1Tries + 1`）；**连败 3 次自动静默开启简化模式（怪速度 ×0.7，水晶耐受 ×1.6）；连败 5 次额外显示“跳过本关”按钮**；
     - 阶段二（剧情杀）：无阿远时水晶必碎，字幕 `"一个人很难挡住所有人。"`；有阿远时水晶带裂纹存活，字幕 `"挡不住所有的，但不是一个人。"`；按受击/击败回写 `crystalHits`、`kills` 与 `harm`。
   - `D6` 道歉与补救：入队线阿远向林夏道歉（`apologized = true, harm - 10, ending = 'best'`）；只删帖线独自对话（`soloRepair = true, ending = 'middle'`）→ 转场字幕 `"一个月后"` 进入 `E1`。

### Phase D：第五章结局复盘系统（E1）+ 成就系统（A1–A6）+ 开始页章节选择
1. **五种结局统一结算与复盘页（`src/ui/ending/endingScreen.ts`）**：
   - 按 19.5 优先级确定最终结局（`joined > bystander > worst > best > middle`）；
   - 最好结局（`best`）先演绎 `18.1` 放学后夕阳教室收尾（`trust >= 5` 时林夏撕下画送你并展开全屏 CG `cg_ending_best_drawing`、第一次微笑、走向校门外爸爸发消息 `"今天我自己走进教室了。"`；`trust < 5` 时只点头离开）；中间结局（`middle`）演绎 `18.2` 字幕并展开 `cg_ending_middle_sketch`；
   - 结算页完整包含 5 大板块：**① 结局 CG 与核心定格句 → ② 后日谈字幕与启示句（20.6 表） → ③ 足迹回放（客观陈述玩家一路的选择与观察） → ④ 林夏的草稿箱（按 `trust` 1/3/5/7 解锁 4 条心声） → ⑤ 现实行动卡**；
   - 底部提供定向回溯按钮（参与者结局“**回到食堂，再试一次**”、旁观结局“**回到第二天，再试一次**”、最差结局“**回到楼梯平台，再试一次**”）及“**章节选择**”、“**查看成就**”、“**返回标题页**”。
2. **成就系统（`src/ui/achievements/`）与开始页升级（`src/ui/startScreen.ts`）**：
   - 进入任何结局时自动解锁对应成就 `A1`–`A5`；若 `A1`–`A5` 全部集齐，自动额外解锁隐藏成就 `A6 看见`；
   - 顶部滑出克制成就弹窗（停留 3.2 秒自动收起，金色/银色奖杯图标，状态标签严格按 `A1/A2/A6` 显示“**已完成**”、`A3/A4/A5` 显示“**已记录**”，绝不出现“恭喜/失败”）；
   - 开始页新增“**章节选择**”弹窗（支持直接跳入：第一章·到校、第二章·食堂、第三章·第二天、第四章·对峙、第五章·结局回放，预设合理默认状态以便评委随时体验任意章节）与“**成就**”图鉴弹窗（未解锁显示 `？？？` 与 `尚未完成的结局`）。

### Phase E：3D 食堂（`canteen.ts`）与教学楼复合室内（`schoolInterior.ts`）高配实装
1. **`src/scenes3d/canteen.ts`（S12 食堂打饭，sceneKey: `'canteen'`）**：
   - 构建清晨/午间明亮的校园食堂 3D 空间：成排餐桌椅、取餐档口区（一至四号窗口灯箱牌，其中“三号窗口”带目标引导光点）、托盘与保温餐台、窗外绿植景深；
   - 沿途布置 3 组看手机/低语的学生 3D 角色与触发区（或近距观察点）：玩家走近时弹出片段字幕（`"……明明能自己走……"`、`"……跟她一起的那个……"`、窗口前学生回头打量你一眼又低下头），角色由微摆交谈转为停顿侧目，`canteenSeen + 1`；
   - 与“三号窗口”交互后触发手机震动切入 `S13`。
2. **`src/scenes3d/schoolInterior.ts`（教学楼复合室内，sceneKey: `'interior'`）**：
   - 按 `sceneId` 复用同一套高品质教学楼室内几何模块（水磨石走廊、班级门牌、黑板讲台与课桌椅阵列、带声学空间感的楼梯间转角、夕阳逆光侧楼梯平台）：
     - `C2`（上午·教室）：林夏（`chr_linxia.glb`）坐在最后一排课桌前低头画速写本（桌上放着摊开的速写本与铅笔），提供 3 个选座交互点（`seat-beside`、`seat-front`、`seat-far`）；
     - `C4`（楼梯间）：玩家走下楼梯转角触发林夏接爸爸电话演出，随后切入 2D 对话；
     - `C5`（二楼别班走廊）：当玩家在 C5 选择“去二楼走廊认人”时切入，走廊上错落站立 6 名学生角色（其中 1 人为手持橙色手机壳低头打字的阿远，`state.noticedTyper` 为真时其手机壳带微弱暖光提示；其余为普通手机壳同学，点错触发 `wrongAsks + 1`）；
     - `C6`（夜晚楼梯间）：冷蓝夜色灯光下，楼梯转角处阿远的橙色手机屏幕亮起微光，停留 3 秒后切入第四章；
     - `D1`（放学后侧楼梯平台）：浓烈夕阳暖橘逆光斜射入平台，玩家走近低头看手机的阿远，镜头缓慢推近后切入 `D2` 三轮说服；
     - `D6`（傍晚教室外走廊）：夕阳余晖下的走廊会面，衔接阿远道歉或独自补救对话。
3. **同步更新 `src/scenes3d/index.ts`、`src/ui/liteWorld.ts` 与 `src/scenes3d/sceneContract.test.ts`**：
   - 确保所有新增 3D 场景与 `stage2d` 在 `liteWorld.ts`（`/?lite=1` 2D 降级模式）下均有完整可点击推进卡片，保证 3D 与 2D 降级双模式 100% 通关！

### Phase F：全链路自动化验收、仓库卫生与终版构建
1. 编写/更新 Vitest 单元测试：覆盖全 5 章状态流转、5 种结局判定优先级、D2 三轮说服分支、草稿箱 `trust` 阈值解锁、成就 `A1`–`A6` 解锁与存档持久化、小游戏结算 `harm` 公式。
2. 运行 Playwright 无头浏览器回归脚本：遍历验证开始页（含章节选择与成就弹窗）、S1–S14、C1–C6、D1–D6、E1 五结局结算页，确保控制台 **0 Error、0 Warning、0 404**，首屏体积 **≤ 3 MB**。
3. 更新 `docs/HANDOFF_CH1.md`（追加 v0.5 全五章完工记录）与根目录竞赛级 `README.md`。
