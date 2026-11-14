# 第三方软件说明

SolveMate 的 MIT 许可证不替代第三方软件的许可证。依赖的准确版本以 `package-lock.json` 和 `apps/server/requirements.lock`、`apps/local/requirements.lock` 为准。

| 用途            | 组件                                  | 许可证                                              |
| --------------- | ------------------------------------- | --------------------------------------------------- |
| 网页界面        | React、React DOM、Radix UI            | MIT                                                 |
| 图标            | Lucide                                | ISC，附带上游文件中的其他版权声明                   |
| PDF 显示与文字选择 | PDF.js | Apache-2.0；随附字体和解码器保留各自许可 |
| PDF 读取 | pypdf | BSD-3-Clause |
| 浏览器数据库    | Dexie                                 | Apache-2.0                                          |
| 共享数据校验    | Ajv、jsonschema                       | MIT                                                 |
| ZIP 读取        | fflate                                | MIT                                                 |
| Markdown 与公式 | react-markdown、remark、rehype、KaTeX | MIT；其传递依赖分别保留原许可                       |
| 公式字体        | KaTeX 随附字体                        | SIL Open Font License 1.1，保留字体原版权与保留名称 |
| 内容 API        | FastAPI、Pydantic                     | MIT                                                 |
| DSH 配置读取    | PyYAML                                | MIT                                                 |
| DSH 实时订阅    | websockets                            | BSD-3-Clause                                        |
| HTTP 服务       | Uvicorn                               | BSD-3-Clause                                        |

## 网页发行文件

[完整运行依赖许可证](apps/web/public/third-party-licenses.txt) 包含第三方包的许可证与版权原文，覆盖直接、传递运行依赖及锁定的可选平台包。构建后该文件随网页发布，地址为 `third-party-licenses.txt`；项目自己的许可证随附为 `LICENSE.txt`。KaTeX 代码的 MIT 许可证、字体中嵌入的版权及保留名称、SIL OFL 1.1 原文一并分发；许可证文件也纳入 PWA 离线缓存。

安装锁定依赖后，运行 `npm run licenses:generate` 更新副本，`npm run licenses:check` 检查是否同步。构建命令自动执行检查。开发和构建工具不被这个运行依赖清单覆盖，重新分发这些工具时仍须保留其自己的许可文件。

少数 npm 包未随包附带许可证文件，其已核对版本使用 `scripts/licenses/` 中的上游原文副本。来源及版本见该目录说明。

## Python 发行文件

SolveMate 服务 wheel 附带自身 MIT 许可证。FastAPI、Pydantic、Uvicorn 等依赖由 pip 单独安装，适用各自发行包附带的许可证。容器或其他打包方式若同时分发这些依赖，应保留其 `.dist-info` 中的许可与版权文件。

## 构建依赖补丁

`packages/deepmerge/` 基于 npm deepmerge 4.3.1，保留其 [MIT 原文](packages/deepmerge/LICENSE)与版权。项目加入属性复制的安全补丁，以修复上游尚未发行修复版的问题，来源与改动见[补丁说明](packages/deepmerge/README.md)。此模块只用于 PWA 构建，不进入网页运行代码；其许可证不由 SolveMate 署名替代。

## 笔记纸张素材

`apps/web/src/assets/note-paper.jpg` 使用 [ambientCG 的 Paper 001](https://ambientcg.com/view?id=Paper001)，取自官方 `Paper001_1K-JPG.zip` 的 `Paper001_1K-JPG_Color.jpg`，文件保持原样。素材采用 [Creative Commons CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)，许可范围见 [ambientCG 官方说明](https://docs.ambientcg.com/license/)。点阵、页边线和装订孔由 SolveMate 的 CSS 绘制。

## 本机课件转换

PPTX 转换调用用户单独安装的 LibreOffice，不将 LibreOffice 二进制打包进仓库或网页。LibreOffice 使用 [MPL 2.0 等上游许可证](https://www.libreoffice.org/about-us/licenses/)。PDF.js 的字符映射、标准字体与 WebAssembly 解码器随网页分发，各自版权及许可原文已收录到网页的完整许可证文件。
