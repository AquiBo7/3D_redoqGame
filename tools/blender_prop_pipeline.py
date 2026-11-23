# -*- coding: utf-8 -*-
"""tools/blender_prop_pipeline.py —— 第三方道具的无头（headless）批处理标准化流水线。

运行方式（在项目根目录，Blender 不在 PATH 就用绝对路径）：
    blender --background --python tools/blender_prop_pipeline.py -- --input art/props_raw --output public/models/props
    "D:/千问比赛/新建文件夹/blender.exe" --background --python tools/blender_prop_pipeline.py -- --input art/props_raw --output public/models/props

对 art/props_raw/*.glb 的每一件道具依次做 6 步，原始文件只读不改动：
    1. 清空默认场景 → 导入 .glb → 丢弃灯光/相机/空物体，把零散子网格 join 成单个网格，
       再合并「同底图同参数」的重复材质槽（一个材质 = 一个 primitive = 一次 DrawCall）。
    2. 居中并把最低点贴到世界原点：X/Y 取包围盒中心、最低 Z 归零，避免道具悬空或穿进 Three.js 地板。
    3. 按文件名前缀查内置真实米制高度表，等比缩放后烘焙变换（Apply All Transforms）。
    4. 统计三角面：> 600 面时自动减面到 <= 500（压缩比 <=20 用平面坍缩保外形，更狠的直接用拓扑坍缩，
       否则薄片零件会被吃掉；扫描类高模按 TRI_TARGET_OVERRIDES 单独放宽，目前只有 bed 1500 面）。
    5. 统一低饱和哑光风：Roughness 钳制 0.80-0.92、Metallic <= 0.15，底图长边缩到 512px 并降饱和；
       与常量粗糙度/金属度冲突的 粗糙度/金属度/法线 贴图链路一并断开（<=500 面的网格挂法线图只会糊），
       透明度链路默认也断开（KEEP_ALPHA），带 alpha 的底图只能存 PNG，一件就要吃掉 240KB。
    6. 导出标准化 .glb 到 public/models/props/，并打印【原面数 -> 减面后 -> 文件体积 KB】汇总表。

导出后还要用 gltf-transform 复压一次才会落进 Step 3 的 10–80KB 窗口（本表那一列是复压前体积）：
    npx gltf-transform meshopt public/models/props/<道具>.glb <同一文件> --level high

可选参数：--only <子串> 单件复跑；--decimate auto|planar|collapse 指定减面手段；
--tri-target <面数> 临时改预算（默认 500，仍受 TRI_TARGET_OVERRIDES 覆盖）。

纯批处理工具：不 import 项目任何业务模块，也不改动 src/ 下的场景代码。
"""

import argparse
import os
import sys

import bpy

# numpy 随 Blender 自带，用于批量处理顶点与贴图像素；缺失时退化成纯 Python + 不降饱和。
try:
    import numpy as np
except Exception:  # pragma: no cover
    np = None

from mathutils import Matrix, Vector

# ---------------------------------------------------------------------------
# 可调参数（与 docs/美术优化素材与提示词包.md 的「瘦身关」保持一致）
# ---------------------------------------------------------------------------

# 真实米制目标高度表：键是 prop_<键>.glb 里 <键> 的词元，值是整个道具的站立高度（米）。
TARGET_HEIGHTS = {
    "street_lamp": 4.2,
    "bed": 0.9,
    "desk": 0.75,
    "backpack": 0.45,
    "trashcan": 0.85,
    "bench": 0.8,
    "chair": 0.85,
    "suitcase": 0.65,
    "stationery": 0.18,
    "canteen_table": 0.78,
    # 一桌四椅套装：整包最高点是椅背 0.956m，桌面因此落在 0.783m，与 TABLE_TOP_PROP 常量一致。
    "canteen_set": 0.956,
    "tree": 4.5,
}

