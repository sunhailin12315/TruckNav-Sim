# TruckNav-Sim 游玩性升级设计

> 目标：把"被动的地图导航"升级为"参与游戏循环的副驾助手"——
> 接单 → 规划 → 驾驶 → 交付的每一环都有导航参与感和反馈感。
> 全部设计基于 v0.5.2 现有遥测数据与路由图能力，不依赖游戏改动。

---

## 1. 现状盘点：已到货但未消费的数据

`ws://<ip>:30001` 遥测包（`app/types/telemetry.ts`）中，客户端目前只用了位置/速度/朝向/油量/限速/休息倒计时/gameTime/`onJob`。以下字段**已在包里、前端零消费**，是本次升级的全部原料：

| 字段 | 内容 | 可支撑的功能 |
|---|---|---|
| `job.remainingDeliveryTime` | 剩余交付时限 | 任务截止倒计时 |
| `job.cargo` | mass / name / cargoDamage | 货物损坏监控 |
| `job.income` | 本单收入 | 收入看板 |
| `gamePlayEvents.jobDelivered` | revenue、earnedXp、cargoDamage、deliveryTime、distanceKm、autoParker、autoLoaded | 送达结算卡片 |
| `gamePlayEvents.finedData` / `specialEvents.fined` | 罚款金额 | 罚单通知 |
| `gamePlayEvents.tollgatePayment` / `specialEvents.tollgate` | 过路费 | 收费站流水 |
| `gamePlayEvents.ferryData` / `trainData` | payAmount、source/target | 渡轮/火车事件 |
| `gamePlayEvents.jobCancelledPenalty` | 取消订单罚金 | 损失记录 |
| `truck.damage` | engine/transmission/cabin/chassis/wheels | 车损五维显示 |
| `truck.current.dashboard` | fuelRange、averageConsumption、fuelWarning、cruiseControlActive、rpm、odometer | 续航规划、里程统计 |
| `trailers[]` | attached、damage(cargo/wheels/chassis) | 挂车状态 |

路由图侧同样有现成能力：

- PMTiles 已有 **prefab zones（服务区/加油站）图层 + sprite POI 图标**（`app/composables/MapLibre.ts`）；
- 边数据已含 `isFerry`、`requiredDlc`、`maneuverType`（`GraphSystem.ts:80-92`）；
- 城市区域空间网格（b629434）已可判断"当前是否在城区"，可做提前减速提示；
- settings schema 已版本化并预留 `MIGRATIONS` map（`app/assets/utils/shared/settingsSchema.ts`），加配置走 v1→v2 迁移即可。

## 2. 设计原则

1. **零游戏侧改动**：只用 SDK 遥测 + 本地图数据，任何新功能都必须能在 APK / EXE / 浏览器三端跑。
2. **"提示在需要时出现"**：所有播报走统一通知中心，默认低打扰，可分级开关。
3. **本地积累**：统计数据全部本地持久化，不引入账号/云服务。
4. **每档可独立交付**：P0 不依赖 P1，随时可拆成独立 PR。

---

## 3. P0 —— 立即可做（纯前端 + 已有遥测，零新依赖）

### 3.1 任务看板（Job Panel）
- 接单（`specialEvents.onJob` 翻真）时底部 sheet 切换为任务卡：货名、货重、起点→终点、**收入**、剩余交付时间倒计时（`remainingDeliveryTime`，随 gameTime 实时跳动）、货损进度条。
- 长单（剩余时限 < 预计 ETA）时任务卡高亮"来不及"警示——ETA 复用 `RouteController` 现有缓存。
- 工程落点：消费 `telemetryState.ts` 的 JobState 全字段；新组件 `navigation/jobCard.vue`。

### 3.2 送达结算卡片
- 监听 `gamePlayEvents.jobDelivered`：弹出结算卡（收入、XP、货损百分比、用时、距离，autoParker/autoLoaded 加成标注）。
- 结算后自动进入"历史记录"（见 P1.6）。
- 这是整个设计里**反馈感最强**的一项：现在送达是静默的。

