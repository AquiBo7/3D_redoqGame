// scenes3d/propManifest.ts —— 第三方道具清单：相对路径、实测高度、色温覆盖与许可留痕
// 纯数据配置，不含业务逻辑；路径必须以 ./models/ 开头（vite base './'，禁止写死根路径）。
// heightM 是 docs/props-evidence/three-r187-check.txt 用游戏同款 three r187 实测的成品高度，
// 运行时由 resources.normalizeModelToHeight 精确贴地并等比归一到该值，禁止改动（挂载摆放点以它为准）。
// tint 是美术统一色温覆盖：道具底图与 material.color 相乘，用中性暖色压掉 Poly Haven 的写实旧化，
// 木器 0xb9a07f / 金属 0x8f949b / 纸张书本 0xd8cbb4，与场景程序化家具同色域。

export type PropModelId =
  | 'streetLamp'
  | 'schoolDesk'
  | 'schoolChair'
  | 'bench'
  | 'trashcan'
  | 'stationery'
  | 'bed'
  | 'suitcase'
  | 'canteenSet'
  | 'canteenColumn'
  | 'canteenTrayRack'
  | 'canteenWindowBay'
  | 'canteenVending'
  | 'canteenClock'
  | 'schoolDeskUnit'
  | 'schoolChairUnit'
  | 'schoolLowLocker'
  | 'schoolTallLocker'
  | 'schoolBackpack'
  | 'schoolBulletin'
  | 'schoolPodium'
  | 'schoolSpeaker'
  | 'schoolOfficeDesk'
  | 'schoolFileCabinet'
  | 'schoolTreeA'
  | 'schoolTreeB'
  | 'schoolTreeC';

/** 色温覆盖三档：木器 / 金属 / 纸张书本 */
export const PROP_TINT_WOOD = 0xb9a07f;
export const PROP_TINT_METAL = 0x8f949b;
export const PROP_TINT_PAPER = 0xd8cbb4;
/** 中性白：本地套件已把成品色烘进 COLOR_0 顶点色，tint 不得再二次偏色 */
export const PROP_TINT_NEUTRAL = 0xffffff;

export interface PropModelEntry {
  id: PropModelId;
  /** 显示名（道具预览台 / 调试面板用） */
  name: string;
  /** 相对模型路径，部署到任意子路径均可加载 */
  path: string;
  /** 实测成品高度（米），底面已贴 y = 0 */
  heightM: number;
  /** 是否投射阴影：小件（文具）只接收阴影，省一次阴影 pass */
  castShadow: boolean;
  /** 材质色温覆盖色（与底图相乘） */
  tint: number;
  license: string;
  author: string;
  /** Poly Haven 原始资产页，评委可核查 */
  source: string;
}