TRI_SOFT_LIMIT = 600        # 超过这个三角面才动刀，本来就在预算内的道具不二次损伤
TRI_TARGET = 500            # 手机 iGPU 60fps 的单道具预算
# 个别源模型面数极高，500 面会把零件直接削没：old_bed_frame 原始 49990 面，压到 500 后
# 只剩两头框架、床板条全部消失（见 .tmp 目检），1500 面才看得出是一张床，且复压后 68.6KB
# 仍在 Step 3 的 10–80KB 窗口内。放宽只针对这类前缀，其余道具仍守 500 面红线。
TRI_TARGET_OVERRIDES = {"bed": 1500}
ROUGHNESS_RANGE = (0.80, 0.92)
ROUGHNESS_FALLBACK = 0.86   # 粗糙度由贴图驱动、拿不到单值时采用的哑光中值
METALLIC_MAX = 0.15
# 手机端半透明要额外排序开销，而且带 alpha 的底图只能存 PNG（实测 512px 就要 240KB）。
# 关掉后统一按不透明哑光导出；确实需要玻璃/布料的透明度时再把开关置 True。
KEEP_ALPHA = False
TEX_MAX_EDGE = 512          # Step 3 明确要求：带 4K 巨型贴图的道具缩到 512px
JPEG_QUALITY = 78
SATURATION_MAX = 0.45       # 线性空间下「(顶色-基色) p90 / 亮度 p90」，只拦真正刺眼的高饱和
SATURATION_TARGET = 0.30
PLANAR_ANGLE_MIN = 0.0175   # 1°，平面坍缩角度下限
PLANAR_ANGLE_MAX = 0.5236   # 30°
PLANAR_RATIO_LIMIT = 20.0   # 压缩比超过它平面坍缩会吃掉薄片零件，改用拓扑坍缩
SIZE_WINDOW = (10, 80)      # KB，Step 3 的单道具体积验收区间

PRINCIPLED = "ShaderNodeBsdfPrincipled"
STATS = {"roughness": 0, "metallic": 0, "normal": 0, "textures": 0, "resized": 0, "desat": 0}


# ---------------------------------------------------------------------------
# 通用小工具
# ---------------------------------------------------------------------------

def log(message):
    text = str(message)
    try:
        print(text, flush=True)
    except UnicodeEncodeError:
        print(text.encode("ascii", "replace").decode("ascii"), flush=True)


def call_op(op_path, **kwargs):
    """只把当前 Blender 版本认识的参数传给算子：4.x 与 5.x 的算子签名并不完全一致。"""
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
    """世界包围盒（Blender 是行向量约定 v' = v @ M）。"""
    count = len(obj.data.vertices)
    matrix = [list(row) for row in obj.matrix_world]
    if np is not None:
        flat = np.empty(count * 3, dtype=np.float32)
        obj.data.vertices.foreach_get("co", flat)
        points = flat.reshape(-1, 3).astype(np.float64)
        rotation = np.array([row[:3] for row in matrix[:3]], dtype=np.float64)
        points = points @ rotation + np.array(matrix[3][:3], dtype=np.float64)
        return tuple(float(v) for v in points.min(axis=0)), tuple(float(v) for v in points.max(axis=0))
    flat = [0.0] * (count * 3)
    obj.data.vertices.foreach_get("co", flat)
    low, high = [1e18] * 3, [-1e18] * 3
    for index in range(count):
        x, y, z = flat[index * 3 : index * 3 + 3]
        point = [
            x * matrix[0][0] + y * matrix[1][0] + z * matrix[2][0] + matrix[3][0],
            x * matrix[0][1] + y * matrix[1][1] + z * matrix[2][1] + matrix[3][1],
            x * matrix[0][2] + y * matrix[1][2] + z * matrix[2][2] + matrix[3][2],
        ]
        for axis in range(3):
            low[axis] = min(low[axis], point[axis])
            high[axis] = max(high[axis], point[axis])
    return tuple(low), tuple(high)


def height_key(stem):
    """按文件名前缀在高度表里查真实米制高度：prop_street_lamp -> street_lamp -> 4.2。"""
    name = stem.lower()
    if name.startswith("prop_"):
        name = name[5:]
    tokens = name.replace("-", "_").split("_")
    for key in sorted(TARGET_HEIGHTS, key=len, reverse=True):
        parts = key.split("_")
        if key == name or tokens[: len(parts)] == parts or all(part in tokens for part in parts):
            return TARGET_HEIGHTS[key], key
    return None, None


def display_width(text):
    return sum(2 if ord(char) > 0x2E80 else 1 for char in str(text))


def pad(text, width):
    return str(text) + " " * max(0, width - display_width(text))


# ---------------------------------------------------------------------------
# 第 1 步：导入并合并子网格
# ---------------------------------------------------------------------------

