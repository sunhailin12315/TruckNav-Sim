# 高德车机版对标分析（AMap Auto 9.5.0.600013）

> 目的：为 TruckNav-Sim 的下一轮升级提供真实车机导航产品的功能参照。
> 分析对象：`Auto_9.5.0.600013_release_signed.apk`（`com.autonavi.amapauto`，minSdk 21 / targetSdk 24）。
> 方法：资源层静态分析（Manifest、HmiRes HMI 配置、引擎配置 JSON、卡片 DSL、ARSC），未反编译原生代码。
> 结论按"可迁移到 TruckNav-Sim"的程度标注：✅ 直接可落地 / ⚠️ 需要验证数据支持 / ❌ 数据不支持。

---

## 1. 总体架构发现

车机版是**单 Activity + 全原生自绘插件 UI**（`MainMapActivity` + ProjConfig.json 中 13 个插件：autonavi 地图引擎、SwitchCard、MyTrack、PhoneConn、DriveReport、EHP、SmartPark、AGroup、WechatBind…），无 Android layout XML——所有 UI 是 HTML-like DSL（卡片配置）+ 原生渲染。这与 TruckNav-Sim 的"第二屏导航仪"定位高度同构。

## 2. 可对标的功能面（附 APK 证据）

### 2.1 三态模式机 ✅（`assets/res/HmiRes/MultipleScreen.json`）
车机版地图有三种模式，每种独立配置 Render/Map/Ui：
- **Cruise 巡航态**：未导航，自由浏览 + 限速/路况常显
- **Preview 全览态**：路线规划后/导航中查看全程，非跟车相机
- **Guide 导航态**：跟车相机 + 转向卡

TruckNav-Sim 现状：只有"跟车/自由"两态（`MapCamera.followTruck`），导航中无全览。
→ **提案 M7.2**：导航中加"全程概览"按钮（fitBounds 路线包围盒，N 秒后自动回跟车）。

### 2.2 导航卡片类型学 + 互斥调度 ✅（`assets/res/HmiRes/guide_card_normal.json`）
导航页底部卡片共 22 种，配置驱动的优先级调度（priorityValue 0–4，ShowAndShow / ShowAndClose / ShowAndHide / HideAndShow / CloseAndShow 五种转移），支持 portrait/landscape 分屏规则、Touch/Immerse 模式规则。核心卡片：
| 卡片 | 语义 | TruckNav-Sim 对应 |
|---|---|---|
| GuideCardIDSAPA | 服务区/停车区推荐 | ✅ 已有（M5 rest/fuel 建议） |
| GuideCardIDEnergyWarn | 油量警告 | ✅ 已有（M5 续航规划） |
| GuideCardIDRecommendRoute | 备选路线推荐 | ❌ **无——见 M7.1** |
| GuideCardIDAddVia / DelViaManual / DelViaAuto | 途经点添加/手动删/过点自动删 | ⚠️ multi-stop 基础设施已有，过点自动删未见 |
| GuideCardIDDynamicNavi | 路况变化自动重算提示 | ⚠️ reroute 存在但无可见反馈 |
| GuideCardIDGpsWeak | GPS 弱提示 | ⚠️ 遥测断线已有，可复用为"信号弱"卡 |
| GuideCardIDTBTCard | 转向卡 | ✅ 已有（maneuverCard） |
| GuideCardIDGroupIM / AGroupDest | 组队消息/组队目的地 | ❌ 见 2.7 |
| GuideCardIDParkRecommend | 到达后停车推荐 | ⚠️ 送达目的地上屏可给"公司入口"提示 |
| GuideCardIDBrandSelect / DiscountGasDest | 加油站品牌/优惠 | ❌ 游戏无此数据 |

→ **提案**：`warningSlide/sheetSlide` 卡片区对齐这套"优先级互斥"思想（同一时刻只有一张主动卡，事件卡抢占后自动归还），不必照抄 22 种。

### 2.3 备选路线对比字段 ✅（`assets/res/HmiRes/card_config/guide_alternative_path_label.xml`）
备选路线徽标 exactly 四个字段：**时间差**（快3分钟）、**过路费差**（少3元）、**距离差**（多1公里）、**红绿灯数差**（少3个）。
→ **提案 M7.1**：worker 以不同权重算 2–3 条备选（默认 / 少收费=toll 惩罚加倍 / 避开渡轮），路线页并排对比时间/距离/收费站数。RouteController 现有惩罚权重机制（M4/M6）天然支持多次计算。

### 2.4 沿途 POI 气泡 ✅（`assets/res/HmiRes/card_config/along_route_pop_label.xml`）
沿途建议点气泡 = **名称 + 绕行时间差(+4分钟) + 绕行距离差(+493米) + "最佳"徽标**。
TruckNav-Sim 现状：M5 的 rest/fuel 建议只打标，不给绕行代价。
→ **提案 M7.3**：给建议点补 `+X分钟/+Y米`（沿路线 waypoint 前后段求和即可算），照搬"最佳"徽标。

