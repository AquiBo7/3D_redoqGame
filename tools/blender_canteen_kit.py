# -*- coding: utf-8 -*-
"""tools/blender_canteen_kit.py —— 食堂模块化低模套件的无头程序化生产 + AO 图集烘焙。

产物（直接落 public/models/props/，再过 gltf-transform meshopt 复压）：
    prop_canteen_set.glb        细金属管腿 + 浅木面长餐桌 + 圆角木背椅（一桌四椅，≤1000 面）
    prop_canteen_column.glb     右侧竖条纹凹槽结构柱（≤300 面，凹槽烘 AO）
    prop_canteen_tray_rack.glb  不锈钢多层餐盘回收架（≤500 面）
    prop_canteen_window_bay.glb 左侧落地高窗框 + 窗台 + 铸铁暖气片（≤450 面，不含玻璃）
    prop_canteen_vending.glb    尽头墙无品牌自动贩卖机（≤380 面，抽象色块）
    prop_canteen_clock.glb      尽头大圆挂钟（≤180 面）

运行（项目根目录）：
    "E:/blender/blender.exe" --background --python tools/blender_canteen_kit.py -- --preview
复压：
    npx gltf-transform meshopt public/models/props/<file>.glb <同一文件> --level high

约束与口径：
  · 每件成品「单网格 + 单材质 + 底面贴 z=0」——resources.loadPropModel 对多网格/多材质直接返回 null。
  · 度量单位=米，按真实尺寸建模：套装椅背顶 0.956 / 桌面顶 0.783（TABLE_TOP_PROP），
    柱高 4.5，窗bay高 4.08（对齐程序化窗洞 0.84~4.08），贩卖机 1.95，回收架 1.2，挂钟直径 0.62。
  · 颜色即成品色（清单 tint 用 PROP_TINT_NEUTRAL 白，不再二次偏色），低饱和日系动漫傍晚基调。
  · Blender 是 Z 轴向上；导出 glTF 后 three 里 x=Blender x、y=Blender z、z=−Blender y。
"""

import argparse
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(REPO, "public", "models", "props")
PREVIEW_DIR = os.path.join(REPO, ".tmp", "preview", "canteen")
JPEG_DIR = os.path.join(REPO, ".tmp", "canteen_kit")
JPEG_QUALITY = 80
BAKE_MARGIN = 16
AO_DISTANCE = 0.12


def log(message):
    text = str(message)
    try:
        print(text, flush=True)
    except UnicodeEncodeError:
        print(text.encode("ascii", "replace").decode("ascii"), flush=True)


def call_op(op_path, **kwargs):
    """只把当前 Blender 版本认识的参数传给算子（5.3 与 4.x 的算子签名不一致）。"""
    group, name = op_path.split(".")
    op = getattr(getattr(bpy.ops, group), name)
    known = {prop.identifier for prop in op.get_rna_type().properties}
    for key in [k for k in kwargs if k not in known]:
        kwargs.pop(key)
    return op(**kwargs)


def tri_count(mesh):
    mesh.calc_loop_triangles()
    return len(mesh.loop_triangles)


def bounds(obj):
    bpy.context.view_layer.update()
    matrix = [list(row) for row in obj.matrix_world]
    flat = [0.0] * (len(obj.data.vertices) * 3)
    obj.data.vertices.foreach_get("co", flat)
    low, high = [1e18] * 3, [-1e18] * 3
    for index in range(len(obj.data.vertices)):
        x, y, z = flat[index * 3: index * 3 + 3]
        point = (
            x * matrix[0][0] + y * matrix[1][0] + z * matrix[2][0] + matrix[3][0],
            x * matrix[0][1] + y * matrix[1][1] + z * matrix[2][1] + matrix[3][1],
            x * matrix[0][2] + y * matrix[1][2] + z * matrix[2][2] + matrix[3][2],
        )
        for axis in range(3):
            low[axis] = min(low[axis], point[axis])
            high[axis] = max(high[axis], point[axis])
    return tuple(low), tuple(high)


# ---------------------------------------------------------------------------
# 建模小工具：全部走「加图元 → 记入 PARTS → 最后 join」的流水
# ---------------------------------------------------------------------------

PARTS = []
MATERIALS = {}