def import_and_merge(path, name):
    call_op("wm.read_homefile", use_empty=True)
    call_op("import_scene.gltf", filepath=path)
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("文件里没有任何网格")
    # 灯/相机/空物体属于场景布置而不是道具本体，先清掉，否则 join 会把它们一起吞进来或报错。
    for obj in [o for o in bpy.data.objects if o.type != "MESH"]:
        bpy.data.objects.remove(obj, do_unlink=True)
    raw_tris = sum(tri_count(obj.data) for obj in meshes)
    # 父级变换先摊平到物体自身，join 才会把世界坐标正确写进主网格。
    for obj in meshes:
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world
    select_only(None)
    base = max(meshes, key=lambda obj: len(obj.data.vertices))
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = base
    if len(meshes) > 1:
        call_op("object.join")
    call_op("object.transform_apply", location=True, rotation=True, scale=True)
    base.name = name
    return base, raw_tris, len(meshes)


# ---------------------------------------------------------------------------
# 第 2、3 步：贴地居中 + 真实尺度
# ---------------------------------------------------------------------------

def ground_center_and_scale(obj, target_h):
    low, high = bounds(obj)
    obj.data.transform(Matrix.Translation(Vector(((low[0] + high[0]) / 2.0, (low[1] + high[1]) / 2.0, low[2]))))
    low, high = bounds(obj)
    current = high[2] - low[2]
    if current <= 1e-6:
        raise RuntimeError("包围盒高度为 0，无法缩放")
    scale = target_h / current
    obj.data.transform(Matrix.Scale(scale, 4))
    return scale


# ---------------------------------------------------------------------------
# 第 4 步：减面
# ---------------------------------------------------------------------------

def _evaluated_tris(obj):
    deps = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(deps)
    mesh = evaluated.to_mesh()
    tris = tri_count(mesh)
    evaluated.to_mesh_clear()
    return tris


def _bake(obj):
    """把修改器结果写回网格本体，避免导出阶段再算一遍。"""
    deps = bpy.context.evaluated_depsgraph_get()
    new_mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(deps), depsgraph=deps)
    old = obj.data
    obj.modifiers.clear()
    obj.data = new_mesh
    if old.users == 0:
        bpy.data.meshes.remove(old)


def reduce_triangles(obj, raw_tris, mode="auto", tri_target=TRI_TARGET, soft_limit=TRI_SOFT_LIMIT):
    """返回 (最终面数, 手段)。

    平面坍缩（DISSOLVE）只合并共面三角形，保硬边外形、几乎不掉特征，适合「高模 + 大平面」；
    但压缩比超过 PLANAR_RATIO_LIMIT 时它会把床板条这类薄片直接吃掉（实测 old_bed_frame
    49990 -> 500 面后只剩两头框架）。所以 auto 模式按压缩比选路：大比例直接走 COLLAPSE，
    它按拓扑整体重分配顶点，薄片能各留几个三角面。
    """
    if raw_tris <= soft_limit:
        return raw_tris, "已在预算内"
    obj.modifiers.clear()
    mod = obj.modifiers.new("decimate", "DECIMATE")
    ratio = raw_tris / float(tri_target)
    use_planar = mode == "planar" or (mode == "auto" and ratio <= PLANAR_RATIO_LIMIT)
    if use_planar:
        mod.decimate_type = "DISSOLVE"
        lo, hi, best = PLANAR_ANGLE_MIN, PLANAR_ANGLE_MAX, None
        for _ in range(7):
            mid = (lo + hi) / 2.0
            mod.angle_limit = mid
            tris = _evaluated_tris(obj)
            if tris <= tri_target:
                hi, best = mid, (mid, tris)
            else:
                lo = mid
        if best:
            mod.angle_limit = best[0]
            _bake(obj)
            return tri_count(obj.data), f"平面坍缩 {best[0]:.1f}"
    mod.decimate_type = "COLLAPSE"
    mod.ratio = tri_target / float(raw_tris)
    _bake(obj)
    return tri_count(obj.data), f"精确坍缩 1:{ratio:.0f}"


def recalc_normals(obj):
    """统一法线朝外，修掉扫描模型常见的翻面；后台模式拿不到编辑上下文时只告警。"""
    try:
        select_only(obj)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode="OBJECT")
        return True
    except Exception as error:  # pragma: no cover
        log(f"  [警告] 法线重算跳过：{error}")
        if bpy.context.object and bpy.context.object.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        select_only(obj)
        return False


# ---------------------------------------------------------------------------
# 第 5 步：统一低饱和哑光材质
# ---------------------------------------------------------------------------