### 2.5 昼夜主题 + 六时态氛围 ✅（`assets/res/HmiRes/map_day/night.txt` 全套主题对；`EngineRes/bl_data/MapConfig.json`）
- 所有页面均为 **day/night 成对主题**（map/route/search/broadcast…）；
- 地图引擎支持**六时态动态天空**：dawn_1 / dawn_2 / day / dusk_1 / dusk_2 / night。
TruckNav-Sim 现状：**全库无 night 概念**，地图配色（landColor/roadColor/backgroundColor）是静态用户配色。
→ **提案 M8**：settings 定义 day+night 两套配色，按 gameTime 分档自动切换（晨/昼/暮/夜 + 过渡插值），HUD 主题联动。纯前端，PMTiles 样式全部是 runtime paint 属性，切换成本低。

### 2.6 音效与播报 ✅（`assets/res/HmiRes/*.wav`、broadcast_day.txt）
音效体系：`camera.wav` 电子眼、`traffic_light.wav` 红绿灯、`edog_dingdong.wav`、**`autoreroute.wav` 重新规划提示**、`msg_pop.wav`、`volume_change.wav`；
播报体系：简洁播报开关、混音模式（压低/暂停音乐）、TTS 语音包目录（`voice_conf/voicedata.json`）。
TruckNav-Sim 现状：SoundAlerts 只有超速蜂鸣；转向 TTS 播报（P0.6 遗留）未做；偏航重算静默。
→ **提案 M9**：转向 TTS（Web Speech API）+ 简洁播报档 + 偏航重算提示音/toast。

### 2.7 服务清单旁证
`CarTeamService`（组队）、`IntelligentSpeedLimitService`（智能限速）、`FloatWindowService`（悬浮窗）、`ProtocolService/JsonProtocolService`（手机互联协议）、讯飞 `NavigationService`、桌面小组件 `AutoWidgetProvider`。
- 组队：**❌ ETS2/ATS 无多人位置遥测，不可做**；
- 智能限速：✅ 已有 speedLimit + 超速蜂鸣，后续可做"限速变化提前预警"（沿路线查限速骤降段）；
- 悬浮窗/小窗：⚠️ Electron 端可做置顶迷你 HUD，优先级低。

### 2.8 驾驶报告 DriveReport ✅
主页卡片之一（libcmb_DriveReportPackage）。TripLog/统计页已有约 70% 数据。
→ **提案 M10（可选）**：把统计聚合成"本次行程/本周"报告卡，送达后顺带展示。

### 2.9 沿途搜索分类 ✅（`assets/res/HmiRes/search_config/search_enroute_category.txt`）
沿途搜索 11 类：充电/加油/美食/卫生间/加气/洗车/酒店/服务区/途径路/天气/景点。
TruckNav-Sim 的 spritelocations 图层实际有哪些 POI 类别需验证（已知 service_ico/gas_ico/toll_ico）。
→ **⚠️ 待验证**：若 sprite 表含 hotel/washing 等，可低成本扩 M5 的沿途建议类别。

## 3. 差距矩阵（按优先级）

| # | 差距 | 对标来源 | 状态 |
|---|---|---|---|
| 1 | 备选路线 + 对比徽标 | 2.3 | ✅ M7.1 已实现 |
| 2 | 昼夜双主题 + 时相氛围 | 2.5 | ✅ M8 已实现（四时相连续过渡） |
| 3 | 全程概览（Preview 态） | 2.1 | ✅ M7.2 已实现 |
| 4 | 沿途建议绕行代价气泡 | 2.4 | ✅ M7.3 已实现（toast 形式） |
| 5 | 转向 TTS / 简洁播报 / 偏航提示音 | 2.6 | ✅ M9 已实现（Web Speech，混音模式不适用） |
| 6 | 卡片互斥调度（事件卡抢占） | 2.2 | ⚠️ 简化为串行 |
| 7 | 途经点过点自动删 | 2.2 | ⚠️ |
| 8 | 限速变化预警 | 2.7 | ⚠️ |
| 9 | 驾驶报告卡 | 2.8 | ✅ M10 已实现（会话维度报告卡） |
| 10 | 组队/红绿灯/车道级/电子眼 | 2.7 | ❌ 游戏数据不支持 |

## 4. 建议里程碑

| 里程碑 | 内容 | 依赖 |
|---|---|---|
| **M7 路线体验** | 7.1 备选路线对比 · 7.2 全程概览 · 7.3 沿途气泡代价 | RouteController/MapCamera 现有能力 |
| **M8 昼夜氛围** | 8.1 day/night 配色对 + gameTime 自动切换 · 8.2 晨/昼/暮/夜四时相过渡 · 8.3 HUD 主题联动 | settings v3（MIGRATIONS 已预留） |
| **M9 语音播报** | 9.1 转向 TTS + 简洁档 · 9.2 偏航重算提示音/toast · 9.3 音效扩展 | Web Speech API，零新依赖 |
| **M10 报告卡** | DriveReport 式行程报告（可选） | TripLog |

每档可独立交付；i18n 全语言（8 个 locale，含新增 zh）照旧走 `Translations.ts`。

## 5. 原始证据留存

- APK：`C:/Users/shl/Downloads/Auto_9.5.0.600013_release_signed.apk`（只读）
- 提取与脚本：`%TEMP%/amap-extract`、`%TEMP%/amap-scripts`（临时目录，可随时重跑）
- 关键文件：`ProjConfig.json`（插件清单）、`guide_card_normal.json`（卡片调度）、`card_config/*.xml`（徽标字段）、`MultipleScreen.json`（三态模式机）、`MapConfig.json`（六时态天空）、`search_enroute_category.txt`（沿途分类）
