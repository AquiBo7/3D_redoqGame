# 《一条截图》第一章：交互升级、全场景精装与水彩漫染工程规格文档（CH1 Polish Engineering Spec）

- **适用工作区**：`E:\3D_Qoder`
- **文档存放路径**：`docs/CH1_POLISH_ENGINEERING_SPEC.md`
- **前置必读文档**：`AGENTS.md`、`docs/HANDOFF_CH1.md`
- **执行方式**：按 **里程碑 M1 → M2 → M3 → M4** 顺序逐步实施；**每完成一个里程碑必须跑通 `npm run test && npm run build` 并做一次 `git commit` 存档**，全部完成后统一执行端到端视觉验收并输出验收报告。

---

## 〇、全局架构红线与前置环境要求

1. **引擎与语法红线（来自 `AGENTS.md` & `threejs-r187-guard`）**：
   - `three@0.187.0` 仅允许使用 `THREE.PCFShadowMap`（严禁 `PCFSoftShadowMap`）；
   - 目标语法为 ES2020（严禁 `.at()`、`findLast`、`toSorted`、`Object.hasOwn` 等 ES2022+ API）；
   - `src/core/` 与 `src/ui/` 严禁导入 `three`；
   - `src/ui/phonePanel.ts` 的外部接口签名（`constructor / open / hide / isOpen / dispose` 及 `PhonePanelCallbacks`）严禁修改（队友后续会独立替换内部实现）；
   - 首屏 S1 卧室必须保持 **0 GLB 请求**、首屏加载资源总计 `<= 3MB`；
   - 移动端（`pointer: coarse`）保持 `pixelRatio <= 1.5`、**零 `EffectComposer` 后处理**、底部安全区 `calc(48px + env(safe-area-inset-bottom))`、触控按钮热区 `>= 44×44px`。
2. **依赖与工具约束**：
   - 优先使用工作区已配置的 `context7` MCP 查阅 `three@0.187.0` / `gsap` 官方 API；
   - 视觉与回归验收使用工作区本地 Playwright 脚本（`tools/verifyMovement.mjs`、`tools/verifyCampusArt.mjs` 或新增 `tools/verifyPolish.mjs`）；
   - **禁止**在 `src/scenes3d/` 外随意修改已通过的剧本 ID、事件名或存档字段结构。

---

## 一、里程碑 M1：双端交互闭环、电影感 UI 指引与主角行动提醒

### 模块 1：按 `E` 键查看与收起手机/消息 + 手机触屏双击地面疾跑

1. **`E` 键打开与收起居中 2D 手机面板（`src/ui/phonePanel.ts` & `src/ui/gameUi.ts`）**：
   - 保持 `PhonePanelView` 对外构造与公共方法签名完全不变；
   - 在手机面板打开状态下（`phone.isOpen() === true`），绑定键盘 `KeyE` 监听（忽略 `event.repeat` 及输入焦点）：
     - 若处于锁屏页（`view === 'lock'`），按 `E` 解锁进入手机主界面；
     - 若处于主界面或子会话视图，按 `E` 直接触发 `requestClose()` 收起手机（等同点击底部「收起手机」按钮）；
   - **防连发防抖**：S1 中按 `E` 触发 `phone` 交互打开手机的那次按键事件，必须通过 `stopPropagation()` 或打开后 `180ms` 冷却保护，避免同一按键瞬间又把手机关掉；
   - **保留原按钮服务手机用户**：底部「收起手机」按钮完整保留（热区 `>= 44×44px`），桌面端可附带轻量 `[E]` 键帽角标，手机端保持简洁文字。

2. **`E` 键查看与收起手机震动消息（`src/ui/phoneVibrate.ts`）**：
   - 当 S4 街巷「手机震动了」浮动提示条可见（`!snackbar.hidden`）时，按 `KeyE`（忽略 `repeat`）触发 `handleView()` 打开消息卡；
   - 当「新消息」卡片可见（`!messageOverlay.hidden`）时，再按 `KeyE` 触发 `closeMessage()` 收起消息卡（同样加 `180ms` 防抖，避免一次按键同时打开又关闭）；
   - 原有「查看」「忽略」「收起」按钮全部保留且热区 `>= 44×44px`。

