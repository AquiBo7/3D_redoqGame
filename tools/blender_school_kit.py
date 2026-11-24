# -*- coding: utf-8 -*-
"""tools/blender_school_kit.py —— 教学楼高精度模块化低模套件 + 三款香樟树程序化生产与顶点 AO 烘焙。

严格依据《一条截图_教学楼审查与Blender执行提示词》第 2～4 节规范建模：
  1. prop_school_desk_unit.glb     双人尺度倒角暖木课桌 + 朝后开口薄板书斗 + 弯管 H 撑钢腿 + 黑脚套（0.75m）
  2. prop_school_chair_unit.glb    横向微弧胶合板座面/靠背 + 双螺钉背板片 + 后倾连续弯管课椅（0.84m）
  3. prop_school_low_locker.glb    2×4 格灰暖白柜体 + 陶土门片点缀 + 门缝/双百叶/标签槽/暗锁扣矮柜（0.90m）
  4. prop_school_tall_locker.glb   双门灰蓝金属高柜 + 上下百叶格栅 + 姓名卡槽 + 嵌入式锁把（1.92m）
  5. prop_school_backpack.glb      圆角深蓝学生双肩包 + 前拉链袋 + 提手环 + 双肩背带 + 侧水壶袋（0.34m）
  6. prop_school_bulletin.glb      45°斜拼暖木边框 + 内凹墨绿绒板 + 课表/海报/折角纸/图钉公告栏（1.04m）
  7. prop_school_podium.glb        45mm 挡书围边 + 斜顶木纹与浅灰立式讲桌 + 粉笔盒与板擦（1.08m）
  8. prop_school_speaker.glb       前倾梯形深木色校园广播音箱 + 背挂支架 + 铝圈深色圆网罩（0.32m）
  9. prop_school_office_desk.glb   胡桃木倒角教师办公桌 + 三抽柜拉手 + 窄边显示器 + 教案夹 + 暖铜台灯（1.14m）
  10. prop_school_file_cabinet.glb 上玻（内嵌彩色档案盒脊）下铁双开门文件柜 + 分缝拉手与底座（1.94m）
  11. prop_school_tree_a.glb       A 型伞状阔叶香樟（8 边微弯主干 + 4 分叉承重枝穿冠 + 透天叶团，4.45m）
  12. prop_school_tree_b.glb       B 型偏侧自然香樟（偏轴主干 + 4 不对称外探枝 + 错落叶团，4.68m）
  13. prop_school_tree_c.glb       C 型高窄疏朗香樟（修长主干 + 5 层级斜伸枝 + 分层透空叶团，4.90m）

约定：
  · 每件成品「单网格 + 单材质 + 底面贴 z=0」，正面统一朝向 Blender -Y（导出 glTF +Y up 后朝 Three.js +Z）。
  · 颜色严格使用审查稿第 3 节 sRGB 色板（转换为 Blender 线性空间写入节点），射线采样 AO 写入 COLOR_0。
"""

import argparse
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(REPO, "public", "models", "props")


def log(msg):
    text = str(msg)
    try:
        print(text, flush=True)
    except UnicodeEncodeError:
        print(text.encode("ascii", "replace").decode("ascii"), flush=True)


def srgb_to_linear(c):
    if c <= 0.04045:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4


def hex_lin(hex_value):
    r = ((hex_value >> 16) & 0xFF) / 255.0
    g = ((hex_value >> 8) & 0xFF) / 255.0
    b = (hex_value & 0xFF) / 255.0
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b))


def call_op(op_path, **kwargs):
    group, name = op_path.split(".")
    op = getattr(getattr(bpy.ops, group), name)
    known = {prop.identifier for prop in op.get_rna_type().properties}
    for key in [k for k in list(kwargs.keys()) if k not in known]:
        kwargs.pop(key)
    return op(**kwargs)


def tri_count(mesh):
    mesh.calc_loop_triangles()
    return len(mesh.loop_triangles)


def bounds(obj):
    bpy.context.view_layer.update()
    mat_w = obj.matrix_world
    low = [1e18, 1e18, 1e18]
    high = [-1e18, -1e18, -1e18]
    for v in obj.data.vertices:
        p = mat_w @ v.co
        for i in range(3):
            low[i] = min(low[i], p[i])
            high[i] = max(high[i], p[i])
    return tuple(low), tuple(high)


PARTS = []
MATERIALS = {}


def mat(hex_color, name="m", roughness=0.65, metallic=0.0):
    rgb = hex_lin(hex_color) if isinstance(hex_color, int) else hex_color
    key = (tuple(round(c, 4) for c in rgb), round(roughness, 2), round(metallic, 2))
    if key in MATERIALS:
        return MATERIALS[key]
    m = bpy.data.materials.new(f"{name}_{len(MATERIALS)}")
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    bsdf = next((n for n in m.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled"), None)
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
        if bsdf.inputs.get("Roughness"):
            bsdf.inputs["Roughness"].default_value = roughness
        if bsdf.inputs.get("Metallic"):
            bsdf.inputs["Metallic"].default_value = metallic
    MATERIALS[key] = m
    return m


def _new_mesh_obj(bm, material, name="part"):
    mesh = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(material)
    PARTS.append(obj)
    return obj


def add_box(material, loc, dim, rot=None, bevel=0.0, bevel_segs=1):
    """创建中心在 loc、尺寸为 dim=(dx,dy,dz) 的盒体，可选真实几何倒角。"""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(dim), verts=bm.verts)
    if bevel > 0.0:
        bmesh.ops.bevel(
            bm,
            geom=list(bm.edges),
            offset=bevel,
            segments=bevel_segs,
            profile=0.5,
            affect="EDGES",
        )
    if rot:
        bmesh.ops.rotate(bm, cent=Vector((0, 0, 0)), matrix=Euler(rot, "XYZ").to_matrix(), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    return _new_mesh_obj(bm, material, "box")


def add_cyl(material, loc, radius, length, segs=8, rot=None, r_top=None):
    """创建圆柱/圆台，默认轴向 Z。"""
    bm = bmesh.new()
    rt = radius if r_top is None else r_top
    bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=True,
        segments=segs,
        radius1=radius,
        radius2=rt,
        depth=length,
    )
    if rot:
        bmesh.ops.rotate(bm, cent=Vector((0, 0, 0)), matrix=Euler(rot, "XYZ").to_matrix(), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    return _new_mesh_obj(bm, material, "cyl")


def add_limb(material, p0, p1, r0, r1, segs=7):
    """两点之间连一段锥形圆管/树枝，自动对齐方向。"""
    v0 = Vector(p0)
    v1 = Vector(p1)
    diff = v1 - v0
    length = diff.length
    if length < 1e-4:
        return None
    mid = (v0 + v1) * 0.5
    quat = Vector((0, 0, 1)).rotation_difference(diff.normalized())
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=True,
        segments=segs,
        radius1=r0,
        radius2=r1,
        depth=length,
    )
    bmesh.ops.rotate(bm, cent=Vector((0, 0, 0)), matrix=quat.to_matrix(), verts=bm.verts)
    bmesh.ops.translate(bm, vec=mid, verts=bm.verts)
    return _new_mesh_obj(bm, material, "limb")


def add_foliage_lobe(material, loc, scale_xyz, seed=0, subdivisions=1):
    """创建自然不规则低多边形叶团（IcoSphere 细分 + 确定性柔和扰动，消除生硬正球感）。"""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=1.0)
    rng = random.Random(seed)
    for v in bm.verts:
        n = v.co.normalized()
        jitter = 1.0 + 0.14 * math.sin(n.x * 4.1 + seed) * math.cos(n.y * 3.7 - seed * 0.6) + rng.uniform(-0.06, 0.06)
        # 底面略微收平（树冠受重力自然微垂）
        flat_bottom = 0.84 if n.z < -0.25 else 1.0
        v.co = Vector((
            v.co.x * scale_xyz[0] * jitter,
            v.co.y * scale_xyz[1] * jitter,
            v.co.z * scale_xyz[2] * jitter * flat_bottom,
        ))
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    return _new_mesh_obj(bm, material, "lobe")


