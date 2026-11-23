# -*- coding: utf-8 -*-
"""tools/blender_canteen_set.py —— 食堂「一桌四椅」套装的无头合成 + 单图集烘焙。

为什么要合成：`src/world/resources.ts` 的 loadPropModel 遇到 meshes.length>1 或 materials>1
直接返回 null（挂不上），而食堂 S12 的贴图账已经到 25/25 上限。所以餐桌和餐椅不能各自是一件
道具，必须并进同一个网格、共用同一张底图，占用原 prop_canteen_table 的那一个道具位与那一张贴图。

运行（Blender 不在 PATH，用绝对路径；在项目根目录）：
    "D:/千问比赛/新建文件夹/blender.exe" --background --python tools/blender_canteen_set.py -- --preview
前置：node tools/fetchProps.mjs 已把两件 CC0 原始素材落到 art/props_raw/。

产物 art/props_raw/prop_canteen_set.glb 只算「原始素材」，还要再过一遍标准化流水线：
    "D:/千问比赛/新建文件夹/blender.exe" --background --python tools/blender_prop_pipeline.py -- \
        --only canteen_set --tri-target 1000 --tri-soft-limit 1100
    npx gltf-transform meshopt public/models/props/prop_canteen_set.glb <同一文件> --level high
1000 面是账算出来的上限：S12 的六张位表要同时守住 232 DrawCall / 30000 面 / 25 张贴纸，
套装替掉的程序化桌板+椅腿+座面只腾出 6×1000 的口子，再高就顶穿。

摆放口径（Blender 是 Z 轴向上；导出 glTF 后 three 里 x=Blender x、y=Blender z、z=−Blender y）：
  · 整包按椅背 0.956 m 归一化，桌面顶因此落在 0.783 m，桌面小道具（托盘/碗/瓶/纸巾盒）的位移表沿用这个值。
  · 四把椅子落在 three 的 (x±0.70, z±0.92) —— 与程序化座椅、与 STUDENTS 坐姿站位同一套位表。
  · 椅子按真实尺度 1.0 摆放（靠背 0.956 m），不用桌子的缩放系数，否则座高只有 0.37 m，人坐不住。
"""

import argparse
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TABLE_RAW = os.path.join(REPO, "art", "props_raw", "prop_canteen_table_raw.glb")
CHAIR_RAW = os.path.join(REPO, "art", "props_raw", "prop_canteen_chair_raw.glb")
OUT_PATH = os.path.join(REPO, "art", "props_raw", "prop_canteen_set.glb")
PREVIEW_DIR = os.path.join(REPO, ".tmp", "canteen_set")
# 烘焙出来的内部图像是 generated 的 RGBA，glTF 导出器的 AUTO 分支只认「源文件本来就是 JPEG」，
# 直接导出会写 188KB 的 PNG。先落一张 JPEG 中间图再 load 回来，流水线那侧才会走 JPEG 重打包。
ATLAS_SRC = os.path.join(PREVIEW_DIR, "atlas_src.jpg")

# 现网成品：painted_wooden_table 原始包围高 0.958 m，归一化到 0.782 m（propManifest.heightM）。
TABLE_SOURCE_HEIGHT = 0.958
TABLE_TARGET_HEIGHT = 0.782
CHAIR_SCALE = 1.0
# (Blender x, Blender y, yaw)。Blender +y 对应 three −z，椅背在 +y 侧，所以 y=−0.92 的两把要转 180°。
SEATS = [(0.70, -0.92, math.pi), (-0.70, -0.92, math.pi), (0.70, 0.92, 0.0), (-0.70, 0.92, 0.0)]
# 校验椅背用的两条判据带：整包最高点是椅背 0.956，桌面顶 0.783，所以 z>0.80 只有椅背；
# 座面在 0.40~0.60 之间。椅背必须落在离桌心更远的一侧（|背| > |座位| − 容差）。
BACKREST_BAND_Z = 0.80
SEAT_BAND_Z = (0.40, 0.60)

ATLAS_SIZE = 1024
# 两张格子都不做非等比拉伸：桌面大、椅子小，各按一个系数整体缩放。
# 分成 0.60 / 0.36 两块方格（中间留 2% 空隙防烘焙 margin 串色）：1024 烘焙后桌面约 614px、
# 椅子约 369px，流水线再压到 512 仍分别有 307/184px，比程序化纯色椅子仍是净提升。
TABLE_UV = (0.60, 0.60, 0.01, 0.01)
CHAIR_UV = (0.36, 0.36, 0.63, 0.63)
BAKE_MARGIN = 8
OUT_ROUGHNESS = 0.86


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
    dropped = [key for key in kwargs if key not in known]
    for key in dropped:
        kwargs.pop(key)
    if dropped:
        log(f"  [算子] {op_path} 忽略本机不支持的参数：{','.join(sorted(dropped))}")
    return op(**kwargs)


