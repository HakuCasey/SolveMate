# SolveMate 官网

官网介绍产品、用户指南和源码运行方式。页面和样式在本目录维护，标志与界面截图分别复用应用资源和[用户手册](../product/manual/README.md)。

## 本地预览

从仓库根目录运行：

```sh
node scripts/build-website.mjs
python3 -m http.server 4321 --bind 127.0.0.1 --directory dist/website
```

打开 [http://127.0.0.1:4321/](http://127.0.0.1:4321/)。官网可独立构建和预览，无需启动 SolveMate。

## GitHub Pages 发布

在仓库的 **Settings → Pages** 中将 **Source** 设为 **GitHub Actions**。官网代码合入 `main` 后，到 **Actions → Publish website** 手动运行发布流程。运行完成后可从部署记录中打开官网地址。

发布流程只上传 `dist/website/`。更新截图或标志后，重新运行发布流程即可使用新资源。
