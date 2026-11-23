# 道具工业化流水线证据

Blender 无头流水线把 `art/props_raw/` 的第三方 CC0 高模批量标准化成 `public/models/props/`，
本目录保存两次验收的原始输出，供比赛「工业化」举证。

## 复现命令（项目根目录）

```bash
node tools/fetchProps.mjs                        # 拉 Poly Haven CC0 散件 → art/props_raw/*.glb
blender --background --python tools/blender_prop_pipeline.py -- \
  --input art/props_raw --output public/models/props   # 6 步标准化，见 blender-terminal.txt
for f in public/models/props/*.glb; do npx gltf-transform meshopt "$f" "$f" --level high; done
```

`blender` 不在 PATH 时把第一行换成绝对路径：
`"D:/千问比赛/新建文件夹/blender.exe" --background --python tools/blender_prop_pipeline.py -- ...`

## 文件说明

| 文件 | 内容 |
| --- | --- |
| `blender-terminal.txt` | Blender 5.3.0 无头运行的完整终端输出：【原面数 → 减面后 → 复压前体积】汇总表 + 每件道具的材质处理明细 |
| `three-r187-check.txt` | 游戏同款 three@0.187.0 `GLTFLoader` + `MeshoptDecoder` 在真实浏览器里解码成品的实测表：面数 / DrawCall / 底面Y / 高度 / Rough / Metal / 底图 / 体积 |
| `preview-all.png` | 8 件道具同框（含地面网格，检查贴地与比例） |
| `preview-prop_*.png` | 单件道具特写，检查全黑、法线反转、倒立 |

## 验收结论

- 面数：7 件 ≤500 三角面；`prop_bed` 例外 1500 面（源模型 49990 面，压到 500 会丢光床板条，见下）。
- 体积：复压后 21.4–68.6 KB，全部落在 10–80 KB 窗口内，8 件合计 346.6 KB。
- 贴地：8 件 `底面Y = 0.0000`，既不悬空也不穿地板；实测高度与内置米制表一致（床 0.90 / 桌 0.75 / 椅 0.85 / 路灯 4.20 …）。
- 风格：Roughness 统一 0.86、Metallic 0.00、OPAQUE、底图 512×512 JPEG，无高饱和、无全黑、无法线反转或倒立。
- DrawCall：每件 1 个（行李箱 2 个），子网格最多 9→1。
- 许可：全部 CC0，登记在 `docs/ASSET_CREDITS.md`；无 CC BY 素材。

## bed 的面数例外

`old_bed_frame` 原始 49990 面，压到 500 面（1:100）后床板条全部消失、只剩两头框架，
1500 面（1:33）才是一张能看出结构的旧铁床，复压后 68.6 KB 仍在体积窗口内。
例外写在 `tools/blender_prop_pipeline.py` 的 `TRI_TARGET_OVERRIDES = {"bed": 1500}`，
其余道具仍守 500 面红线。