### 3.3 疲劳与休息规划（导航仪的灵魂功能）
- `nextRestStopMinutes` 阈值分级：< 90 min 黄色提醒（现在只有蓝色脉冲），< 20 min 红色强提醒 + 移动端震动。
- **沿路线找休息点**：路线剩余 game-hours 与剩余疲劳时间对比，若"本趟到不了终点"，在导航模式下沿路线向前搜索下一个服务区 prefab zone 并在地图上打标（图层已存在，只需查询 + 打点），sheet 提示"建议在 X km 后服务区休息"。
- 工程落点：`RouteController` 新增 `findServiceAlongRoute`，复用现有路线 waypoint 遍历逻辑。

### 3.4 续航规划（Fuel Planning）
- 用 `fuelRange`（SDK 已算好剩余续航）对比路线剩余距离：
  - 够 → 正常；
  - 不够 → 沿路线搜索最近加油站 prefab，提示"剩余油续航 X km，建议 Y km 处加油"。
- `fuelWarning` 触发红色持续警告；`averageConsumption` 显示在油量小组件上（升/百公里，随 `units` 单位切换）。
- 加油点也可一键**插入为途经点**（multi-stop 基础设施已完备）。

### 3.5 事件通知中心（Economy Feed）
- 统一监听 `specialEvents` + `gamePlayEvents`：罚单（金额）、收费站（金额）、渡轮/火车（票价、起止港）、取消订单（罚金）、送达。
- 形式：顶部 toast 流 + 通知抽屉历史（本 session 内存即可，P1 持久化）。
- 现状这四类事件**全部静默**，司机在专注驾驶时最有感知缺口。

### 3.6 超速语音/声音 + 震动
- `speedLimit.vue` 已有 >limit+5 的闪烁，升级为三级：闪 + 蜂鸣（Web Audio，无资源文件）+ 连续超速震动（Capacitor Haptics）。
- 顺带补齐转向播报：`maneuverCard` 已有"下 2 个转向"，用 TTS/音频在接近时提示（可做成开关）。

### 3.7 车损与挂车状态
- HUD 增加"车况"小组件：`truck.damage` 五维微型条形图 + `trailers[]` 挂车损伤；超过 50% 变红。
- 工程落点：挂进 `manageDriveInfoPanel.vue` 的可开关组件列表（机制已现成）。

---

## 4. P1 —— 数据积累层（本地持久化 + 长线反馈）

### 4.1 旅程日志（Trip Log）
- 每个 job 记录：起止城市/公司、货物、收入、距离、用时、货损、罚款合计、加油/收费站/渡轮支出。
- 用途：送达时结算卡引用历史均值（"比近 10 单平均多赚 12%"）。

### 4.2 统计面板
- 累计里程（`odometer` 差值，解决 SDK odometer 跨任务连续性问题）、总收入/支出、准时率、零货损率、罚单次数、渡轮/火车次数、按国家/地图 mod 的里程分布。
- 入口：设置面板新 view `stats.vue`，复用主题色体系。

### 4.3 里程碑成就（纯本地）
- 里程类：累计 1/10/100 万 km；质量类：完美交付（0 货损 + 准时）、无罚单连续 N 单；探索类：到达 N 个国家、首次乘渡轮/火车。
- 判定逻辑纯函数化（`app/assets/utils/gameplay/achievements.ts`），进 vitest。
- 通知中心承载成就弹出，不新增 UI 通道。

### 4.4 持久化与 settings v2
- 日志/成就落盘：Electron 用 `@capacitor/filesystem` 既有通道；浏览器端 localStorage + 导出 JSON。
- `SETTINGS_SCHEMA_VERSION 1→2`：新增 `gameplay` 块（`alerts: { speedVoice, fatigueThreshold, fuelReserve, tolls }`、`statsEnabled`）。迁移函数写进预留的 `MIGRATIONS` map 并补测试。

---

## 5. P2 —— 深度功能（需要少量新数据/算法）

### 5.1 路线偏好开关
- **避开渡轮**：`edge.isFerry` 已在图里，worker 加惩罚权重即可，零数据改动，可考虑提前到 P1。
- **避开收费站**：需要 `app/scripts/packer.ts` 阶段给边补 toll 标注（一次性离线工作，图重打包）。
- **避开城市**：利用城市区域网格给城市边缘加惩罚，模拟"走外环"。

### 5.2 城区提前减速提示
- 城市网格查询已在热路径（b629434），路线前方 N km 落入城市区域时提前播报"前方进入城区"。

