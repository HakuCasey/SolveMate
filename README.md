<p align="center">
  <img src="apps/web/src/assets/solvemate-wordmark.png" alt="SolveMate" width="280" />
</p>

# SolveMate

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 24](https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![npm 11](https://img.shields.io/badge/npm-11-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/)
[![Python 3.12+](https://img.shields.io/badge/Python-3.12%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![TypeScript 5.9](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)

## 简介

[访问官网](https://hakucasey.github.io/SolveMate/)

SolveMate 是一款面向自学的开源应用。阅读资料时，可以对照当前页、指定页码或选段和 AI 讨论。

- **对话现场完整保留。** 再次打开对话时，可以回到当时读的那一页或那道题，接着原来的讨论。
- **重要信息及时记录。** 资料选段和对话内容都能当场记成笔记。回看笔记时可以打开出处，笔记本也可以导出 PDF。
- **教研工具得心应手。** 预置讲义研发、试题研发和试题精讲。Skill 和输出模板在教研室统一管理，分别编辑后可以另存成一份自定义工具。

支持阅读 PDF、PPTX 及社区题目，连接本机 DeepSeek Harness、Hermes 或 Codex，并自定义机器人。资料、对话、笔记和配置保存在本机。应用提供 Web/PWA 和 macOS 桌面安装包。更多产品思路见[产品愿景](docs/product/vision.md)。

## 使用方式

### 桌面安装版

桌面安装包包含网页、Electron、Python 运行环境和本机服务，安装后的用户不需要安装 Node.js 或 Python。使用 AI 回复仍需安装并配置至少一个支持的 Harness；导入 PPTX 需要 LibreOffice，PDF 不需要。

从[官网](https://hakucasey.github.io/SolveMate/)下载 macOS 安装包，打开 DMG 后将 SolveMate 拖入「应用程序」。Windows 安装包待发布。

首次使用空数据目录时，对话和笔记均为空。可直接阅读预置的高等数学、C 语言社区资料与题目，也可使用三个教研工具。已有记录可通过“系统设置 → 备份与恢复 → 备份文件”导入 ZIP 备份。

桌面应用的构建和当前限制见[桌面应用说明](apps/desktop/README.md)。

### 源码运行环境

- Git、Node.js 24 和 npm 11。
- Python 3.12 或以上版本，用于运行本机数据保存、AI 连接及社区内容服务。
- 使用 AI 时，需要安装并配置 DeepSeek Harness、Hermes 或 Codex。macOS 已进行真实调用验证；Windows 已提供启动适配和自动测试，仍需实机验收。

导入 PPTX 需要安装 [LibreOffice](https://www.libreoffice.org/download/download-libreoffice/)，PDF 导入不需要此依赖。macOS 可使用 `brew install --cask libreoffice`；Windows 安装到默认目录即可。自定义程序位置见[本机服务说明](apps/local/README.md#资料导入与处理)。

### 获取代码与安装依赖

```bash
git clone https://github.com/HakuCasey/SolveMate.git
cd SolveMate
npm ci
```

### 本地启动与访问

首次使用时，先从仓库根目录准备 Python 环境：

```bash
cd apps/server
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.lock
python -m pip install -r ../local/requirements.lock
python -m pip install --no-deps --no-build-isolation -e .
python -m pip install --no-deps --no-build-isolation -e ../local
cd ../..
```

上面的命令适用于 macOS 和 Linux。Windows PowerShell 从仓库根目录执行：

```powershell
cd apps/server
py -3 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.lock
.venv\Scripts\python.exe -m pip install -r ../local/requirements.lock
.venv\Scripts\python.exe -m pip install --no-deps --no-build-isolation -e .
.venv\Scripts\python.exe -m pip install --no-deps --no-build-isolation -e ..\local
cd ../..
```

Windows 命令直接使用虚拟环境中的 Python，无需修改 PowerShell 的脚本执行策略。

此后在仓库根目录执行一条命令：

```bash
npm start
```

脚本依次检查依赖和端口、构建网页、发布课程内容，再同时启动网页、社区内容服务和本机 AI 服务。看到 `SolveMate is ready` 后，打开 <http://127.0.0.1:4173/>。网页支持社区内容下载和离线重开。无需另开终端或手动激活 Python 环境；按一次 `Ctrl+C` 会统一停止三个服务，任一服务异常退出时也会停止其余服务。

默认端口是网页 4173、社区内容 8000、本机服务 8765。需要同时调试第二套服务时，在另一个终端运行：

```bash
npm start -- --port 4174 --isolated
```

打开 <http://127.0.0.1:4174/>。两项后端服务自动使用空闲端口，这个实例单独保存调试数据。也可以追加 `--content-port 8001 --local-port 8766` 指定后端端口。在对应终端按 `Ctrl+C` 即可停止该实例。

打开网页后，在“系统设置 → AI 配置”中选择 DeepSeek Harness、Hermes 或 Codex，检测连接并选择模型。配置和独立启动方式见[本机 AI 服务说明](apps/local/README.md)。

本机服务负责个人记录的读取和保存，即使不使用 AI 也需要启动。单独预览网页可执行 `npm run build`、`npm run preview`，并按[本机服务说明](apps/local/README.md#启动)启动本机服务；服务未启动时只能查看已有浏览器缓存。内容服务的单独启动和配置见[后端说明](apps/server/README.md)。

### 部署到服务器

1. 在仓库根目录执行 `npm run build`，将 `apps/web/dist/` 中的内容部署到提供 HTTPS 的站点根目录。
2. 如需提供社区课程下载，按[后端说明](apps/server/README.md)安装、发布并启动内容服务，保留发布后的课程目录。在 `apps/web/.env.local` 中设置包含 `/api/v1` 的完整服务地址，再重新构建网页。本机默认地址为 `http://127.0.0.1:8000/api/v1`。
3. 前后端部署到不同站点时，后端还需通过 `SOLVEMATE_CORS_ORIGINS` 配置允许访问的网页来源。

跨站点配置示例，使用时替换为自己的内容服务地址：

```dotenv
VITE_CONTENT_API_URL=https://content.example.com/api/v1
```

`npm run preview` 用于本地查看构建结果；对外部署时，用静态托管服务或 Web 服务器提供网页。个人记录和 Harness 接入均通过本机服务提供，完整使用请采用上方的本地启动方式。公网网页与用户本机服务的连接和配对尚未实现；不能将个人数据接口和本机 AI 接口公开转发到互联网。

后端目录与来源配置见[后端部署说明](apps/server/README.md#配置与部署)。

### 将网页安装为离线应用

网页会缓存离线运行所需的资源。支持 PWA 安装的浏览器可通过自身的安装入口安装网页；不安装也可继续通过浏览器访问。必要资源缓存完成后可离线重开，需要离线阅读的社区资料应先下载并保存。

源码版与桌面版默认共用系统应用数据目录：macOS 为 `~/Library/Application Support/SolveMate/data`，Windows 为 `%APPDATA%\SolveMate\data`。对话、笔记和设置保存在其中的 `app.sqlite3`，上传资料位于 `uploads/`，社区资料位于 `community/`，AI 连接和原生会话关联位于 `ai/`。浏览器只保存缓存，清理浏览器缓存不会删除正式记录，但尚未保存的修改仍需先处理。

两种版本都可以在“系统设置 → 备份与恢复 → 用户数据”查看实际位置或更改目录，修改后两边会读取同一位置。仓库中的 `user/` 只保留开发数据的文件组织，不作为默认运行目录。

完成安装或部署后，页面操作见[用户指南](docs/product/manual/README.md)。

在“系统设置 → 备份与恢复 → 备份文件”中可导出资料、对话、笔记和配置的完整 ZIP 备份，并恢复到当前本机数据目录。恢复前会自动备份当前数据；第三方 Harness 的登录信息与原生会话文件仍由对应软件管理，不包含在此备份中。

## 开发方式

前端使用 React、TypeScript 和 Vite，后端使用 Python 和 FastAPI。完成上方依赖安装后，在仓库根目录启动网页开发服务：

```bash
npm run dev
```

通过终端显示的地址访问页面，修改代码后可即时查看结果。开发时同时启动[本机服务](apps/local/README.md#启动)，用于读取和保存个人记录；联调社区课程下载时再启动内容服务。

提交代码前执行：

```bash
npm run check
npm run format:check
npm test
npm run build
```

Python 检查命令见[内容服务说明](apps/server/README.md#检查)和[本机 AI 服务说明](apps/local/README.md#检查)。桌面应用的构建命令见[桌面应用说明](apps/desktop/README.md)，其他开发约定见[贡献指南](CONTRIBUTING.md)。

## 仓库结构

```text
SolveMate/
├── data/                 # 社区资料、题目、课程记忆与教研工具源文件
├── docs/
│   ├── product/          # 产品愿景与用户指南
│   ├── features/         # 特性规格与设计
│   ├── architecture/     # 系统架构与技术方案
│   └── templates/        # 文档模板
├── apps/
│   ├── web/              # 网页应用
│   ├── server/           # 社区内容服务
│   ├── local/            # 本机数据保存与 AI 连接服务
│   └── desktop/          # macOS 与 Windows 桌面安装版
├── packages/             # 共享代码与接口约定
├── scripts/              # 项目维护脚本
├── AGENTS.md             # 项目指令文件，私有规范保存在工作区
├── PLANS.md              # 项目计划与待办
└── README.md             # 项目说明
```

## 开源许可

代码、文档和自编示例内容采用 [MIT 许可证](LICENSE)，允许使用、修改、分发及商业使用，分发时须保留版权声明和许可证原文。

授权范围与内容来源见[开源声明](NOTICE.md)，第三方依赖的许可见[第三方说明](THIRD_PARTY_NOTICES.md)。
