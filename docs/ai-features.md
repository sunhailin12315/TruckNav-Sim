# TruckNav-Sim AI 功能设计（行车报告 + 智能播报）

> 目的：为 TruckNav-Sim 引入 AI 能力，首发两个功能——**AI 行车报告**（任务完成/会话结束的个人化驾驶点评）与 **AI 播报脚本**（路线规划后预生成的口语化导航播报）。
> 范围：基于 v0.6.2 现有数据与代码结构，不依赖游戏端改动；Phase 3（自然语言指令/Copilot）只列方向不展开。
> 核心立场：AI 是"叙述与建议"层，不是"导航计算"层；无网络、无 key 时 app 行为与现状完全一致。
> **状态（2026-11-15）**：Phase 1 + Phase 2 与第二轮增强（§10）已实现，230 项测试与 typecheck 全绿；本文档 §5.2/§6.1/§6.2 已按实现修订（报告上下文为纯回溯数据、播报短语按转向生成且情境条目暂缓）。实车验证待做。

---

## 1. 四条设计原则

1. **确定性边界**。路由（A*/图搜索）、ETA、限速判断、播报触发时机全部留在现有规则引擎里。LLM 只产出文本（报告叙述、播报文案），绝不参与路径计算——幻觉出现在路线几何上是不可接受的。
2. **单一协议抽象**。只实现 OpenAI-compatible `/chat/completions`。DeepSeek、Qwen（DashScope compatible-mode）、GLM、OpenAI 以及本地 Ollama/LM Studio（`http://localhost:11434/v1`）全部走同一通道，设置页仅暴露 endpoint / apiKey / model 三项。
3. **离线降级**。AI 是增强不是依赖：没有 key = 完全不调网络；请求失败 = 静默回退到现有模板文案；坏 JSON = 解析容错后丢弃。任何 AI 路径都必须有"和今天一模一样"的退路。
4. **token 预算**。上下文由 ContextBuilder 裁剪为紧凑 JSON（只送聚合值与名字，不堆原始遥测）；播报按路线一次性预生成后缓存；触发频次受事件驱动（不轮询）。

## 2. 数据盘点：AI 原料已在内存，零新增采集

| 数据 | 位置 | Phase 1 | Phase 2 |
|---|---|:-:|:-:|
| 单趟记录（收入/罚款及次数/过路费/渡轮/火车/货损/XP/距离） | `TripRecord`（`app/assets/utils/gameplay/tripLog.ts`） | ✅ | — |
| 会话聚合（送达数/净收入/均货损…） | `computeDriveReport`（`app/assets/utils/gameplay/stats.ts:44`） | ✅ | — |
| 实时油量/续航/均耗、六项损伤、货物损坏 | `TelemetryPacket.truck`（`app/types/telemetry.ts`） | ✅ | ✅ |
| 疲劳剩余分钟 `nextRestStopMinutes` | `TelemetryPacket.common` | ✅ | ✅ |
| 罚单事件（类型+金额）`finedData` | `TelemetryPacket.gamePlayEvents` | ✅ | — |
| 任务信息（起讫城市/公司/货物/收入/剩余时限） | `TelemetryPacket.job` | ✅ | ✅ |
| 路线 maneuver 列表、总距离/时间 | `RouteController` composable | — | ✅ |
| 沿线 POI | `poiAlongRoute`（`app/assets/utils/routing/`） | — | ✅ |
| 界面语言（8 种，含 zh/en） | `settings.locale` | 输出语言 | 输出语言 |

发送给模型的内容只有**虚拟游戏数据**（城市名、聚合金额、损伤百分比），无真实个人信息；API key 仅存本地 settings。

## 3. 总体架构

```
数据层（现成，零改造）
  TripLog / TelemetryPacket / RouteController / settings
        │
        ▼
ContextBuilder        app/assets/utils/ai/contextBuilder.ts   纯函数，可单测
  按功能裁剪为紧凑 JSON 上下文（token 预算内）
        │
        ▼
AIService             app/assets/utils/ai/aiClient.ts         OpenAI-compatible client
  fetch POST /chat/completions；超时 15s；AbortController 可取消；失败一次重试后放弃
        │
  ┌───┴──────────────────────┐
  ▼                          ▼
①行车报告叙述              ②播报脚本（结构化 JSON）
  driveReportCard 底部       RouteController 规划成功后预生成，
  折叠区异步生成             按里程碑缓存触发 → VoiceGuidance.speak()
```

