# AGENTS.md — TruckNav-Sim 开发规范

## 项目一句话

ETS2/ATS 的**外置** GPS 导航（TS/Nuxt 4 + Vue 3，经 Capacitor 打包 APK/EXE/浏览器多端）：游戏 → `scs-telemetry.dll` → `bridge/`（C# WebSocket 推流）→ 前端（MapLibre 地图、自建路由图、TTS 播报、AI 副驾）。**外置架构是可维护性的刻意选择**，不轻易换成注入/内存读取。

## 改动在哪里（目录地图）

| 位置 | 职责 |
|---|---|
| `app/assets/utils/` | 核心逻辑，按域分包：`routing/`（图搜索/转向/POI）、`telemetry/`、`guidance/`、`map/`、`gameplay/`、`ai/`（client/contextBuilder/prompts）、`shared/` |
| `app/composables/` | 有状态控制器：`RouteController`、`MapLibre`、`EtsTelemetry`、`Settings`、`Translations` 等 |
| `app/workers/route.worker.ts` | 路由计算 Web Worker（主线程不碰大图搜索） |
| `electron/src/` | 桌面主进程：`scanMap.ts`（内置地图扫描）、`cloudTts.ts`/`neuralTts.ts`、`settingsManager.ts` |
| `scripts/scan-worker/` | 地图扫描管线 worker（产物进 `electron/resources/scan/`，需 `TRUCKNAV_SCAN_TOOLS_DIR`） |
| `bridge/` | C# 遥测桥（`TruckNavTelemetry`，30 Hz 广播节流；`SmokeA` 冒烟测试） |
| `server/plugins/startTelemetry.ts` | dev/服务端遥测通路 |
| `tests/<域>/*.test.ts` | vitest，`environment: node`，与被测 `utils/` 分包同名 |
| `app/locales/` | 8 语言文案（含 zh/en），改动须同步全部语言 |
| `docs/` | 设计文档与外部项目学习笔记（见"开放学习"节） |

## 常用命令

```bash
npm run dev            # nuxt dev
npm test               # vitest run（tests/ 全量，当前 250+ 项）
npm run typecheck      # nuxt typecheck
npm run build:scan     # 扫描 worker bundle（需 TRUCKNAV_SCAN_TOOLS_DIR）
npm run electron:sync  # generate + cap sync + 桌面端启动
npm run version:sync   # 版本号同步（package/capacitor/electron）
```

## 工程红线（提交即视为已履行）

1. **质量门**：提交前 `npm run typecheck` 与 `npm test` 必须全绿；修 bug 先加能复现的测试。
2. **确定性边界**（`docs/ai-features.md` 四原则）：路由/ETA/限速/播报触发全部留在规则引擎；LLM 只产出文本；无 key/断网/坏 JSON 必须回退到"和今天一模一样"的模板路径；token 预算受 ContextBuilder 裁剪。API key 只存本地 settings。
3. **数据一致性**：屏上数字与游戏内显示同源对齐是本项目最高原则（比例尺、剩余距离、时间换算如 `REAL_TIME_DELAY_FACTOR`）；引入新数字先回答"游戏里对应哪个计数"。
4. **多端回归意识**：同一改动常要验 EXE + APK/浏览器 + 8 语言三轴；Worker/主进程双环境代码避免环境耦合。
5. **提交信息**：Conventional Commits（`feat|fix|perf|chore(scope):`），中英文均可，写清"改了什么、为什么"，性能改动附前后数据。

## 开放学习：学思路，不闭门造车也不复制粘贴

对待外部项目（ETS2LA、WestPlay、ts-map、truckermudgeon 等，先例见 `docs/ets2la-reference-study.md`、`docs/westplay-reference-study.md`）：

1. **学思路，不搬代码。** 借鉴止步设计级：架构切分、生命周期处理、信号滤波方法、参数哲学。许可证是硬边界——外部参考源码只读，摘录存 `.zcode/<project>-ref/`（git-ignored），结论沉淀为 `docs/<project>-reference-study.md`（定位对比 + 精读笔记 + 带优先级和代价评估的落地清单）。
2. **取其精华，去其糟粕。** 每个借鉴点必须写明：落点（本仓库哪个文件/模块）、代价/风险、优先级。不适合的方案明确标记"不跟进"并说明理由（例：UID 级路线锚点需游戏内插件逐版本跟特征码，终身成本 > 收益，故维持几何匹配），而非无限期观望。
3. **不照单全收，也不照单全拒。** "别人说不行"或"别人这么做"都不构成论据。WestPlay 用 Rust、ETS2LA 用 C#，栈不同不代表思路不可移植；反之，上游再活跃也不代表其路线适合我们。
4. **决策留痕。** 采纳/拒绝某借鉴项时，在学习笔记的对照表里更新状态与理由，让"为什么没用"和"为什么用了"同样可查。

## 一切以实际数据做支撑

1. **性能断言先测量再下结论**：开销给量级（% 单核 / 每拍耗时 / 内存 MB），并注明是**实测**还是**结构推算**；优化前后要有对比依据，不接受"感觉会快"。
2. **行为判断先跑现状**：读相关代码与既有测试，再动手；引用外部教训要落到具体出处（文件:行、issue 编号）——例：ETS2LA #555/#563 证明高频循环的风险在写法本身（tick 落后不睡会打满一个核；60 Hz 每拍重建 mmap 应改为句柄复用 + 每秒一次轻量重校验，而不是每秒真的 close/open）。
3. **警惕凭印象**：数字（测试数、频率、大小）以当次运行输出与当轮源码为准；文档中的旧数字不可直接采信。
4. **实测条件要交代**：报性能数据附平台/硬件档位与负载场景；无法实测时明确说"未实测"，给出推算方法而非拍脑袋百分比。

## 代码与文档风格

- 代码标识符用英文；注释风格随所在目录现有 utils；文档正文中文（`docs/` 现有风格）。
- 新逻辑进 `utils/<域>/` 做**纯函数 + 单测**，副作用留在 composables/主进程——参照 `contextBuilder.ts`、`scan-worker/convert.ts` 的形状。
- 改投影/序列化等数值管线时，必须有与 app 端逐点一致性的对照测试（先例：`tests/shared/scanConvert.test.ts` 对 `convertEts2ToGeo`）。
