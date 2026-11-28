# SolveMate 官网

官网介绍产品、用户指南和源码运行方式。页面和样式在本目录维护，标志与界面截图分别复用应用资源和[用户手册](../product/manual/README.md)。

首屏的丽泽背景和导航栏的淡墨六爻分别位于 `assets/lize-ink.jpg` 和 `assets/lize-hexagram-header.png`。

架构图在 `assets/architecture.drawio` 中保留宽屏和窄屏两页，修改图源后同步导出 `architecture.svg` 和 `architecture-mobile.svg`。

## 安装包版本

官网的 Mac 和 Windows 下载版本记录在 [`website-downloads.json`](website-downloads.json)。需要更换官网安装包时，确认对应的 GitHub Release 安装包可下载，手动修改清单中的平台版本，再部署官网。官网仍在提供的安装包须保留在 GitHub Releases。

应用内「检查更新」读取 GitHub Pages 上的 [`downloads.json`](downloads.json)。发布新安装包并确认可下载后，只更新这个文件中的对应平台版本，已安装用户即可在应用内检查并下载新版。

## 下载统计

Cloudflare D1 按版本、平台和入口保存累计次数。`website` 记录官网安装包按钮的点击，`app-update` 记录应用内发起的下载。在 Cloudflare 控制台打开 D1 数据库并查询 `download_counts` 即可查看，计数表只有版本、平台、入口和次数。安装包继续从 GitHub Releases 下载。

首次启用时，在 `apps/download-stats` 中运行以下命令。D1 创建命令会把数据库绑定加入 `wrangler.toml`。

```sh
npx wrangler login
npx wrangler d1 create solvemate-download-stats --binding DOWNLOADS --update-config
npx wrangler d1 migrations apply solvemate-download-stats --remote
npx wrangler deploy
```

在 GitHub 仓库的「Settings → Secrets and variables → Actions → Variables」中设置 `SOLVEMATE_DOWNLOAD_STATS_URL`，值为 Worker 的 HTTPS 地址加 `/download`，再运行 `Publish website`。计数从启用后开始，应用内统计要求客户端安装了支持上报的版本。GitHub Releases 里的安装包总下载量可另行查看。

## 本地预览

从仓库根目录运行：

```sh
node scripts/build-website.mjs
python3 -m http.server 4321 --bind 127.0.0.1 --directory dist/website
```

打开 [http://127.0.0.1:4321/](http://127.0.0.1:4321/)。官网可独立构建和预览，无需启动 SolveMate。

## GitHub Pages 发布

在仓库的 **Settings → Pages** 中将 **Source** 设为 **GitHub Actions**。官网文件或社区内容更新合入 `main` 后，**Publish website** 会自动部署。也可以从 **Actions → Publish website** 手动运行。运行完成后可从部署记录中打开官网地址。

发布流程只上传 `dist/website/`。其中 `community/` 由现有发布命令生成，包含公开目录、课程包和教研工具。每次发布前会从 Pages 读取上一份目录并校验其列出的文件，保留已发布的历史版本。