**新增文件清单**（代码英文，注释风格随现有 utils）：

| 文件 | 职责 |
|---|---|
| `app/assets/utils/ai/aiClient.ts` | OpenAI-compatible 客户端：构造请求、超时、取消、一次重试、非 200 处理。返回原始文本，不做业务解释 |
| `app/assets/utils/ai/contextBuilder.ts` | 纯函数：`buildDriveReportContext(...)` / `buildScriptContext(...)`，输入业务对象输出紧凑 JSON 字符串 |
| `app/assets/utils/ai/prompts.ts` | 提示词模板（按 `settings.locale` 选输出语言）+ JSON 解析容错（剥离 ```json 围栏、截断补救） |
| `app/composables/useAI.ts` | 单例状态：配置就绪态、在途请求管理（切路线/关卡片时 abort）、报告缓存 |
| `app/components/settings/views/aiSettings.vue` | AI 设置视图：开关、endpoint、apiKey（password 框）、model、"测试连接"按钮 |
| `tests/ai/*.test.ts` | contextBuilder、解析容错、脚本里程碑匹配的纯函数单测 |

## 4. 设置：`AppSettingsState` 新增 `ai` 分组

```ts
// app/assets/utils/shared/settingsSchema.ts
export interface AiSettings {
    /** Master switch; when false nothing ever calls the network. */
    aiEnabled: boolean;
    /** OpenAI-compatible base URL, e.g. https://api.deepseek.com/v1 */
    aiEndpoint: string;
    /** Stored locally only; never logged, never synced. */
    aiApiKey: string;
    /** e.g. "deepseek-chat", "qwen-plus", "glm-4-flash", "llama3.1:8b" */
    aiModel: string;
    /** Phase 1: AI narration on the drive-report card. */
    aiDriveReport: boolean;
    /** Phase 2: spoken-cue style. "template" keeps today's behavior. */
    aiVoiceStyle: "template" | "ai";
}
```

- `SETTINGS_SCHEMA_VERSION` 10 → 11，`MIGRATIONS` 补一条：旧档填默认值（`aiEnabled: false`，endpoint 预填 `https://api.deepseek.com/v1` 但不启用）。
- 设置页 `settings/views` 下新增 AI 视图；`aiEnabled: false` 时其余项置灰。
- "测试连接"按钮发一个 1-token 请求验证 endpoint/key/model 三元组，结果就地反馈。

## 5. Phase 1 — AI 行车报告

### 5.1 触发与缓存
- **触发**：`driveReportCard.vue` 打开且 `aiDriveReport` 开启时异步生成；同一 `sessionStart.maxTripId` 锚点只生成一次，期间新增任务后缓存失效重算。生成期间卡片显示现有统计 + 骨架占位；失败或未开启则卡片与今天完全一致。
- **取消**：关闭卡片时 abort 在途请求。

### 5.2 上下文（ContextBuilder 输出，示意）
```json
{
  "session": {
    "delivered": 4, "cancelled": 1, "distanceKm": 812,
    "grossIncome": 96500, "netIncome": 78120, "penalty": 0,
    "fines": {"count": 3, "total": 1250, "reasons": ["Speeding"]},
    "tolls": 860, "ferry": 120, "train": 0, "avgCargoDamagePct": 2.1,
    "trips": [{"from": "Calais", "to": "Duisburg", "cargo": "Construction pieces",
               "massT": 18, "income": 15200, "distanceKm": 412,
               "cancelled": false, "cargoDamagePct": 3, "finesCount": 1}]
  },
  "lifetime": {"delivered": 132, "avgIncomePerDelivered": 21000,
               "avgDistancePerDeliveredKm": 312, "avgCargoDamagePct": 4.0,
               "finesTotal": 5300}
}
```
注意：只送聚合与枚举名，不送坐标、不送时间戳精度高于分钟。疲劳/油量等**实时**遥测不进报告上下文——报告是纯回溯数据（TripLog），不与遥测会话耦合，卡片离线打开也应可用。

### 5.3 输出契约与渲染
- 提示词要求返回 JSON：`{"summary": "<2–3 句点评>", "tips": ["<1 条最具体的建议>"]}`。
- 点评须引用数字（如"3 张罚单全是超速"），建议只给一条、必须可执行（如"建议开启限速提示音"）。
- 渲染：卡片底部折叠区"AI 点评"，summary 一段 + tips 列表；语言跟随 `settings.locale`（提示词指定目标语言）。

