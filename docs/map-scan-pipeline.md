# 地图扫描管线（Map Scan Pipeline）

> 目标：不依赖上游作者的 QGIS 手工管线，直接扫描本地 ETS2/ATS 安装目录，
> 自动生成 TruckNav 的地图数据包（`graph.bin` / `geometry.bin` / `cities.json` / `scale.json`）。
> 首个应用场景：官方 Iceland DLC（2026-11-10 发布）。

## App 内置功能（桌面端）

2026-11-15 起扫描管线已内置为 Electron 桌面功能，不再需要手动跑命令行：

- **入口**：游戏管理面板（选择地图模组）→ 底部"扫描本机游戏地图"卡片 → 开始扫描。
- **执行**：主进程 spawn `ELECTRON_RUN_AS_NODE` 子进程跑
  `resources/scan/scan-worker.mjs`（esbuild bundle，见 `scripts/scan-worker/`），
  解析在内存直通进行（不落盘中间 JSON），产物直接写入
  `userData/maps/<game>-scan/`，并生成 `manifest.json`。
- **进度**：worker stdout 的 JSON 行 → `scan:progress` IPC（含退订）→ 模组面板
  进度条；网页伴侣走 `GET /api/scan-status` 轮询。
- **发现**：模组列表 = 硬编码清单 + `getDownloadedMaps()` 动态发现（读
  manifest 的 `map-scan` 目录，命名约定 `<game>-scan`）。
- **底图**：扫描图不带 tiles/sprites；`MapLibre.ts` 在 `<game>-scan` 激活时
  回退加载基础地图的 tiles 与 sprites（同一投影，底图可对齐，仅缺新 DLC
  道路的美术渲染）。
- **内存**：子进程堆 = `min(12 GB, 物理内存一半)`；低于 16 GB 机器会写警告日志。
- **源码**：主进程 `electron/src/scanMap.ts`；worker 入口
  `scripts/scan-worker/entry.ts`；转换纯函数 `scripts/scan-worker/convert.ts`
  （单测 `tests/shared/scanConvert.test.ts` 校验投影与 app 端
  `convertEts2ToGeo` 逐点一致）。

构建 bundle（需要 `TRUCKNAV_SCAN_TOOLS_DIR` 指向打了补丁的 truckermudgeon
checkout，默认 `D:\trucknav-map-tools\maps`）：

```bash
npm run build:scan   # -> electron/resources/scan/scan-worker.mjs + native modules
```

bundle 产物与 CLI 管线**字节级一致**（distance 四舍五入已对齐 CLI 的
graphSerializer）。

## 手工管线（无桌面端时/调试用）

## 管线总览

```
游戏安装目录 (*.scs, HashFS)
   │  ① parser（truckermudgeon/maps，解包+解析所有官方 DLC）
   ▼
parser-out/*.json   （nodes / roads / cities / prefabDescriptions ...）
   │  ② generator graph（构建导航图 GraphData，含 DLC guard / ferry / 环岛）
   ▼
graph-out/europe-graph.json
   │  ③ 转换脚本 to-trucknav.mts（本管线核心新增）
   ▼
mapdata/ets2-iceland/{roadnetwork/*.bin, map-data/*.json}
```

