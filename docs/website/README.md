# SolveMate 官网

官网介绍产品、用户指南和源码运行方式。页面和样式在本目录维护，标志与界面截图分别复用应用资源和[用户手册](../product/manual/README.md)。

首屏的丽泽背景和导航栏的淡墨六爻分别位于 `assets/lize-ink.jpg` 和 `assets/lize-hexagram-header.png`。

架构图在 `assets/architecture.drawio` 中保留宽屏和窄屏两页，修改图源后同步导出 `architecture.svg` 和 `architecture-mobile.svg`。

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