def mat(color, name, roughness=0.8, metallic=0.0):
    """按颜色缓存材质；Base Color 直接是成品色（清单 tint=白，不再偏色）。"""
    key = (tuple(round(c, 3) for c in color), roughness, metallic)
    if key in MATERIALS:
        return MATERIALS[key]
    material = bpy.data.materials.new(f"{name}_{len(MATERIALS)}")
    try:
        material.use_nodes = True
    except AttributeError:
        pass
    nodes = material.node_tree.nodes
    bsdf = next((n for n in nodes if n.bl_idname == "ShaderNodeBsdfPrincipled"), None)
    if bsdf is not None:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        if bsdf.inputs.get("Roughness") is not None:
            bsdf.inputs["Roughness"].default_value = roughness
        if bsdf.inputs.get("Metallic") is not None:
            bsdf.inputs["Metallic"].default_value = metallic
    MATERIALS[key] = material
    return material


def _spawn(op_path, **kwargs):
    """加图元并可靠地拿到新对象：background 模式下 active_object 偶发指向上一件，
    用「新建前后 bpy.data.objects 差集」捕获，再显式写 location/scale 并刷新视图层。"""
    before = set(bpy.data.objects)
    call_op(op_path, **kwargs)
    created = [obj for obj in bpy.data.objects if obj not in before]
    if not created:
        raise RuntimeError(f"{op_path} 没有创建新对象")
    return created[0]


def box(material, loc, dim, rot=None):
    obj = _spawn("mesh.primitive_cube_add", size=1.0)
    obj.location = tuple(loc)
    obj.scale = tuple(dim)
    if rot:
        obj.rotation_euler = tuple(rot)
    obj.data.materials.append(material)
    bpy.context.view_layer.update()
    PARTS.append(obj)
    return obj


def cyl(material, loc, radius, height, seg=6, rot=None):
    obj = _spawn("mesh.primitive_cylinder_add", vertices=seg, radius=radius, depth=height)
    obj.location = tuple(loc)
    if rot:
        obj.rotation_euler = tuple(rot)
    obj.data.materials.append(material)
    bpy.context.view_layer.update()
    PARTS.append(obj)
    return obj


def rot_z(loc, yaw):
    """绕 Z 轴旋转局部坐标（摆椅子用）。"""
    x, y, z = loc
    return (x * math.cos(yaw) - y * math.sin(yaw),
            x * math.sin(yaw) + y * math.cos(yaw), z)


# ---------------------------------------------------------------------------
# 各件建模：浅木长餐桌 + 圆角木背椅（一桌四椅）
# ---------------------------------------------------------------------------

WOOD_LIGHT = (0.74, 0.64, 0.50)
WOOD_DARK = (0.64, 0.53, 0.40)
STEEL_DARK = (0.30, 0.33, 0.36)
STEEL_LIGHT = (0.72, 0.75, 0.77)
IRON_WHITE = (0.80, 0.79, 0.75)
PAINT_FRAME = (0.26, 0.30, 0.33)
PLASTER = (0.68, 0.68, 0.66)
PLASTER_DARK = (0.30, 0.32, 0.34)
VEND_BODY = (0.24, 0.28, 0.34)
VEND_SCREEN = (0.90, 0.93, 0.96)
CLOCK_FACE = (0.92, 0.92, 0.88)


def build_set():
    """一桌四椅：桌面顶 0.783，椅背顶 0.956（与 TABLE_TOP_PROP / heightM 对齐）。
    椅子落在 (x±0.70, y±0.92)（Blender y = −three z），椅背朝外，与程序化座椅同一套位表。"""
    wood = mat(WOOD_LIGHT, "wood_light", 0.72)
    wood2 = mat(WOOD_DARK, "wood_dark", 0.74)
    steel = mat(STEEL_DARK, "steel_dark", 0.45, 0.55)

    # 桌面板 + 底板裙 + 四细管腿 + 纵横拉杆
    box(wood, (0, 0, 0.758), (2.76, 0.86, 0.05))
    box(steel, (0, 0, 0.708), (2.5, 0.7, 0.05))
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(steel, (sx * 1.22, sy * 0.34, 0.345), 0.026, 0.69, 6)
        box(steel, (sx * 1.22, 0, 0.14), (0.045, 0.72, 0.045))
    box(steel, (0, 0.34, 0.14), (2.44, 0.04, 0.04))
    box(steel, (0, -0.34, 0.14), (2.44, 0.04, 0.04))

    # 四把椅子：座面 0.44，靠背板顶到 0.956，顶部圆杆 r=0.026 收圆角
    for (cx, cy, yaw) in ((0.70, -0.92, math.pi), (-0.70, -0.92, math.pi),
                          (0.70, 0.92, 0.0), (-0.70, 0.92, 0.0)):
        def place(lx, ly, lz, cx=cx, cy=cy, yaw=yaw):
            """椅子局部坐标 → 世界坐标（yaw=π 的椅子绕自身中心转 180°，椅背朝外）。"""
            return (cx + lx * math.cos(yaw) - ly * math.sin(yaw),
                    cy + lx * math.sin(yaw) + ly * math.cos(yaw), lz)
        # 座面 / 靠背板 / 顶部圆杆 / 双背柱 / 四腿
        box(wood, place(0, 0, 0.44), (0.42, 0.40, 0.045))
        box(wood2, place(0, 0.17, 0.776), (0.40, 0.04, 0.36))
        cyl(wood2, place(0, 0.17, 0.93), 0.026, 0.40, 6, rot=(0, math.pi / 2, 0))
        for sx in (-1, 1):
            cyl(steel, place(sx * 0.16, 0.17, 0.60), 0.02, 0.36, 6)
        for sx in (-1, 1):
            for sy in (-1, 1):
                cyl(steel, place(sx * 0.17, sy * 0.15, 0.22), 0.022, 0.44, 6)


