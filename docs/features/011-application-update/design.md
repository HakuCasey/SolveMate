# 011 应用更新实现方案

## 更新与窗口职责

`pwa/update-controller.ts` 集中维护检查、下载、就绪、重载和失败状态，观察同一 Service Worker 注册对象与安装中的 worker。检查复用进行中的请求；检查上限 20 秒，下载上限两分钟。失败后允许重试，超时检测的迟到结果不覆盖新状态；已实际完成安装的版本可以从下载失败状态恢复为就绪。

`pwa/useAppUpdate.ts` 使用浏览器原生注册与更新接口，读取 Workbox 生成的 `sw.js`。Vite PWA 继续生成清单和离线缓存，关闭自动注入的注册脚本，由应用集中注册。检测先按 `no-store` 访问脚本，核对 HTTP 结果和 JavaScript 类型，再请求浏览器检查；仅有旧缓存不能证明应用已经是最新版本。

只有用户点击“更新应用”才向等待中的 worker 发送 Workbox 支持的 `SKIP_WAITING` 消息。等待 worker 完成启用或当前窗口收到控制器变化后，再核对保存状态并重载。启用超过 15 秒时恢复按钮并显示错误。其他窗口启用版本时只显示就绪提示，不替用户重载本页。

## 重载前保存

`pwa/reload-checkpoint.ts` 使用当前窗口的 `sessionStorage` 保存版本 1 的临时记录，包括当前对话编号、按对话或阅读场景组织的输入草稿，以及应用层的统一阅读状态。位置继续使用已有资料编号和固定版本，各片段保留各自的原文快照，不复制学习数据库或 AI 凭据。

输入草稿由应用层集中管理，聊天输入框使用受控属性。存储写入后核对结果，失败时阻止重载。初始化只读取临时记录，兼容 React StrictMode 的重复初始化；个人记录读取成功后再清除。结构不兼容或损坏时显示恢复错误并保留原临时记录。普通刷新不生成这份记录。

更新后的入口仍为对话页。阅读状态在重新打开资料时恢复，历史引用仍按原位置定位。未保存的机器人配置不自动丢弃或提交，用户须先保存或取消。AI 的运行与恢复继续由现有本机服务和执行编号负责，更新代码不调用停止或取消接口。

## 依据

- [ServiceWorkerRegistration.update](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/update)
- [Service Worker 控制器变化事件](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/controllerchange_event)
- [Vite PWA 定期检查与网络边界](https://vite-pwa-org.netlify.app/guide/periodic-sw-updates)
- [Vite PWA 更新提示与离线缓存](https://vite-pwa-org.netlify.app/guide/prompt-for-update)

## 验证

2026-11-12：使用隔离站点和两个生产构建版本验证首次准备离线资源、主动检查、没有新版、服务返回 503、资源下载失败、重试下载、下载中提示和新版就绪。重新加载后进入对话页，保留当前对话及未发送草稿；返回 C 语言题目后引用、答案展开和滚动位置恢复。机器人配置未保存时显示具体提示，取消修改后允许继续。另一窗口启用新版时，当前窗口保留草稿并显示就绪入口，日间与夜间外观均已核对。

14 项新增自动测试覆盖检查与下载的失败和重试、并发检查、离线等待版本、过期结果、检查与下载超时、事件清理，以及临时记录读取、存储不足、损坏内容与非法引用。网页共 208 项、脚本 19 项测试通过，TypeScript、ESLint、Prettier 和生产构建通过。本次未调用真实模型；Windows 真机及不同浏览器的安装验收仍需对应环境。