### 5.3 送达表现分（Delivery Score）
- 综合：准时率 × 货损 × 罚单 × 送达时长 vs ETA，输出 S/A/B/C + 一句话评价，接入结算卡与统计页。纯函数，本地计算。

### 5.4 Discord RPC 增强
- Electron 端已接 Discord RPC，补送达/罚单状态行（`electron/src/discordRpc.ts`）。

---

## 6. 建议里程碑

| 里程碑 | 内容 | 依赖 |
|---|---|---|
| M1 | P0.1–P0.5（看板、结算、疲劳、续航、事件中心） | 无 |
| M2 | P0.6–P0.7（声音/震动、车损） + settings v2 | M1 的通知中心 |
| M3 | P1 全部（日志、统计、成就、持久化） | M2 settings v2 |
| M4 | P2.1–P2.2（avoid ferry/toll、城区提示） | packer 重打包 |

每档自带验收项：路由/数学逻辑进 `tests/`（成就判定、续航估算、settings 迁移），UI 走三端手测（浏览器 + APK + EXE）。

## 7. i18n 与交互备注

- 所有新文案进 `app/locales/` 全部 7 个语言（en/de/nl/cs/sk/ro/ko），`Translations.ts` 已是集中入口。
- 默认全部播报关闭或低打扰，尊重"这是第二块屏幕"的使用场景。
- 成就与统计**不联网**，避免引入账号系统的复杂度。

---

## 8. 实现状态（2026-11-07）

全部经 vitest（76 测试）+ `nuxt typecheck` 验证，按里程碑提交：

### ✅ M1 — `44e37b0` feat(gameplay): job panel and delivery settlement card
- [x] 3.1 任务看板（`jobCard.vue`：货名/货重/收入/倒计时分级/货损条/ETA 对比）
- [x] 3.2 送达结算卡（`deliveryCard.vue`：收入/XP/货损/加成 chips，取消变体）

### ✅ M2 — `0d494e7` feat(feed): economy event feed with sound alerts, settings v2
- [x] 3.3 部分疲劳提醒（<20min 边沿 toast + 震动；沿路线找休息点未做，见下）
- [x] 3.5 事件通知中心（`eventToast.vue` + `eventDrawer.vue`，罚单/收费站/渡轮/火车/送达/取消，上升沿检测）
- [x] 3.6 超速蜂鸣 + 震动（`SoundAlerts.ts`，WebAudio + navigator.vibrate，零依赖）
- [x] 4.4 settings v2（`gameplay` 块，迁移已实装）

### ✅ M3 — `da3567d` feat(stats): trip log, statistics and local achievements
- [x] 4.1 旅程日志（localStorage，500 条，开销归属 job）
- [x] 4.2 统计面板（settings 新 Statistics 视图，含净收益/平均货损/最近任务）
- [x] 4.3 6 个本地成就（纯函数判定，解锁走 feed toast）

### ✅ M4 — `43c493b` feat(routing): avoid-ferries preference and urban-entry warnings
- [x] 5.1 避开渡轮（`isFerry` 边 +25km 惩罚，profile 开关，切换即重算）
- [x] 5.2 城区提前减速提示（stats cache 附带城区入口 km 标记，1.5km 前预警）
- [x] 5.4 Discord RPC 增强（送达/罚单/取消状态行，3 分钟 TTL，后续提交）

### ⬜ 未实现 / 后续
- [ ] 3.3 沿路线搜索休息点/加油站打标（服务区 prefab 图层已有，需要沿路线查询）
- [ ] 3.4 续航规划（`fuelRange` 对比剩余距离，同上路线查询基础设施）
- [ ] 5.1 避开收费站（需要 QGIS 源数据重跑 `packer.ts` 给边补 toll 标注）
- [ ] 5.3 送达表现分（数据已在旅程日志里，纯函数可随时加）

### 待实车验证
- `remainingDeliveryTime` 日期语义假设（deadline − gameTime）
- 渡轮/火车 flag 存活时长与详情到达时序（上升沿 + 4s 窗口是否够）
- 25km 渡轮惩罚量级、1.5km 城区预警距离的体感调参
- Electron WebAudio 首帧需用户手势（已有 `resume()` 兜底）
