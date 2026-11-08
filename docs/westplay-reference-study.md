# WestPlay 参考学习笔记

> 对象：[enes-less/WestPlay](https://github.com/enes-less/WestPlay)（ETS2/ATS 的 CarPlay 风格游戏内车机屏，GPL-3.0，v2.2.2）。
> 目的：精读其地图渲染 / 转向引导 / 相机跟随 / 沿途设施 / 改道可靠性实现，提炼可借鉴的设计，
> 对照 TruckNav-Sim 现状形成可落地清单。
> 原始摘录保存在 `.zcode/westplay-ref/`（17 个文件，仅本地参考，不入库）。
>
> **许可说明**：双方均为 GPL-3.0，同 license 下移植代码合法（需保留出处与版权声明），
> 但两套栈不同（React vs Vue）且各自风格独立，本文以**设计级借鉴**为主，直接移植仅限纯算法。

---

## 1. 定位对比：它和我们在做同一件事的不同切面

| | WestPlay | TruckNav-Sim |
|---|---|---|
| 形态 | 注入游戏进程的插件 + PC 端渲染器，把屏**画进**仪表盘纹理 | 外部"副驾仪表"（APK/EXE/浏览器），读 WebSocket 遥测 |
| 地图来源 | 解析游戏自身地图文件（SCS 压缩包 → 矢量瓦片，含地图 mod） | PMTiles 预生成 + sprite POI |
| 路线来源 | 读游戏 GPS 的路线节点，或自建寻路（`planner.rs`）再喂回游戏 | 自建路由图 Dijkstra（Web Worker） |
| 引导/播报 | 游戏原生语音，UI 只画"下一转"卡片 | 自研语音播报（M9）+ 转向卡 |
| 共同点 | **游戏尺度、游戏单位、游戏曲线**——一切以"和游戏 GPS 数字一致"为最高原则 | 同样坚持遥测数据与游戏数字一致（REAL_TIME_DELAY_FACTOR 等） |

核心启发：WestPlay 全部 UI 的精度锚点是"**用游戏自己的计数**"（它的地图比例、它的曲线方程、它的剩余距离），
这样屏上数字和游戏 GPS、任务面板永远一致。TruckNav-Sim 的 `mapScaleConfig` 是同一个思想，值得继续贯彻。

---

## 2. 精读笔记

### 2.1 `guidance.ts`——65 行的转向引导教科书

**纯函数**：`guidanceOf(distances, maneuvers, next, distanceLeft) → Guidance | null`。

- 每个路线节点携带"距终点剩余距离"，`距离 = distanceLeft - distances[maneuver.node]`——
  与游戏 GPS 完全同源，不需要自己沿路累加。
- **12 种转向**（slight/normal/sharp 左右、u-turn、keep-left/right、exit-left/right、roundabout），
  每种带**实际角度** `angle`，供图标按真实角度绘制。
- `THEN_WITHIN = 400`：下一步距离 < 400 m 时随当前步一起显示（"…然后"行）。
- `NOW_WITHIN = 30`：进入路口 30 m 内显示"现在"而非距离。
- `maneuver.node >= next - 1` 的过滤保证卡车过路口后步骤自动推进，无需状态机。

对照：`app/assets/utils/routing/directions.ts` 的 `DirectionStep.type` 枚举与它几乎一一对应
（含 roundabout 的 exitCount），但缺 `u-turn` 与 keep/exit 的细分，且 `debugAngle` 未转正、未用于绘制。
`maneuverCard.vue` 已有 then 行（[1]/[2] 取法），但无 400 m 阈值联动——目前"永远显示 then"。

### 2.2 `route.ts`——路线线渲染三件套

**曲线**：节点间用三次 Hermite 插值（`roadCurve`，每 8 m 一点，切线长度 = 节点间距），
与游戏地图画路的方程同款，线**始终贴在路面上**。

**车道偏移**：`offsetLine(points, from, to)`——双幅路面（高速）游戏路线走中央隔离带，
按节点向行驶方向右侧平移，跨节点线性渐变。

**卡车投影**（`progressOf`）两个亮点：

1. 只在 `next` 附近 `SPANS_AHEAD = 3` 段内找最近点（主机每 0.5 s 报一次，卡车最多穿过几小段）；
2. **对向判别**：`AGAINST = -0.5`（≈120°）——环岛 U-turn 时去程回程叠在同一线上，
   只有朝向点积能区分，取"顺着卡车走的方向"的候选。

**吸附**（`snapToRoute`）：距离路线 10 m 内全吸附、18 m 外不吸附，之间线性渐变——离开/汇入路线永不跳变。

**接入线**（`approachLine`）：路线起点在远处屏幕外时，从卡车沿路画一段接入线（Apple 风格）。

对照：`RouteController.updateRouteProgress`（RouteController.ts:1400）搜索窗口 ±500 段、
静态 `DEVIATION_THRESHOLD_SQ` 单一阈值（yard 特例两档）、无朝向判别、无渐变吸附。
并行高速/对向重叠路段可能投影到对向线 → 误判偏航 → 误触发 reroute（`rerouteTrigger`）。

### 2.3 `camera.ts`——跟随相机的五个细节

1. **70 ms 延迟样本缓冲**（`FOLLOW_DELAY_MS`）：相机永远渲染"70 ms 前"的位置，插值永远有两个样本可用，永不外推、永不跳帧。
2. `truckAt()`：样本间按时间线性插值，heading 走短弧（`((b - a) % 1 + 1.5) % 1 - 0.5`）。
3. **速度联动缩放** `zoomForSpeed`：20→90 km/h 间 smoothstep 从 17.2 降到 15.9，"前方路面保持同等时间"。
4. **帧率无关指数阻尼** `damp/dampBearing`：`target + (current - target) * exp(-dt / tau)`，与 rAF 频率解耦。
5. **交互后 15 s 自动回中**（`AUTO_RECENTRE_MS`，CarPlay 同款）+ `ZOOM_OFFSET_LIMITS [-4, 2]`：
   用户在跟随模式下的缩放作为"偏移"被记住，速度缩放以它为基准继续生效；`samePose` 去掉无意义整帧重绘。

对照：`MapCamera.ts` 固定 120 ms 线性 lerp（样本间隔硬编码）、无速度缩放、无阻尼、
交互后 1.5 s 强制回锁（比 CarPlay 的 15 s 激进得多）、用户的缩放在恢复跟随时被 easeTo 覆盖丢失。

### 2.4 `alongRoute.ts`——沿途设施的空间索引

- 剩余路线的每条线段按中点散列进 **1000 m 网格 cell**（`Map<string, number[]>`），
  POI 按 kind 的 `REACH`（加油站 1000 m / 公司 3000 m / 城市 5000 m）查相邻 cell，O(1) 命中；
- 返回 `along`（沿路里程）+ `off`（偏离距离），**只取 `along > 1`**（前方），
  按 along 排序——列表天然是"下一个最近的"；
- 分 kind 的可达距离更拟真：路边设施近、城镇设施远。

对照：`poiAlongRoute.ts` 用 SAMPLE_STEP=10 线性扫描 + bbox 预过滤，返回**第一个**命中即止；
固定 `POI_MAX_DETOUR_KM = 3` 不分 kind。功能等价，长路线 + 大量 POI 时复杂度差一个量级；
且"第一个命中"在路线折返（如山路）时可能选中折返段的点而非沿路最近的。

### 2.5 `traffic.ts`——用玩家数据造交通层（低成本彩蛋）

TruckersMP 其他玩家位置 → 沿路线切 **200 m 路段桶** → 同向（cos60°）且在路上（12 m 内）的
玩家速度进桶 → 桶内 **中位数** 速度 < 50 km/h 黄、< 20 km/h 红 → 相邻同色路段合并成一条线。
中位数天然抗"路边停一辆车"的离群点。全程纯函数 + `.test.ts`。
TruckNav-Sim 若接 TruckersMP API（遥测生态里常见），可直接复用此算法形状。

### 2.6 改道请求的可靠性——`routeChange.ts` + `route_change.rs`

UI 侧：请求带自增 `id`，pending map + `setTimeout` 兜底（8 s / 30 s / 6 s，各调用语义不同）。
Rust 侧：**同一时刻只允许一个在途请求**；新请求把旧请求直接回 `noAnswer`（被超车）；
3 s 无答复回 `noAnswer`；原子量 `request`/`answered` 配对防串号。测试专门覆盖"超车"场景。

对照：TruckNav-Sim 的 `rerouteTrigger` 计数器模式更简单（适合纯前端自算路线），
但这套"请求 id + 超时 + 被超车答复"模式在 `Network.ts` 与 route worker 的异步调用上值得推广。

### 2.7 UI 状态机与图标

- `GuidanceCard.tsx` 的 `useStepChange`：渲染期同步调整 state（React 惯用法，无闪帧），
  leaving（旧步骤滑出）/ entering（新步骤滑入）/ closing（路线结束淡出）三态 + 560 ms spring；
  `useKept` 在值变 null 时保留上一帧值完成收尾动画；Dashboard 上 `widget-slot` 开合让下方组件让位。
- `ManeuverGlyph.tsx`：48 单位 viewBox 手绘 SVG，**箭头方向 = 转弯真实角度**；
  keep/exit 把"没走的岔路"画成 35% 透明度；环岛画圆环 + 按角度出口（含贴边防越界的臂长计算）。
- `navigation.ts`：Home 键行为复刻 CarPlay——从 app 回到"打开它的那个底屏"，两个底屏间互换。

对照：`maneuverCard.vue` / `directionIcon.vue` 是"图标枚举选择"而非角度绘制，
卡片无转场状态机。VoiceGuidance 阈值播报（2 km/0.5 km）是自己的强项，WestPlay 无对应物。

### 2.8 `screen.ts` 屏幕适配（了解即可）

固定 1280×720 设计画布 + 每车型 profile（scale / 边距 / 回车按钮位 / 屏幕边框色），
"物理尺寸决定 UI scale"（大屏字号不变、内容变多）。对全自适应的 TruckNav-Sim 不适用，
但手机端竖屏卡片的"内容随屏幕高度增减"（`recents: 2/4` 的思路）可参考。

---

## 3. 差距对照表

| 能力 | WestPlay | TruckNav-Sim 现状 | 差距评估 |
|---|---|---|---|
| 相机跟随 | 70ms 样本缓冲 + 指数阻尼 + 速度缩放 + 15s 回中 + 缩放记忆 | 120ms 线性 lerp + 1.5s 回锁 | **大**（体感差异最直接） |
| 路线投影 | 3 段窗口 + 朝向判别 + 渐变吸附 | ±500 段 + 静态阈值 | **大**（对向/并行路误判偏航） |
| 转向图标 | 真实角度手绘 SVG，含 keep/exit/环岛角度 | 枚举图标 | 中（`debugAngle` 已有，可转正） |
| 引导卡转场 | leaving/entering/closing 状态机 + spring | 无转场 | 中 |
| then 行联动 | < 400 m 才显示 | 恒显示 | 小 |
| 沿途设施 | 网格索引 + 按 kind 距离 + 全量排序 | 线性扫描 + 首个命中 + 固定距离 | 中（POI 多时性能 + 正确性） |
| 改道可靠性 | 请求 id + 超时 + 被超车答复 | 计数器触发重算 | 小（自算路线场景够用） |
| 交通层 | TruckersMP 玩家速度 → 路段拥挤 | 无 | 观察项（需 MP 数据源） |
| 测试文化 | 每个纯函数文件配 `.test.ts` | tests/ 目录已有 6 组 | 持续保持 |

---

## 4. 可落地清单

### P0（体感收益最大，互相独立）

1. **相机升级**（重写 `app/composables/MapCamera.ts` 的插值部分）：
   - 样本环形缓冲 + `FOLLOW_DELAY_MS = 70` 渲染滞后（WestPlay camera.ts 的 `truckAt` 可近移植，纯算法）；
   - `damp/dampBearing` 帧率无关阻尼替换固定 120 ms lerp；
   - `zoomForSpeed` 平滑速度缩放（阈值可按 AMap 车机观感调）；
   - 交互后自动回锁 1.5 s → 15 s（并把 wheel/pinch 的缩放作为 `zoomOffset` 记忆，恢复跟随时保留）。
   - 落点：MapCamera.ts；新纯函数文件 `app/assets/utils/map/cameraMath.ts` + `tests/shared/`。
2. **投影/偏航判定加朝向**（`RouteController.updateRouteProgress`）：
   - 最近段候选按 `(段方向 · 卡车朝向) > -0.5` 过滤后再取最小距离；
   - 吸附显示做 10→18 m 渐变（路线线与卡车标记分离渲染时同样适用）。

### P1

3. **`ManeuverGlyph` 风格转向图标**：`directions.ts` 的 `debugAngle` 转正为 `angle`，
   `directionIcon.vue` 换成按角度绘制的 SVG（ GPL 下可对照移植其几何生成逻辑），
   补 `u-turn` / `keep-left/right` 类型。
4. **引导卡转场**：`maneuverCard.vue` 加 leaving/entering 状态机（Vue 侧用 `<Transition>` + 双渲染等价实现），
   then 行按 `nextLegDistance < 0.4 km` 联动显隐；距离 < 30 m 显示"现在"。
5. **`poiAlongRoute` 网格化**：段中点 1000 m 格索引 + 按 kind 分级 `REACH` + 返回排序数组取前 N，
   服务区/加油站建议（`serviceSuggestion`）随之升级为"候选列表"。

### P2 / 观察项

6. 中途停靠点 ETA 分摊（`nextStop.ts`：按距离比例分摊总时长）——适合 jobCard 的"途经城市"行。
7. TruckersMP 交通层（`traffic.ts` 算法可整体移植，前提是接入 MP 位置 API）。
8. 异步调用统一"请求 id + 超时兜底"模式（Network.ts / worker 封装）。

> **落地状态（2026-11-08）**：P0.1 相机（`app/assets/utils/map/cameraMath.ts` + `MapCamera.ts` 重写）、
> P0.2 朝向投影与吸附（`routeProjection.ts`）、P1.3 角度箭头（`maneuverGlyph.ts` + `directions.ts` 的
> `angle`/u-turn）、P1.4 引导卡转场、P1.5 POI 网格化与分级可达、P2.6 途经点 ETA（`nextStop.ts` +
> jobCard 途经行）、P2.8 worker RPC 超时兜底均已实现并配测试；P2.7 TruckersMP 交通层仍为观察项。

### 明确不抄的

- 车型 profile / OEM 条 / 回车按钮等**嵌入式屏适配**（与外部副驾形态无关）；
- 音乐/YouTube 集成（与导航无关，且 GPL 合规敏感度高）；
- 游戏内注入整条链路（D3D hook、遥测桥、mod 安装）——TruckNav-Sim 的零游戏侧改动原则不变。

---

## 5. 附：读到的代码品味（可迁移的工作方式）

- **常量即文档**：每个魔法数命名 + 一句"为什么"（`THEN_WITHIN = 400`、`STRETCH = 200`、`AGAINST = -0.5`），
  调参历史写进注释（"red seen only once on the road (owner 2026-10-21)"）。
- **纯函数 + 共置测试**：几何/引导/相机全部是"输入→输出"模块，React 只做渲染，
  `wc -l` 显示最大的逻辑文件也不过 300 行。
- **注释写成散文设计文档**：文件头注释先讲清"这是什么、为什么这样做、边界在哪"，再进代码。
- 本笔记对应的 WestPlay 原始文件：`.zcode/westplay-ref/`（guidance.ts、route.ts、camera.ts、
  alongRoute.ts、traffic.ts、routeChange.ts、route_change.rs、GuidanceCard.tsx、ManeuverGlyph.tsx、
  navigation.ts、screen.ts、mapData.ts、nextStop.ts、destination.ts、labels.ts、Destinations.tsx、
  state/navigation.ts）。
