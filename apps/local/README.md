# SolveMate 本机服务

本服务在用户电脑上连接已安装的 DeepSeek Harness、Hermes 或 Codex，负责 Harness 进程、模型选项、会话绑定、执行记录和权限确认，并提供个人记录、上传资料和已下载课程的本机保存与处理。官方内容服务仍位于 `apps/server/`，个人问题和资料不经过官方内容服务。

## 启动

按仓库 README 准备 `apps/server/.venv`，并在其中安装本目录 `requirements.lock` 的额外依赖后，在仓库根目录执行 `npm start`。脚本同时启动网页、官方内容服务和本机 AI 服务，按 `Ctrl+C` 统一停止。本服务使用该 Python 环境中的 FastAPI、Pydantic、Uvicorn 和 PyYAML，启动时直接加载本目录的源代码。

开发时可在仓库根目录单独启动：

```bash
apps/server/.venv/bin/python -m uvicorn solvemate_local.main:create_app --factory --app-dir apps/local/src --host 127.0.0.1 --port 8765
```

Windows PowerShell 使用：

```powershell
apps\server\.venv\Scripts\python.exe -m uvicorn solvemate_local.main:create_app --factory --app-dir apps/local/src --host 127.0.0.1 --port 8765
```

网页开发服务与构建预览均将 `/local-api/` 转发到本机端口 8765。健康检查位于 `http://127.0.0.1:8765/healthz`。

## 配置 Harness

先安装要使用的 Harness，并在其中完成账号登录或模型服务配置。

### DeepSeek Harness

先安装 DeepSeek Harness，并在 Harness 中完成账号登录或模型服务配置。桌面窗口不必打开，本服务使用安装包附带的运行时启动独立 ACP 进程。

在 SolveMate 的“设置 → AI 配置”中选择 DeepSeek Harness、检测连接，再选择实际返回的模型和推理强度并保存。正常情况下通过 PATH 查找 `dsh`，页面不显示安装路径；命令缺失时显示路径输入框，填入对应系统的默认安装位置并自动检测一次；默认位置仍找不到程序时再提示用户修改。模型列表不代表每个模型的鉴权和额度均已验证；实际提问失败时会保留问题并显示错误。

- macOS 与 Windows：优先使用 PATH 中的 `dsh` 命令。未注册命令时尝试默认安装位置：macOS 为 `/Applications/DeepSeek Harness.app`；Windows 为系统用户程序目录下的 `DeepSeek Harness`，通常是 `%LOCALAPPDATA%\Programs\DeepSeek Harness`，支持系统目录重定向。默认位置也未找到时，可手动填写实际位置。
- 手动路径支持 macOS 的 `.app` 或包内命令，以及 Windows 的 `DeepSeek Harness.exe`、安装目录或官方 `dsh.cmd`。不扫描整个磁盘，也不修改系统命令注册；第三方 `.cmd`、`.bat` 暂不支持。
- 模型标识按运行时返回值保存，不根据显示名称拼接。
- 连接检测不发起模型推理。真实提问会使用所选模型服务，遵循该服务的用量规则。

### Hermes

通过原生 `hermes acp` 接入，模型列表、会话和工具均由现有 Hermes 提供。先在终端运行 `hermes acp --check` 确认 ACP 依赖可用，再在 SolveMate 选择 Hermes、检测连接、选择模型并保存。检测列表包含 Hermes 已配置提供方的模型；模型编号原样保存。

优先使用 PATH 中的原生 `hermes` 命令。找不到时，macOS 尝试 `~/.local/bin/hermes`，Windows 尝试 `%LOCALAPPDATA%/hermes/bin/hermes.exe`，对应官方源码安装器的 CLI 位置。其他位置可手动填写；Windows MSIX 安装优先使用系统执行别名。不通过 shell 执行 `.cmd`、`.bat`，也不跨 Windows 与 WSL 查找程序。

配置目录取本机服务继承的 `HERMES_HOME`，未设置时遵循 Hermes 平台默认与 `HERMES_DATA_DIR_SUFFIX`。SolveMate 不导入 Hermes 的 Python 包、不复制密钥、不修改其全局默认模型。退出只关闭 SolveMate 持有的 ACP 客户端，不直接停止用户自己的 Gateway。