def build_column():
    """竖条纹凹槽大柱：核心方柱 + 面向室内一侧的凸棱（棱间凹槽由 AO 烘焙加深），高 4.5。"""
    plaster = mat(PLASTER, "plaster", 0.86)
    plaster2 = mat((0.60, 0.60, 0.58), "plaster_mid", 0.86)
    dark = mat(PLASTER_DARK, "plaster_dark", 0.8)
    box(plaster, (0, 0, 2.3), (0.40, 0.44, 4.2))
    box(dark, (0, 0, 0.07), (0.52, 0.56, 0.14))          # 防撞基座
    box(plaster2, (0, 0, 4.44), (0.48, 0.52, 0.12))      # 柱头收分
    for i in range(7):                                    # 室内侧（−x）竖棱
        y = -0.15 + i * 0.05
        box(plaster2, (-0.225, y, 2.3), (0.05, 0.028, 4.1))
    for i in range(3):                                    # 侧面（±y）各三道竖棱
        for side in (-1, 1):
            box(plaster2, (-0.12 + i * 0.12, side * 0.245, 2.3), (0.06, 0.05, 4.1))


def build_tray_rack():
    """不锈钢多层餐盘回收架：四立柱 + 三层搁板 + 六摞餐盘 + 底部横撑，高 1.2。"""
    steel = mat(STEEL_LIGHT, "steel", 0.32, 0.7)
    tray = mat((0.82, 0.84, 0.85), "tray", 0.38, 0.5)
    dark = mat((0.40, 0.44, 0.46), "steel_dark", 0.4, 0.6)
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(steel, (sx * 0.21, sy * 0.42, 0.6), 0.018, 1.2, 6)
    for z in (0.30, 0.65, 1.00):
        box(steel, (0, 0, z), (0.5, 0.92, 0.02))
        box(dark, (0, 0, z - 0.025), (0.44, 0.86, 0.03))
    for z, count in ((0.33, 3), (0.68, 3)):
        for k in range(count):
            box(tray, (-0.09 + k * 0.09, 0, z + k * 0.024), (0.3, 0.42, 0.016))
    box(steel, (0, 0.42, 0.1), (0.5, 0.03, 0.03))
    box(steel, (0, -0.42, 0.1), (0.5, 0.03, 0.03))
    box(steel, (0, 0, 1.17), (0.5, 0.92, 0.03))          # 顶 tray 台面


def build_window_bay():
    """左侧落地高窗框 + 窗台 + 铸铁暖气片（不含玻璃；玻璃由场景程序化面片负责）。
    总高 4.08：窗框占 0.84~4.08（对齐程序化墙洞），暖气片落地 0~0.8。
    朝向：框体贴 x≈0 平面、沿 Blender y 展开 3.9 宽，暖气片凸向 +x（室内）。"""
    frame = mat(PAINT_FRAME, "frame", 0.55, 0.25)
    sill = mat((0.74, 0.74, 0.71), "sill", 0.7)
    iron = mat(IRON_WHITE, "iron", 0.66, 0.12)
    # 窗框：两侧竖梃 + 上梃 + 中竖梃 + 两道横梃
    for sy in (-1, 1):
        box(frame, (0, sy * 1.95, 2.46), (0.16, 0.12, 3.24))
    box(frame, (0, 0, 4.02), (0.16, 3.9, 0.12))
    box(frame, (0, 0, 2.46), (0.1, 0.07, 3.1))
    for z in (1.7, 3.0):
        box(frame, (0, 0, z), (0.12, 3.84, 0.07))
    box(sill, (0.1, 0, 0.86), (0.34, 4.0, 0.08))         # 窗台板（凸向室内）
    box(frame, (0, 0, 0.80), (0.14, 3.9, 0.06))          # 窗洞底框
    # 铸铁暖气片：主体 + 竖翅片 + 两腿 + 顶板
    box(iron, (0.14, 0, 0.42), (0.16, 2.6, 0.5))
    for i in range(11):
        box(iron, (0.24, -1.25 + i * 0.25, 0.42), (0.05, 0.09, 0.56))
    for sy in (-1, 1):
        box(iron, (0.14, sy * 1.1, 0.08), (0.2, 0.12, 0.16))
    box(iron, (0.16, 0, 0.72), (0.24, 2.7, 0.04))