# ==================== 审查稿第 3 节标准色板 ====================
C_DESK_WOOD = 0xAD8E68       # 暖木桌面/椅面
C_DESK_EDGE = 0x8F7250       # 木边带微深
C_STEEL_FRAME = 0x465A68     # 灰蓝喷涂钢管腿/书斗
C_STEEL_CUBBY = 0x3D4F5C     # 书斗内壁深灰蓝
C_FOOT_BLACK = 0x222629      # 近黑哑光防滑脚套
C_RIVET = 0x8C959C           # 螺钉/金属连接件

C_LOCKER_BODY = 0xCBC4B6     # 灰暖白柜体（降饱和克制调）
C_LOCKER_DOOR_A = 0xC8BFAEE  # 修正为标准 6 位 hex -> 见下
C_DOOR_CREAM = 0xC9C2B4      # 主柜门暖灰米
C_DOOR_TERRA = 0xB57D64      # 陶土点缀门片（审查第3节 #A97862~#B57D64）
C_LOCKER_SEAM = 0x2D3236     # 门缝与锁扣深色
C_LABEL_WHITE = 0xECE8DE     # 标签卡纸

C_TALL_LOCKER = 0x5C7585     # 灰蓝铁皮储物高柜
C_BAG_NAVY = 0x2B4363        # 学生书包深藏青
C_BAG_POCKET = 0x223650      # 前袋压深
C_BAG_STRAP = 0x38424D       # 肩带织带灰黑
C_BAG_TRIM = 0xA8B2BC        # 拉链/滚边

C_WOOD_FRAME = 0x624B38      # 门窗/公告栏暖深木框
C_BOARD_GREEN = 0x285847     # 墨绿绒布公告板面
C_PAPER_CREAM = 0xEFEAD8     # 课表暖白纸
C_PAPER_BLUE = 0xD7E2E8      # 通知浅蓝灰纸
C_PAPER_PEACH = 0xE8D6C8     # 社团海报暖杏纸
C_PIN_RED = 0xB84A3C         # 图钉红
C_PIN_GOLD = 0xC99E48        # 图钉铜黄

C_PODIUM_BODY = 0xD2CEC4     # 讲桌暖灰白面板
C_PODIUM_WOOD = 0x6E543E     # 讲桌胡桃木护边/台沿
C_SPEAKER_BOX = 0x3F3834     # 广播音箱深棕灰箱体
C_SPEAKER_MESH = 0x1D2124    # 广播音箱金属圆网罩

C_WALNUT = 0x6B4E37          # 辅导员办公桌胡桃木
C_CABINET_GREY = 0x7A868E    # 铁皮档案柜灰蓝
C_GLASS_BACK = 0x4E6473      # 玻璃柜内背板冷灰蓝
C_LAMP_BRASS = 0xB5944B      # 办公桌黄铜台灯
C_LAMP_SHADE = 0xEBD9B4      # 暖白灯罩

C_BARK = 0x54493E            # 香樟树皮灰褐
C_LEAF_DARK = 0x445D46       # 冠内深绿（第3节色板）
C_LEAF_MID = 0x647A50        # 冠中香樟绿
C_LEAF_LIGHT = 0x81915D      # 受光叶缘黄绿


# ==================== 1. 双人尺度弧角课桌（正面学生侧朝 -Y = Three +Z） ====================
def build_desk_unit():
    wood = mat(C_DESK_WOOD, "desk_wood", 0.54)
    edge = mat(C_DESK_EDGE, "desk_edge", 0.58)
    steel = mat(C_STEEL_FRAME, "desk_steel", 0.50, 0.25)
    cubby_in = mat(C_STEEL_CUBBY, "cubby_in", 0.65, 0.15)
    foot = mat(C_FOOT_BLACK, "foot", 0.85)

    # 桌面 1.36 x 0.62 x 0.028，顶高 0.750，带 5mm 圆润倒角
    add_box(wood, (0, 0, 0.736), (1.36, 0.62, 0.028), bevel=0.005, bevel_segs=2)
    add_box(edge, (0, 0, 0.720), (1.32, 0.58, 0.006))

    # 真实掏空薄板书斗（开口朝学生侧 -Y，留出充足腿部净空 0.59m！）
    # 底板 z=0.605、前挡板 y=+0.22、左右侧板 x=±0.57（绝不封死 -Y 开口！）
    add_box(steel, (0, 0.01, 0.606), (1.16, 0.44, 0.014), bevel=0.002)
    add_box(steel, (0, 0.225, 0.662), (1.16, 0.016, 0.112))
    for sx in (-1, 1):
        add_box(steel, (sx * 0.572, 0.01, 0.662), (0.016, 0.44, 0.112))
        # 书斗内侧压深薄衬，强化开口深度可读性
        add_box(cubby_in, (sx * 0.558, 0.02, 0.662), (0.006, 0.40, 0.10))
    add_box(cubby_in, (0, 0.212, 0.662), (1.12, 0.006, 0.10))

    # 两侧钢管腿（直径 28mm）+ H 型侧横撑 + 下横梁 + 侧面挂包钩 + 黑色防滑脚套（高 18mm）
    for sx in (-1, 1):
        lx = sx * 0.60
        for sy in (-0.23, 0.23):
            add_cyl(steel, (lx, sy, 0.365), 0.014, 0.71, segs=8)
            add_cyl(foot, (lx, sy, 0.009), 0.017, 0.018, segs=8)
        # 侧面上下双横管连接
        add_cyl(steel, (lx, 0, 0.17), 0.011, 0.46, segs=8, rot=(math.pi / 2, 0, 0))
        add_cyl(steel, (lx, 0, 0.68), 0.012, 0.48, segs=8, rot=(math.pi / 2, 0, 0))
        # 侧面弯折挂书包小钩
        add_box(steel, (lx + sx * 0.022, -0.05, 0.63), (0.032, 0.012, 0.012))
        add_box(steel, (lx + sx * 0.035, -0.05, 0.642), (0.010, 0.012, 0.026))
    # 背侧加固横杆（在 y=+0.23 侧，完全不碰膝盖空间）
    add_cyl(steel, (0, 0.23, 0.42), 0.011, 1.20, segs=8, rot=(0, math.pi / 2, 0))


