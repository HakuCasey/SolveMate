# SolveMate

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

知识平权

## 简介

SolveMate 是一款面向师生的学习应用，服务于学生的自主学习与教师的智能备课。产品以资料为主干，围绕资料组织与 AI 的对话、笔记及教学内容。用户可以通过网页使用，也可以安装为离线网页应用。

- 导入自己的 PDF 课本或 PPTX 课件，阅读原页面，围绕选段或当前页文字提问。
- 阅读内置教材和题目，查看公式、代码与参考答案。
- 连接本机 DeepSeek Harness、Hermes 或 Codex，选择模型和教师，围绕阅读内容提问、追问，并恢复已有对话；教师的名称、角色指令和 AI 配置可以自定义。
- 从资料查看相关对话与笔记，记录和编辑自己的理解，并通过笔记来源返回原文；资料改名、移动或删除后，历史关联仍保留。
- 下载和更新官方资料，离线时继续阅读，更新失败时保留旧版本。对话、笔记、教师配置等记录保存在本机，换浏览器后可继续使用。
- 教师智能备课围绕讲义研发、试题精讲和试题研发展开。目前已提供教研室入口，具体的 AI 辅助流程正在规划，见[项目计划](PLANS.md#教研室)。

使用 AI 前，需要在电脑上安装并配置所选 Harness。推荐问题目前使用预置文案，学习统计仍为示例数据。

## 使用方式

### 环境要求

- Git、Node.js 24 和 npm 11。
- Python 3.12 或以上版本，用于运行本机数据保存、AI 连接及官方内容服务。
- 使用 AI 时，需要安装并配置 DeepSeek Harness、Hermes 或 Codex。macOS 已进行真实调用验证；Windows 已提供启动适配和自动测试，仍需实机验收。

导入 PPTX 需要安装 [LibreOffice](https://www.libreoffice.org/download/download-libreoffice/)，PDF 导入不需要此依赖。macOS 可使用 `brew install --cask libreoffice`；Windows 安装到默认目录即可。自定义程序位置见[本机服务说明](apps/local/README.md#用户资料)。

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
cd ../..
```

上面的命令适用于 macOS 和 Linux。Windows PowerShell 从仓库根目录执行：

```powershell
cd apps/server
py -3 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.lock
.venv\Scripts\python.exe -m pip install -r ../local/requirements.lock
.venv\Scripts\python.exe -m pip install --no-deps --no-build-isolation -e .
cd ../..
```

Windows 命令直接使用虚拟环境中的 Python，无需修改 PowerShell 的脚本执行策略。

此后在仓库根目录执行一条命令：

```bash
npm start
```

脚本依次检查依赖和端口、构建网页、发布课程内容，再同时启动网页、官方内容服务和本机 AI 服务。看到 `SolveMate is ready` 后，打开 <http://127.0.0.1:4173/>。网页支持课程下载、安装应用和离线使用。无需另开终端或手动激活 Python 环境；按一次 `Ctrl+C` 会统一停止三个服务，任一服务异常退出时也会停止其余服务。

默认使用网页端口 4173、内容服务端口 8000 和本机 AI 端口 8765。已有服务占用端口时，脚本会报错并保留原进程。可以先在原终端按 `Ctrl+C` 停止旧服务，也可以用 `npm start -- --port 4174` 更换网页端口。

打开网页后，在“设置 → AI 配置”中选择 DeepSeek Harness、Hermes 或 Codex，检测连接并选择模型。配置和独立启动方式见[本机 AI 服务说明](apps/local/README.md)。

本机服务负责个人记录的读取和保存，即使不使用 AI 也需要启动。单独预览网页可执行 `npm run build`、`npm run preview`，并按[本机服务说明](apps/local/README.md#启动)启动本机服务；服务未启动时只能查看已有浏览器缓存。内容服务的单独启动和配置见[后端说明](apps/server/README.md)。

### 部署到服务器

1. 在仓库根目录执行 `npm run build`，将 `apps/web/dist/` 中的内容部署到提供 HTTPS 的站点根目录。
2. 如需提供官方课程下载，按[后端说明](apps/server/README.md)安装、发布并启动内容服务，保留发布后的课程目录，并将站点的 `/api/v1/` 请求转发到该服务。本机默认服务地址为 `http://127.0.0.1:8000`。
3. 前后端部署到不同站点时，在 `apps/web/.env.local` 中设置完整内容服务地址，再重新构建网页；后端同时通过 `SOLVEMATE_CORS_ORIGINS` 配置允许访问的网页来源。

跨站点配置示例，使用时替换为自己的内容服务地址：

```dotenv
VITE_CONTENT_API_URL=https://content.example.com/api/v1
```

`npm run preview` 用于本地查看构建结果；对外部署时，用静态托管服务或 Web 服务器提供网页。个人记录和 Harness 接入均通过本机服务提供，完整使用请采用上方的本地启动方式。公网网页与用户本机服务的连接和配对尚未实现；不能将个人数据接口和本机 AI 接口公开转发到互联网。

后端目录与来源配置见[后端部署说明](apps/server/README.md#配置与部署)。

### 安装为离线应用

网页会缓存离线运行所需的资源。点击右下角的应用更新状态，浏览器提供“安装应用”入口时，可在气泡中安装；不安装也可继续通过浏览器访问。必要资源缓存完成后可离线重开，需要离线阅读的官方资料应先下载并保存。

对话、笔记、机器人、学科和设置保存在项目的 `user/app.sqlite3`；上传资料位于 `user/uploads/`，获取的官方和社区资料位于 `user/community/`，AI 连接和原生会话关联继续保存在 `user/ai/`。浏览器只保存缓存，连接同一个本机服务即可换浏览器继续使用。清理浏览器缓存不会删除这些正式记录，但尚未保存的修改仍需先处理。首次升级请使用原来的浏览器和访问地址完成迁移，原浏览器数据和旧资料目录保留，迁移备份位于 `user/backups/`。

完成安装或部署后，页面操作见[用户指南](docs/product/manual/README.md)。

在“设置 → 备份与恢复”中可导出资料、对话、笔记和配置的完整 ZIP 备份，并恢复到当前本机数据目录。恢复前会自动备份当前数据；第三方 Harness 的登录信息与原生会话文件仍由对应软件管理，不包含在此备份中。

## 开发方式

前端使用 React、TypeScript 和 Vite，后端使用 Python 和 FastAPI。完成上方依赖安装后，在仓库根目录启动网页开发服务：

```bash
npm run dev
```

通过终端显示的地址访问页面，修改代码后可即时查看结果。开发时同时启动[本机服务](apps/local/README.md#启动)，用于读取和保存个人记录；联调官方课程下载时再启动内容服务。

提交代码前执行：

```bash
npm run check
npm run format:check
npm test
npm run build
```

Python 检查命令见[内容服务说明](apps/server/README.md#检查)和[本机 AI 服务说明](apps/local/README.md#检查)，其他开发约定见[贡献指南](CONTRIBUTING.md)。

## 仓库结构

```text
SolveMate/
├── data/                 # 按课程组织的教材、题目和课程记忆
├── docs/
│   ├── product/          # 产品愿景与用户指南
│   ├── features/         # 特性规格与设计
│   ├── architecture/     # 系统架构与技术方案
│   └── templates/        # 文档模板
├── apps/
│   ├── web/              # 网页应用
│   ├── server/           # 官方内容服务
│   └── local/            # 本机数据保存与 AI 连接服务
├── packages/             # 共享代码与接口约定
├── scripts/              # 项目维护脚本
├── AGENTS.md             # 项目指令文件，私有规范保存在工作区
├── PLANS.md              # 项目计划与待办
└── README.md             # 项目说明
```

## 开源许可

代码、文档和自编示例内容采用 [MIT 许可证](LICENSE)，允许使用、修改、分发及商业使用，分发时须保留版权声明和许可证原文。

授权范围与内容来源见[开源声明](NOTICE.md)，第三方依赖的许可见[第三方说明](THIRD_PARTY_NOTICES.md)。