def build_vending():
    """尽头墙无品牌自动贩卖机：机身 1.95 高，前面板（−x）亮屏 + 两排抽象色块饮料 + 取物口。"""
    body = mat(VEND_BODY, "vend_body", 0.42, 0.25)
    screen = mat(VEND_SCREEN, "vend_screen", 0.3)
    dark = mat((0.14, 0.16, 0.19), "vend_dark", 0.5, 0.2)
    trim = mat((0.52, 0.56, 0.60), "vend_trim", 0.4, 0.4)
    can_colors = [(0.78, 0.35, 0.30), (0.85, 0.62, 0.28), (0.40, 0.62, 0.45), (0.38, 0.50, 0.68)]
    box(body, (0, 0, 1.0), (0.72, 1.0, 1.6))
    box(body, (0, 0, 1.89), (0.76, 1.04, 0.12))          # 顶盖（顶=1.95）
    box(dark, (0, 0, 0.06), (0.66, 0.94, 0.12))          # 底座
    box(screen, (-0.35, 0.06, 1.30), (0.04, 0.76, 0.56))  # 亮屏展示窗
    box(trim, (-0.34, -0.36, 1.62), (0.06, 0.16, 0.06))   # 投币/按钮柱
    for row in range(2):
        for k in range(4):
            c = mat(can_colors[(row + k) % 4], "can", 0.4, 0.1)
            box(c, (-0.30, -0.27 + k * 0.18, 1.16 + row * 0.28), (0.1, 0.1, 0.2))
    box(dark, (-0.33, 0.1, 0.32), (0.08, 0.5, 0.3))       # 取物口
    box(trim, (-0.36, 0.1, 0.52), (0.03, 0.56, 0.03))


def build_clock():
    """尽头大圆挂钟：直径 0.62，面朝 Blender −y（导出后朝 three +z，正对室内）。"""
    rim = mat((0.28, 0.30, 0.32), "clock_rim", 0.45, 0.35)
    face = mat(CLOCK_FACE, "clock_face", 0.6)
    hand = mat((0.20, 0.21, 0.23), "clock_hand", 0.5, 0.2)
    cyl(rim, (0, 0, 0), 0.31, 0.06, 12, rot=(math.pi / 2, 0, 0))
    cyl(face, (0, -0.032, 0), 0.275, 0.012, 12, rot=(math.pi / 2, 0, 0))
    box(hand, (0, -0.045, 0.075), (0.018, 0.012, 0.19))    # 分针（竖直向上偏 +z）
    box(hand, (0.05, -0.045, -0.02), (0.13, 0.012, 0.022))  # 时针
    for i in range(4):                                      # 四向刻度
        a = i * math.pi / 2
        box(hand, (math.sin(a) * 0.235, -0.042, math.cos(a) * 0.235),
            (0.02 if i % 2 == 0 else 0.05, 0.008, 0.05 if i % 2 == 0 else 0.02))


# ---------------------------------------------------------------------------
# 烘焙与导出
# ---------------------------------------------------------------------------

def join_parts(name):
    for obj in PARTS:
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world
    call_op("object.select_all", action="DESELECT")
    base = max(PARTS, key=lambda obj: len(obj.data.vertices))
    for obj in PARTS:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = base
    if len(PARTS) > 1:
        call_op("object.join")
    call_op("object.transform_apply", location=True, rotation=True, scale=True)
    base.name = name
    PARTS.clear()
    return base


def ground(obj):
    """底面贴 z=0（挂钟等壁挂件也贴 0，运行时由 canteen.ts 决定挂高）。"""
    low, _ = bounds(obj)
    if abs(low[2]) > 1e-5:
        obj.data.transform(Matrix.Translation(Vector((0.0, 0.0, -low[2]))))