# ==================== 2. 弧面胶合板弯管课椅（正面向讲台 +Y / 靠背在 -Y 侧，与场景座位朝向一致） ====================
def build_chair_unit():
    """注意：在教室里课桌在 z，椅子在 z+0.75（Three +Z 侧），学生面朝讲台（Three -Z = Blender +Y）。
    所以椅子靠背在 Three +Z（Blender -Y），座面朝向 Three -Z（Blender +Y），yaw=0 直接完美对齐！"""
    wood = mat(C_DESK_WOOD, "chair_wood", 0.52)
    steel = mat(C_STEEL_FRAME, "chair_steel", 0.50, 0.25)
    foot = mat(C_FOOT_BLACK, "chair_foot", 0.85)
    rivet = mat(C_RIVET, "rivet", 0.35, 0.65)

    # 微凹三段式弧面胶合板座板（宽 0.43，深 0.40，离地 0.445m，前缘瀑布圆角）
    add_box(wood, (-0.13, 0.01, 0.448), (0.16, 0.40, 0.018), rot=(0, 0.05, 0), bevel=0.004)
    add_box(wood, (0.0, 0.01, 0.444), (0.14, 0.40, 0.018), bevel=0.004)
    add_box(wood, (0.13, 0.01, 0.448), (0.16, 0.40, 0.018), rot=(0, -0.05, 0), bevel=0.004)
    # 前缘圆润瀑布压边（Blender +Y 侧）
    add_cyl(wood, (0, 0.208, 0.442), 0.011, 0.426, segs=8, rot=(0, math.pi / 2, 0))

    # 横向微弯胶合板靠背（靠背中心在 y=-0.19，顶高 0.84m，后倾 7°）
    add_box(wood, (-0.13, -0.186, 0.745), (0.155, 0.018, 0.19), rot=(-0.11, 0, -0.08), bevel=0.004)
    add_box(wood, (0.0, -0.194, 0.745), (0.155, 0.018, 0.19), rot=(-0.11, 0, 0), bevel=0.004)
    add_box(wood, (0.13, -0.186, 0.745), (0.155, 0.018, 0.19), rot=(-0.11, 0, 0.08), bevel=0.004)

    # 钢框四腿 + 后倾连续靠背立管 + 背板连接片与双螺钉铆钉 + 脚套
    for sx in (-1, 1):
        lx = sx * 0.175
        # 前腿（y=+0.16）与后腿（y=-0.16）
        add_limb(steel, (lx, 0.165, 0.016), (lx, 0.155, 0.438), 0.011, 0.011, segs=8)
        add_limb(steel, (lx, -0.165, 0.016), (lx, -0.160, 0.445), 0.011, 0.011, segs=8)
        # 后腿向上微后仰延伸至靠背（z=0.445 -> 0.81）
        add_limb(steel, (lx, -0.160, 0.445), (lx, -0.198, 0.805), 0.0105, 0.0105, segs=8)
        # 脚套
        add_cyl(foot, (lx, 0.165, 0.008), 0.014, 0.016, segs=8)
        add_cyl(foot, (lx, -0.165, 0.008), 0.014, 0.016, segs=8)
        # 座下纵撑与下横撑
        add_cyl(steel, (lx, 0, 0.432), 0.010, 0.34, segs=8, rot=(math.pi / 2, 0, 0))
        add_cyl(steel, (lx, 0, 0.16), 0.009, 0.33, segs=8, rot=(math.pi / 2, 0, 0))
        # 背板后双螺钉与连接片
        add_box(steel, (lx, -0.204, 0.745), (0.026, 0.008, 0.12), rot=(-0.11, 0, 0))
        for dz in (-0.035, 0.035):
            add_cyl(rivet, (lx, -0.210, 0.745 + dz), 0.007, 0.008, segs=6, rot=(math.pi / 2, 0, 0))
    add_cyl(steel, (0, -0.162, 0.22), 0.009, 0.35, segs=8, rot=(0, math.pi / 2, 0))


# ==================== 3. 走廊 2×4 格低饱和储物矮柜（正面朝 -Y = Three +Z） ====================
def build_low_locker():
    body = mat(C_LOCKER_BODY, "locker_body", 0.68)
    door_cream = mat(C_DOOR_CREAM, "door_cream", 0.62)
    door_terra = mat(C_DOOR_TERRA, "door_terra", 0.62)
    seam = mat(C_LOCKER_SEAM, "locker_seam", 0.55, 0.2)
    label = mat(C_LABEL_WHITE, "locker_label", 0.78)
    base_dark = mat(0x7B7870, "locker_plinth", 0.75)

    # 实接地踢脚底座（高 0.06m，微内缩）+ 灰暖白外箱体（总宽 1.38m，深 0.38m，总高 0.90m）
    add_box(base_dark, (0, 0.01, 0.03), (1.36, 0.35, 0.06))
    add_box(body, (0, 0.01, 0.48), (1.38, 0.36, 0.84), bevel=0.005, bevel_segs=2)
    # 正面内凹暗腔底板（制造清晰 6mm 门缝阴影！）
    add_box(seam, (0, -0.168, 0.48), (1.31, 0.015, 0.77))

    # 2 行 × 4 列门片：按审查第 3 节以灰暖白为主，局部点缀陶土色门片，告别整块刺眼亮橙
    terra_slots = {(0, 1), (0, 3), (1, 0), (1, 2)}
    col_w = 0.316
    row_h = 0.372
    for r in range(2):
        cz = 0.288 + r * 0.384
        for c in range(4):
            cx = -0.486 + c * 0.324
            dmat = door_terra if (r, c) in terra_slots else door_cream
            add_box(dmat, (cx, -0.178, cz), (col_w, 0.018, row_h), bevel=0.003)
            # 顶部白色姓名标签槽
            add_box(seam, (cx, -0.188, cz + 0.125), (0.11, 0.006, 0.034))
            add_box(label, (cx, -0.190, cz + 0.125), (0.096, 0.005, 0.024))
            # 下部两条水平百叶通风槽
            for lv in (-0.105, -0.132):
                add_box(seam, (cx, -0.189, cz + lv), (0.16, 0.006, 0.010))
            # 右侧嵌入式深色竖锁扣
            add_box(seam, (cx + 0.108, -0.189, cz - 0.01), (0.028, 0.008, 0.062), bevel=0.002)