3. **手机触屏「双击地面疾跑」（`src/world/FirstPersonController.ts`）**：
   - 在 `handleTap(clientX, clientY, pointerType)` 的 `pointerType === 'touch'` 分支记录上一次触屏轻点时间与坐标；
   - 若两次轻点间隔 `<= 320ms` 且屏幕距离 `<= 48px`，开启 `this.autoWalkSprint = true`；单击地面则为普通步行（`this.autoWalkSprint = false`）；
   - `autoWalking` 期间若 `this.autoWalkSprint === true`：速度使用 `this.config.sprintSpeed`，向 `updateBob` 传入 `sprinting = true`，并让地面目标圆环 `this.marker` 脉冲更快、微带暖金高光以反馈疾跑状态；到达落点或取消寻路时重置 `this.autoWalkSprint = false`。

### 模块 2：开场双端《操作指南》、`O` 键静音开关与正面视角主角行动提醒

1. **点击开始时的双端《操作指南》叠层（新增 `src/ui/controlsGuide.ts` & `src/ui/controlsGuide.css`）**：
   - 视觉与全站电影感 UI 保持高度统一：使用本地 `Noto Serif SC` / `Noto Sans SC` 字体、胶片纸纹半透明深灰底、极细暖金描边（`1px hairline`），不显得像生硬弹窗；
   - 在开始页点击「开始体验」或「继续体验」后显示（**重要**：若 URL 携带 `?scene=` 调试直达参数，自动跳过此弹窗，保证现有 Playwright 回归脚本畅通无阻）；
   - 内容分两栏清晰展示：
     - **电脑玩家（PC）**：`W/A/S/D` 移动 · `鼠标` 环视（点画面锁鼠，`ESC` 释放） · `Shift` 开关疾跑 · `E / 左键` 互动及查看/收起手机与消息 · `O` 开启/关闭声音；
     - **手机 / 平板玩家（触屏）**：`单指拖动` 环视四周 · `单击地面` 步行前往 · `双击地面` 疾跑前往 · `轻点光点与按钮` 互动、查看消息及开关声音；
   - 底部按钮「进入清晨（点击 / 空格 / E）」（高度 `>= 44px`），关闭后正式解锁控制并进入游戏。

2. **电脑端按 `O` 键一键静音/取消静音（`src/ui/muteButton.ts`）**：
   - 监听 `window` `keydown`：`event.code === 'KeyO'`（`!event.repeat`、非输入框）时切换 `setMuted(!isMuted())`，同步按钮视觉状态与取消静音轻反馈音；桌面端 `title` 更新为 `静音 (O)` / `取消静音 (O)`；清理函数内正确移除事件监听。

3. **主角第一人称正面视角「行动目标提醒」（`src/ui/captions.ts` 或新增 `src/ui/objectivePrompt.ts` + `src/ui/gameUi.ts`）**：
   - 样式采用极克制的电影字幕美学：位于视野正中偏上（约 `top: 21%`，绝对不遮挡中心 `+` 准星与底部对话框），主文使用衬线体呈现主角内心口吻，下方附极细一行小号提示；淡入停留 `4.2s` 后柔和渐隐，并在顶部边缘保留极简当前目标胶囊（直至进入下一场景或完成目标）；
   - 覆盖全部自由行动前节点：
     - **S1（起床过场结束进入自由态）**：主文 `“闹钟响个不停……先去床头看一眼手机吧。”` / 副提示 `走近床头手机，按 E 或点击查看`
     - **S3（收起手机后）**：主文 `“8:47 了……拿上证件袋和文化衫，我要出门了，要迟到了！”` / 副提示 `可先拿桌上证件袋与椅背文化衫，或直接出发`
     - **S4（进入清晨街巷）**：主文 `“顺着这条街一直往前走，得赶快到校门口。”` / 副提示 `沿街道向前走往校门（手机震动可按 E 查看）`
     - **S5（父女进门拆分后）**：主文 `“他们进校门了……我也踏上台阶进去吧。”` / 副提示 `走上校门台阶进入校园（向左转头可留意旁边的男生）`
     - **S7（来到迟到登记处）**：主文 `“先看看登记桌上的表格，再帮她把地上的药袋捡起来吧。”` / 副提示 `注视登记表，对准桌旁药袋按 E 或点击拾取`
     - **S8（踏上校园林荫道）**：主文 `“陪她一起沿着林荫道走到前面的 A 栋教学楼吧。”` / 副提示 `随林夏前行至 A 栋入口（也可回头望一眼校门口的父亲）`