def select_only(obj):
    bpy.ops.object.select_all(action="DESELECT")
    if obj is not None:
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj


def tri_count(mesh):
    mesh.calc_loop_triangles()
    return len(mesh.loop_triangles)


def bounds(obj):
    matrix = [list(row) for row in obj.matrix_world]
    low, high = [1e18] * 3, [-1e18] * 3
    for vertex in obj.data.vertices:
        point = matrix_world_point(matrix, vertex.co)
        for axis in range(3):
            low[axis] = min(low[axis], point[axis])
            high[axis] = max(high[axis], point[axis])
    return tuple(low), tuple(high)


def matrix_world_point(matrix, co):
    return (
        co.x * matrix[0][0] + co.y * matrix[1][0] + co.z * matrix[2][0] + matrix[3][0],
        co.x * matrix[0][1] + co.y * matrix[1][1] + co.z * matrix[2][1] + matrix[3][1],
        co.x * matrix[0][2] + co.y * matrix[1][2] + co.z * matrix[2][2] + matrix[3][2],
    )


def import_meshes(path):
    """导入一个 glb，摊平父级变换，返回 (网格物体列表, 网格物体集合)。"""
    before = set(bpy.data.objects)
    call_op("import_scene.gltf", filepath=path)
    created = [obj for obj in bpy.data.objects if obj not in before]
    for obj in [o for o in created if o.type != "MESH"]:
        bpy.data.objects.remove(obj, do_unlink=True)
    meshes = [obj for obj in created if obj.type == "MESH"]
    for obj in meshes:
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world
    if not meshes:
        raise RuntimeError(f"{os.path.basename(path)} 里没有网格")
    return meshes


def merge_to_one(meshes, name):
    select_only(None)
    base = max(meshes, key=lambda obj: len(obj.data.vertices))
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = base
    if len(meshes) > 1:
        call_op("object.join")
    call_op("object.transform_apply", location=True, rotation=True, scale=True)
    base.name = name
    return base


def scale_uvs(obj, su, sv, ou, ov):
    layer = obj.data.uv_layers.active
    if layer is None:
        raise RuntimeError(f"{obj.name} 没有 UV 层，无法并图集")
    import numpy as np

    flat = np.empty(len(layer.data) * 2, dtype=np.float32)
    layer.data.foreach_get("uv", flat)
    flat[0::2] = flat[0::2] * su + ou
    flat[1::2] = flat[1::2] * sv + ov
    layer.data.foreach_set("uv", flat)
    return int(len(layer.data) * 0.5)


def place_chair(obj, x, y, yaw):
    """按位表摆一把椅子。

    必须显式把 rotation_mode 切到 XYZ：glTF 导入器给物体留的是 QUATERNION 模式，
    那种模式下写 rotation_euler 只改面板上的欧拉值、不参与世界矩阵，
    于是 y=−0.92 那两排的 180° 会静默失效——现网就栽过一次（椅背全部朝桌子）。
    """
    obj.rotation_mode = "XYZ"
    obj.rotation_euler = (0.0, 0.0, yaw)
    obj.location = (x, y, 0.0)
    bpy.context.view_layer.update()
    return obj


def verify_seat_facing(obj):
    """逐排核对椅背是否落在离桌心更远的一侧，不通过直接抛错，避免又出一版反着摆的套装。"""
    rows = {}
    for vertex in obj.data.vertices:
        x, y, z = vertex.co
        if abs(y) < 0.55:
            continue  # 桌身（|y|≤0.47）不参与判定，只剩四把椅子的两条 y 排
        side = 1 if y > 0 else -1
        row = rows.setdefault(side, {"back": [0.0, 0], "seat": [0.0, 0]})
        if z > BACKREST_BAND_Z:
            row["back"][0] += y
            row["back"][1] += 1
        elif SEAT_BAND_Z[0] < z < SEAT_BAND_Z[1]:
            row["seat"][0] += y
            row["seat"][1] += 1
    for side, row in sorted(rows.items()):
        if not row["back"][1] or not row["seat"][1]:
            raise RuntimeError(f"y{'+' if side > 0 else '−'} 排没采到椅背或座面，无法判定朝向")
        back_mean = row["back"][0] / row["back"][1]
        seat_mean = row["seat"][0] / row["seat"][1]
        log(f"  [朝向] y{'+' if side > 0 else '-'} 排 椅背均值 {back_mean:+.3f} 座面均值 {seat_mean:+.3f}")
        if abs(back_mean) <= abs(seat_mean):
            raise RuntimeError(
                f"y{'+' if side > 0 else '−'} 排椅背（{back_mean:+.3f}）比座面（{seat_mean:+.3f}）更靠桌子，椅子摆反了")
    return True