# ==================== 4. 双门灰蓝铁皮储物高柜（高 1.92m，正面朝 -Y） ====================
def build_tall_locker():
    steel = mat(C_TALL_LOCKER, "tall_steel", 0.52, 0.25)
    door_mat = mat(0x668090, "tall_door", 0.50, 0.25)
    seam = mat(C_LOCKER_SEAM, "tall_seam", 0.50, 0.35)
    label = mat(C_LABEL_WHITE, "tall_label", 0.78)
    handle = mat(C_RIVET, "tall_handle", 0.35, 0.70)

    add_box(seam, (0, 0.01, 0.035), (0.90, 0.41, 0.07))
    add_box(steel, (0, 0.01, 0.995), (0.92, 0.43, 1.85), bevel=0.005, bevel_segs=2)
    add_box(seam, (0, -0.202, 0.995), (0.86, 0.014, 1.77))

    for sx in (-1, 1):
        cx = sx * 0.218
        add_box(door_mat, (cx, -0.212, 0.995), (0.422, 0.018, 1.75), bevel=0.003)
        # 标签卡槽
        add_box(seam, (cx, -0.222, 1.66), (0.13, 0.006, 0.04))
        add_box(label, (cx, -0.224, 1.66), (0.114, 0.005, 0.028))
        # 上下各三道散热百叶孔
        for base_z in (1.52, 0.34):
            for k in range(3):
                add_box(seam, (cx, -0.222, base_z - k * 0.034), (0.22, 0.006, 0.012))
        # 嵌入式执手锁（靠中缝一侧）
        hx = cx - sx * 0.155
        add_box(seam, (hx, -0.222, 1.02), (0.036, 0.008, 0.13))
        add_box(handle, (hx, -0.227, 1.02), (0.014, 0.012, 0.09))


# ==================== 5. 精细学生双肩/通勤书包（告别蓝色占位块，高 0.34m） ====================
def build_backpack():
    navy = mat(C_BAG_NAVY, "bag_navy", 0.76)
    pocket = mat(C_BAG_POCKET, "bag_pocket", 0.78)
    strap = mat(C_BAG_STRAP, "bag_strap", 0.82)
    trim = mat(C_BAG_TRIM, "bag_trim", 0.42, 0.45)

    # 横置通勤学生包/双肩包主体（宽 0.38，深 0.21，高 0.29，大圆角软包感，实接地）
    add_box(navy, (0, 0.01, 0.148), (0.37, 0.19, 0.285), bevel=0.032, bevel_segs=3)
    # 底部耐磨加厚衬底
    add_box(strap, (0, 0.01, 0.018), (0.35, 0.18, 0.034), bevel=0.008)
    # 正面立体拉链前袋 + 浅灰滚边条 + 金属拉链头
    add_box(pocket, (0, -0.098, 0.118), (0.29, 0.048, 0.175), bevel=0.016, bevel_segs=2)
    add_box(trim, (0, -0.123, 0.185), (0.26, 0.006, 0.008))
    add_box(trim, (0.08, -0.128, 0.176), (0.012, 0.008, 0.024))
    # 左右侧水杯插袋
    for sx in (-1, 1):
        add_box(pocket, (sx * 0.19, 0.01, 0.095), (0.026, 0.13, 0.135), bevel=0.008)
    # 顶部拱形提手环（顶高 0.34m）
    add_box(strap, (-0.045, 0.0, 0.308), (0.022, 0.026, 0.045), rot=(0, 0.28, 0))
    add_box(strap, (0.045, 0.0, 0.308), (0.022, 0.026, 0.045), rot=(0, -0.28, 0))
    add_box(strap, (0, 0.0, 0.328), (0.095, 0.028, 0.020), bevel=0.005)
    # 背面两条自然弯曲垂落至地面的双肩背带
    for sx in (-1, 1):
        bx = sx * 0.095
        add_box(strap, (bx, 0.108, 0.22), (0.038, 0.016, 0.13), rot=(0.18, 0, sx * 0.05), bevel=0.004)
        add_box(strap, (bx * 1.08, 0.122, 0.10), (0.036, 0.014, 0.14), rot=(-0.15, 0, sx * 0.06), bevel=0.004)


# ==================== 6. 走廊标准木框墨绿绒布公告栏（宽 1.28m，高 1.04m，正面朝 -Y） ====================
def build_bulletin():
    frame = mat(C_WOOD_FRAME, "board_wood", 0.62)
    felt = mat(C_BOARD_GREEN, "board_felt", 0.86)
    p_cream = mat(C_PAPER_CREAM, "p_cream", 0.82)
    p_blue = mat(C_PAPER_BLUE, "p_blue", 0.82)
    p_peach = mat(C_PAPER_PEACH, "p_peach", 0.82)
    header_bar = mat(0x4A6B5D, "p_header", 0.78)
    pin_r = mat(C_PIN_RED, "pin_r", 0.45)
    pin_g = mat(C_PIN_GOLD, "pin_g", 0.40, 0.35)

    # 背部隐蔽挂墙垫条（留出 4mm 离墙阴影缝）+ 墨绿绒布芯板
    add_box(frame, (0, 0.018, 0.52), (1.20, 0.012, 0.96))
    add_box(felt, (0, 0.0, 0.52), (1.20, 0.024, 0.96))
    # 四周厚实倒角暖木外框（宽 48mm，深 46mm）
    for z in (0.024, 1.016):
        add_box(frame, (0, -0.006, z), (1.28, 0.046, 0.048), bevel=0.004, bevel_segs=2)
    for x in (-0.616, 0.616):
        add_box(frame, (x, -0.006, 0.52), (0.048, 0.046, 0.94), bevel=0.004, bevel_segs=2)

    # 板面错落排布 4 张真实比例通知单（离板面 4~7mm 立体厚度，绝不共面闪烁！）
    # 1) 左侧课程表（横版带表头条）
    add_box(p_cream, (-0.34, -0.015, 0.65), (0.38, 0.005, 0.30))
    add_box(header_bar, (-0.34, -0.018, 0.77), (0.34, 0.004, 0.032))
    # 2) 中上社团海报（竖版微偏 2.5°）
    add_box(p_peach, (0.05, -0.016, 0.63), (0.26, 0.005, 0.36), rot=(0, 0.04, 0))
    # 3) 右侧值日/校历通知（带右下微翘折角）
    add_box(p_blue, (0.39, -0.015, 0.66), (0.28, 0.005, 0.32))
    add_box(p_cream, (0.48, -0.021, 0.525), (0.065, 0.005, 0.055), rot=(0.22, -0.25, 0.1))
    # 4) 左下小便签
    add_box(p_cream, (-0.28, -0.016, 0.33), (0.24, 0.005, 0.20), rot=(0, -0.05, 0))
    add_box(p_cream, (0.16, -0.015, 0.31), (0.30, 0.005, 0.18))

    # 彩色圆形图钉点缀
    pins = [
        (-0.50, 0.78, pin_r), (-0.18, 0.78, pin_r),
        (0.05, 0.79, pin_g), (0.28, 0.80, pin_r), (0.50, 0.80, pin_g),
        (-0.28, 0.41, pin_g), (0.16, 0.38, pin_r),
    ]
    for px, pz, pm in pins:
        add_cyl(pm, (px, -0.021, pz), 0.009, 0.008, segs=8, rot=(math.pi / 2, 0, 0))