> **M1 验收与存档**：补充对应单测（`E` 键开关防抖、触屏双击疾跑、`O` 键静音、行动提醒映射），执行 `npm run test && npm run build`，提交 `git commit -m "feat(ui): 完善 E/O 键位、触屏双击疾跑、双端操作指南与主角行动提醒"`。

---

## 二、里程碑 M2：S1 卧室精装升级与 S5 校门动态路人/拍照男生重排

### 模块 3：S1–S3 卧室参考等距插画精装 + 头顶常亮吊灯 + 细腻纹理（`src/scenes3d/room.ts` & `src/scenes3d/materials.ts`）

严格遵守 **S1 首屏 0 GLB 请求**（纯程序化几何 + 高精度程序化 Canvas PBR 纹理）：

1. **细腻纹理与暖橘撞色墙面**：
   - 在 `src/scenes3d/materials.ts` 中细化 `getWoodFloorMaterial`（清晰的橡木条板分缝线、柔和木纹年轮与自然板间色差、微反光清漆感 `roughnessMap`）与 `getPlasterMaterial`（柔和微粒乳胶漆质感）；
   - 参考暖调卧室配色：将窗户所在的后墙（`z = -6.4`）设为**温暖陶土橘棕色主题墙（`0xc46d45`）**，左右及门口侧墙为**暖米白（`0xf1ece1`）**，配深原木踢脚线。
2. **头顶常亮自发光暖光吊灯（新增 `buildCeilingLamp`）**：
   - 天花板中央（`x: 0, y: 2.82 -> 2.18, z: -1.6`）悬挂现代简约吊灯：吸顶盘 + 吊杆 + 暖米白/拉丝黄铜双层灯罩 + **常亮自发光暖黄灯泡（`emissive: 0xffd27d, emissiveIntensity: 1.8`）+ 柔和光晕 Sprite**；
   - 挂载一盏暖色室内主灯 `THREE.PointLight(0xffcb82, 1.15, 9.0, 1.6)`（`castShadow = false` 零阴影性能损耗），让房间家具表面与墙面有真实温馨的顶光层次。
3. **百叶窗与条纹阳光 + 双层错落搁板 + 双屏书桌 + 废纸篓与纸团**：
   - **百叶窗（Venetian Blinds）**：窗框内侧安装顶盒、10~12 片微倾暖木色百叶叶片与细拉绳；在侧墙与木地板上添加百叶窗投射出的斜向平行阳光条纹光斑；
   - **双层错落壁挂搁板**：在床与书桌之间的墙面（约 `y = 1.48` 与 `y = 1.76`）架设两层原木搁板，摆放**砖红、森绿、暖黄、湖蓝四色立放精装书（带白色书页内芯）、平放叠书与一盆深灰陶盆小绿植**；
   - **书桌与床铺细节升级**：书桌侧面增加双层抽屉面板与黑色拉手；桌面后半区布置**双联显示器（哑光深灰边框 + 柔和暗屏反光）、迷你键盘、鼠标、红皮笔记本与马克杯**（桌面中央前侧保持 `document-bag` 证件袋清晰可交互）；床铺被面改为**暖砖红/珊瑚红质感织物 + 白色折边床单**；床角地板放置**木色梯形废纸篓 + 桶外地板 2 颗白色皱纸团**。

### 模块 4：S5/S6 校门路人走入校园深处 + 拍照男生移至主角左后方（`src/scenes3d/gate.ts`）

