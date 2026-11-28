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

支持阅读 PDF、PPTX 和社区题目。资料、对话、笔记和配置保存在本机。长期方向见[产品愿景](docs/product/vision.md)。

## 使用方式

使用 AI 需先安装并配置 DeepSeek Harness、Hermes 或 Codex。导入 PPTX 需安装 [LibreOffice](https://www.libreoffice.org/download/download-libreoffice/)。

连接 AI、页面操作与备份见[用户手册](docs/product/manual/README.md)。

### 桌面安装版

从[官网](https://hakucasey.github.io/SolveMate/)下载 macOS 安装包，打开 DMG 后将 SolveMate 拖入「应用程序」。桌面版无需另装 Node.js 或 Python。Windows 安装包待发布。

### 源码运行环境

- Git、Node.js 24 和 npm 11。
- Python 3.12 或以上版本。

### 获取代码与安装依赖

```bash
git clone https://github.com/HakuCasey/SolveMate.git
cd SolveMate
npm ci
```

### 本地启动与访问

从仓库根目录安装 Python 依赖。macOS 和 Linux 使用：

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

Windows PowerShell 使用：

```powershell
cd apps/server
py -3 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.lock
.venv\Scripts\python.exe -m pip install -r ../local/requirements.lock
.venv\Scripts\python.exe -m pip install --no-deps --no-build-isolation -e .
.venv\Scripts\python.exe -m pip install --no-deps --no-build-isolation -e ..\local
cd ../..
```

在仓库根目录启动应用：

```bash
npm start
```

看到 `SolveMate is ready` 后，打开 <http://127.0.0.1:4173/>。在启动终端按 `Ctrl+C` 停止应用。

启动后，可以在「系统设置 → AI 配置」连接本机已安装的 AI 服务。

### 部署到服务器

1. 在仓库根目录执行 `npm run build`，将 `apps/web/dist/` 中的内容部署到提供 HTTPS 的站点根目录。
2. 如需提供社区课程下载，按[后端说明](apps/server/README.md)安装、发布并启动内容服务，保留发布后的课程目录。在 `apps/web/.env.local` 中设置包含 `/api/v1` 的完整服务地址，再重新构建网页。本机默认地址为 `http://127.0.0.1:8000/api/v1`。
3. 前后端部署到不同站点时，后端还需通过 `SOLVEMATE_CORS_ORIGINS` 配置允许访问的网页来源。

跨站点配置示例，使用时替换为自己的内容服务地址：

```dotenv
VITE_CONTENT_API_URL=https://content.example.com/api/v1
```

个人记录和 AI 连接请使用本地启动方式。个人数据和本机 AI 接口应保持在本机。

后端目录与来源配置见[后端部署说明](apps/server/README.md#配置与部署)。

### 将网页安装为离线应用

支持 PWA 的浏览器可安装网页。应用缓存就绪后可离线打开，社区资料需提前下载。

## 开发方式

前端使用 React、TypeScript 和 Vite，后端使用 Python 和 FastAPI。完成上方依赖安装后，在仓库根目录启动网页开发服务：

```bash
npm run dev
```

通过终端显示的地址访问页面。开发时启动[本机服务](apps/local/README.md#启动)读写个人记录，联调社区课程下载时启动[社区内容服务](apps/server/README.md)。指定端口、隔离调试和桌面打包见[开发指导](docs/development.md)。

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