# ==================== 7. 教室斜顶围边立式讲桌（高 1.08m，学生看正面 -Y） ====================
def build_podium():
    body = mat(C_PODIUM_BODY, "pod_body", 0.56)
    wood = mat(C_PODIUM_WOOD, "pod_wood", 0.52)
    dark = mat(C_LOCKER_SEAM, "pod_base", 0.72)
    chalk_box = mat(0x6D8C74, "chalk_box", 0.75)

    # 底部防踢缩口底座 + 暖灰白箱体 + 左右胡桃木厚侧翼
    add_box(dark, (0, 0, 0.04), (1.06, 0.56, 0.08))
    add_box(body, (0, 0.02, 0.52), (1.06, 0.54, 0.88), bevel=0.005)
    for sx in (-1, 1):
        add_box(wood, (sx * 0.55, 0.0, 0.54), (0.045, 0.62, 1.00), bevel=0.004, bevel_segs=2)
    # 正面（朝学生 -Y）装饰木压条 + 45mm 高挡书围边
    add_box(wood, (0, -0.26, 0.99), (1.14, 0.04, 0.11), bevel=0.004)
    # 微倾斜阅读台面 + 粉笔盒 + 板擦
    add_box(wood, (0, 0.01, 0.995), (1.06, 0.58, 0.032), rot=(-0.08, 0, 0), bevel=0.004)
    add_box(chalk_box, (-0.30, -0.04, 1.032), (0.16, 0.11, 0.048), rot=(-0.08, 0, 0.08), bevel=0.003)
    add_box(wood, (0.28, -0.06, 1.026), (0.17, 0.065, 0.036), rot=(-0.08, 0, -0.12), bevel=0.003)


# ==================== 8. 壁挂前倾圆形网罩校园广播音箱（高 0.32m，正面朝 -Y） ====================
def build_speaker():
    box_mat = mat(C_SPEAKER_BOX, "spk_box", 0.62)
    grille = mat(C_SPEAKER_MESH, "spk_grille", 0.75, 0.25)
    ring = mat(C_RIVET, "spk_ring", 0.38, 0.60)

    # 背部金属壁挂安装底座与支臂
    add_box(ring, (0, 0.075, 0.16), (0.14, 0.016, 0.18), bevel=0.002)
    add_box(ring, (0, 0.045, 0.16), (0.06, 0.05, 0.06))
    # 前倾 8° 深棕木纹箱体（高 0.31m，宽 0.23m，深 0.14m）
    tilt = 0.14
    add_box(box_mat, (0, -0.01, 0.16), (0.23, 0.13, 0.31), rot=(-tilt, 0, 0), bevel=0.008, bevel_segs=2)
    # 正面银色收边外环 + 内凹深色金属圆网罩 + 底部铭牌小标
    add_cyl(ring, (0, -0.076, 0.178), 0.086, 0.014, segs=16, rot=(math.pi / 2 - tilt, 0, 0))
    add_cyl(grille, (0, -0.081, 0.178), 0.076, 0.012, segs=16, rot=(math.pi / 2 - tilt, 0, 0))
    add_box(ring, (0, -0.068, 0.055), (0.048, 0.008, 0.016), rot=(-tilt, 0, 0))


# ==================== 9. 1F 辅导员办公桌组合（来访学生看正面 -Y，老师坐 +Y 侧） ====================
def build_office_desk():
    walnut = mat(C_WALNUT, "off_walnut", 0.50)
    cab = mat(C_CABINET_GREY, "off_cab", 0.54, 0.20)
    dark = mat(C_FOOT_BLACK, "off_dark", 0.45, 0.15)
    screen = mat(0xDCE6EE, "off_screen", 0.32)
    brass = mat(C_LAMP_BRASS, "off_brass", 0.36, 0.65)
    shade = mat(C_LAMP_SHADE, "off_shade", 0.55)
    folder_a = mat(0x476A80, "folder_a", 0.72)
    folder_b = mat(C_PAPER_CREAM, "folder_b", 0.80)
    handle = mat(C_RIVET, "off_handle", 0.35, 0.65)

    # 胡桃木宽厚倒角桌面（1.60 x 0.78 x 0.036，顶高 0.75m）+ 前侧挡板（防穿视）
    add_box(walnut, (0, 0, 0.732), (1.60, 0.78, 0.036), bevel=0.006, bevel_segs=2)
    add_box(walnut, (0.18, -0.30, 0.49), (1.12, 0.022, 0.44))

    # 左侧三抽屉铁皮副柜 + 银色横拉手；右侧落地厚侧板 + 脚垫
    add_box(cab, (-0.54, 0.0, 0.365), (0.44, 0.70, 0.70), bevel=0.004)
    for r in range(3):
        dz = 0.18 + r * 0.21
        add_box(cab, (-0.54, 0.356, dz), (0.39, 0.016, 0.185), bevel=0.002)
        add_box(handle, (-0.54, 0.370, dz + 0.03), (0.12, 0.012, 0.014))
    add_box(cab, (0.72, 0.0, 0.365), (0.055, 0.70, 0.70), bevel=0.003)
    for sx in (-0.72, -0.36, 0.72):
        for sy in (-0.30, 0.30):
            add_cyl(dark, (sx, sy, 0.008), 0.018, 0.016, segs=8)

    # 窄边框液晶显示器（偏右摆放，留出中间与学生面对面交流的开阔桌面视线！）
    mx, my = 0.28, -0.06
    add_box(dark, (mx, my, 0.758), (0.18, 0.14, 0.014), bevel=0.002)
    add_box(dark, (mx, my - 0.02, 0.835), (0.038, 0.026, 0.15))
    add_box(dark, (mx, my, 0.965), (0.52, 0.026, 0.31), rot=(0, 0, -0.18), bevel=0.004)
    add_box(screen, (mx - 0.003, my + 0.015, 0.965), (0.485, 0.006, 0.275), rot=(0, 0, -0.18))
    add_box(dark, (mx - 0.03, my + 0.17, 0.758), (0.34, 0.12, 0.014), rot=(0, 0, -0.18), bevel=0.002)

    # 左侧成摞文件夹、访谈记录本与陶瓷保温杯
    add_box(folder_a, (-0.42, -0.08, 0.772), (0.28, 0.22, 0.042), rot=(0, 0, 0.08), bevel=0.003)
    add_box(folder_b, (-0.40, -0.07, 0.808), (0.25, 0.19, 0.028), rot=(0, 0, -0.04), bevel=0.002)
    add_cyl(shade, (-0.12, 0.12, 0.795), 0.038, 0.09, segs=10)

    # 左前角黄铜长臂阅读台灯（总高 1.14m，成为辅导员办公桌温暖识别锚点）
    lx, ly = -0.62, -0.22
    add_cyl(brass, (lx, ly, 0.762), 0.075, 0.024, segs=12)
    add_limb(brass, (lx, ly, 0.77), (lx - 0.04, ly - 0.02, 1.02), 0.010, 0.009, segs=8)
    add_limb(brass, (lx - 0.04, ly - 0.02, 1.02), (lx + 0.08, ly + 0.04, 1.125), 0.009, 0.008, segs=8)
    add_cyl(shade, (lx + 0.11, ly + 0.05, 1.085), 0.085, 0.11, segs=12, r_top=0.042, rot=(0.22, 0.28, 0))


