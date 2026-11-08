# TruckNavTelemetry bridge（可重建）

这个目录是 `electron/bin/TruckNavTelemetry.exe` 的**可编译源码**。原 exe 由上游
(ByatisGlaaki, 构建路径 `E:\A.Projects\PROJECTS-C#\TruckNavTelemetry`) 打包，仓库里
从未有过它的源码。本目录的源码由 ilspycmd 反编译原 exe 内嵌程序集重建，并经逐项核对
（解析器 276 个读取调用序列与原程序集逐一相等）。

## 为什么存在

原版把交付剩余时间编码为 `Math.Abs(截止 − 游戏时间)` 分钟后锚在 .NET DateTime 纪元
(公元1年) 伪造成 ISO 日期（`remainingDeliveryTime`）。取绝对值丢失了符号，前端无法
区分"还剩 N 分钟"和"已超 N 分钟"。

**v1.1.0 新增 `job.remainingDeliveryMinutes`（int，带符号，负数=已超时）**，来自 SDK
内部本就计算好的带符号差值。旧字段 `remainingDeliveryTime` 保持逐字节不变，旧客户端
不受影响。前端（`app/composables/EtsTelemetry.ts`）优先读新字段，读不到时回退到
两帧符号恢复（`app/assets/utils/telemetry/deliveryDeadline.ts`）。

## 组成

- `SCSSdkClient/` — 上游 scs-sdk-plugin rev 1.12 的 C# 客户端（MIT，见其目录内
  LICENSE.txt），从 net48 重定向到 net8.0。解析器偏移与游戏内 `scs-telemetry.dll`
  匹配，未做任何改动。
- `TruckNavTelemetry/` — 主程序：共享内存 → `TelemetryPacket` JSON → ws://0.0.0.0:30001
  广播（Fleck 1.2.0，与原 exe 相同版本）。`Data/Packets.cs` 是对外 JSON 契约
  （与 `app/types/telemetry.ts` 一一对应），`remainingDeliveryMinutes` 为 v1.1.0 新增。
- `SmokeA/` — 冒烟测试：用手工构造的 32KiB 共享内存镜像驱动解析器与序列化，验证
  带符号剩余与旧字段编码（`remainingDeliveryTime` 仍是 `Math.Abs` 锚定日期）。

## 重建

需要 .NET 8 SDK（10.x SDK 亦可，会 roll-forward）。

```bash
# 冒烟测试（游戏不用开）
dotnet run --project SmokeA -c Release

# 产出单文件自包含 exe，替换 electron/bin/TruckNavTelemetry.exe
dotnet publish TruckNavTelemetry/TruckNavTelemetry.csproj -c Release -r win-x64 \
  --self-contained -p:PublishSingleFile=true \
  -p:IncludeNativeLibrariesForSelfExtract=true \
  -p:PublishTrimmed=true -p:TrimMode=link -o publish
```

注意：主程序对 `GamePlayEvents.TrainData` / `TollgatePayment` 保持"从不赋值"，与
原 exe 一致（前端事件流依赖它们保持默认值的行为不变）。若未来要接入渡轮/火车金额，
另行改协议并同步前端。

## 验证记录（2026-11-08）

- SmokeA：构造 ETS2 镜像（游戏时间 12789 分、截止 = +660 分）→ 解析得
  `remainingDeliveryMinutes=660`、`remainingDeliveryTime="0001-01-01T11:00:00Z"`；
  截止改到 −30 分 → `remainingDeliveryMinutes=-30`、日期仍 `T00:30:00Z`（abs）。
- 端到端：新 exe 起 ws://30001，ws 客户端收到含 `remainingDeliveryMinutes` 的包。