def setup_world():
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    world = scene.world or bpy.data.worlds.new("kit_world")
    scene.world = world
    try:
        world.use_nodes = True
    except AttributeError:
        pass
    background = world.node_tree.nodes.get("Background")
    if background is not None:
        background.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
        background.inputs["Strength"].default_value = 1.0
    try:
        world.light_settings.use_ambient_occlusion = True
        world.light_settings.ao_factor = 1.0
        world.light_settings.distance = AO_DISTANCE
    except AttributeError as error:
        log(f"  [警告] AO 世界设置失败：{error}")


def vertex_ao_colors(obj):
    """把成品色 + 烘焙 AO 写进 COLOR_0 顶点色（零贴图路线）。

    AO 用物体空间射线采样：每个多边形沿法线半球打 5 条短射线，未命中比例即可见度；
    再加落地高度梯度（脚底/贴地处压暗）与底面压暗，等价于低模的烘焙 AO，
    柱子竖棱之间的凹槽、桌底、椅座下都会自然沉下去。glTF 导出为 COLOR_0，
    three 侧 vertexColors 自动生效，清单 tint 用白色不再二次偏色。
    """
    mesh = obj.data
    colors = mesh.color_attributes.new(name="Col", type="BYTE_COLOR", domain="CORNER")
    directions = [Vector((0, 0, 0))]
    for tilt in (0.7,):
        for ang in (0, math.pi / 2, math.pi, -math.pi / 2):
            directions.append(Vector((math.cos(ang) * tilt, math.sin(ang) * tilt, 0.55)).normalized())
    base_by_slot = []
    for slot in obj.material_slots:
        bsdf = None
        if slot.material and slot.material.node_tree:
            bsdf = next((n for n in slot.material.node_tree.nodes
                         if n.bl_idname == "ShaderNodeBsdfPrincipled"), None)
        rgb = tuple(bsdf.inputs["Base Color"].default_value[:3]) if bsdf else (0.7, 0.7, 0.7)
        base_by_slot.append(rgb)
    low, high = bounds(obj)
    height = max(1e-4, high[2] - low[2])
    for poly in mesh.polygons:
        rgb = base_by_slot[poly.material_index] if poly.material_index < len(base_by_slot) else (0.7, 0.7, 0.7)
        normal = poly.normal
        center = poly.center
        hits = 0
        for direction in directions:
            ray = (normal + direction).normalized() if direction.length_squared > 0 else normal.copy()
            hit, _loc, _nrm, _idx = obj.ray_cast(center + ray * 0.004, ray, distance=0.22)
            if hit:
                hits += 1
        ao = 1.0 - 0.62 * (hits / float(len(directions)))
        if normal.z < -0.4:
            ao *= 0.72                                   # 朝下的面（桌底/座底/台底）
        ground_fade = min(1.0, (center.z - low[2]) / (height * 0.16 + 1e-4))
        ao *= 0.62 + 0.38 * min(1.0, ground_fade)        # 落地接触阴影梯度
        if normal.z > 0.6:
            ao = min(1.06, ao * 1.06)                    # 朝天的面轻微提亮
        for loop_index in poly.loop_indices:
            colors.data[loop_index].color = (
                min(1.0, rgb[0] * ao), min(1.0, rgb[1] * ao), min(1.0, rgb[2] * ao), 1.0)
    log(f"  [顶点AO] {len(mesh.polygons)} 面写入 COLOR_0")


def single_material(obj, roughness, metallic):
    material = bpy.data.materials.new(f"{obj.name}_mat")
    try:
        material.use_nodes = True
    except AttributeError:
        pass
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    bsdf.inputs["Roughness"].default_value = roughness
    if bsdf.inputs.get("Metallic") is not None:
        bsdf.inputs["Metallic"].default_value = metallic
    obj.data.materials.clear()
    obj.data.materials.append(material)
    for stale in [m for m in bpy.data.materials if m.users == 0]:
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
        export_extras=False,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_unused_images=False,
        export_jpeg_quality=JPEG_QUALITY,
    )


