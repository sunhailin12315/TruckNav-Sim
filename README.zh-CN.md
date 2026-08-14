# Truck Nav

> [English](README.md) | [中文](README.zh-CN.md)

**Truck Nav** 是一款为《欧洲卡车模拟2》(ETS2) 和《美国卡车模拟》(ATS) 打造的外部 GPS 导航系统，使用 TypeScript 构建。它可以作为 APK、EXE 或浏览器应用运行（非常适合手机、平板或副屏使用），提供基于游戏内地图的实时定位和路线规划。

<div align="center">
    <a href="https://discord.gg/C5BTXCF2jC">
        <img src="https://img.shields.io/badge/Discord-Join_Community-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord">
    </a>
    <a href="https://forum.scssoft.com/viewtopic.php?t=349145">
        <img src="https://img.shields.io/badge/SCS_Forums-Official_Topic-2C3E50?style=for-the-badge&logo=discourse&logoColor=white" alt="SCS论坛">
    </a>
    <a href="https://buymeacoffee.com/raresmnt">
        <img src="https://img.shields.io/badge/Support_the_Project-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black" alt="资助项目">
    </a>
    <br />
    <br />
    <img width="300" alt="image" src="https://github.com/user-attachments/assets/6860e478-3c32-4143-97c4-fca8876ce90f" />
    <img width="300" alt="image" src="https://github.com/user-attachments/assets/a977ea5f-af6f-49e2-adc4-78c8afef9879" />
</div>

# 当前状态：开发中 / 演示版

请将本项目视为 **演示版** 或 **Alpha 版**。

虽然核心导航功能可以工作，但项目还远未完善。构建路由图需要在 **QGIS** 和脚本方面投入大量工作，修复道路片段、环岛和交叉口，以确保 GPS 知道哪里可以去、哪里不能去。

- **ATS / ETS2 版本**: 支持至 **1.58** ✅
- **支持的 DLC**: 全部 ✅
- **地图模组**: 暂无 ❌

# 已知问题与限制

### ⚠️ 常见问题
*   **公司区域:** 如果你深入公司院内，GPS 路由可能会失败。如果出错，请尝试将卡车稍微移向出口再设置目的地。
*   **地图缺口:** 当前使用的图数据可能产生一些错误（断路、非法掉头），但 99% 的情况下会显示正确的路线。

### 📈 性能与兼容性
> [!NOTE]
> *   **性能:** 持续优化中。在较旧的平板或手机上，地图渲染可能会有些卡顿。
> *   **地图支持:** 当前支持原版 **ETS2/ATS + 所有 DLC** (最高至 v1.58)。**ProMods** 等地图模组暂 **不支持**。

> [!CAUTION]
> **真实公司名称模组:** 如果你使用了除 **MLH82** 之外的修改公司名称的模组，导航可能会失败或路由错误。本应用仅针对原版和 **MLH82** 制作的「Real companies, gas station & billboards for ATS and ETS2」模组进行了优化。

# 通过 .exe 文件安装

1. 从 [Releases](https://github.com/Rares-Muntean/ets2-navigation-gps/releases) 页面下载最新的安装文件。

2. 运行下载的安装文件并完成安装。

3. 在电脑上启动 Truck Nav。

4. 在平板或手机上安装 .apk 文件。

5. 打开 **手机应用** 或 **任意设备的 web 浏览器**，输入电脑应用中显示的 IP 地址。

# 通过 Node.js 安装

## 前提条件

安装前，请确保你的电脑上已安装以下软件：

1.  **Node.js (LTS 版本):** 运行应用必需。
   - 下载最新 LTS 版本（推荐）: [https://nodejs.org/](https://nodejs.org/en/download)
2.  **Git:** 用于自动克隆遥测仓库。
   - 下载 Git: [https://git-scm.com/downloads](https://git-scm.com/downloads)

## 安装步骤

### 1. 获取代码

你可以使用 Git 克隆仓库（推荐，便于更新）或下载 ZIP 文件。

**方式 A: Git 克隆（推荐）**
打开终端或命令提示符，运行：
```bash
git clone https://github.com/Rares-Muntean/TruckNav-Sim.git
cd TruckNav-Sim
```

**方式 B: 下载 ZIP**
1. 点击页面顶部的 Code 按钮，选择 `Download ZIP`。
2. 将文件解压到电脑上的一个文件夹。
3. 在终端或 VS Code 中打开该文件夹。

### 2. 环境准备 (Windows 用户)

如果你在 Windows 上运行，可能需要执行以下命令以确保安装顺利进行。

**PowerShell 脚本执行策略:**

如果遇到 PowerShell 脚本被禁用的错误，请以管理员身份运行以下命令之一：

*临时修复（推荐）:*
```Powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

*永久修复:*
```Powershell
Set-ExecutionPolicy RemoteSigned
```

### 3. 安装依赖
```bash
npm install
```

## 运行应用

使用以下命令启动开发服务器，等待 ETS2 遥测服务器克隆完成：
```Bash
npx nuxi dev --host 0.0.0.0
```

按照打开的 .exe 中的说明，将遥测插件 DLL 安装到你的游戏目录。

## 在浏览器中访问应用

在终端中点击网络链接打开应用（本地链接可能存在遥测获取问题）：
```Bash
➜ Network: http://192.168.1.x:3000/
```

# 🐧 Linux 与 Steam Deck 支持

官方的原生 Linux 支持是路线图中的优先事项，但在核心架构定型之前需要一些时间来实现。

如果你是 Linux 用户且急需解决方案，请使用社区维护的分支（由 Jeroen van Straten 维护）。他在这方面投入了大量工作，他的研究成果将成为未来官方 Linux 支持的基础。

[TruckNav Linux 分支 (by Jeroen van Straten)](https://github.com/jvanstraten/TruckTel)

# 工作原理

1. **遥测:** 应用使用遥测服务器从运行中的游戏中直接拉取数据（坐标、速度、方向）。
2. **地图:** 游戏内坐标被转换为标准的 **WGS84** 投影，以便与 Web 地图库配合使用（可能仍会出现视觉问题）。
3. **路由:** 基于游戏文件构建的自定义图数据允许应用计算到目的地的最短路径。

<div align="center">
    <img width="895" height="649" alt="close-up-gps" src="https://github.com/user-attachments/assets/4c593709-6f91-4109-9685-bc292ead920e" />
</div>

# 如何帮助改进地图

如果你测试应用并发现异常行为，可以通过报告发现的问题来帮助改进导航。

### 报告内容
- 问题的简要描述
- 应用的截图

### 报告方式

将你的发现发送至以下 **任一** 渠道：

* raresmnt@yahoo.com
* Discord 服务器 -> #🪲-bugs
* GitHub -> Issues

你的报告有助于完善应用并提高导航准确性。

**注意:**
报告的问题将在时间允许的情况下尽快处理。

# 致谢

### [@truckermudgeon](https://github.com/truckermudgeon)
特别感谢其 **[maps](https://github.com/truckermudgeon/maps)** 仓库。
*   这为地图解析提供了重要的起点，是 **将这个想法变为现实的关键**。
*   将游戏内部坐标转换为可用格式 (WGS84) 的逻辑对于正确渲染地图非常有价值。

### [@RenCloud](https://github.com/RenCloud)
感谢其 **[scs-sdk-plugin](https://github.com/RenCloud/scs-sdk-plugin)**。
*   这个工具是浏览器与游戏引擎通信的桥梁。其核心功能已精炼并无缝集成到 TruckNav 中。

---

*安全驾驶，快乐卡车行！*