### Codex

通过 `codex app-server --listen stdio://` 接入，使用 Codex 现有登录与模型配置。先安装 Codex CLI 并完成登录或模型服务配置，再在 SolveMate 选择 Codex、检测连接、选择模型和推理强度并保存。不要求另行申请 API 密钥，不读取或复制凭据文件。

检测读取账号状态、当前模型配置和分页模型目录，不创建 thread 或请求模型。当前配置的自定义模型未在目录列出时，保留该模型，不推测其他模型或其推理选项。目录不代表每个模型的权限和额度都已验证，真实调用结果以执行状态为准。

优先通过 PATH 查找 `codex`。找不到时显示 CLI 路径，默认候选为 `~/.local/bin/codex`，Windows 为 `~/.local/bin/codex.exe`，实际安装位置可以修改。Windows 的官方 npm 命令若是 `.cmd`，只查找对应 npm 包的原生 `codex.exe`，不通过 shell 执行批处理；仅安装在 WSL 内的程序不能由 Windows 本机服务直接调用。

正式对话使用原生 thread，模型与推理强度按轮传入；恢复保留 thread 编号，停止使用该轮的原生 turn 编号。正文按原生增量显示，并以最终消息校正。权限只提供当前操作或当前轮次的决定，不提供会话级授权。无法完整显示的超长权限内容仅提供拒绝，未支持的客户端请求明确返回错误。

### 多服务与对话绑定

各服务的配置分别保存并独立启用或停用。全局默认通过单独操作选择，保存其他连接不改变默认。教师使用全局默认或独立选择已配置且启用的连接与模型。旧对话固定使用原连接；更改全局默认不改写旧对话的绑定。

在对话中切换教师或服务需要确认，确认后开始新对话。原对话、消息和原生 session 保留；新原生 session 在首次实际提问时建立。同一服务内切换模型继续原 session。

连接检测会话按连接、程序、配置目录和工作目录保存并复用；手动检测、保存前复检和重启不反复创建。创建结果不明或恢复失败时明确报错，只有用户确认后才重建检测会话。Hermes 检测会话通过原生命令命名为“SolveMate 连接测试”；DSH 的原生标题同步仍待实现。

## DSH 自定义模型配置

以下桌面配置补丁仅适用于 DSH；Hermes 直接提供自身的模型目录。

本机服务按其继承的 `DSH_HOME` 定位配置，未设置时使用当前用户的 `.dsh`。macOS 和 Windows 使用相同规则；其他进程单独设置的环境变量不会自动传给 SolveMate。

当前复用桌面配置 `profiles/desktop/cordis.patch.yml` 中 `@deepseek-ai/dsh-llm-pi-ai` 的模型提供方设置。ACP 的有效配置通过 DSH 官方 `--dump-config` 获取；保留 ACP 与共享配置中的已有提供方，同名配置以 ACP 的有效值为准。桌面界面插件和其他设置不进入 ACP。

运行时通过官方 `--patch` 加载提供方配置。临时文件位于系统临时目录、以当前用户权限创建，进程关闭后删除；不写入项目、连接数据库或日志。模型配置中的凭据引用交给 Harness 解析，不读取它的凭据库。更改模型提供方后，重新检测并保存连接，以便重启 ACP 加载新配置。

桌面配置不存在时使用 ACP 自身的模型配置。配置无法读取、YAML 损坏或提供方包含动态表达式时明确报错。当前未复用其他自定义模型插件或任意 profile；需要另外适配。会话绑定保留建立时的配置主目录；目录改变后仍由适配器尝试恢复原会话，找到并恢复成功就继续，失败时保留记录并显示原因。

## 数据与配置

默认使用仓库根目录的 `user/ai/state.sqlite3` 保存连接配置、会话绑定与每轮执行结果，`user/ai/workspace/` 作为 Harness 的学习工作目录。既有网页消息和机器人配置继续保存在 IndexedDB，本特性不迁移它们。

模型密钥和账号凭据仍由 Harness 自身管理，不复制进本服务的数据库、网页或日志。Harness 的外部会话由它自己的持久化机制管理；SolveMate 保存外部编号，以便恢复同一会话。

