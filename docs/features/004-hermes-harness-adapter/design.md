# Hermes 适配与连接、会话的数据设计

## 职责

- `transport.py` 负责 ACP JSON-RPC 收发、请求超时、通知、权限回调及所属子进程的退出。
- `adapters/dsh.py` 与 `adapters/hermes.py` 分别负责启动入口、配置目录、模型选项与会话加载的协议差异。注册表按服务和稳定连接编号取得适配器。
- `connections.py` 负责多项连接、各自的 ACP 运行进程、已加载会话和适配器各自的连接检测流程。
- `service.py` 统一管理提问、绑定、执行状态、正文、停止、权限与 SSE。界面接收同一种执行快照，不处理原生通知的差异。

DSH 保留原有桌面模型补丁处理。Hermes 通过 `hermes acp` 启动，使用 Hermes 自身配置；SolveMate 进程不导入 Hermes 的 Python 包，也不修改其全局模型配置。旧版推理等级兼容入口由 Hermes 自己的隔离 Python 运行。

## 稳定编号与保存

每种服务当前保存一份本机连接：`deepseek-local`、`hermes-local`。`connections` 表分别保存配置与模型目录；`config` 保留全局默认，兼容既有接口。升级时将原 DSH 配置加入连接表，并给旧绑定补充 `deepseek-local`，原生会话编号保持不变。

`bindings` 按 SolveMate 对话编号与连接编号保存、原生会话编号、程序位置、工作目录及 Harness 配置目录。创建原生会话前先保存待确认绑定，获得编号后再补全；结果不明时不自动再次创建。每轮执行保存实际使用的连接、教师与模型。切换服务保留各自关联，切换机器人建立新对话；共同规则由 [006 对话元数据设计](../006-ai-conversation-metadata/design.md)维护。

网页使用 `Conversation.aiConfig` 保存当前服务、模型和推理等级，`bindings[]` 保存各服务的原生关联。网页携带目标服务已知的原生编号；本机缺少关联时先按该编号恢复，明确找不到时由用户确认是否新建。不得使用本地历史悄悄替换原生会话。

## 协议差异

| 操作     | DSH                              | Hermes                                             |
| -------- | -------------------------------- | -------------------------------------------------- |
| 启动     | 桌面运行时或 `dsh acp`           | `hermes acp`                                       |
| 模型目录 | 本机 Host `session/modelCatalog` | Hermes 原生模型目录 SDK                            |
| 切换模型 | `session/set_config_option`      | `session/set_model`                                |
| 恢复     | `session/resume`                 | `session/load`，要求 `loadSession` 能力            |
| 新建     | ACP `session/new`                | Gateway `session.create` 指定模型后由 ACP 严格加载 |
| 检测结束 | 关闭目录客户端                   | 关闭客户端，不创建或加载会话                       |

选择 Hermes 的严格加载接口，是因为部分旧实现的 `resume` 会在找不到会话时新建。SolveMate 不接受这种替换行为。加载时原生回放发生在新轮次通知映射建立之前，不把历史内容当作本轮回复。

各服务的进度与权限通知按“连接编号 + 原生会话编号”定位，避免编号相同的服务互相干扰。停止只发送给该轮所属进程；关闭 SolveMate 只关闭自身持有的 ACP 客户端，不直接终止用户的 Hermes Gateway。

## 检测会话

`probes` 按连接、实际程序、配置主目录和工作目录的组合保存一个检测会话编号。创建前先写入结果未知的记录，收到编号后立即保存。再次检测严格加载该编号；恢复失败、超时或创建结果未知都不自动另建。用户明确选择“重建检测会话”并确认后才允许重新创建。

Hermes 通过本地 `/title` 命令将新检测会话命名为“SolveMate 连接测试”，不调用模型。DSH 使用不依赖会话的模型目录接口检测，不创建检测会话；原生标题同步仍待适配。

每项服务使用独立的检测锁；同一服务已有检测时返回 `detection_busy`，不排队重复执行，也不把已有连接标成不可用。整次协议检测设置 25 秒上限，创建结果未知时保留未知记录。结束或取消后继续等待本次进程清理，不能留下后台进程；释放检测会话最多等待 2 秒，随后关闭客户端。关闭进程的时间与协议等待分别计算，因此超时提示可能在 25 秒后经过短暂清理再出现。

