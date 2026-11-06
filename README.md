# SolveMate

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

知识平权——让每一位学生，都有一位因材施教的专业教师。

SolveMate 按长期客户端产品规划，首个可运行版本为 Web/PWA，提供教材和题目阅读、会话记录、笔记查看、机器人配置及本地保存。AI 连接的后续目标是独立适配用户自己的 API 或 harness。手机 App、小程序及桌面外壳的具体实现尚未确定。

前端使用 TypeScript，React 负责界面组件，Vite 负责开发与构建。Web 本地存储采用 IndexedDB/Dexie，并通过统一接口访问。界面组件使用 Radix Primitives 与 CSS Modules，内容展示使用 Markdown 与 KaTeX，PWA 缓存使用 vite-plugin-pwa / Workbox。官方内容服务已使用 Python + FastAPI 实现课程目录、版本查询、更新判断和 ZIP 下载，位于 `apps/server/`。网页已通过“设置 → 官方内容”接入下载更新；后端启动方式见 [后端说明](apps/server/README.md)。

## 本地开发

开发环境使用 Node.js 24 和 npm 11。以下命令均在仓库根目录执行：

```bash
npm ci
npm run dev
```

`npm ci` 按锁定文件安装依赖；`npm run dev` 启动本地开发服务，地址以终端输出为准。开发服务用于编辑页面和检查交互。

| 命令                     | 用途                                                   |
| ------------------------ | ------------------------------------------------------ |
| `npm run licenses:check` | 检查发行文件的许可证与依赖一致                         |
| `npm run check`          | 检查 TypeScript 类型及 ESLint 问题                     |
| `npm run format:check`   | 使用 Prettier 默认配置检查代码格式                     |
| `npm test`               | 运行数据、本地存储及业务逻辑等单元测试                 |
| `npm run build`          | 检查类型，生成网页和 PWA 发布文件                      |
| `npm run preview`        | 在本地预览构建结果，默认地址为 `http://127.0.0.1:4173` |

PWA 的安装和离线行为需要使用构建结果验证：

```bash
npm run build
npm run preview
```

开发服务不作为 PWA 离线验收环境。生产环境应通过 HTTPS 提供网页；本地预览使用回环地址。首次完成应用与内容缓存、页面显示离线资源就绪后，可以脱离 SolveMate 服务重新打开应用，并使用已保存的内容和记录。

## 官方内容后端

后端使用独立 Python 虚拟环境，发布已有高等数学和 C 语言内容，保留历史版本，并提供包大小与 SHA-256 校验。源目录为 `data/catalog.json`；安装、发布、启动和接口说明见 [apps/server/README.md](apps/server/README.md)。网页已支持下载、本地保存和版本更新；更新失败继续使用已保存的版本。

本地联调先按后端说明启动 8000 端口的内容服务，再运行网页。开发与预览将 `/api/v1` 代理到该服务；正式部署应为这个路径配置同源反向代理，或在构建时设置 `VITE_CONTENT_API_URL`（包含 `/api/v1` 的完整基址），并配置后端允许的网页来源。示例见 `apps/web/.env.example`。服务不可达时，网页仍可读取本地已保存内容。

## 当前功能与数据

- “设置 → 官方内容”可检查、下载与更新课程，保存后可离线阅读；网络、校验或本地保存失败时保留旧版本，历史会话继续关联原内容版本。
- 内置高等数学 24 道题和 C 语言 12 道题，各有 6 章教材，包含公式与代码块。
- 对话和笔记提供示例内容。发送新问题时仅保存到本地，当前不会生成 AI 回复；推荐问题也明确标记为示例。
- 机器人支持新建、配置、设为默认、复制和删除。会话、机器人配置、阅读字号及外观设置保存到当前浏览器。
- 学习热图、学习时长和勋章使用示例数据，尚未统计实际学习情况。语音输入、账号服务和头像菜单中的其他服务尚未接入。

学习记录属于当前浏览器中当前站点的数据。更换浏览器、站点地址或设备时，不会自动带上已有记录；浏览器主动清理站点数据也会移除这些记录。备份、导出和跨端迁移流程仍待后续设计。

## 项目文档

- [项目计划](PLANS.md)
- [参与开发](CONTRIBUTING.md)
- [开源声明](NOTICE.md)
- [产品愿景](docs/product/vision.md)
- [架构与技术方向](docs/architecture/overview.md)
- [用户指南](docs/product/manual/README.md)
- [001 高等数学题目阅读助手规格](docs/features/001-instant-question-answering/spec.md)
- [001 高等数学题目阅读助手技术设计](docs/features/001-instant-question-answering/design.md)
- [002 官方内容服务规格](docs/features/002-official-content-service/spec.md)
- [002 官方内容服务设计](docs/features/002-official-content-service/design.md)
- [后端安装与接口](apps/server/README.md)
- [内容服务 OpenAPI](packages/contracts/content-api.openapi.json)
- [数据资产说明](data/README.md)
- [高等数学首版示例题库](data/calculus/questions/questions.json)
- [高等数学示例教材](data/calculus/textbooks/primer.md)
- [高等数学记忆点](data/calculus/memory/learning-points.json)
- [高等数学讨论点](data/calculus/memory/discussion-points.json)
- [C 语言示例题库](data/c-language/questions/questions.json)
- [C 语言示例教材](data/c-language/textbooks/primer.md)
- [C 语言记忆点](data/c-language/memory/learning-points.json)
- [C 语言讨论点](data/c-language/memory/discussion-points.json)