def render_previews(obj, tag):
    """两件检查图：正视 + 三分之四侧视（CYCLES，无头模式下工作台引擎会出白图）。"""
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    scene = bpy.context.scene
    scene.cycles.samples = 24
    scene.render.resolution_x = 640
    scene.render.resolution_y = 480
    world = scene.world
    background = world.node_tree.nodes.get("Background")
    if background is not None:
        background.inputs["Color"].default_value = (0.10, 0.11, 0.14, 1.0)
        background.inputs["Strength"].default_value = 1.0
    camera_data = bpy.data.cameras.new("preview_cam")
    camera_data.lens = 60
    camera = bpy.data.objects.new("preview_cam", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    sun = bpy.data.objects.new("preview_sun", bpy.data.lights.new("preview_sun", "SUN"))
    sun.data.energy = 3.2
    sun.rotation_euler = tuple(math.radians(v) for v in (52, 8, 40))
    scene.collection.objects.link(sun)
    low, high = bounds(obj)
    center = Vector(((low[0] + high[0]) / 2, (low[1] + high[1]) / 2, (low[2] + high[2]) * 0.45))
    span = max(high[0] - low[0], high[1] - low[1], high[2] - low[2])
    distance = span * 2.1 + 0.8
    for name, direction in (("front", Vector((0.0, -distance, span * 0.35))),
                            ("three_quarter", Vector((distance * 0.7, -distance * 0.7, span * 0.55)))):
        camera.location = center + direction
        camera.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
        scene.render.filepath = os.path.join(PREVIEW_DIR, f"{tag}_{name}.png")
        call_op("render.render", write_still=True)
    log(f"  [预览] {PREVIEW_DIR}/{tag}_*.png")


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

PROPS = [
    # (文件名, 建模函数, 面数预算, 图集边长, roughness, metallic, 高度校验(min,max), 预览)
    ("prop_canteen_set", build_set, 1000, 512, 0.62, 0.18, (0.94, 0.97), True),
    ("prop_canteen_column", build_column, 300, 256, 0.84, 0.0, (4.45, 4.55), True),
    ("prop_canteen_tray_rack", build_tray_rack, 500, 256, 0.36, 0.62, (1.15, 1.25), True),
    ("prop_canteen_window_bay", build_window_bay, 450, 256, 0.6, 0.15, (4.02, 4.12), True),
    ("prop_canteen_vending", build_vending, 380, 256, 0.42, 0.22, (1.9, 2.0), True),
    ("prop_canteen_clock", build_clock, 180, 256, 0.5, 0.25, (0.6, 0.64), False),
]


def main():
    parser = argparse.ArgumentParser(description="食堂低模套件程序化生产")
    parser.add_argument("--preview", action="store_true", help="每件渲染两张检查图到 .tmp/preview/canteen/")
    parser.add_argument("--only", default="", help="只跑文件名含此子串的道具")
    args, _ = parser.parse_known_args([a for a in sys.argv[1:] if a != "--"])
    args.preview = args.preview or "--preview" in sys.argv

    os.makedirs(OUT_DIR, exist_ok=True)
    rows = []
    for name, builder, budget, atlas, roughness, metallic, height_band, preview in PROPS:
        if args.only and args.only not in name:
            continue
        log(f"[{name}] 开始建模")
        call_op("wm.read_homefile", use_empty=True)
        MATERIALS.clear()
        bpy.context.scene.unit_settings.system = "METRIC"
        setup_world()
        builder()
        obj = join_parts(name)
        ground(obj)
        tris = tri_count(obj.data)
        low, high = bounds(obj)
        height = high[2] - low[2]
        if not (height_band[0] <= height <= height_band[1]):
            raise RuntimeError(f"{name} 高度 {height:.3f} 不在校验带 {height_band}")
        if tris > budget:
            raise RuntimeError(f"{name} 面数 {tris} 超预算 {budget}")
        vertex_ao_colors(obj)
        single_material(obj, roughness, metallic)
        out_path = os.path.join(OUT_DIR, f"{name}.glb")
        export_glb(obj, out_path)
        size_kb = os.path.getsize(out_path) / 1024.0
        log(f"[{name}] 面数 {tris}/{budget} 高 {height:.3f}m 导出 {size_kb:.1f} KB（复压前）")
        if args.preview and preview:
            render_previews(obj, name)
        rows.append((name, tris, budget, height, size_kb))

    log("\n【食堂套件汇总（复压前）】")
    total = 0.0
    for name, tris, budget, height, size_kb in rows:
        total += size_kb
        log(f"  {name}: {tris}/{budget} 面  高 {height:.3f}m  {size_kb:.1f} KB")
    log(f"  合计 {total:.1f} KB（meshopt 复压后应再降 30%~60%）")
    log("下一步：npx gltf-transform meshopt public/models/props/<file>.glb <同一文件> --level high")


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()
