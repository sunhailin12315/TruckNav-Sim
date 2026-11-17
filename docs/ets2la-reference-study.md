# ETS2LA 参考学习笔记

> 对象：[ETS2LA/ETS2LA](https://github.com/ETS2LA/ETS2LA)（ETS2/ATS 游戏内自动驾驶，C#/.NET 10，GPL-3.0，活跃：2026-11-16 仍有提交，最新 release v2026.11.5297）。
> 目的：精读其 SDK 扩展层 / 信号处理 / 数据管线 / 事件总线 / 插件体系，提炼**设计级思路**对照 TruckNav-Sim 现状，形成可落地清单。不照搬代码。
> 原始摘录保存在 `.zcode/ets2la-ref/`（12 个文件，仅本地参考，不入库；GPL-3.0，禁止复制代码进本仓库，只学思路）。
> 上游生态相同：它致谢 ts-map / truckermudgeon maps / TruckLib——与我们扫描管线（`docs/map-scan-pipeline.md`）依赖同源。

---

## 1. 定位对比：一个数据面的两面

| | ETS2LA | TruckNav-Sim |
|---|---|---|
| 形态 | 注入游戏的插件（C# DLL，按游戏版本 1.59–1.62 各带一份）+ .NET 后端 + WebView UI | 外置"副驾仪表"：C# bridge 读官方 SDK 共享内存 → WebSocket → Nuxt 前端 |
| 目标 | 自动驾驶（控车）：需要周围车辆/红绿灯/车道级信息 | 导航显示（不控车）：路线、ETA、播报、POI |
| 数据来源 | 官方 telemetry mmap + **自建扩展 mmap 通道**（游戏内存直读） | 官方 SDK 包络内字段 |
| 地图 | TruckLib 解析游戏文件（运行时） | 预扫描产物 graph.bin/geometry.bin（离线管线） |
| 路线 | 读游戏 GPS 的 **route node UID 序列**（`Navigation.cs`） | 自建路由图 Dijkstra + 几何投影匹配 |

核心启发：**它把"官方 SDK 不够用"的部分拆成了独立的旁路通道，每条通道自己的生命周期、自己的更新频率、自己的事件名**，官方遥测通道保持原样。这给了我们一个"增量扩数据面"的架构样板，而不必推翻现有 bridge。

---

## 2. 精读笔记

### 2.1 通道架构：SDK 扩展不碰主 telemetry（`ETS2LA.Game/SDK/*.cs`）

它同时开 6 条命名 mmap，互不干扰：

| 通道 | 大小 | 频率 | 内容 |
|---|---|---|---|
| `SCSTelemetry`（官方） | 32 KB | 60 Hz | 卡车/作业/导航距离等官方字段 |
| `ETS2LARoute` | 96 KB | **1 Hz** | ≤6000 个路线点：`nodeUid(u64) + distanceToEnd(f32) + timeToEnd(f32)` |
| `ETS2LATraffic` | 6.8 KB | 60 Hz | ≤40 辆交通车：pos/quat/size/speed/accel + 最多 3 节拖车 |
| `ETS2LASemaphore` | 1.9 KB | 60 Hz | 附近红绿灯/闸门：state + `time_remaining` + 世界坐标 |
| `ETS2LAParkedVehicles` | 1.7 KB | — | 停放车辆 |
| `ETS2LACameraProps` | 128 B | 60 Hz | 相机 fov/位姿（含与卡车同步的注释，见 2.5） |

每条通道 = 一个独立 Provider（独立线程 + 独立 `UpdateRate` + 独立事件发布）。游戏端写插件 DLL 是它唯一的"重"依赖：每个游戏版本要重配特征码，Linux 换 `/dev/shm` 路径。**可学的不是内存读取本身，而是"按数据域分通道、按变化率分频率"的切分方式。**

### 2.2 Provider 生命周期样板（六个文件同一套骨架，值得逐条抄思路）

`Navigation.cs:97-178` 每 80 行重复的循环骨架，处处是踩坑后的防御：

1. **固定节拍不用 sleep 轮询**：`Stopwatch` 测耗时 → `Sleep(周期 - 耗时)`，欠债不累积（与 commit 6d2b362 的遥测节拍修法同族，可互为对照）；
2. **打开失败 → 睡 10 s 再试**，游戏没开时零 CPU；
3. **读失败（mapping 消失，如游戏关闭）→ 静默 CloseMemory**，下拍重连，不刷日志；
4. **每 1 s 周期性关闭重开 mmap**：检测"游戏重启但通道名没变"的假连接——这是很容易被忽略的坑，我们 WebSocket 重连若只做"断了才重连"就会中这个招；
5. **循环体整体 try/catch，异常只记日志不退出线程**。

这套骨架自己就翻过两次车，issue 即反面教材（正是"数据支撑"该引的具体出处）：

- **#555「plugin tick loop CPU spike after slow ticks」**：tick 落后时循环不再 sleep、背靠背补跑，GC 暂停或插件 Tick 超时一次就把一个核打满。修复是落后超期就把 `next` 直接拨回当前时刻——**宁可丢拍，不可补拍**。我们的 30 Hz 广播节流与未来的任何周期任务循环同此理；
- **#563「Reuse telemetry mmap instead of reopening every update」**：早期实现 60 Hz 每拍重建 mmap+缓冲，被 PR 改为**句柄复用、每秒一次 close/reopen 作重启探测**（当前 main：`Telemetry/Program.cs:667-671`）。教训两条：打开/关闭这类 syscall 绝不能放进最高频路径；而每秒一次的 close/reopen 成本可忽略（µs 级 + 缓冲区已复用），换来重启检测，**不需要**为了"轻量校验"再发明 unread-byte 之类的方案——它现在这个形态就是够用的最终形态。

### 2.3 信号处理：卡尔曼按信号源单独调参（`Traffic.cs:60, 286-304`）

- 每辆车**实例自带**一个一维卡尔曼 `KalmanFilter(q: 0.008f, r: 0.4f)`——q/r 是为"位置差分算速度"这个信号源单独调的，不是一栈共用一个滤波器；
- TMP mod 车辆不报速度，它用 10 Hz 的位置差分 + 滤波重建速度，且**滤波器对象按车辆 id 跨帧继承**（`_lastVehicleById`），换帧不重置；
- 差分限频 10 Hz 而渲染 60 Hz：噪声大的估计量更新慢，显示值平滑查表——与我们"遥测 60 Hz、扫描任务 5 s 一次"的降频哲学（6d2b362）完全同构，可引用为外部佐证。

对照：`bridge/TruckNavTelemetry` 目前 30 Hz 广播节流（`TelemetryManager.cs:29`）只做了一维节流；若后续对速度/朝向做平滑展示，应学它**按字段选滤波器参数**、状态挂在实体 id 上。

### 2.4 route node UID：路线对齐的"硬锚点"（`Navigation.cs` + `NavigationData.IndexFor`）

它的导航重算触发器极简也极稳：**拿当前路线节点序列，查 `IndexFor(truckNextNodeUid) == -1` → 偏航**，不依赖几何投影。`distanceToEnd`/`timeToEnd` 与游戏 GPS 严格同源（WestPlay 学习笔记 §2.1 同款思想，见 `westplay-reference-study.md`）。

对我们的意义（不是照搬，是替代思路）：
- 现有偏航/进度判定是几何投影（`approachLines.ts`/`graphIndex.ts`），公司院区内、环岛去回叠线上都吃过亏；
- 官方 SDK **没有** route node 序列，但**有** `routeSegments`（起讫城市）和 `nextRoadIntersection*` 字段——短期可先把"游戏 GPS 剩余距离"与自建路线剩余距离做漂移监测（连续超阈值才告警），中期若要 UID 级对齐只能走插件内存读取，成本=每个游戏版本跟一次特征码。**结论：维持几何路线匹配为主，把 UID 锚点记为"已知上限的方案"，不盲目跟进。**

### 2.5 渲染同步注释是免费的最佳实践（`Camera.cs:13-38`）

`CameraData` 里三条 XML 注释直接写明：**把任何视觉元素锚定到"相机时间戳下的卡车位姿"，不要用遥测的卡车位姿，否则渲染抖动**；以及 sector 坐标换算 `position + (cx, cy) * 512`（`Semaphores.GetWorldCoordinates` 同款）。我们地图卡车平滑/瓦片对齐如果还有微抖，这两条就是解法参照：**同一帧内所有视觉元素用同一时刻的同一份位姿快照**，而不是各读各的最新值。

### 2.6 事件总线：字符串 topic + 每订阅者隔离异常（`Bus.cs`，72 行）

`Dictionary<string, List<Delegate>>` + 锁内拷贝快照、锁外派发 + **每个 handler 单独 try/catch**（一个订阅者炸不影响其他）。没有优先级、没有 sticky，就是够用。前端 `utils/` 之间目前靠 import 直连，若"扫描进度""遥测节拍""AI 事件"要多路订阅，这个 72 行的形状是比引入三方库更好的模板；**隔离异常**一条必学。

### 2.7 插件沙箱：collectible ALC + 影子目录（`PluginLoadContext.cs` + `Handler.cs`）

- `AssemblyLoadContext(isCollectible: true)` + `AssemblyDependencyResolver`：插件卸载得掉，`Unload()` 后两次 `GC.Collect()` 逼出句柄释放（`Handler.cs:267-281`）；
- 依赖解析三段式：插件目录自解析 → 框架/宿主程序集（`System.*`/`ETS2LA.*`）强制回落 default context（防类型双份）→ 其余 null；
- **影子复制**到 `%TEMP%/ETS2LA/PluginShadow`：原 DLL 被占用也能更新，且为"监听文件变化→热重载"留了门（注释里 TODO）；
- 加载排除清单 `Microsoft.* / System.* / ETS2LA.*` 防误认插件。

Electron 侧无直接对应物，但"每个扩展一个可回收沙箱 + 共享层不下沉到插件目录 + 更新走影子复制"三点，对应我们未来把扫描器/AI 提供方做成可卸载模块时的设计检查表。

### 2.8 Vision：用地图数据自渲染代替屏幕识别（`Vision.cs`）

ML 输入不是游戏截图，而是**用解析出的地图节点在 OpenGL 里重绘的"数字孪生"渲染**：前视 + 俯视两台虚拟相机，道路网格 + 交通车网格，`nodeUpdateInterval = 5s` 的低频几何更新与逐帧渲染分离。对我们是思路储备：若 AI 播报要空间上下文（"下个路口左侧有测速"），**输入应该是 graph.bin 里的几何 + POI 查询，而不是任何像素级识别**——这与 `ai-features.md` §1"确定性边界"完全一致，是它的强化版：连"感知"都用精确数据合成。

### 2.9 自带提取器的另一面（`Data/Extractor/`）

它把 sk-zk/Extractor 内嵌为子工程（支持 HashFS v1/v2、"locked" ZIP、无目录清单时的路径搜索）。修正我们文档里的一处印象：**内嵌 ≠ 从零自研**，它是 vendored 上游 + 自家 `HashFsPathFinder` 等补丁。对我们的 `TRUCKNAV_SCAN_TOOLS_DIR`（外部 truckermudgeon checkout）：可学的做法是**把依赖以源码/产物形式 vendor 进仓库并只保留自家补丁层**，让"缺环境"从高频故障变成不存在——这正是我们文档里已计划的方向，ETS2LA 验证了可行性。

### 2.10 值得记录的工程配套

- **Velopack**（`velopack.bat/sh`）：一次构建出 Win Setup/MSI/Portable + Linux AppImage 且带自动更新——Electron 分发可评估（electron-builder 的 nsis+autoUpdate 是其子集）；
- **Weblate 自托管 + gettext `.po` + msgmerge 自动同步**：8 语言翻译流的社区化方案；其"禁止把本地 .po 回传 Weblate（会破坏署名）"的细则值得原样吸收进我们的翻译流程约定；
- **`AGENTS.md`**：仓库声明拒绝 AI 生成的 PR——参考时勿向其提 PR（本笔记仅本地学习）。

---

## 3. 对照与落地清单

| # | 可借鉴设计 | 来源 | 落点（TruckNav-Sim） | 代价/风险 | 优先级 |
|---|---|---|---|---|---|
| 1 | Provider 生命周期五件套（节拍/退避/静默重连/1s 重开探测/异常隔离） | `Navigation.cs`/`Traffic.cs` | ✅ **已实现（2026-11-17）**：前端新鲜度状态机 `app/assets/utils/telemetry/freshness.ts`（+1 Hz 看门狗接线 `EtsTelemetry.ts`，检测"静默常开"与"僵尸帧"两种 onclose 看不见的故障）；bridge 包内新增 `common.renderTimestamp`（Packets.cs/TelemetryManager.cs）；Electron `index.ts` bridge 进程守护（退避重启+崩溃循环熔断，"丢拍不补拍"的进程版）；重连退避加 ±20% jitter | 低，纯健壮性；老 bridge 无新字段时冻结检测自动失效 | ~~P0~~ 完成 |
| 2 | 字符串 topic 事件总线 + 每 handler 隔离异常 | `Bus.cs` | `app/assets/utils/`（扫描进度/AI/遥测多订阅场景） | 低 | P1 |
| 3 | 按字段调参的卡尔曼 + 滤波器状态挂实体 id | `Traffic.cs:60,286` | 地图卡车平滑、ETA 均耗展示 | 中（需调参） | P1 |
| 4 | 同帧视觉元素锚定同一位姿快照（防抖） | `Camera.cs:20-38` | `MapLibre.ts` 卡车标记跟随 | 低 | P1 |
| 5 | vendor 数据工具进仓库，只保留自家补丁层 | `Data/Extractor/` | `scripts/scan-worker/`（消灭 `TRUCKNAV_SCAN_TOOLS_DIR` 外部 checkout） | 中（license：truckermudgeon 另议） | P1 |
| 6 | 游戏 GPS 剩余距离 vs 自建路线剩余距离的漂移监测 | `Navigation.cs` 思路的免插件版 | 偏航检测增强（`directions.ts`/RouteController） | 低 | P2 |
| 7 | UID 级路线锚点（需游戏内插件读内存） | `Navigation.cs` | 远期，仅当几何匹配仍不可靠 | 高（跟版本、平台差异） | P3 观察 |
| 8 | collectible 沙箱 + 影子复制的插件模型 | `PluginLoadContext.cs`/`Handler.cs` | 桌面端模块可卸载化时参考 | 中 | P3 储备 |
| 9 | 数字孪生渲染喂 AI（几何合成而非像素识别） | `Vision.cs` | AI 空间上下文（配合 ai-features.md 原则） | 中 | P3 储备 |
| 10 | Velopack / Weblate 生态位 | 发布与翻译流程 | Electron 分发、8 语言流程 | 中 | P3 评估 |

---

## 4. 边界备忘

- **GPL-3.0**：思路、架构、参数哲学可学；**一行代码不得复制进本仓库**（我们同为 GPL-3.0，理论可移植但栈异构（C#→TS）且其核心依赖注入/内存读取与外置架构冲突——移植无意义，借鉴止于设计）。
- 它的数据面扩展以"每个游戏版本跟一次特征码"为终身成本；我们外置 bridge 的可维护性是刻意选择，勿因几个字段轻易换轨。
- 原始摘录在 `.zcode/ets2la-ref/`（git-ignored），升级对照时重新拉取 release tag 而非 main。