## 仓库结构

```text
SolveMate/
├── data/                                   # 按课程组织的数据资产
│   ├── README.md
│   ├── catalog.json                       # 官方课程及发布文件白名单
│   ├── calculus/                           # 高等数学
│   │   ├── textbooks/
│   │   │   └── primer.md
│   │   ├── questions/
│   │   │   └── questions.json
│   │   └── memory/
│   │       ├── learning-points.json
│   │       └── discussion-points.json
│   └── c-language/                         # C 语言
│       ├── textbooks/                      # 教材
│       │   └── primer.md
│       ├── questions/                      # 题目、参考答案和讲解要点
│       │   └── questions.json
│       └── memory/                         # AI 提炼的记忆点、讨论点等
│           ├── learning-points.json
│           └── discussion-points.json
├── docs/
│   ├── product/
│   │   ├── vision.md                       # 产品愿景、痛点、场景和核心竞争力
│   │   └── manual/                         # 面向最终用户的产品说明书
│   │       ├── README.md                   # 用户指南
│   │       └── images/                     # 指南截图
│   ├── features/                           # 按产品特性组织
│   │   ├── 001-instant-question-answering/
│   │   │   ├── spec.md                     # 背景、目标、功能要求和验收标准
│   │   │   └── design.md                   # 该特性的技术设计
│   │   └── 002-official-content-service/
│   │       ├── spec.md
│   │       └── design.md
│   ├── architecture/                       # 系统当前整体架构
│   │   └── overview.md                     # 产品形态、技术方向和职责边界
│   └── templates/                          # 文档模板
│       ├── feature-spec.md
│       └── feature-design.md
├── apps/
│   ├── server/                             # Python + FastAPI 官方内容服务
│   │   ├── src/solvemate_server/            # 路由、模型、发布和内容读取
│   │   ├── tests/                          # 发布与 HTTP 接口测试
│   │   ├── pyproject.toml
│   │   ├── requirements.lock
│   │   └── README.md
│   └── web/                                # Web/PWA 应用
│       ├── public/                         # 应用图标
│       ├── src/
│       │   ├── App.tsx                     # 页面切换和应用状态
│       │   ├── App.module.css
│       │   ├── main.tsx                    # React 入口
│       │   ├── styles.css                  # 全局基础样式
│       │   ├── assets/                     # 用户头像等静态图片
│       │   ├── components/                 # 阅读、对话、机器人及导航等组件
│       │   ├── data/                       # 课程加载、示例数据和内容校验
│       │   ├── content/                    # 官方内容接口、校验、下载与本地版本保存
│       │   ├── storage/                    # 本地存储接口、IndexedDB 实现和保存状态
│       │   ├── state/                      # 会话等业务处理
│       │   ├── ai/                         # AI 连接接口与未接入状态
│       │   └── logger.ts                   # 英文错误日志
│       ├── index.html
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts                  # 构建与 PWA 配置
│       └── vitest.config.ts                # 单元测试配置
├── packages/                               # 不独立运行的共享代码
│   ├── contracts/                          # 客户端与内容服务使用的接口和数据约定
│       ├── package.json
│       ├── content-api.openapi.json        # Python 路由生成的 HTTP 接口约定
│       └── src/
│           └── index.ts                    # 内容、会话、机器人和配置类型
│   └── deepmerge/                          # PWA 构建依赖安全补丁、原许可与测试
├── package-lock.json                       # 锁定 npm 依赖版本
├── package.json                            # npm 工作区与统一命令
├── eslint.config.js                        # TypeScript 与 React 检查配置
├── scripts/                                # 第三方许可证生成与上游许可副本
├── LICENSE                                 # MIT 许可证
├── NOTICE.md                               # 开源声明与内容授权范围
├── THIRD_PARTY_NOTICES.md                   # 第三方依赖说明
├── CONTRIBUTING.md                          # 安装验证与贡献说明
├── PLANS.md                                # 项目阶段与执行顺序
├── README.md                               # 项目入口
└── .gitignore
```

目录树列出当前主要文件。单元测试与所测试的模块放在同一目录，文件名以 `.test.ts` 结尾。其他平台的程序在实现时再加入；后端 `.venv/`、`.content/` 和构建输出为自动生成目录，均不提交 Git。

特性目录统一使用 `三位编号-特性名称`，例如 `001-instant-question-answering/`、`002-特性名称/`。编号按新增顺序递增，已有编号保持稳定。

## 开源与许可

代码、文档和自编示例内容采用 [MIT](LICENSE)。允许修改、分发及商业使用，分发时保留许可证和版权声明。适用范围、示例内容来源及产品现状见[开源声明](NOTICE.md)，依赖版权见[第三方说明](THIRD_PARTY_NOTICES.md)。

参与开发见 [CONTRIBUTING](CONTRIBUTING.md)。npm 配置中的 `private: true` 用来避免误发布 npm 包，不影响仓库的 MIT 授权。