# ==================== 10. 上玻下铁双节档案文件柜（高 1.94m，零透明闪烁，正面朝 -Y） ====================
def build_file_cabinet():
    cab = mat(C_CABINET_GREY, "fc_body", 0.52, 0.25)
    door_m = mat(0x86929A, "fc_door", 0.50, 0.25)
    seam = mat(C_LOCKER_SEAM, "fc_seam", 0.55, 0.25)
    glass_bg = mat(C_GLASS_BACK, "fc_glass", 0.28, 0.35)
    handle = mat(C_RIVET, "fc_handle", 0.32, 0.70)
    sp_blue = mat(0x3B5C76, "sp_b", 0.75)
    sp_ochre = mat(0xA88256, "sp_o", 0.75)
    sp_cream = mat(C_PAPER_CREAM, "sp_c", 0.80)

    # 踢脚底座 + 柜体主壳（0.90 x 0.42 x 1.94m）
    add_box(seam, (0, 0.01, 0.035), (0.88, 0.40, 0.07))
    add_box(cab, (0, 0.01, 1.005), (0.90, 0.42, 1.87), bevel=0.005, bevel_segs=2)
    add_box(seam, (0, -0.198, 1.005), (0.84, 0.012, 1.80))

    # 下半部实心双开门（z ∈ [0.09, 0.90]）
    for sx in (-1, 1):
        cx = sx * 0.212
        add_box(door_m, (cx, -0.208, 0.495), (0.412, 0.018, 0.79), bevel=0.003)
        hx = cx - sx * 0.15
        add_box(handle, (hx, -0.220, 0.54), (0.014, 0.012, 0.095))

    # 上半部玻璃框门（z ∈ [0.92, 1.90]）：不透明高反射冷蓝灰内腔 + 两层搁板 + 错落档案夹脊，彻底杜绝透明闪烁！
    for sx in (-1, 1):
        cx = sx * 0.212
        # 门框四边
        add_box(door_m, (cx, -0.208, 0.95), (0.412, 0.018, 0.055))
        add_box(door_m, (cx, -0.208, 1.87), (0.412, 0.018, 0.055))
        for ex in (-0.18, 0.18):
            add_box(door_m, (cx + ex, -0.208, 1.41), (0.052, 0.018, 0.87))
        # 玻璃背衬面与内层搁板、立式档案盒脊
        add_box(glass_bg, (cx, -0.196, 1.41), (0.315, 0.010, 0.86))
        add_box(cab, (cx, -0.202, 1.39), (0.31, 0.016, 0.022))
        spines = [sp_blue, sp_cream, sp_ochre, sp_blue, sp_cream]
        for idx, sm in enumerate(spines):
            bx = cx - 0.11 + idx * 0.054
            add_box(sm, (bx, -0.201, 1.15), (0.042, 0.012, 0.24))
            if idx != 2:
                add_box(spines[(idx + 2) % 5], (bx, -0.201, 1.56), (0.042, 0.012, 0.25))
        hx = cx - sx * 0.155
        add_box(handle, (hx, -0.220, 1.36), (0.014, 0.012, 0.095))