| 环境变量                  | 用途                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `SOLVEMATE_LOCAL_DATA`    | 修改本机服务的数据目录，测试时可使用独立位置                                            |
| `SOLVEMATE_LOCAL_ORIGINS` | 逗号分隔的受信任网页来源；默认允许本机 4173、5173 端口，统一启动时按实际网页端口设置    |
| `DSH_HOME`                | 可选，由 Harness 自身解析；修改后需要同时保留原有外部会话与配置，否则旧绑定可能无法恢复 |

服务只监听回环地址，写接口检查 Origin、JSON 内容类型及客户端请求头，读接口检查客户端请求头。请勿把本服务的端口或 `/local-api/` 公开到互联网。公网静态网页直接控制本机 Harness 的配对与连接方式尚未实现。

## 已确认的协议边界

DeepSeek Harness `0.2.2-rc.1` 在本机声明 ACP v1、会话创建/恢复/关闭和模型配置能力。未声明图片、音频及嵌入式上下文输入；当前传递题目或教材的实际文字，不承诺 PDF、PPT 原件能够被该入口直接读取。

会话恢复使用 `session/resume`，不回放历史消息。网页历史由 SolveMate 保存；恢复错误会明确显示，不创建空会话替代。请求编号用于去重，同编号不同内容会被拒绝。服务重启时把未结束执行标为中断，已收到的回复继续保留。

程序位置和配置目录变化不直接阻止恢复；删除后重新配置同一服务也使用原生会话编号继续查找。DSH 未找到可恢复会话、原会话被其他连接占用和原生工作目录不匹配分别提示；连接断开、超时和账号错误保留实际原因。Hermes 使用严格的 `session/load`，不使用找不到会话时可能另建会话的恢复入口。

专用连接测试会话丢失时可明确重建该测试会话，不将已有正式对话一并设为不可用。如果该测试会话在 DSH 桌面中打开，可能被桌面进程占用；关闭占用的会话或退出对应进程后重新检测，继续使用原测试会话。此类占用不使其他正式会话失效。连接本身故障仍记录为检测失败，保留原配置供用户检查。

`GET /local-api/v1/turns/{id}/events` 通过 SSE 发送完整执行快照，保留读接口的客户端请求头校验。状态和正文变化后推送，每 5 秒发送心跳；客户端断线后查询同一请求并重连，旧服务不支持该接口时使用查询。关闭网页连接不会取消模型执行，停止由独立接口处理。

DSH 当前 ACP 发送已提交的消息，不提供原始逐字增量。本机 0.2.2-rc.1 实测长回复在约 24.3 秒后以一个正文块返回；实时推送会立即转发这些实际内容，不生成打字动画。

网页展示 Harness 发起的权限请求，只提供当前操作的一次性允许或拒绝；Harness 自身已经配置的授权规则仍由其管理。温度、个人长期记忆、Skill 安装和 RAG 配置没有在本特性中接入，既有偏好不会被清除。

## 检查

在仓库根目录执行：

```bash
apps/server/.venv/bin/ruff check apps/local
apps/server/.venv/bin/ruff format --check apps/local
apps/server/.venv/bin/python -m pytest apps/local/tests -c apps/local/pyproject.toml
```

普通测试不调用模型。需要真实 Harness 验证时，显式设置程序和模型后执行 `tests/test_live_acp.py`；测试会产生真实模型请求，使用临时工作目录和新会话，并验证提问、追问、进程重启后的恢复。

```bash
SOLVEMATE_LIVE_DSH='/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh' \
SOLVEMATE_LIVE_MODEL='["deepseek-account","deepseek-flash"]' \
apps/server/.venv/bin/python -m pytest apps/local/tests/test_live_acp.py -c apps/local/pyproject.toml
```

模型值仅为本机已验证的示例，应使用自己连接检测返回的实际值。Windows 可使用 PowerShell 的 `$env:SOLVEMATE_LIVE_DSH` 和 `$env:SOLVEMATE_LIVE_MODEL` 设置，再通过虚拟环境的 `python.exe` 运行相同测试。

