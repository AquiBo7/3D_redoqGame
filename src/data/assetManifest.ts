import readyExternalAssets from './readyExternalAssets.json';

// 遵循 AGENTS 的 data 纯数据边界：这里不生成 SVG、不操作 DOM、不探测网络。
// 路径、尺寸、无障碍描述是唯一美术契约；渲染实现见 src/ui/assetImage.ts。
export const ASSET_MANIFEST = {
  portrait_linxia_casual: {
    path: './art/portraits/linxia_casual.png', width: 600, height: 800,
    alt: '林夏穿着浅黄色外套，微微低头，双手抱住速写本，深色短发垂在脸侧。',
  },
  portrait_linxia_smile: {
    path: './art/portraits/linxia_smile.png', width: 600, height: 800,
    alt: '暖光中，浅黄外套的林夏轻轻扬起嘴角，将一张画着并肩背影的画递向你。',
  },
  portrait_father: {
    path: './art/portraits/father.png', width: 600, height: 800,
    alt: '沉默的父亲穿着旧灰绿衬衫，袖口挽起，手里提着两只鼓鼓的布袋。',
  },
  portrait_xiaochen: {
    path: './art/portraits/xiaochen.png', width: 600, height: 800,
    alt: '室友小陈穿宽松蓝色卫衣，肩挎帆布包，侧身将手机递过来。',
  },
  portrait_ayuan: {
    path: './art/portraits/ayuan.png', width: 600, height: 800,
    alt: '别班男生阿远穿深蓝外套，低头握着橙色手机壳的手机，肩膀略微收紧。',
  },
  portrait_teacher: {
    path: './art/portraits/teacher.png', width: 600, height: 800,
    alt: '周老师将头发束起，穿米白衬衣与灰绿外套，臂弯夹着文件夹，神情温和。',
  },
  portrait_volunteer: {
    path: './art/portraits/volunteer.png', width: 600, height: 800,
    alt: '迎新学姐戴着工作证和砖红袖标，拿着报到夹板，抬手为新生指路。',
  },
  portrait_protagonist: {
    path: './art/portraits/protagonist.png', width: 600, height: 800,
    alt: '穿灰蓝外套的少年背向镜头，单肩背着帆布包，手里拿着一支笔。',
  },
  cg_s6_gate_panorama: {
    path: './art/cg/s6_gate_panorama.png', width: 1200, height: 896,
    alt: '清晨校门前的新生合照：人群、行李和树影之间，台阶右侧有父亲背着浅黄外套女生的背影，手里提着两只袋子。',
  },
  cg_s11_post_crop: {
    path: './art/cg/s11_post_crop.png', width: 417, height: 417,
    alt: '同一张校门全景的台阶局部被放大：父亲背着浅黄外套女生走上石阶，旁边是两只布袋和栏杆。',
  },
  cg_s13_walk_together: {
    path: './art/cg/s13_walk_together.png', width: 1200, height: 896,
    alt: '斑驳树影落在林荫道上，浅黄外套的林夏独立行走，与灰蓝外套的少年并肩走向教学楼，两人都只露背影。',
  },
  cg_ending_best_drawing: {
    path: './art/cg/ending_best_drawing.png', width: 1600, height: 900,
    alt: '完整的铅笔淡彩画：晨光台阶上两个背影并肩，远处校门外父亲提袋守望，纸张角落留着一点橙色。',
  },
  cg_ending_middle_sketch: {
    path: './art/cg/ending_middle_sketch.png', width: 1600, height: 900,
    alt: '夕阳照在空课桌的速写本上，左半页只有未完成的空台阶铅笔线稿，右半页留白；纸角有擦痕，旁边放着铅笔和橡皮。',
  },
  cg_ending_bystander_seat: {
    path: './art/cg/ending_bystander_seat.png', width: 1600, height: 900,
    alt: '教室最后一排的空桌椅落在夕阳里，窗边的光穿过椅背，旁边挂钩上不再有书包。',
  },
  prop_pharmacy_receipt: {
    path: './art/props/pharmacy_receipt.png', width: 600, height: 800,
    alt: '略有卷边的热敏纸小票，清楚印着早晨 07:52 和跌打消肿药贴，纸旁是无品牌药贴包装。',
  },
  prop_late_form: {
    path: './art/props/late_form.png', width: 800, height: 600,
    alt: '迟到登记表的姓名栏写着林夏，原因栏的脚崴了被两道笔划划掉，旁边改写为路上耽搁了，纸边压着一支笔。',
  },
  bg_dorm_morning: {
    path: './art/bg/dorm_morning.png', width: 1600, height: 900,
    alt: '清晨宿舍里，窗光照亮上下铺的蓝色床帘、书桌上的水杯与翻开的书，帆布包靠在椅边。',
  },
  bg_office_afternoon: {
    path: './art/bg/office_afternoon.png', width: 1600, height: 900,
    alt: '午后办公室的百叶窗投下斜光，桌上摆着文件夹和两只茶杯，访客椅安静地朝向老师的位置。',
  },
  bg_stairwell_echo: {
    path: './art/bg/stairwell_echo.png', width: 1600, height: 900,
    alt: '安静的教学楼楼梯间，水磨石台阶折向高窗，灰绿扶手映着冷光，窗台上放着一盆绿植。',
  },
  bg_platform_sunset: {
    path: './art/bg/platform_sunset.png', width: 1600, height: 900,
    alt: '侧楼梯平台被夕阳染成赭金色，细长的栏杆影跨过地砖，远处树梢与长椅在逆光中沉静。',
  },
  trophy_gold: {
    path: './art/trophies/trophy_gold.png', width: 128, height: 128,
    alt: '简洁的哑金双耳奖杯，杯腹刻着一枝细叶，暖白高光落在细窄杯沿与石色底座上。',
  },
  trophy_silver: {
    path: './art/trophies/trophy_silver.png', width: 128, height: 128,
    alt: '简洁的银灰双耳奖杯，杯腹刻着一枝细叶，冷白高光落在细窄杯沿与蓝灰底座上。',
  },
} as const;

export type AssetId = keyof typeof ASSET_MANIFEST;
export const READY_EXTERNAL_ASSETS: Partial<Record<AssetId, string>> = readyExternalAssets;

// 全景画布中左上角 x/y 与宽高，单位均为百分比（0–100），不是 0–1。
// 交互层须相对实际图片内容区定位；object-fit: contain 的留白不属于图片。
export const PHOTO_HOTSPOT = { x: 69, y: 37, width: 16, height: 38 } as const;
// S11 直接更换同一全景 SVG 的 viewBox，不另画一组背影。
export const PHOTO_CROP = { x: 1032, y: 295, width: 400, height: 400 } as const;