def set_origin_bottom(obj, center_xy=True):
    """把物体原点放到底面（可选同时居中 XY）：椅子复制体是以原点为轴摆放的，XY 必须落在座面中心。"""
    low, high = bounds(obj)
    offset = Vector((((low[0] + high[0]) / 2.0 if center_xy else 0.0),
                     ((low[1] + high[1]) / 2.0 if center_xy else 0.0), low[2]))
    obj.data.transform(Matrix.Translation(offset))
    obj.location = (0.0, 0.0, 0.0)
    call_op("object.transform_apply", location=True, rotation=True, scale=True)


def bake_atlas(obj, image):
    """把两件源素材各自的底图烘到一张图集上，最终只留一个材质槽。"""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 1
    scene.render.bake.margin = BAKE_MARGIN
    for material in [slot.material for slot in obj.material_slots if slot.material]:
        nodes = material.node_tree.nodes
        node = nodes.new("ShaderNodeTexImage")
        node.image = image
        node.select = True
        material.node_tree.nodes.active = node
    select_only(obj)
    call_op("object.bake", type="DIFFUSE", pass_filter={"COLOR"}, use_clear=True)
    log(f"  [烘焙] {image.name} {image.size[0]}×{image.size[1]} 完成")


def save_jpeg(image):
    """烘焙结果先落一张 JPEG 中间图再读回来：导出器的 AUTO 分支只认源格式已经是 JPEG 的底图。"""
    os.makedirs(os.path.dirname(ATLAS_SRC), exist_ok=True)
    image.file_format = "JPEG"
    image.filepath_raw = ATLAS_SRC
    image.save()
    baked = bpy.data.images.load(ATLAS_SRC)
    baked.name = image.name
    baked.colorspace_settings.name = "sRGB"
    log(f"  [图集] {ATLAS_SRC} {os.path.getsize(ATLAS_SRC) / 1024.0:.1f} KB")
    return baked


def single_material(obj, image, name):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    for identifier, value in (("Roughness", OUT_ROUGHNESS), ("Metallic", 0.0)):
        socket = bsdf.inputs.get(identifier)
        if socket is not None:
            socket.default_value = value
    obj.data.materials.clear()
    obj.data.materials.append(material)
    return material


def export_glb(obj, path):
    select_only(obj)
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
    )