macOS 实际验证与 Windows 启动适配测试分别记录在 [003 设计](../../docs/features/003-ai-harness-connection/design.md)。Windows 的真实账号调用与安装运行仍需在实机验收。

Hermes 与多服务数据结构、兼容方式和验证结果见 [004 设计](../../docs/features/004-hermes-harness-adapter/design.md)。Hermes 的真实调用已在 macOS 验证；Windows 原生启动参数、候选路径和进程管理通过自动测试，实机调用仍待验收。

Codex 的接口映射、适配边界及验证结果见 [005 设计](../../docs/features/005-codex-harness-adapter/design.md)。Codex 已在 macOS 完成真实提问、换模型、停止和恢复；Windows 仍待实机验收。

## AI 配置与对话数据

共享定义位于 `packages/contracts/ai-metadata.schema.json`，TypeScript 类型和本机服务打包的 Schema 由 `npm run contracts:generate` 生成。请求、返回与保存数据使用相同字段定义；`npm run contracts:check` 检查生成文件是否同步。

左下角管理外部连接、启用状态及检测结果；全局默认独立引用一项连接。教师与对话只选择已配置且启用的连接与模型，不处理安装与检测。教师未单独配置时使用全局默认，新对话保存明确的服务与模型。每轮执行独立保存请求快照、提交信息与结果版本；没有取得原生实际模型时保留为空。配置更新携带期望版本，发生冲突返回 HTTP 409，客户端重新读取配置。

SQLite 首次打开旧数据库时，在同一事务中备份旧记录并迁移至格式 3，原生会话编号保持不变。浏览器个人数据库也通过事务迁移并保留旧格式备份，课程内容数据库保持原格式。具体约束与验证见 [006 设计](../../docs/features/006-ai-conversation-metadata/design.md)。

## 用户资料

网页科目下的“学习资料”列表支持 PDF 和 PPTX，单文件上限 100 MiB。原件先保存到 `user/uploads/<资料编号>/<SHA-256 版本>/`；资料编号目录中的 `record.json` 记录处理状态和阅读文件。PPTX 由 LibreOffice 转换为 PDF，PDF.js 在网页显示原页面；每页文字通过 pypdf 提取。官方服务不接收这些文件。