def _principled(material):
    # Blender 5.3 已把 Material.use_nodes 标为废弃，直接判断 node_tree 是否存在。
    if not (material and material.node_tree):
        return None
    for node in material.node_tree.nodes:
        if node.bl_idname == PRINCIPLED:
            return node
    return None


def _unlink(node, identifier):
    socket = node.inputs.get(identifier)
    if socket is None:
        return False
    links = list(socket.links)
    for link in links:
        node.id_data.links.remove(link)
    return len(links) > 0


def _images_feeding(node, identifier):
    """反向遍历节点图，找出真正喂给某个输入端口的所有图像纹理。"""
    socket = node.inputs.get(identifier)
    if socket is None or not socket.links:
        return []
    found, pending, seen = [], list(socket.links), set()
    while pending:
        link = pending.pop()
        source = link.from_node
        if source.name in seen:
            continue
        seen.add(source.name)
        if source.bl_idname == "ShaderNodeTexImage" and source.image:
            found.append(source.image)
        for inp in source.inputs:
            pending.extend(list(inp.links))
    return found


def slim_texture(image, allow_jpeg):
    """底图长边缩到 512px、过高饱和往回拉，最后按 JPEG 重新打包成 GLB 内的紧凑数据。"""
    notes = []
    width, height = int(image.size[0]), int(image.size[1])
    if width <= 1 or height <= 1:
        return "无有效尺寸"
    long_edge = max(width, height)
    if long_edge > TEX_MAX_EDGE:
        ratio = TEX_MAX_EDGE / float(long_edge)
        width = max(1, int(round(width * ratio)))
        height = max(1, int(round(height * ratio)))
        image.scale(width, height)
        STATS["resized"] += 1
        notes.append(f"{long_edge}px 长边 -> {max(width, height)}px")
    if np is None:
        return "；".join(notes + ["缺 numpy，跳过像素处理"])
    try:
        channels = image.channels
        buffer = np.empty(width * height * channels, dtype=np.float32)
        image.pixels.foreach_get(buffer)
        grid = buffer.reshape(-1, channels)
        rgb = grid[:, :3]
        luma = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
        spread = rgb.max(axis=1) - rgb.min(axis=1)
        chroma = float(np.percentile(spread, 90)) / (float(np.percentile(luma, 90)) + 1e-6)
        notes.append(f"饱和度指标 {chroma:.2f}")
        if chroma > SATURATION_MAX:
            mix = SATURATION_TARGET / chroma
            gray = luma.reshape(-1, 1)
            grid[:, :3] = gray + (rgb - gray) * mix
            image.pixels.foreach_set(buffer)
            image.update()
            STATS["desat"] += 1
            notes.append(f"降饱和 mix={mix:.2f}")
    except Exception as error:  # pragma: no cover
        return "；".join(notes + [f"像素处理失败 {error}"])
    if allow_jpeg and image.file_format != "JPEG":
        try:
            image.file_format = "JPEG"
            image.pack()
            notes.append("重打包 JPEG")
        except Exception as error:  # pragma: no cover
            notes.append(f"JPEG 打包失败 {error}")
    elif not allow_jpeg:
        notes.append("保留透明通道 -> PNG")
    return "；".join(notes)


def unify_materials(obj):
    """钳制哑光参数并断开与常量粗糙度冲突的贴图链路，返回处理明细。"""
    report = []
    for slot in obj.material_slots:
        material = slot.material
        node = _principled(material)
        if node is None:
            continue
        name = material.name
        if not KEEP_ALPHA and _unlink(node, "Alpha"):
            report.append(f"{name}：断开透明度链路，统一不透明哑光")
        alpha_socket = node.inputs.get("Alpha")
        has_alpha = KEEP_ALPHA and bool(alpha_socket and alpha_socket.links)
        for identifier, value_if_linked, limit in (
            ("Roughness", ROUGHNESS_FALLBACK, ROUGHNESS_RANGE),
            ("Metallic", 0.0, (0.0, METALLIC_MAX)),
        ):
            socket = node.inputs.get(identifier)
            if socket is None:
                continue
            current = float(socket.default_value)
            linked = _unlink(node, identifier)
            value = value_if_linked if linked else min(max(current, limit[0]), limit[1])
            socket.default_value = value
            STATS[identifier.lower()] += 1
            report.append(f"{name}：{identifier} {'贴图驱动' if linked else f'{current:.2f}'} -> {value:.2f}")
        if _unlink(node, "Normal"):
            STATS["normal"] += 1
            report.append(f"{name}：断开法线贴图（<= {TRI_TARGET} 面挂法线图只会糊）")
        for image in _images_feeding(node, "Base Color"):
            STATS["textures"] += 1
            report.append(f"{name}：底图 {image.name} -> {slim_texture(image, not has_alpha)}")
    return report


