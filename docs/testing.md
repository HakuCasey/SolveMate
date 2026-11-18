# SolveMate 网页端到端测试

用 Playwright 驱动真实浏览器（Chromium），模拟真实用户操作，覆盖主要用户路径。发现的问题一律定位根因后根治，修复配最小回归测试。

## 运行环境

1. 依赖：仓库根 `npm ci`，再 `npm i -D @playwright/test`、`npx playwright install chromium`（国内可设 `PLAYWRIGHT_DOWNLOAD_HOST=https://registry.npmmirror.com/-/binary/playwright`）。
2. 前置服务：`npm start`（网页 4173 + 内容服务 8000 + 本机 AI 8765），AI 用例需在「设置 → AI 配置」配好 DeepSeek Harness。
3. 运行：仓库根 `npx playwright test`（配置见 `playwright.config.ts`，串行执行、失败保留 trace 与截图）。

## 测试用例清单

状态标记：✅ 通过 · ❌ 失败（已修复）· ⏭️ 跳过（注明原因）。

### A. 启动与数据
- A1 打开应用正常加载，学科/对话/笔记入口可见
- A2 刷新后未发送的草稿与阅读现场保留
- A3 社区服务不可达时，已下载资料仍可阅读（离线）

### B. 学科与资料列表
- B1 学科切换（高等数学 / C 语言）
- B2 「学习资料 / 题目」切换、打开与返回列表
- B3 上传 PDF（处理中状态、失败重试）
- B4 资料改名 / 移动学科 / 删除
- B5 未分类资料归属

### C. 资料阅读（PDF）
- C1 翻页、页码跳转、缩放、单页/连续、分栏
- C2 文字选段 → 加入提问引用 / 记笔记
- C3 离开后返回，阅读位置恢复

### D. 对话与 AI（DSH）
- D1 新建对话、发送问题、追问、停止生成
- D2 机器人切换（全科/高数/C 语言教师）
- D3 会话重命名 / 标签 / 归档 / 恢复 / 删除
- D4 指定页码提问
- D5 关联当前页提问、选段提问
- D6 切换服务/模型、切回恢复原生会话
- D7 失败重试、AI 未配置时的提示
- D8 刷新/服务重启后续聊（会话恢复）
- D9 空输入按 ↑ 回填上一次发送内容

### E. 笔记
- E1 笔记本新建/重命名/删除
- E2 笔记新建/编辑/删除、标签
- E3 从资料/对话建笔记、返回来源
- E4 笔记 PDF 导出
- E5 合并笔记

### F. 机器人配置
- F1 新建/复制/删除/设默认、名称与指令编辑
- F2 配置导入/导出 JSON

### G. 设置
- G1 字号、白天/夜间、四种主题色调
- G2 AI 配置：连接检测、模型选择
- G3 备份导出 ZIP、恢复
- G4 用户数据路径查看/更改

### H. 社区内容
- H1 检查更新、下载/更新资料与工具
- H2 下载后离线阅读

### I. 教研工具
- I1 进入教研室、选资料、选工具（讲义/试题研发/试题精讲）
- I2 Skill 与输出模板确认
- I3 教研对话

### J. 学习统计
- J1 学习时长、热图、勋章展示

### K. 应用更新 / PWA
- K1 应用更新状态、离线重开

## 测试结果与修复记录

（逐项填写：用例、结果、根因与修复提交。）

### 已通过用例（真实浏览器 + 真实 DSH）

- A1 应用加载、侧边栏功能菜单、导航切换（`e2e/smoke.spec.ts`）
- 各主页面（学科/对话/笔记/教研室/机器人）导航、设置菜单（`e2e/navigation.spec.ts`）
- B1 学科切换（高等数学 / C 语言）、B2 学习资料/题目切换、C1 打开 PDF 阅读（`e2e/subjects.spec.ts`）
- C3 阅读位置在重新打开后恢复（`e2e/reading-position.spec.ts`）
- D1 新建对话、发送、收到回复、追问（`e2e/conversation.spec.ts`）
- D4 指定页码提问正常提交并收到回复（`e2e/reading-context.spec.ts`）
- D9 空输入按 ↑ 回填上一次发送内容（`e2e/conversation.spec.ts`）
- D3 会话归档与移回进行中（`e2e/conversation-manage.spec.ts`）
- D2 切换机器人触发确认并新建对话（`e2e/robot-switch.spec.ts`）
- E 笔记页渲染、F 机器人页展示预置机器人、G1 显示设置（夜间模式/字号，`e2e/notes-robots-settings.spec.ts`）
- H 社区内容展示内置资料、I 教研室展示资料与教研工具（`e2e/research-community.spec.ts`）

### 已修复问题（根因）

- 初始加载竞态：`saveChanges` 在数据未就绪时先等待加载，不再报「原记录尚未读取成功」。
- 生成流程终态：`run_turn` 的 `finally` 补齐 `running → interrupted`，杜绝持久化出 `running + finished` 非法组合。
- 指定页码提问被误拒：前端 `recordQuestion` 对齐后端，`pageNumbers` 非空时不再误判「关联内容尚未读取」。
- KaTeX override 导致许可证检查失败：`generate-license-notices` 容忍 npm ls 的 invalid 非零退出。