PDF 无需安装办公软件。PPTX 需安装 [LibreOffice](https://www.libreoffice.org/download/download-libreoffice/)：macOS 可执行 `brew install --cask libreoffice`；Windows 使用官方安装程序。服务优先查找 PATH，再检查 macOS 应用目录或 Windows Program Files 目录。非默认路径可在启动前设置 `SOLVEMATE_LIBREOFFICE`，值为 `soffice`、`soffice.com` 或 `soffice.exe` 的完整路径。macOS 无界面转换会同时加载系统与 LibreOffice 自带字体；未安装课件使用的字体时，转换后的排版可能与原课件不同，要求原版排版时可导入课件导出的 PDF。

转换使用独立配置目录，最多同时处理两份资料，超过两分钟会停止本次转换；缺少转换器或文件损坏时保留原件，可在网页点击“重试处理”。重启服务会将中断任务标为失败，等待用户重试。在同一科目重复导入同一文件复用原资料；不同科目分别保留资料记录。调整所属科目只改变归属，不改变文件编号和历史引用。原件或阅读文件丢失时可重新导入原文件恢复。

`SOLVEMATE_USER_DIR` 可指定本机数据根目录；默认使用项目的 `user/`。`SOLVEMATE_MATERIALS_DIR` 可单独指定上传资料目录，默认是数据根目录下的 `uploads/`；已有 `SOLVEMATE_LOCAL_DATA` 仍指定 AI 数据目录。测试应显式指定独立目录，不使用正式资料。

| 接口 | 用途 |
| --- | --- |
| `GET /local-api/v1/materials` | 资料列表；`X-SolveMate-Material-Errors` 记录未能读取的元数据数量 |
| `POST /local-api/v1/materials?filename=...&courseId=...` | 上传原件，正文为 `application/octet-stream`；课程可不填写 |
| `PATCH /local-api/v1/materials/{id}/course` | 通过 `courseId` 与 `expectedRevision` 调整归属，原编号和版本不变 |
| `POST /local-api/v1/materials/{id}/retry` | 重试失败的处理，不重复上传 |
| `GET /local-api/v1/materials/{id}/{version}/reader` | 读取固定资料版本的 PDF |
| `GET /local-api/v1/materials/{id}/{version}/pages/{page}` | 取得对应页面文字 |

所有资料接口沿用本机服务的 Host、Origin 和 `X-SolveMate-Client` 检查。文件名只作显示，不参与磁盘目录拼接。网页引用保存资料编号、固定版本、页码和文字快照；文字随问题直接进入现有 Harness 请求。当前不提供扫描件 OCR、图片理解、跨页选区或整本书检索。

## 个人记录与浏览器迁移

`user/app.sqlite3` 保存对话、消息、笔记本、笔记、机器人、学科、标签、设置、提问草稿及阅读进度。`user/community/` 保存下载包和清单，数据库保存版本索引与当前指针；`user/ai/` 继续保存已有连接、原生绑定和执行。接口位于 `/local-api/v1/user/`，沿用本机地址、网页来源及客户端标识检查，个人记录不发送到官方服务。

首次升级使用原浏览器、原访问地址打开新版，先关闭其他旧版页面。程序读取原始 IndexedDB 记录及下载包，将完整信封（含旧格式备份）备份到 `user/backups/`，校验后导入；原数据库不删除。已有正式记录时提供“使用本机记录”或“导入浏览器记录”；替换需要确认，并先用 SQLite 备份接口保存本机记录。相同来源与内容重复打开不会重复导入；旧页面后续改动过的记录会再次提示选择。

默认上传目录从 `user/materials/` 复制到 `user/uploads/`，复制后逐文件核对 SHA-256，再启用新目录并写入迁移回执。旧目录保留，程序只读写新目录。复制或回执写入中断可重试；两目录存在差异且无回执时拒绝覆盖。显式指定的资料目录保持原位。

本机服务不可达时，网页可查看已有缓存；修改未能保存时保留未确认副本并提示重试，重新打开后可选择恢复。缓存不充当正式记录。需要备份整个用户目录时，先停止应用，再复制 `user/`；恢复前保留当前目录。跨设备同步、自动定期备份及备份导入界面未提供。结构和失败处理详见 [012 本机用户数据保存](../../docs/features/012-local-user-storage/design.md)。


## 笔记本 PDF 导出

笔记本右键的“导出 PDF”通过本机 Chrome、Chromium 或 Microsoft Edge 无界面打印，不调用 AI，不上传笔记。服务优先从 PATH 查找程序，再检查 macOS 应用目录或 Windows 的 Program Files、LocalAppData。非默认安装可设置 `SOLVEMATE_PDF_BROWSER` 为浏览器可执行文件的完整路径。此要求仅用于生成 PDF，不限制使用 SolveMate 网页的浏览器。

打印使用独立临时配置目录，正文与公式字体由网页内嵌，不读取用户浏览器记录，不加载外部网络资源。导出最多等待 45 秒，失败或取消后清理本次进程和临时文件。首版导出文字、代码、公式和表格；远程图片保留替代文字，不主动请求图床。网页默认下载 PDF，Chrome／Edge 等支持文件保存选择器的浏览器也可以选择路径；其他浏览器按自己的下载设置保存。

## 文件导出

`GET /local-api/v1/user/exports/directory` 返回系统下载目录；`POST /local-api/v1/user/exports/save?filename=...` 接收 JSON 或 PDF 并写入该目录，返回实际文件名与位置。同名文件自动添加数字后缀，不覆盖已有文件；接口不接受任意目标路径，遵循现有来源及客户端标识检查。笔记本 PDF 的生成接口保持不变。

### 学习时长

`GET /local-api/v1/user/study` 读取每日统计，`POST` 提交时间段和数据目录编号。统计保存在 `user/app.sqlite3` 的 `study_days` 表中，与整份页面记录分别更新；合并重叠时间段，重复提交不增加时长。规则与验证见 [017 学习时长统计](../../docs/features/017-study-time/spec.md)。