def _socket_value(node, identifier, default=0.0):
    socket = node.inputs.get(identifier)
    return round(float(socket.default_value), 3) if socket is not None else default


def _material_signature(material):
    """材质能否合并的判据：同一批底图 + 同一套哑光参数 + 同样的自发光/透明状态。"""
    node = _principled(material)
    if node is None:
        return ("no-node", getattr(material, "name", None))
    images = tuple(sorted({image.name for image in _images_feeding(node, "Base Color")}))
    color_socket = node.inputs.get("Base Color")
    color = tuple(round(float(c), 3) for c in color_socket.default_value) if color_socket else ()
    alpha = node.inputs.get("Alpha")
    return (
        images,
        _socket_value(node, "Roughness"),
        _socket_value(node, "Metallic"),
        _socket_value(node, "Emission Strength"),
        color,
        bool(alpha and alpha.links),
    )


def dedupe_materials(obj):
    """把重复材质槽并成一个：一个材质 = Three.js 里的一个 primitive = 一次 DrawCall。"""
    before = len(obj.material_slots)
    if before < 2:
        return before, before
    order, uniques, remap = {}, [], []
    for slot in obj.material_slots:
        key = _material_signature(slot.material)
        if key not in order:
            order[key] = len(uniques)
            uniques.append(slot.material)
        remap.append(order[key])
    if len(uniques) == before:
        return before, before
    for polygon in obj.data.polygons:
        if polygon.material_index < len(remap):
            polygon.material_index = remap[polygon.material_index]
    obj.data.materials.clear()
    for material in uniques:
        obj.data.materials.append(material)
    return before, len(uniques)


# ---------------------------------------------------------------------------
# 第 6 步：导出
# ---------------------------------------------------------------------------

