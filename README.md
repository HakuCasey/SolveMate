# SolveMate

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

知识平权——让每一位学生，都有一位因材施教的专业教师。

## 简介

SolveMate 是一款面向学生的学习应用，支持教材与题目阅读、对话记录和教师配置。用户可以通过网页使用，也可以安装为离线网页应用。

- 阅读教材和题目，查看公式、代码与参考答案。
- 管理对话，选择或自定义教师，记录保存在本地。
- 下载和更新官方课程，离线时继续阅读，更新失败时保留旧版本。

当前尚未接入 AI，对话中暂时没有 AI 回复。笔记、推荐问题和学习统计目前提供示例内容。

## 使用方式

### 环境要求

- Git、Node.js 24 和 npm 11。
- 使用官方内容下载与更新时，还需要 Python 3.12 或以上版本运行内容服务。

### 获取代码与安装依赖

```bash
git clone https://github.com/HakuCasey/SolveMate.git
cd SolveMate
npm ci
```

### 本地启动与访问

在仓库根目录执行：

```bash
npm run build
npm run preview
```

启动后打开 <http://127.0.0.1:4173/>。这会运行构建后的网页，可用于阅读内置内容、安装应用和验证离线使用。

如需下载和更新官方课程，在另一个终端中，从仓库根目录启动内容服务：

```bash
cd apps/server
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.lock
python -m pip install --no-deps --no-build-isolation -e .
solvemate-publish
uvicorn solvemate_server.main:create_app --factory --host 127.0.0.1 --port 8000
```

以上虚拟环境激活命令适用于 macOS 和 Linux；Windows PowerShell 使用 `.venv\Scripts\Activate.ps1`。服务启动后，可在网页中下载课程。后续修改课程内容时，重新执行 `solvemate-publish`。更多配置见[后端说明](apps/server/README.md)。

### 部署到服务器

1. 在仓库根目录执行 `npm run build`，将 `apps/web/dist/` 中的内容部署到提供 HTTPS 的站点根目录。
2. 如需提供官方课程下载，按上方步骤安装并启动内容服务，保留发布后的课程目录，并将站点的 `/api/v1/` 请求转发到该服务。本机默认服务地址为 `http://127.0.0.1:8000`。
3. 前后端部署到不同站点时，在 `apps/web/.env.local` 中设置完整内容服务地址，再重新构建网页；后端同时通过 `SOLVEMATE_CORS_ORIGINS` 配置允许访问的网页来源。

跨站点配置示例，使用时替换为自己的内容服务地址：

```dotenv
VITE_CONTENT_API_URL=https://content.example.com/api/v1
```

`npm run preview` 用于本地查看构建结果；对外部署时，用静态托管服务或 Web 服务器提供网页。后端目录与来源配置见[后端部署说明](apps/server/README.md#配置与部署)。

### 安装为离线应用

打开网页，等待“离线资源已就绪”。浏览器提供“安装应用”入口时，按提示安装；不安装也可继续通过浏览器访问。需要离线阅读的官方课程应先下载并保存。

内容和记录保存在当前浏览器的当前站点，清理站点数据会将其移除。目前不支持跨设备同步或备份导出。

完成安装或部署后，页面操作见[用户指南](docs/product/manual/README.md)。

## 开发方式

前端使用 React、TypeScript 和 Vite，后端使用 Python 和 FastAPI。完成上方依赖安装后，在仓库根目录启动网页开发服务：

```bash
npm run dev
```

通过终端显示的地址访问页面，修改代码后可即时查看结果。需要联调课程下载时，另行启动内容服务。

提交代码前执行：

```bash
npm run check
npm run format:check
npm test
npm run build
```

后端检查命令见[后端说明](apps/server/README.md#检查)，其他开发约定见[贡献指南](CONTRIBUTING.md)。

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
│   └── server/           # 官方内容服务
├── packages/             # 共享代码与接口约定
├── scripts/              # 项目维护脚本
├── AGENTS.md             # 项目指令文件，私有规范保存在工作区
├── PLANS.md              # 项目计划与待办
└── README.md             # 项目说明
```

## 开源许可

代码、文档和自编示例内容采用 [MIT 许可证](LICENSE)，允许使用、修改、分发及商业使用，分发时须保留版权声明和许可证原文。

授权范围与内容来源见[开源声明](NOTICE.md)，第三方依赖的许可见[第三方说明](THIRD_PARTY_NOTICES.md)。