# ==================== 11–13. 校园三型香樟阔叶树（A 伞状 / B 偏侧 / C 高窄，透天间隙 + 枝干穿冠） ====================
def _build_camphor_tree(variant):
    bark = mat(C_BARK, "camphor_bark", 0.90)
    leaf_d = mat(C_LEAF_DARK, "leaf_dark", 0.86)
    leaf_m = mat(C_LEAF_MID, "leaf_mid", 0.84)
    leaf_l = mat(C_LEAF_LIGHT, "leaf_light", 0.82)

    if variant == "A":
        # A 型：经典伞状阔冠香樟（总高 ~4.45m，主干略微 S 弯，4 大承重主枝外展，冠内留透天小窗）
        trunk_pts = [(0, 0, 0), (0.05, -0.03, 0.85), (-0.04, 0.05, 1.75), (0.02, 0.0, 2.35)]
        trunk_r = [0.19, 0.145, 0.115, 0.085]
        limbs = [
            ((0.02, 0.0, 2.15), (-0.92, -0.55, 3.15), 0.078, 0.036),
            ((0.02, 0.0, 2.22), (0.96, -0.42, 3.22), 0.075, 0.035),
            ((0.02, 0.0, 2.28), (-0.48, 0.88, 3.30), 0.072, 0.034),
            ((0.02, 0.0, 2.32), (0.58, 0.78, 3.42), 0.070, 0.032),
        ]
        # 二级穿冠小枝杈（在叶团间隙里清楚可见）
        twigs = [
            ((-0.55, -0.32, 2.75), (-1.15, -0.15, 3.35), 0.042, 0.020),
            ((0.58, -0.25, 2.82), (1.12, 0.22, 3.45), 0.040, 0.020),
            ((0.28, 0.42, 2.90), (0.12, 0.10, 3.85), 0.044, 0.022),
        ]
        # 叶团（x, y, z, sx, sy, sz, mat, seed）—— 刻意拉开间距留出 2~3 处透天孔隙
        lobes = [
            (-1.05, -0.58, 3.32, 0.82, 0.74, 0.52, leaf_m, 11),
            (1.08, -0.44, 3.38, 0.80, 0.72, 0.50, leaf_m, 12),
            (-0.52, 0.92, 3.45, 0.78, 0.70, 0.52, leaf_d, 13),
            (0.66, 0.82, 3.55, 0.76, 0.68, 0.50, leaf_m, 14),
            (-1.22, 0.12, 3.52, 0.64, 0.60, 0.44, leaf_l, 15),
            (1.18, 0.28, 3.60, 0.62, 0.58, 0.44, leaf_l, 16),
            (-0.28, -0.18, 3.05, 0.74, 0.68, 0.46, leaf_d, 17),
            (0.12, 0.14, 4.02, 0.86, 0.78, 0.44, leaf_l, 18),
            (-0.62, 0.22, 3.88, 0.66, 0.60, 0.42, leaf_l, 19),
        ]
    elif variant == "B":
        # B 型：偏侧自然迎光香樟（总高 ~4.68m，树干向 +X 微倾，左右冠幅一大一小破除对称）
        trunk_pts = [(0, 0, 0), (0.10, 0.04, 0.95), (0.24, -0.02, 1.95), (0.34, 0.02, 2.65)]
        trunk_r = [0.18, 0.14, 0.108, 0.078]
        limbs = [
            ((0.26, -0.01, 2.15), (1.28, -0.35, 3.18), 0.076, 0.034),
            ((0.30, 0.01, 2.42), (0.95, 0.68, 3.55), 0.070, 0.032),
            ((0.28, 0.0, 2.35), (-0.58, -0.48, 3.40), 0.068, 0.032),
            ((0.34, 0.02, 2.62), (0.18, 0.35, 3.92), 0.066, 0.030),
        ]
        twigs = [
            ((0.82, -0.20, 2.72), (1.42, 0.22, 3.38), 0.040, 0.019),
            ((-0.18, -0.25, 2.90), (-0.82, 0.18, 3.62), 0.038, 0.018),
        ]
        lobes = [
            (1.32, -0.38, 3.34, 0.84, 0.72, 0.50, leaf_m, 21),
            (1.42, 0.28, 3.54, 0.68, 0.62, 0.45, leaf_l, 22),
            (0.92, 0.72, 3.72, 0.76, 0.68, 0.48, leaf_m, 23),
            (-0.62, -0.50, 3.52, 0.68, 0.62, 0.46, leaf_d, 24),
            (-0.78, 0.22, 3.74, 0.62, 0.56, 0.42, leaf_m, 25),
            (0.42, -0.08, 3.22, 0.72, 0.66, 0.44, leaf_d, 26),
            (0.22, 0.32, 4.22, 0.82, 0.74, 0.46, leaf_l, 27),
            (0.86, -0.05, 4.02, 0.66, 0.60, 0.42, leaf_l, 28),
        ]
    else:
        # C 型：高窄疏朗分层树（总高 ~4.90m，上下两层错落云片冠，中间大段露出主干与斜枝，极富呼吸感！）
        trunk_pts = [(0, 0, 0), (-0.06, -0.04, 1.1), (-0.02, 0.03, 2.3), (0.04, 0.0, 3.35)]
        trunk_r = [0.17, 0.132, 0.098, 0.068]
        limbs = [
            ((-0.03, 0.01, 2.05), (-0.78, -0.36, 2.82), 0.066, 0.030),
            ((-0.02, 0.02, 2.25), (0.76, 0.32, 3.02), 0.064, 0.030),
            ((0.01, 0.01, 2.95), (-0.64, 0.48, 3.88), 0.058, 0.028),
            ((0.03, 0.0, 3.15), (0.68, -0.38, 4.05), 0.056, 0.026),
            ((0.04, 0.0, 3.32), (0.06, 0.08, 4.35), 0.052, 0.024),
        ]
        twigs = [
            ((-0.45, -0.20, 2.48), (-0.52, 0.42, 3.05), 0.036, 0.018),
            ((0.42, -0.22, 3.65), (0.22, -0.58, 4.22), 0.034, 0.017),
        ]
        lobes = [
            # 下层疏朗托叶
            (-0.82, -0.38, 2.94, 0.68, 0.60, 0.40, leaf_d, 31),
            (0.80, 0.34, 3.14, 0.68, 0.58, 0.40, leaf_m, 32),
            (-0.50, 0.44, 3.16, 0.56, 0.50, 0.36, leaf_d, 33),
            # 上层主冠（与下层之间留出约 0.45m 透空枝干层！）
            (-0.66, 0.50, 4.02, 0.70, 0.62, 0.44, leaf_m, 34),
            (0.70, -0.40, 4.18, 0.68, 0.60, 0.44, leaf_l, 35),
            (0.20, -0.56, 4.32, 0.56, 0.52, 0.38, leaf_m, 36),
            (0.06, 0.08, 4.50, 0.74, 0.68, 0.40, leaf_l, 37),
        ]

    # 根部微扩树头（自然扎根感）
    add_cyl(bark, (0, 0, 0.09), 0.23, 0.18, segs=8, r_top=trunk_r[0])
    for i in range(len(trunk_pts) - 1):
        add_limb(bark, trunk_pts[i], trunk_pts[i + 1], trunk_r[i], trunk_r[i + 1], segs=8)
    for p0, p1, r0, r1 in limbs:
        add_limb(bark, p0, p1, r0, r1, segs=7)
    for p0, p1, r0, r1 in twigs:
        add_limb(bark, p0, p1, r0, r1, segs=6)
    for lx, ly, lz, sx, sy, sz, lmat, seed in lobes:
        add_foliage_lobe(lmat, (lx, ly, lz), (sx, sy, sz), seed=seed, subdivisions=1)


def build_tree_a():
    _build_camphor_tree("A")


def build_tree_b():
    _build_camphor_tree("B")


def build_tree_c():
    _build_camphor_tree("C")


# ==================== 合并、落地、射线烘焙 AO 与导出 ====================

def join_parts(name):
    for obj in PARTS:
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world
    call_op("object.select_all", action="DESELECT")
    base = max(PARTS, key=lambda o: len(o.data.vertices))
    for obj in PARTS:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = base
    if len(PARTS) > 1:
        call_op("object.join")
    call_op("object.transform_apply", location=True, rotation=True, scale=True)
    base.name = name
    PARTS.clear()
    return base


def ground_and_center(obj):
    low, high = bounds(obj)
    cx = (low[0] + high[0]) * 0.5
    cy = (low[1] + high[1]) * 0.5
    obj.data.transform(Matrix.Translation(Vector((-cx, -cy, -low[2]))))