def export_prop(obj, out_path):
    select_only(obj)
    call_op(
        "export_scene.gltf",
        filepath=out_path,
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


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

def process(path, out_dir, decimate="auto", tri_target=TRI_TARGET, tri_soft_limit=TRI_SOFT_LIMIT):
    stem = os.path.splitext(os.path.basename(path))[0]
    target_h, key = height_key(stem)
    if target_h is None:
        raise RuntimeError("高度表 TARGET_HEIGHTS 里没有这个前缀，请先补一行")
    obj, raw_tris, parts = import_and_merge(path, stem)
    scale = ground_center_and_scale(obj, target_h)
    tri_target = TRI_TARGET_OVERRIDES.get(key, tri_target)
    final_tris, method = reduce_triangles(obj, raw_tris, decimate, tri_target, tri_soft_limit)
    recalc_normals(obj)
    # 减面会把最低点带离原点，贴地必须按最终网格再做一次，才能保证导出文件里底面确实落在 0。
    sink = bounds(obj)[0][2]
    if abs(sink) > 1e-4:
        obj.data.transform(Matrix.Translation(Vector((0.0, 0.0, -sink))))
    report = unify_materials(obj)
    mats_before, mats_after = dedupe_materials(obj)
    for material in [item for item in bpy.data.materials if item.users == 0]:
        bpy.data.materials.remove(material)
    out_path = os.path.join(out_dir, f"{stem}.glb")
    export_prop(obj, out_path)
    low, high = bounds(obj)
    return {
        "name": stem,
        "raw": raw_tris,
        "tris": final_tris,
        "budget": tri_target,
        "method": method,
        "parts": f"{parts}->1",
        "mats": f"{mats_before}->{mats_after}",
        "height": f"{high[2] - low[2]:.2f}m/{key}",
        "scale": f"{scale:.3f}",
        "size": os.path.getsize(out_path) / 1024.0,
        "foot": f"{low[2]:+.3f}",
        "report": report,
    }


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # pragma: no cover
        pass
    parser = argparse.ArgumentParser(description="Blender 无头道具标准化流水线")
    parser.add_argument("--input", default="art/props_raw", help="原始 .glb 目录（只读）")
    parser.add_argument("--output", default="public/models/props", help="标准化 .glb 输出目录")
    parser.add_argument("--only", default="", help="只跑文件名含此子串的道具，便于单件复跑")
    parser.add_argument(
        "--decimate",
        default="auto",
        choices=("auto", "planar", "collapse"),
        help="减面手段：auto 按压缩比选路；planar 只用平面坍缩；collapse 只用拓扑坍缩",
    )
    parser.add_argument(
        "--tri-target",
        type=int,
        default=TRI_TARGET,
        help=f"单道具三角面预算，默认 {TRI_TARGET}；扫描类高模（如 old_bed_frame 5 万面）需要放宽",
    )
    parser.add_argument(
        "--tri-soft-limit",
        type=int,
        default=TRI_SOFT_LIMIT,
        help=f"低于此面数不动刀，默认 {TRI_SOFT_LIMIT}；同画面要摆多件的低模（如 6 张餐桌）需要一起压低",
    )
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    args, unknown = parser.parse_known_args(argv)
    if unknown:
        log(f"[警告] 忽略未识别参数：{' '.join(unknown)}")

    in_dir = os.path.abspath(args.input)
    out_dir = os.path.abspath(args.output)
    if not os.path.isdir(in_dir):
        log(f"[阻断] 找不到输入目录：{in_dir}")
        return 1
    os.makedirs(out_dir, exist_ok=True)
    files = sorted(
        os.path.join(in_dir, name) for name in os.listdir(in_dir)
        if name.lower().endswith(".glb") and not os.path.splitext(name)[0].endswith("_raw")
    )
    if args.only:
        files = [path for path in files if args.only in os.path.basename(path)]
    if not files:
        log(f"[阻断] {in_dir} 里没有 .glb，请先执行 node tools/fetchProps.mjs")
        return 1

    log(f"Blender {bpy.app.version_string} | numpy {'有' if np is not None else '无'} | "
        f"输入 {in_dir} | 输出 {out_dir} | {len(files)} 件道具")
    rows, failures = [], []
    for path in files:
        try:
            row = process(path, out_dir, decimate=args.decimate, tri_target=args.tri_target,
                          tri_soft_limit=args.tri_soft_limit)
            rows.append(row)
            log(f"[完成] {row['name']}：{row['raw']} -> {row['tris']} 面 / {row['size']:.1f} KB")
        except Exception as error:  # 单件失败不能带走整批
            failures.append((os.path.basename(path), f"{type(error).__name__}: {error}"))
            log(f"[阻断] {os.path.basename(path)}：{error}")

    headers = ["道具", "原面数", "->减面后", "减面手段", "子网格", "材质/DC", "实测高(表)", "缩放", "底面Z", "复压前KB", "状态"]
    table = []
    for row in rows:
        # 体积门槛（10–80KB）是对 gltf-transform 复压之后的成品说的，本表这一列只是复压前参考值，
        # 所以状态只判面数；成品体积由 .tmp/props_check.mjs 那份 three.js 实测表核对。
        ok = row["tris"] <= row["budget"]
        table.append([
            row["name"], row["raw"], row["tris"], row["method"], row["parts"], row["mats"],
            row["height"], row["scale"], row["foot"], f'{row["size"]:.1f}',
            "OK" if ok else f"超预算{row['budget']}",
        ])
    for name, error in failures:
        table.append([name, "-", "-", "-", "-", "-", "-", "-", "-", "-", error[:48]])
    widths = [
        max([display_width(header)] + [display_width(row[i]) for row in table])
        for i, header in enumerate(headers)
    ]
    log("\n【道具工业化汇总】")
    log("  ".join(pad(header, widths[i]) for i, header in enumerate(headers)))
    log("  ".join("-" * width for width in widths))
    for row in table:
        log("  ".join(pad(value, widths[i]) for i, value in enumerate(row)))
    log("\n【材质处理明细】")
    for row in rows:
        log(f"- {row['name']}")
        for line in row["report"]:
            log(f"    {line}")
    total = sum(row["size"] for row in rows)
    log(f"\n合计 {len(rows)} 件 / {total:.0f} KB | Roughness×{STATS['roughness']} Metallic×{STATS['metallic']} "
        f"断法线×{STATS['normal']} | 底图×{STATS['textures']}（缩放 {STATS['resized']}、降饱和 {STATS['desat']}）"
        f"{' | 失败 ' + str(len(failures)) + ' 件' if failures else ''}")
    log("下一步：npx gltf-transform meshopt <in.glb> <out.glb> --level high")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