1. **拍照/打字男生（`typer`）移至主角左后方（必须向左转头才能看见，正对进门父女）**：
   - 玩家在 S5 的出生点为 `SPAWN = { x: 0, z: 7.6, yaw: 0 }`（面向 `-Z` 校门正前方）；
   - 将 `TYPER.position` 改为 **`{ x: -3.6, y: 0, z: 7.95 }`**（主角左肩偏后方约 `96°` 方向的台阶下平整路面）：开场正面镜头看不见他，玩家向左转头才会注意到他正举着橙壳手机对着校门拍照/打字；
   - `typer` 的朝向设为 `yaw: yawToward(TYPER.position, { x: -0.2, z: 2.8 })`（精准朝向正在上台阶进校门的父女），取消僵硬的 `leanRad: 0.22`（改为 `0.02` 或 `0`）；
   - 同步更新 `HOTSPOTS` 中 `id: 'typer'` 的坐标为 `{ x: -3.6, y: 1.35, z: 7.95 }`，并保留碰撞盒与引导，确保玩家左转头注视他可正常触发热点。
2. **激活多路动态步行同学（走入校园深处尽头、零穿模）+ 驻足 NPC 朝向差异化**：
   - 已有完整 41 骨骼 `'walk'` 动画的模型为 `studentFemale`（女同学2可动）与 `studentMale`（胖男同学可动）；
   - 在 `gate.ts` 配置 **2~3 名步行路人同学**（分走左通道 `x = -2.85` 与右通道 `x = +2.85`，严格避开中央 `x ∈ [-1.2, 1.2]` 父女上台阶路线、避开门柱 `x = ±1.7` 及两侧花坛/静态人群），播放原生 `'walk'` 骨骼动画，从校门外一路走上台阶（每帧同步 `actor.position.y = gateGround(actor.position)` 贴地抬升），穿过校门一直走到门内广场尽头（`z: -20 ~ -24`）停下并切换为 `'idle'` / `'fold_arms'`，全程零穿模；
   - 台阶外侧与广场内驻足的其余围观 NPC 朝向（`yaw`）各自错落（看父女、看横幅、两两侧身微聊），彻底避免机械排排站。

> **M2 验收与存档**：执行 `npm run test && npm run build`，提交 `git commit -m "feat(scenes): 精装 S1 暖调卧室吊灯并优化 S5 校门路人动线与拍照男生站位"`。

---

## 三、里程碑 M3：S7 登记处重建、S8/S9 教学楼 360° 封边与核显性能保障

### 模块 5：S7 迟到登记处志愿者贴近摊位 + 迎新帐篷与校内背景重建（`src/scenes3d/desk.ts`）

1. **志愿者贴近登记桌**：
   - 将 `STANDS.volunteer` 由 `{ x: 0, z: -5.1 }` 前移至 **`{ x: 0, z: -4.68 }`**（紧贴桌后沿 `z = -4.5`），同步更新 `desk-volunteer` 碰撞盒为 `minZ: -5.0, maxZ: -4.35`。
2. **迎新帐篷与登记桌细节精装**：
   - 升级为**迎新折叠遮阳帐篷**：四角深青灰金属立柱与交叉斜撑杆、微坡度双色顶篷与四周垂坠帘眉（深青绿 `#475b58` + 米白边），正面帘眉挂 `createTextSign('新生报到 · 迟到登记', ...)` 横幅；
   - 登记桌铺设垂褶桌布，桌面保留核心热点 `REASON_FORM`（迟到登记表）与签字笔，并增添：**「迟到登记处」立式三角桌牌、插满文具的笔筒、两摞彩色《新生报到指南》、校园卡挂绳盒、志愿者保温杯与文件夹板**；
   - 摊位左侧地板放置一只**开口迎新物资纸箱**，右侧偏后（避开 `MEDICINE_BAG` `{ x: 1.15, y: 0.09, z: -3.15 }` 的药袋与交互视野）竖立一块**迎新易拉宝展架（印有「欢迎新同学」）**。
3. **志愿者身后校内广场大背景（彻底消除灰色虚空）**：
   - 地面铺设 `getPavingMaterial` 石板与嵌缝线，左右两侧建砖石花坛与灌木（接入 `foliageWind.ts` 风场摇曳草花）；
   - 志愿者正后方及左右中远景（`z: -9 .. -34`）搭建对称校园行道树、庭院路灯、公告宣传栏、引导牌，以及 `z = -24 .. -32` 的**三层教学楼背景建筑群（带凹凸窗框、玻璃反光、暖光内透窗、雨棚与连廊围墙封边）**，并在后方广场放 1~2 名走动/驻足的 `studentFemale`/`studentMale` 路人同学。