export const PROP_MODELS: readonly PropModelEntry[] = [
  {
    id: 'streetLamp',
    name: '复古铸铁路灯',
    path: './models/props/prop_street_lamp.glb',
    heightM: 4.203,
    castShadow: true,
    tint: PROP_TINT_METAL,
    license: 'CC0 1.0',
    author: 'Poly Haven',
    source: 'https://polyhaven.com/a/street_lamp_01',
  },
  {
    id: 'schoolDesk',
    name: '木质课桌',
    path: './models/props/prop_school_desk.glb',
    heightM: 0.75,
    castShadow: true,
    tint: PROP_TINT_WOOD,
    license: 'CC0 1.0',
    author: 'Poly Haven',
    source: 'https://polyhaven.com/a/schooldesk_01',
  },
  {
    id: 'schoolChair',
    name: '铁艺课椅',
    path: './models/props/prop_school_chair.glb',
    heightM: 0.851,
    castShadow: true,
    tint: PROP_TINT_METAL,
    license: 'CC0 1.0',
    author: 'Poly Haven',
    source: 'https://polyhaven.com/a/schoolchair_01',
  },
  {
    id: 'bench',
    name: '木条长椅',
    path: './models/props/prop_bench.glb',
    heightM: 0.8,
    castShadow: true,
    tint: PROP_TINT_WOOD,
    license: 'CC0 1.0',
    author: 'Poly Haven',
    source: 'https://polyhaven.com/a/painted_wooden_bench',
  },
  {
    id: 'trashcan',
    name: '金属垃圾桶（两只一组）',
    path: './models/props/prop_trashcan.glb',
    heightM: 0.851,
    castShadow: true,
    tint: PROP_TINT_METAL,
    license: 'CC0 1.0',
    author: 'Poly Haven',
    source: 'https://polyhaven.com/a/metal_trash_can',
  },
  {
    id: 'stationery',
    name: '桌面文具书本',
    path: './models/props/prop_stationery.glb',
    heightM: 0.18,
    castShadow: false,
    tint: PROP_TINT_PAPER,
    license: 'CC0 1.0',
    author: 'Poly Haven',
    source: 'https://polyhaven.com/a/stationery_supplies',
  },
  {
    id: 'bed',
    name: '旧铁艺单人床',
    path: './models/props/prop_bed.glb',
    heightM: 0.902,
    castShadow: true,
    tint: PROP_TINT_METAL,
    license: 'CC0 1.0',
    author: 'Poly Haven',
    source: 'https://polyhaven.com/a/old_bed_frame',
  },
  {
    id: 'suitcase',
    name: '复古行李箱（两只一组）',
    path: './models/props/prop_suitcase.glb',
    heightM: 0.654,
    castShadow: true,
    tint: PROP_TINT_WOOD,
    license: 'CC0 1.0',
    author: 'Poly Haven',
    source: 'https://polyhaven.com/a/vintage_suitcase',
  },
  {
    id: 'canteenSet',
    name: '连体四人桌椅套装',
    path: './models/props/prop_canteen_set.glb',
    // 整包最高点是椅背 0.956m，桌面因此落在 0.783m，与 canteen.ts 的 TABLE_TOP_PROP 对齐
    heightM: 0.956,
    // 食堂全场景零投影者（见 canteen.test.ts 的逐节点断言），套装因此只接收阴影
    castShadow: false,
    // 套装顶点色只烘了 AO 未烘分件固有色，用木器档 tint 统一染成浅木色
    tint: PROP_TINT_WOOD,
    license: 'CC0 1.0',
    author: 'Local Blender Kit',
    // 本地脚本 tools/blender_canteen_kit.py 程序化建模，成品色与 AO 烘进顶点色
    source: 'local://tools/blender_canteen_kit.py',
  },
  {
    id: 'canteenColumn',
    name: '竖条纹凹槽大柱',
    path: './models/props/prop_canteen_column.glb',
    heightM: 4.5,
    castShadow: false,
    tint: PROP_TINT_NEUTRAL,
    license: 'CC0 1.0',
    author: 'Local Blender Kit',
    source: 'local://tools/blender_canteen_kit.py',
  },
  {
    id: 'canteenTrayRack',
    name: '不锈钢多层餐盘回收架',
    path: './models/props/prop_canteen_tray_rack.glb',
    heightM: 1.2,
    castShadow: false,
    tint: PROP_TINT_NEUTRAL,
    license: 'CC0 1.0',
    author: 'Local Blender Kit',
    source: 'local://tools/blender_canteen_kit.py',
  },
  {
    id: 'canteenWindowBay',
    name: '落地高窗框带暖气片',
    path: './models/props/prop_canteen_window_bay.glb',
    heightM: 4.08,
    castShadow: false,
    tint: PROP_TINT_NEUTRAL,
    license: 'CC0 1.0',
    author: 'Local Blender Kit',
    source: 'local://tools/blender_canteen_kit.py',
  },
  {
    id: 'canteenVending',
    name: '无品牌发光售货机',
    path: './models/props/prop_canteen_vending.glb',
    heightM: 1.95,
    castShadow: false,
    tint: PROP_TINT_NEUTRAL,
    license: 'CC0 1.0',
    author: 'Local Blender Kit',
    source: 'local://tools/blender_canteen_kit.py',
  },
  {
    id: 'canteenClock',
    name: '端墙圆形挂钟',
    path: './models/props/prop_canteen_clock.glb',
    heightM: 0.62,
    castShadow: false,
    tint: PROP_TINT_NEUTRAL,
    license: 'CC0 1.0',
    author: 'Local Blender Kit',
    source: 'local://tools/blender_canteen_kit.py',
  },
  {
    id: 'schoolDeskUnit',
    name: '倒角暖木弯管课桌',
    path: './models/props/prop_school_desk_unit.glb',
    heightM: 0.75,
    castShadow: false,
    tint: PROP_TINT_NEUTRAL,
    license: 'CC0 1.0',
    author: 'Local Blender Kit',
    source: 'local://tools/blender_school_kit.py',
  },
  {
    id: 'schoolChairUnit',
    name: '微弧胶合板弯管课椅',
    path: './models/props/prop_school_chair_unit.glb',
    heightM: 0.84,
    castShadow: false,
    tint: PROP_TINT_NEUTRAL,
    license: 'CC0 1.0',
    author: 'Local Blender Kit',
    source: 'local://tools/blender_school_kit.py',
  },
  {
    id: 'schoolLowLocker',
    name: '走廊八门百叶储物矮柜',
    path: './models/props/prop_school_low_locker.glb',
    heightM: 0.9,
    castShadow: false,
    tint: PROP_TINT_NEUTRAL,
    license: 'CC0 1.0',
    author: 'Local Blender Kit',
    source: 'local://tools/blender_school_kit.py',
  },
  {
    id: 'schoolTallLocker',
    name: '双门铁皮百叶储物高柜',
    path: './models/props/prop_school_tall_locker.glb',
    heightM: 1.92,
    castShadow: false,
    tint: PROP_TINT_NEUTRAL,
    license: 'CC0 1.0',
    author: 'Local Blender Kit',
    source: 'local://tools/blender_school_kit.py',
  },
  {
    id: 'schoolBackpack',
    name: '学生通勤双肩书包',
    path: './models/props/prop_school_backpack.glb',
    heightM: 0.337,
    castShadow: false,
    tint: PROP_TINT_NEUTRAL,
    license: 'CC0 1.0',
    author: 'Local Blender Kit',
    source: 'local://tools/blender_school_kit.py',
  },
  {
    id: 'schoolBulletin',
    name: '木框绿绒课程表公告栏',
    path: './models/props/prop_school_bulletin.glb',
    heightM: 1.04,
    castShadow: false,
    tint: PROP_TINT_NEUTRAL,
    license: 'CC0 1.0',
    author: 'Local Blender Kit',
    source: 'local://tools/blender_school_kit.py',
  },
  {
    id: 'schoolPodium',
    name: '挡书围边斜顶立式讲桌',
    path: './models/props/prop_school_podium.glb',
    heightM: 1.06,
    castShadow: false,
    tint: PROP_TINT_NEUTRAL,
    license: 'CC0 1.0',
    author: 'Local Blender Kit',
    source: 'local://tools/blender_school_kit.py',
  },
  {
    id: 'schoolSpeaker',
    name: '壁挂圆网罩广播音箱',
    path: './models/props/prop_school_speaker.glb',
    heightM: 0.323,
    castShadow: false,
    tint: PROP_TINT_NEUTRAL,
    license: 'CC0 1.0',
    author: 'Local Blender Kit',
    source: 'local://tools/blender_school_kit.py',
  },
  {
    id: 'schoolOfficeDesk',
    name: '胡桃木辅导员办公桌组合',
    path: './models/props/prop_school_office_desk.glb',
    heightM: 1.151,
    castShadow: false,
    tint: PROP_TINT_NEUTRAL,
    license: 'CC0 1.0',
    author: 'Local Blender Kit',
    source: 'local://tools/blender_school_kit.py',
  },
  {
    id: 'schoolFileCabinet',
    name: '上玻下铁双节档案文件柜',
    path: './models/props/prop_school_file_cabinet.glb',
    heightM: 1.94,
    castShadow: false,
    tint: PROP_TINT_NEUTRAL,
    license: 'CC0 1.0',
    author: 'Local Blender Kit',
    source: 'local://tools/blender_school_kit.py',
  },
  {
    id: 'schoolTreeA',
    name: '庭院伞状阔冠香樟树',
    path: './models/props/prop_school_tree_a.glb',
    heightM: 4.472,
    castShadow: false,
    tint: PROP_TINT_NEUTRAL,
    license: 'CC0 1.0',
    author: 'Local Blender Kit',
    source: 'local://tools/blender_school_kit.py',
  },
  {
    id: 'schoolTreeB',
    name: '庭院偏侧自然香樟树',
    path: './models/props/prop_school_tree_b.glb',
    heightM: 4.644,
    castShadow: false,
    tint: PROP_TINT_NEUTRAL,
    license: 'CC0 1.0',
    author: 'Local Blender Kit',
    source: 'local://tools/blender_school_kit.py',
  },
  {
    id: 'schoolTreeC',
    name: '庭院高窄疏朗香樟树',
    path: './models/props/prop_school_tree_c.glb',
    heightM: 4.951,
    castShadow: false,
    tint: PROP_TINT_NEUTRAL,
    license: 'CC0 1.0',
    author: 'Local Blender Kit',
    source: 'local://tools/blender_school_kit.py',
  },
];

export function getPropModel(id: PropModelId): PropModelEntry {
  const entry = PROP_MODELS.find((item) => item.id === id);
  if (!entry) throw new Error(`未知道具模型：${id}`);
  return entry;
}