- 扫描工具源：`D:\trucknav-map-tools\maps`（[truckermudgeon/maps](https://github.com/truckermudgeon/maps) 的
  tarball + libdeflate 子模块，已打 3 个兼容性补丁，见下文）
- 转换脚本：`D:\trucknav-map-tools\maps\to-trucknav.mts`
- 校验脚本：`D:\trucknav-map-tools\verify.mjs`（读 bin 跑 Dijkstra）

## TruckNav 数据格式（app 端约定）

- `roadnetwork/graph.bin`：Float32，**每 12 值一条有向边**：
  `[u, v, weight(米), hIn(rad), hOut(rad), isFerry, requiredDlc, vPrefabId, startIndex, pointCount, maneuverType, exitNumber]`
  - 节点 id 是**重编号的密集 int**（Float32 只有 24 位整数精度，不能用游戏 hash）
  - hIn/hOut = 边的 WGS84 方位角（弧度），用于 A* 转弯惩罚
- `roadnetwork/geometry.bin`：Float32 折线池 `[lng,lat,...]`，边的 `startIndex/pointCount` 指向其中
- 节点坐标**不单独存**：取每条边几何的第 0 个点（`GraphSystem.ts` 的 uniqueNodes 逻辑）
- 投影：**简化 Web Mercator（R=300000）**，即 `app/assets/utils/map/converters.ts` 的
  `convertEts2ToGeo`。⚠️ 不是 truckermudgeon 自带的 proj4 投影（含 UK 缩放 hack），
  混用会与遥测/城市坐标错位。

## DLC guard → TruckNav DLC 编号

TruckNav 的 `requiredDlc` 必须对应 `app/data/ets2/ets2Expansions.ts` 的 key。
truckermudgeon 的 guard 值见其 `packages/libs/map/constants.ts` 的 `Ets2DlcGuards`，
映射表写在 `to-trucknav.mts` 的 `GUARD_TO_DLC`。已确认：**Iceland 的 guard = 27 → TruckNav 编号 11**。

## 操作步骤（重扫时）

```bash
cd /d/trucknav-map-tools/maps

# ① 扫描游戏（需已安装目标 DLC；europe 全图 ~10-15 分钟，12GB v8 堆）
NODE_OPTIONS=--max-old-space-size=12288 npx tsx packages/clis/parser/index.ts \
  -i "D:/software/steam/steamapps/common/Euro Truck Simulator 2" \
  -o /d/trucknav-map-tools/parser-out

# ② 构建导航图
NODE_OPTIONS=--max-old-space-size=12288 npx tsx packages/clis/generator/index.ts \
  graph -m europe -i /d/trucknav-map-tools/parser-out -o /d/trucknav-map-tools/graph-out

# ③ 转成 TruckNav 格式
NODE_OPTIONS=--max-old-space-size=12288 npx tsx to-trucknav.mts \
  /d/trucknav-map-tools/parser-out /d/trucknav-map-tools/graph-out \
  /d/trucknav-map-tools/mapdata/ets2-iceland

# ④ 校验（雷克雅未克→阿克雷里 Dijkstra）
node /d/trucknav-map-tools/verify.mjs /d/trucknav-map-tools/mapdata/ets2-iceland

# ⑤ 放入 app 数据目录（dev: public/maps/ets2-iceland；Electron: userData/maps/ets2-iceland）
```

## truckermudgeon 源码补丁（1.62.3.3 兼容，D 盘工具内已改）

1. `parser/game-files/def-parser.ts`：跳过 `model.stable.sii`（新版游戏的自由文本
   注释文件，非 SII 语法，会让解析器 throw）
2. `parser/game-files/map-files-parser.ts`：图标/图集解析失败降级为空 Map
   （新 TOBJ 图片格式 93 未支持，图标仅用于 UI 图集）
3. `generator/graph/graph.ts`：ferry 引用的 prefab 缺失时 warn+跳过
4. Windows 编译环境：node-gyp v11 不认识 VS 18.4，用环境变量绕过
   `VCINSTALLDIR=D:\software\VisualStudio\VC\ VSCMD_VER=17.13.5 WindowsSDKVersion=10.0.26100.0\`
   （装依赖时需 `--engine-strict=false --ignore-scripts`，node 要求 >=24 而本机 22）

## 当前状态与已知限制

- ✅ 2026-11-15：管线全通，1.62.3.3 全欧扫描成功（19.6 万节点 / 40.4 万边 / 388 城）
- ⚠️ **Iceland DLC 尚未安装**（游戏目录无 `dlc_iceland.scs`，Steam 无对应 manifest）。
  1.62 base 已预埋冰岛城市存根（reykjavik/akureyri/keflavik 等，guard=0）但无道路。
  装好 DLC 后按上面步骤重扫即可得到冰岛路网。
- ⚠️ 缺底图 tiles（`map-data/tiles/*.mp3` PMTiles）——导航/寻路可用，MapLibre 底图空白。
  后续可用 generator 的 `map` 命令生成 pmtiles 再对齐图层名。
- ⚠️ 公司 POI 实例为空（prefab 内 company item 解析未产出），目的地搜索不受影响。
- ⚠️ 第三方 mod（ProMods 等）不在 parser 支持范围，仍走作者手工管线。