### 5.4 提示词要点（`prompts.ts` 中文基准，按 locale 渲染）
- 角色：卡车型导航 app 的副驾教练，语言像老司机，不用客服腔。
- 硬约束：只用输入 JSON 里的数字与地名，不得编造；输出 JSON，不输出多余文字。
- 上一会话数据存在时做对比（油耗/罚款趋势），不存在时不提。

## 6. Phase 2 — AI 播报脚本（预生成，非实时）

### 6.1 关键洞察：触发与发声分离
现有播报是"**模板句** × **固定里程碑触发**"（`voiceAnnouncements.ts` 的 `TURN_ANNOUNCEMENT_THRESHOLDS_KM = [5, 3, 1]`）。AI 不接管触发，也不实时生成——**触发引擎与距离前缀（"前方5公里"）原样保留，只把"转向描述"换成按路线预生成的口语短语**：

```
路线规划成功（map.vue watch fullRouteDirections，且 aiVoiceStyle === "ai"）
   —— 规划/重算会整体重赋值 ref，而驾驶进度 shift 原地改窗口不触发 watch，
      天然只在规划时生成一次
        │ 一次性调用（后台异步，不阻塞规划）
        ▼
buildVoiceScriptContext（voiceScript.ts）：非 depart/destination 的转向列表
                    （cap 30 个，{i: step.id, type, km, exit}）+ 总里程
        ▼
模型输出结构化短语 JSON：
{"cues": [{"i": 3, "text": "前面要左转了，提前并线"},
          {"i": 7, "text": "环岛，走第二个出口"},
          {"i": 12, "text": "下高速，注意减速车道"}]}
        ▼
缓存 Map<step.id, phrase>（routeKey + locale 键控去重）
        │
        ▼
行驶中里程碑触发（pickTurnAnnouncement 原逻辑不动）
   → 播报文案 = 模板距离前缀 + (AI短语 ?? 模板转向文案)
```

- **零改动受益**：AI 文本进入 `speak()` 门面后自动获得 neural 缓存（按 `<locale>:<text>` 键控）、"最新播报顶掉旧播报"、neural/OS 双引擎——TTS 层一行不用动。
- **重算防护**：reroute 整体重赋值 directions → 触发重新生成并 abort 旧请求；生成完成前播报回退模板句（无缝，用户无感）。短语查找键是生成时的 step.id 快照，不随窗口滑动漂移。
- **规模上限**：单次生成 cap 30 个转向；更远的转向保持模板文案。疲劳/油量等**情境播报保持模板**——安全类短句不应每次措辞不同，此为对原设计的有意收敛（原"milestoneKm: -1 情境条目"暂不做）。

### 6.2 提示词硬约束
- 每条短语 ≤ 40 字符（卡车驾驶噪音环境，短句优先）；口语、口语、口语。
- **距离绝不进短语**——距离前缀由模板播报（`voice.aheadOf`）负责，数字保持确定性。
- **只允许使用输入里的 maneuver 类型与环岛出口数**，不得发明"限速摄像头""施工"、街道名等未提供信息。
- 环岛必须把出口数写进短语（"走第二个出口"）。
- 语言跟随 `settings.locale`；melo 神经音只支持 zh/en，其余语言走 OS 引擎（现状已如此，无新增约束）。
- 换语言（locale 切换）触发重新生成——短语缓存键含 locale。

### 6.3 与现有播报体系共存
- `aiVoiceStyle: "template"`（默认）= 与今天完全一致；`"ai"` = 文本来源换成 AI 脚本，回退链：AI 脚本缺失/超时 → 模板句。
- 设置页 AI 视图内联这个切换项，旁边注明"生成于路线规划时，需网络与 AI 开启"。

## 7. 降级与容错矩阵

| 场景 | 行为 |
|---|---|
| `aiEnabled: false` / 无 key | 全部 AI 代码路径短路，零网络请求，UI 与现状一致 |
| 请求超时（15s）/ 网络失败 | 重试一次后放弃；报告卡片无 AI 区块；播报回退模板句 |
| 返回坏 JSON / 围栏文本 | 解析容错（剥围栏、找首个 `{`）失败则丢弃，走回退 |
| 播报脚本生成慢于驾驶进度 | 生成前用模板句，生成完成后切换（跨阈值逻辑自动衔接） |
| key 无效（401/403） | "测试连接"与首次失败时在设置页标红，运行时静默回退 |
| 本地 Ollama 未启动 | 同网络失败路径 |