### 模块 6：S8/S9 教学楼林荫道 360° 建筑连廊与远景山脊封边（`src/scenes3d/building.ts`）

彻底解决 A 栋两侧建筑缺口及树干缝隙露出空旷地平线的问题：
1. **A 栋与左右配楼间「校园风雨连廊 + 景墙绿篱」围合**：
   - 在 A 栋教学楼（`x: -9..9, z: -50`）与左右配楼之间的建筑缺口（`x: -22..-9` 及 `x: 9..22, z: -44..-52`），搭建**校园风雨连廊**（成排米白方柱 + 青灰屋檐顶盖 + 红砖矮墙与铁艺栅栏 + 后方高大修剪绿篱与延伸侧翼配楼），从建筑结构上把教学楼院落连成一体。
2. **树林后方中景生活设施加密**：
   - 在林荫道两侧树干后方开阔草坪区（`x: ±11 .. ±28, z: -8 .. -54`），增设**第二排错落高矮乔木灌木、校园自行车棚、公告亭与远景操场球场灯杆/篮球架剪影**，无论透过哪处树干缝隙观望都有饱满层次。
3. **360° 远景吉卜力层叠山脊与林带天际线环**：
   - 沿校园外围（半径 `55m~78m`，环绕 `z: -78..+30, x: -65..+65`）用单个轻量 `InstancedMesh` 搭建一圈**高低起伏的低饱和远景层叠山峦与远林冠剪影（青灰蓝/远山黛绿渐变，柔和融入场景雾色）**，完全封住地面与天空的生硬接缝。

### 模块 7：核显/移动端 60fps 阴影与面数优化（解决 `S5Desktop` 核显掉帧）

- 针对 `AMD Radeon(TM) 610M` 核显上 9 个高面数角色同时投射实时阴影（`651K` 三角形、`33.4 FPS`）的瓶颈：
  - 在 `src/scenes3d/shared.ts` 的 `createCharacterActor` 增加 `castShadow?: boolean` 选项（或按模型角色区分）：**仅核心叙事主角（`linxia`、`father`、`fatherCarry`）保留平行光 `castShadow = true`**；围观群众与路人同学（`ayuan`、`studentFemale`、`studentMale`、`volunteer`）的骨骼网格设为 `castShadow = false`（全员仍完整保留 `attachContactShadows()` 脚底柔和接触阴影圆盘与 `receiveShadow = true`）；
  - 将 `gate-meadow-wind-grass` 单场景实例数精简优化至 `2800~3200` 簇（适度微增单簇宽度以保持同等草海丰满度），使总渲染三角形大幅下降，核显与手机均可稳步跑出流畅高帧率。

> **M3 验收与存档**：运行 `npm run test && npm run build && node tools/verifyCampusArt.mjs`，确认核显帧率检查全绿通过，提交 `git commit -m "feat(scenes): 重建 S7 登记处、封边 S8 教学楼 360° 天际线并优化核显阴影性能"`。

---

## 四、里程碑 M4（阶段 3 点睛大招）：S8《水彩林》同款「陪伴脚步漫染」+ 动态朝霞破晓

### 模块 8：零后处理开销的 GPU 着色器叙事高潮（`src/scenes3d/colorBloom.ts` + `src/scenes3d/building.ts` + `src/world/WorldApp.ts`）

借鉴 Three.js《水彩林》脚下色彩漫染与《吉卜力晚霞》动态天空渐变，与《一条截图》「陪伴驱散网暴阴霾」的公益主题深度结合（**纯 Shader Uniform 驱动，严禁新增后处理 Pass，桌面与手机均满帧运行**）：