def render_previews(path):
    """出两张检查图：正视（查椅子朝向）与三分之四侧视（查整体比例）。

    用 CYCLES 而不是 BLENDER_WORKBENCH：无头模式没有 OpenGL 上下文，工作台引擎会出一张纯白图。
    """
    os.makedirs(path, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.render.resolution_x = 760
    scene.render.resolution_y = 560
    world = scene.world or bpy.data.worlds.new("preview_world")
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background is None:
        background = world.node_tree.nodes.new("ShaderNodeBackground")
        output = next((n for n in world.node_tree.nodes if n.type == "OUTPUT_WORLD"), None)
        if output is not None:
            world.node_tree.links.new(background.outputs["Background"], output.inputs["Surface"])
    background.inputs["Color"].default_value = (0.05, 0.05, 0.06, 1.0)
    background.inputs["Strength"].default_value = 1.0
    camera_data = bpy.data.cameras.new("preview")
    camera_data.lens = 60
    camera = bpy.data.objects.new("preview", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    for angle, energy in (((55, 0, 35), 4.0), ((-40, 0, 150), 1.5)):
        sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
        sun.data.energy = energy
        scene.collection.objects.link(sun)
        sun.rotation_euler = tuple(math.radians(v) for v in angle)
    low, high = bounds([obj for obj in bpy.data.objects if obj.type == "MESH"][0])
    center = Vector(((low[0] + high[0]) / 2.0, (low[1] + high[1]) / 2.0, (low[2] + high[2]) * 0.45))
    for name, direction in (("front", Vector((0.0, -4.6, 1.5))), ("three_quarter", Vector((3.2, -3.2, 1.9)))):
        camera.location = center + direction
        camera.rotation_euler = (direction.to_track_quat("Z", "Y")).to_euler()
        scene.render.filepath = os.path.join(path, f"canteen_set_{name}.png")
        call_op("render.render", write_still=True)
    log(f"  [预览] {path}")


def main():
    parser = argparse.ArgumentParser(description="食堂一桌四椅套装合成与图集烘焙")
    parser.add_argument("--preview", action="store_true", help="额外渲染两张检查图到 .tmp/canteen_set/")
    parser.add_argument("--atlas", type=int, default=ATLAS_SIZE, help="图集边长，默认 1024")
    args, _ = parser.parse_known_args([a for a in sys.argv[1:] if a != "--"])
    # Blender 把自身命令行也留在 sys.argv 里，parse_known_args 会把 -- 之后的 --preview 当位置参数丢掉。
    args.preview = args.preview or "--preview" in sys.argv

    for path in (TABLE_RAW, CHAIR_RAW):
        if not os.path.exists(path):
            raise RuntimeError(f"缺少原始素材：{path}（先跑 node tools/fetchProps.mjs）")

    call_op("wm.read_homefile", use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0

    table = merge_to_one(import_meshes(TABLE_RAW), "set_table")
    table_scale = TABLE_TARGET_HEIGHT / TABLE_SOURCE_HEIGHT
    table.scale = (table_scale, table_scale, table_scale)
    call_op("object.transform_apply", location=True, rotation=True, scale=True)
    table_low, table_high = bounds(table)
    log(f"[桌子] 缩放 {table_scale:.4f} → 高 {table_high[2] - table_low[2]:.3f}m "
        f"占地 {(table_high[0] - table_low[0]):.2f}×{(table_high[1] - table_low[1]):.2f}m")
    scale_uvs(table, *TABLE_UV)

    chair_meshes = import_meshes(CHAIR_RAW)
    chair = merge_to_one(chair_meshes, "set_chair")
    chair.scale = (CHAIR_SCALE,) * 3
    call_op("object.transform_apply", location=True, rotation=True, scale=True)
    set_origin_bottom(chair, center_xy=False)
    chair_low, chair_high = bounds(chair)
    log(f"[椅子] 高 {chair_high[2] - chair_low[2]:.3f}m 占地 "
        f"{chair_high[0] - chair_low[0]:.2f}×{chair_high[1] - chair_low[1]:.2f}m")
    scale_uvs(chair, *CHAIR_UV)

    copies = [place_chair(chair, *SEATS[0])]
    for seat in SEATS[1:]:
        copy = chair.copy()
        copy.data = chair.data
        scene.collection.objects.link(copy)
        copies.append(place_chair(copy, *seat))
    select_only(None)
    for copy in copies:
        copy.select_set(True)
    bpy.context.view_layer.objects.active = chair
    call_op("object.join")
    chairs = bpy.context.view_layer.objects.active
    chairs.name = "set_chairs"
    call_op("object.transform_apply", location=True, rotation=True, scale=True)
    verify_seat_facing(chairs)

    select_only(None)
    table.select_set(True)
    chairs.select_set(True)
    bpy.context.view_layer.objects.active = table
    call_op("object.join")
    prop = bpy.context.view_layer.objects.active
    prop.name = "prop_canteen_set"
    set_origin_bottom(prop)
    low, high = bounds(prop)
    log(f"[套装] 面数 {tri_count(prop.data)} 高 {high[2] - low[2]:.3f}m 占地 "
        f"{high[0] - low[0]:.2f}×{high[1] - low[1]:.2f}m 材质槽 {len(prop.material_slots)}")
    if high[2] - low[2] < 0.9 or high[2] - low[2] > 1.05:
        raise RuntimeError("套装总高不在 0.9~1.05m，椅子或桌子的尺度算错了")

    image = bpy.data.images.new("canteen_set_atlas", args.atlas, args.atlas, alpha=False)
    image.colorspace_settings.name = "sRGB"
    bake_atlas(prop, image)
    atlas = save_jpeg(image)
    single_material(prop, atlas, "canteen_set")
    log(f"[烘焙] 图集 {atlas.size[0]}px JPEG，材质槽 {len(prop.material_slots)}")

    export_glb(prop, OUT_PATH)
    log(f"[产物] {OUT_PATH} {os.path.getsize(OUT_PATH) / 1024.0:.1f} KB")
    if args.preview:
        render_previews(PREVIEW_DIR)


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()