## 8. 成本估算（供参考）

- 每份行车报告上下文 + 输出 ≈ 0.8k tokens；每条路线脚本 ≈ 1.5k tokens。
- 典型一晚 30 趟任务 + 播报生成 10 次 ≈ 40k tokens——以 deepseek-chat / glm-4-flash 定价计为**分厘级**；本地 Ollama 为零成本。
- 不做流式（两个场景都不需要逐字呈现），不做多轮会话（Phase 3 之前）。

## 9. 实施顺序与验收

| 步骤 | 内容 | 验收 |
|---|---|---|
| 1 | `aiClient` + 设置页 AI 视图 + schema 迁移 | 测试连接对 DeepSeek/Ollama 均通过；旧档迁移无丢档；`aiEnabled:false` 时网络面板零请求 |
| 2 | `contextBuilder`/`prompts` + DriveReport AI 点评 | vitest 覆盖裁剪与解析容错；无 key/断网时卡片与现状像素级一致 |
| 3 | 播报脚本生成 + `aiVoiceStyle` 切换 + 缓存/失效 | reroute 后旧脚本作废；生成期回退模板；AI 条目经 neural 缓存正常发声 |
| 4 | 收尾 | `npm run typecheck`、`npm test` 全绿；文档同步 |

**Phase 3（仅方向，另行设计）**：自然语言目的地/设置指令（解析为 POI 查询或 settings 变更）、行车中 Copilot 问答（工具调用读遥测）。依赖 Phase 1/2 打通的 client 与上下文基建，风险（权限面、延迟、误触发）显著更高，单独立项评估。

---

## 10. 第二轮增强（2026-11-15，已实现）

### 10.1 修复
- **报告缓存补 locale 键**：切换语言后重开卡片会按新语言重新生成点评（此前显示旧语言缓存）。
- **失败冷却**：任一 AI 请求失败后，所有自动触发的功能静默 5 分钟（设置页"测试连接"不受限），避免断网时每次打开卡片都白等超时。
- **Ollama CORS**：跨设备浏览器 + 桌面 Ollama 场景必须在 Ollama 侧设置 `OLLAMA_ORIGINS` 允许本应用来源（设置页 endpoint hint 已注明）。

### 10.2 一次性 AI 提示（新设置项 `aiInsights`，默认开；schema v11→12）
- **路线解读**：规划完成后一句出发简报（总里程/ETA/渡轮数/环岛数/目的地），toast 呈现；AI 播报风格开启时同时语音念出。
- **送达快评**：送达事件触发一句快评（本单收入/距离/货损/XP + 会话累计净收入与罚单数），toast 呈现，AI 播报风格开启时语音念出。
- 组件 `aiNoteToast.vue`（纯展示）；触发点：map.vue 规划 watcher / EtsTelemetry 送达分支（endTrip 之后调用，保证会话聚合含本单）。上下文构建：`buildRouteInsightContext` / `buildDeliveryNoteContext`；解析：`parseAiNote`（`{"note": "..."}` 容错）。

### 10.3 设置页增强
- **Provider 预设**：DeepSeek / Qwen / GLM / OpenAI / Ollama / LM Studio 一键填 endpoint（云端预设连默认 model 一起填；本地预设只填 endpoint，模型名用户自填）。
- **token 用量统计**：`aiClient` 读取响应 `usage` 块（`extractUsage`），会话累计显示于设置页（模块级 `aiUsageTokens`，不持久化）。
- **短语缓存持久化**：AI 播报短语按 routeKey + locale 落 localStorage（LRU 上限 8 条路线），同一规划（跑熟线、重启 app）零请求零延迟命中。

### 10.4 降级矩阵补充
| 场景 | 行为 |
|---|---|
| 任一失败后 5 分钟内 | 所有自动触发静默跳过（冷却期），手动"测试连接"不受限 |
| Ollama 跨设备 CORS 拒绝 | 同网络失败路径（进入冷却 + 回退模板） |
| localStorage 短语缓存损坏 / 写入超配额 | 忽略缓存重新生成 / 仅放弃持久化，功能不受影响 |