1. **「脚步色彩漫染」着色器模块（新增 `src/scenes3d/colorBloom.ts` 及纯函数单测 `colorBloom.test.ts`）**：
   - 导出可复用的材质增强函数 `applyColorBloomShader(material, sharedUniforms)`（通过 `material.onBeforeCompile` 注入世界坐标 `vBloomWorldPos`，并与 `foliageWind.ts` 的 `onBeforeCompile` 兼容不互相覆盖 `customProgramCacheKey`）；
   - 共享 Uniform：
     - `uPlayerPos: THREE.Vector3`（主角当前脚底坐标）
     - `uCompanionPos: THREE.Vector3`（林夏当前坐标）
     - `uRevealedZ: number`（随林夏与主角前行单调递减的已走过 Z 轴边界，记录走过即永不褪色的色彩轨迹）
     - `uBloomTime: number`（微弱水彩边缘流动时间）
   - 片元着色逻辑（极轻量，仅 ~10 行 GLSL）：
     - 计算当前片元到主角与林夏的最近水平距离 `d = min(length(vBloomWorldPos.xz - uPlayerPos.xz), length(vBloomWorldPos.xz - uCompanionPos.xz))`，叠加轻微有机水彩边界扰动（2D 噪声/正弦波），并结合已走过区域 `vBloomWorldPos.z >= uRevealedZ` 计算漫染权重 `reveal ∈ [0, 1]`；
     - **`reveal = 0`（未走过的前方景物）**：转为克制的冷灰低饱和水彩纸/铅笔素描感（降低饱和度 `saturation ~0.22`，略偏冷雾蓝灰），象征网暴传言笼罩下的沉重压抑；
     - **`reveal = 1`（脚下走近与已走过的林荫道、草坪、野花、灌木与树冠）**：以柔和的水彩晕染边缘过渡为**温暖明亮的吉卜力高饱和色彩**（略微提暖提亮），仿佛善意陪伴所经之处，校园一寸寸重焕生机！
   - 在 `building.ts` 的铺装、草地、花坛砖石、摇曳草花与树冠材质上启用该着色器，在 `buildingRuntime.tick()` 中实时更新 `uPlayerPos`、`uCompanionPos` 与 `uRevealedZ`（注意：仅在 S8/S9 林荫道生效，不污染人物皮肤与 A 栋清晰标识文字）。

2. **天空与晨光随同行进度破晓渐变（`src/world/WorldApp.ts`）**：
   - 在 `WorldApp` 中为天空球（`uZenith / uMid / uHorizon`）与主平行光提供可选的场景运行时动态氛围插值钩子（或通过事件/方法更新 `atmosphereProgress ∈ [0, 1]`）；
   - 在 **S8 行走期间**：进度 `0.0`（刚离开校门）保持清晨微凉青灰蓝雾色；随着玩家陪林夏走过林荫道中段直至接近 A 栋门口（`0.0 -> 1.0`），天空地平线与云层高光平滑渐变为温暖治愈的**吉卜力金粉朝霞 / 暖橘晨曦**，平行光颜色同步略微转暖；
   - 同步让林荫道空气粒子（`airParticles`）在 S8 后半段呈现出轻盈飘落的**暖金光尘与淡粉花瓣/嫩叶微粒**；
   - **安全复位**：切换离开 `building` 场景或重新开始时，天空球 Uniform 与灯光颜色 100% 恢复默认场景配置，绝不串台污染其他场景。

> **M4 验收与最终全量质检**：
> 1. 执行 `npm run test` 与 `npm run build` 全绿通过；
> 2. 执行 `node tools/verifyMovement.mjs`、`node tools/verifyCampusArt.mjs` 以及覆盖本次全部新模块的 Playwright 截图验收脚本（输出到 `tools/shots/polish-report.json` 及截图）：
>    - 双端《操作指南》弹窗截图与主角行动独白字幕截图；
>    - S1 卧室暖橘墙、常亮暖光吊灯、百叶窗光斑、双层书架、双屏书桌、废纸篓截图；
>    - S5 校门左转头可见左后方拍照男生正对父女 + 路人沿台阶走入校内截图；
>    - S7 登记处志愿者紧贴桌后 + 迎新帐篷细节 + 校内背景截图；
>    - S8 起点冷灰未漫染 vs 中后段「脚下彩色漫染 + 金粉朝霞」对比截图 + A 栋连廊与 360° 远山封边截图；
> 3. 提交最终快照：`git commit -m "feat(s8): 植入脚步水彩漫染着色器与动态朝霞破晓演出并完成全量视觉验收"`；
> 4. 在对话末尾输出一份简明清晰的《晨间验收报告》（列明每个模块的改动文件、测试通过数、核显/移动端帧率数据及关键截图路径）。