def bake_vertex_ao(obj, ao_dist=0.24, ao_strength=0.52):
    """高精度 9 方向半球射线 AO + 顶光微暖偏置 + 落地接触柔和压暗，直接写入 COLOR_0。"""
    mesh = obj.data
    colors = mesh.color_attributes.new(name="Col", type="BYTE_COLOR", domain="CORNER")
    sample_dirs = [Vector((0, 0, 0))]
    for ang in (0, math.pi * 0.25, math.pi * 0.5, math.pi * 0.75, math.pi, -math.pi * 0.75, -math.pi * 0.5, -math.pi * 0.25):
        sample_dirs.append(Vector((math.cos(ang) * 0.68, math.sin(ang) * 0.68, 0.58)).normalized())

    base_by_slot = []
    for slot in obj.material_slots:
        bsdf = None
        if slot.material and slot.material.node_tree:
            bsdf = next((n for n in slot.material.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled"), None)
        rgb = tuple(bsdf.inputs["Base Color"].default_value[:3]) if bsdf else (0.5, 0.5, 0.5)
        base_by_slot.append(rgb)

    low, high = bounds(obj)
    height = max(1e-4, high[2] - low[2])

    for poly in mesh.polygons:
        rgb = base_by_slot[poly.material_index] if poly.material_index < len(base_by_slot) else (0.5, 0.5, 0.5)
        normal = poly.normal
        center = poly.center
        hits = 0
        for d in sample_dirs:
            ray = (normal + d).normalized() if d.length_squared > 0 else normal.copy()
            hit, _loc, _nrm, _idx = obj.ray_cast(center + normal * 0.003 + ray * 0.002, ray, distance=ao_dist)
            if hit:
                hits += 1
        ao = 1.0 - ao_strength * (hits / float(len(sample_dirs)))
        if normal.z < -0.45:
            ao *= 0.76
        elif normal.z > 0.55:
            ao = min(1.06, ao * 1.05)
        ground_fade = min(1.0, (center.z - low[2]) / min(0.28, height * 0.18 + 1e-4))
        ao *= 0.74 + 0.26 * ground_fade
        r = min(1.0, max(0.0, rgb[0] * ao))
        g = min(1.0, max(0.0, rgb[1] * ao))
        b = min(1.0, max(0.0, rgb[2] * ao))
        for li in poly.loop_indices:
            # Blender BYTE_COLOR 的 color 属性读写使用线性或 sRGB 取决于版本，这里用 float color 属性写入最精准：
            colors.data[li].color = (r, g, b, 1.0)


def assign_single_material(obj, roughness, metallic):
    m = bpy.data.materials.new(f"{obj.name}_mat")
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    if bsdf.inputs.get("Metallic") is not None:
        bsdf.inputs["Metallic"].default_value = metallic
    # 显式连接 Col 顶点色到 Base Color（兼容 glTF 导出器自动导出 COLOR_0 且材质乘算）
    vcol = nodes.new("ShaderNodeVertexColor")
    vcol.layer_name = "Col"
    links.new(vcol.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    obj.data.materials.clear()
    obj.data.materials.append(m)
    for stale in [mat_item for mat_item in bpy.data.materials if mat_item.users == 0]:
        bpy.data.materials.remove(stale)


def export_glb(obj, path):
    call_op("object.select_all", action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    call_op(
        "export_scene.gltf",
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_lights=False,
        export_cameras=False,
        export_attributes=True,
        export_materials="EXPORT",
    )


PROPS = [
    # (文件名, 建模函数, 面数上限, roughness, metallic, 高度校验带(min, max), ao_dist)
    ("prop_school_desk_unit", build_desk_unit, 1600, 0.56, 0.08, (0.73, 0.77), 0.22),
    ("prop_school_chair_unit", build_chair_unit, 1400, 0.54, 0.10, (0.82, 0.87), 0.20),
    ("prop_school_low_locker", build_low_locker, 1600, 0.62, 0.06, (0.88, 0.92), 0.16),
    ("prop_school_tall_locker", build_tall_locker, 1200, 0.52, 0.22, (1.90, 1.95), 0.20),
    ("prop_school_backpack", build_backpack, 1400, 0.76, 0.04, (0.31, 0.37), 0.12),
    ("prop_school_bulletin", build_bulletin, 1100, 0.72, 0.04, (1.01, 1.07), 0.12),
    ("prop_school_podium", build_podium, 1100, 0.55, 0.06, (1.03, 1.12), 0.22),
    ("prop_school_speaker", build_speaker, 900, 0.58, 0.16, (0.29, 0.36), 0.10),
    ("prop_school_office_desk", build_office_desk, 1800, 0.52, 0.12, (1.10, 1.20), 0.24),
    ("prop_school_file_cabinet", build_file_cabinet, 1400, 0.50, 0.22, (1.91, 1.97), 0.20),
    ("prop_school_tree_a", build_tree_a, 1800, 0.85, 0.0, (4.30, 4.65), 0.55),
    ("prop_school_tree_b", build_tree_b, 1800, 0.85, 0.0, (4.50, 4.85), 0.55),
    ("prop_school_tree_c", build_tree_c, 1800, 0.85, 0.0, (4.70, 4.98), 0.55),
]


def main():
    parser = argparse.ArgumentParser(description="教学楼高精度低模套件程序化生产")
    parser.add_argument("--only", default="", help="只跑文件名含此子串的资产")
    args, _ = parser.parse_known_args([a for a in sys.argv[1:] if a != "--"])

    os.makedirs(OUT_DIR, exist_ok=True)
    summary = []
    for name, builder, budget, roughness, metallic, h_band, ao_dist in PROPS:
        if args.only and args.only not in name:
            continue
        call_op("wm.read_homefile", use_empty=True)
        MATERIALS.clear()
        PARTS.clear()
        bpy.context.scene.unit_settings.system = "METRIC"
        builder()
        obj = join_parts(name)
        ground_and_center(obj)
        tris = tri_count(obj.data)
        low, high = bounds(obj)
        height = high[2] - low[2]
        if not (h_band[0] <= height <= h_band[1]):
            raise RuntimeError(f"{name} 实测高度 {height:.3f}m 超出预期区间 {h_band}")
        if tris > budget:
            raise RuntimeError(f"{name} 面数 {tris} 超出预算 {budget}")
        bake_vertex_ao(obj, ao_dist=ao_dist)
        assign_single_material(obj, roughness, metallic)
        out_path = os.path.join(OUT_DIR, f"{name}.glb")
        export_glb(obj, out_path)
        kb = os.path.getsize(out_path) / 1024.0
        log(f"[OK] {name}: {tris}/{budget} tris | height={height:.3f}m | {kb:.1f} KB")
        summary.append((name, tris, height, kb))

    log("\n=== 教学楼 Blender 套件生产汇总 ===")
    total_kb = sum(r[3] for r in summary)
    for name, tris, height, kb in summary:
        log(f"  {name:<26} {tris:>4} tris   h={height:.3f}m   {kb:>5.1f} KB")
    log(f"  总计 {len(summary)} 件，复压前合计 {total_kb:.1f} KB")


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()