网页显示等待秒数与检测说明，超过 5 秒显示等待提示；HTTP 超时与本机服务无法连接分别报错。实际计时用于显示等待，不编造检测百分比或阶段进度。

## 启动与平台

优先从 PATH 查找原生 `hermes` 命令。找不到时，网页显示程序路径，并尝试一次系统对应的候选位置。macOS 候选为 `~/.local/bin/hermes`；Windows 候选为 Hermes 数据目录下 `bin/hermes.exe`，对应官方源码安装器发布的 CLI 入口；MSIX 使用系统执行别名，其他安装位置可以手动填写。

`HERMES_HOME` 使用本机服务继承的环境变量；未设置时遵循 Hermes 的平台默认：macOS 为 `~/.hermes`，Windows 为 `%LOCALAPPDATA%/hermes`。启动使用参数数组，不经 shell 拼接。Windows `.cmd`、`.bat` 和仅安装于 WSL 的命令需要另外适配。

## 参考

- [Hermes Windows 原生安装说明](https://hermes-agent.nousresearch.com/docs/user-guide/windows-native)
- [Hermes ACP 官方说明](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp)
- 本机 Hermes 0.22.5 的 `acp_adapter/gateway_server.py`、`acp_adapter/server.py` 与 `hermes_constants.py`；实际调用按本机返回结果确认。

## 验证记录

2026-11-10，在 macOS 使用本机 Hermes 0.22.5 和 DeepSeek Harness 完成验证。测试数据与正常使用的数据分别保存。

| 项目                            | 结果                                                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Hermes 真实提问、追问、重启恢复 | 三轮完成，使用同一个原生编号；重启后仍能回答前文约定的练习代号                                                              |
| 网页双服务                      | DSH 实际回答 C 语言除法问题；确认切换后由 Hermes 回答，旧对话仍能恢复和追问                                                 |
| Hermes 换模型                   | 从 `deepseek-v4.1-flash-1017` 改为 `glm-5.3` 后继续原会话，保留上下文，不弹重开确认                                         |
| 严格恢复与历史合并              | 重启本机服务后通过 `session/load` 继续 Hermes 会话；回放未重复插入网页消息                                                  |
| 停止                            | 网页停止后执行记为取消，输入恢复可用；部分回复保留由公共执行逻辑的自动测试覆盖                                              |
| 切换确认                        | 教师和服务均验证确认与取消；新对话保留阅读关联，不继承旧消息；未提问的新对话不创建原生 session                              |
| 检测复用                        | 反复检测、保存前复检及重启后，测试存储仍各有一条 DSH、Hermes 检测绑定；Hermes 原生标题为“SolveMate 连接测试”                |
| 自动检查                        | TypeScript、ESLint、Prettier、Ruff 和发布构建通过；网页 90 项、本机服务 54 项、启动与依赖补丁 11 项测试通过，2 项按环境跳过 |
| Windows                         | 自动测试覆盖原生启动参数、中文与空格路径、默认 CLI 位置、配置目录及进程管理；没有 Windows 实机调用结果                      |

DSH 的标题、重命名与归档等原生管理接口尚未同步，保留为后续事项；本次会话执行与连接复用的完成不代表这些管理操作已接入。

DSH 与 Hermes 的 ACP 差异由本特性覆盖；公共会话结果、执行事件与 Codex app-server 接口见 [005 设计](../005-codex-harness-adapter/design.md)。

2026-11-12：本机 Hermes 复用已登记的连接测试会话，初始化约 1.02 秒，严格加载并取得 8 个模型约 7.89 秒，命名约 0.06 秒，退出约 0.26 秒；没有创建新的原生会话或调用模型。自动测试覆盖整次检测超时、创建结果未知、关闭期间取消、同服务重复检测及不同服务互不阻塞。

新检测流程使用相同已登记的 Hermes 测试会话完成实测，返回 8 个模型，总耗时约 9.71 秒。263 项网页测试、19 项脚本测试、210 项本机服务测试通过，另 2 项按条件跳过；TypeScript、ESLint、Prettier、Ruff 和网页构建通过。独立网页环境验证计时、模拟超时提示和重试后模型列表恢复；本次没有调用真实模型或 Codex。

## 推理等级适配

优先读取 ACP 会话的 `configOptions` 并通过 `session/set_config_option` 设置推理等级；设置后核对接口返回值。旧版 Hermes 未提供该选项时，通过所选安装自己的 `--print-runtime-command` 解析运行命令，复用 Hermes 的依赖环境和 Gateway SDK，读取该安装提供的等级及当前会话值。设置复用 Hermes 的 `PreparedMutations` 会话操作，并重新读取确认。兼容代码只在 Hermes 适配器维护，界面与公共执行服务继续使用统一的等级元数据。Hermes 的等级属于会话，目录中的各个模型共享这些原生选项，切换模型后仍可选择推理等级。

兼容调用不修改 Hermes 安装文件、全局模型配置或其他会话，不发送控制命令给模型。路径及系统差异由 Hermes 运行命令负责，SolveMate 不猜测 Python 安装位置。会话创建和恢复时读取等级元数据，在提问前应用用户保存的等级；不能核实生效时返回具体错误，保留原会话绑定。

测试覆盖原生 ACP、旧版 SDK、运行入口不支持、超时、异常、取消清理、设置后的读回不一致，以及会话恢复后重新应用等级。真实验证使用独立主目录及一个明确登记的测试会话，不调用 Codex，不修改用户正式会话。

## 按所选模型初始化

Hermes 当前的 ACP `session/new` 会按默认配置创建会话，不接收模型参数。适配器使用安装自身的 `--print-runtime-command` 取得隔离 Python 入口，在该环境中运行 `hermes_gateway.py`。目录、SDK 能力检查和原生创建均通过此入口，SolveMate 不导入 Hermes 包、不猜测 Python 路径、不复制凭据。

- 检测读取原生目录 SDK，不实例化模型 Agent，不创建、恢复或命名检测会话。模型编号与 ACP 选择接口一致，推理选项由安装自身提供。旧检测记录保留但不再参与检测。
- 正式创建使用 Gateway `session.create`，提供方和模型由 Hermes 自己的 `parse_model_input` 解析，并显式传入创建请求；ACP 来源、工作目录和审批策略与原生 ACP 创建保持一致。默认模型不参与新建。全局配置保持原值。
- 公共服务接收原生编号后先保存绑定及本轮原生编号，再调用适配器加载选项。Hermes 通过 `session/load` 加载该编号，后续模型选择、推理等级、回复、停止和权限交互继续使用 ACP。加载或选项读取失败时保留已知编号，下次恢复同一会话。
- 旧会话继续按已有编号严格加载，不通过创建接口替代。新建结果不明时保留原状态，不重复创建；SDK 或严格加载能力不可用时说明需要更新 Hermes，不回退到默认模型。
- 运行入口、请求、模型目录及返回编号均需有效；超时和取消清理本次辅助进程，不停止用户 Gateway。原生异常只返回固定错误码与说明，不把凭据和原始诊断转发到网页。

验证覆盖：目录读取与重复检测不创建会话、创建请求包含所选提供方与模型、加载失败后保存原编号、重试与服务重开不重复创建、SDK 不支持时明确拒绝、推理等级读回、跨服务独立绑定及停止处理。Windows 的运行命令和进程行为使用自动测试，实机另行验收。

2026-11-13：macOS 使用独立 SolveMate 存储及一个登记的 Hermes 专用会话，直接选择自定义 GLM 5.3 创建，ACP 加载后核对当前模型。首轮发送测试标记，关闭并重开本机数据与 ACP 进程，再按原生编号追问；未附加本地历史，正确返回首轮标记。两轮回复均完成，原生编号一致，Hermes 全局配置文件的 SHA-256 保持不变。未调用真实 Codex，未修改或清理用户正式会话。

参考：[Hermes ACP 集成](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/acp.md)、[原生 ACP 创建逻辑](https://github.com/NousResearch/hermes-agent/blob/main/acp_adapter/gateway_server.py)、[Gateway 创建参数](https://github.com/NousResearch/hermes-agent/blob/main/gateway/session_policy.py)。

相关自动验证：126 项通过，1 项按运行平台跳过；覆盖适配器合同、Hermes 初始化与模型目录、推理等级、同编号恢复、引用收件记录、进程退出和路径处理。Ruff 检查与格式检查通过。
