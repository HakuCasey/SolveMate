# SolveMate 官方内容服务

使用 Python + FastAPI 提供课程目录、版本查询、更新判断与内容包下载。当前发布高等数学和 C 语言两门课程，每门课程包含教材、题目、记忆点和讨论点。

服务只分发官方学习内容，不接收或保存个人会话、笔记、机器人配置与 AI 凭据。网页已通过“设置 → 官方内容”接入下载更新；未下载时使用随应用提供的基础内容，下载后通过本地 IndexedDB 保存。

## 安装与启动

要求 Python 3.12 或以上。本轮使用 Python 3.14 验证。在仓库根目录进入后端目录：

```bash
cd apps/server
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.lock
python -m pip install --no-deps --no-build-isolation -e .
solvemate-publish
uvicorn solvemate_server.main:create_app --factory --host 127.0.0.1 --port 8000
```

`requirements.lock` 锁定本次验证的运行、测试与构建依赖。修改依赖时在独立虚拟环境中安装 `-e ".[dev]"`，验证后重新生成锁定文件。`.venv` 是自动生成的本地依赖目录，不提交 Git。

默认 API 地址为 `http://127.0.0.1:8000`，交互接口文档为 `/docs`，OpenAPI 为 `/openapi.json`。首次启动前必须执行发布命令；没有发布目录或内容损坏时，启动校验会报错，不提供空的成功结果。

## 源内容与发布

`data/catalog.json` 声明课程信息与允许发布的文件。原始教材、题目及课程记忆仍保存在各课程目录中，不复制到服务源码。修改原始内容后，在同一虚拟环境再次执行 `solvemate-publish`。

发布工具会检查 JSON 格式、题目编号、记忆点引用的题号、教材路径与章节锚点，再生成每门课程的 ZIP。它不会扫描整个仓库或自动打包未列出的文件。路径必须位于相应课程目录内。

同一环境下，源文件和课程信息不变时，重复发布不会新增版本。版本标识是 ZIP 字节的 SHA-256；`release` 是便于阅读的名称，例如 `example-1`，不能用它替代版本标识判断更新。

每个 ZIP 内含：

```text
course.json                  # 包格式版本、课程信息、原文件列表及校验值
textbooks/primer.md
questions/questions.json
memory/learning-points.json
memory/discussion-points.json
```

发布结果默认写入 `.content/`，已加入 Git 忽略。每个版本保留独立的 `content.zip` 和 `manifest.json`，新发布不覆盖旧包。所有新包写入完成后，再原子替换 `catalog.json`。发布失败时保留原目录；API 逐次读取已提交目录，成功发布后无需重启服务。

`.publish-lock` 防止多个发布进程同时提交。若发布进程被强制终止而留下锁目录，确认没有发布进程运行后再移除这个空目录。失败留下但未进入目录的包不会通过 API 暴露，后续重试可继续使用相同的完整包。

## 接口

| 方法      | 路径                                                      | 返回内容                         |
| --------- | --------------------------------------------------------- | -------------------------------- |
| GET       | `/healthz`                                                | 检查发布目录与包的完整性         |
| GET       | `/api/v1/courses`                                         | 课程目录及最新版本入口           |
| GET       | `/api/v1/courses/{course_id}`                             | 一门课程的简介与最新版本         |
| GET       | `/api/v1/courses/{course_id}/versions`                    | 已发布版本清单，当前最新版本在前 |
| GET       | `/api/v1/courses/{course_id}/versions/latest`             | 最新版本清单                     |
| GET       | `/api/v1/courses/{course_id}/versions/{version}`          | 固定版本清单                     |
| GET、HEAD | `/api/v1/courses/{course_id}/versions/{version}/download` | ZIP 下载或文件头                 |
| GET       | `/api/v1/courses/{course_id}/updates?current_version=…`   | 判断本地版本的更新状态           |

课程编号目前为 `calculus`、`c-language`。版本清单包含包大小、SHA-256、包内每个原文件的路径、类型、大小及校验值。`download_url` 为相对于本服务根地址的路径，固定指向清单对应的版本；客户端应使用这个地址，避免查询清单与下载时读取到不同版本。

更新状态：

| `status`           | 含义                             | `update_available` |
| ------------------ | -------------------------------- | ------------------ |
| `not_installed`    | 未提供本地版本，可首次下载       | true               |
| `up_to_date`       | 本地版本与最新版本相同           | false              |
| `update_available` | 本地版本是已知历史版本，可更新   | true               |
| `unknown_version`  | 服务不认识本地版本，无法判断先后 | false              |

未知版本仍返回最新清单，但不能自动认定本地内容更旧并覆盖。未找到课程或版本返回 404，参数格式不正确返回 422；发布数据损坏或丢失返回 503，不返回损坏文件。

目录、版本清单和下载支持 `ETag` / `If-None-Match`，未变化时返回 304。目录和 `latest` 入口要求重新验证缓存；固定哈希版本可以长期缓存。ZIP 下载支持 `HEAD`、字节范围请求和 `If-Range`，可以对同一固定版本续传。

客户端接入时，应先下载到临时位置，校验包大小和 SHA-256，再校验并导入原文件，完整保存成功后才切换本地使用版本。下载失败保留已有内容；网页已实现这些步骤，个人记录与下载内容分别保存。

## 配置与部署

| 环境变量                 | 默认值                                  | 用途                                 |
| ------------------------ | --------------------------------------- | ------------------------------------ |
| `SOLVEMATE_DATA_DIR`     | 仓库的 `data/`                          | 发布工具读取的源内容                 |
| `SOLVEMATE_CONTENT_DIR`  | `apps/server/.content/`                 | API 与发布工具共用的发布目录         |
| `SOLVEMATE_CORS_ORIGINS` | localhost、127.0.0.1 的 5173、5174 端口 | 逗号分隔的网页来源；空值关闭跨域许可 |

正式部署或从 wheel 安装时显式设置上述目录。发布包不嵌入 Python wheel，部署时要保留整个发布目录与历史版本。API 进程只需读取发布目录；发布命令由维护者在服务端运行，不暴露公开上传或发布接口。API 允许公开读取官方内容，不需要登录。

## 检查

在 `apps/server` 目录、已激活虚拟环境的情况下执行：

```bash
ruff check .
ruff format --check .
python -m pytest
python -m pip check
python -m build --wheel --no-isolation
```

测试使用示例内容的独立副本，覆盖内容完整性、版本更新与重启恢复、旧包下载、缓存、断点续传、CORS、无效路径、包损坏及发布失败。日志使用英文，不输出个人会话或 AI 凭据。

接口约定位于仓库的 `packages/contracts/content-api.openapi.json`，由 `create_app().openapi()` 生成；Pydantic 模型与路由是源定义，修改接口后应重新导出。

## 开源与分发

服务采用 [MIT](LICENSE)，wheel 包含许可证原文。仓库整体声明见 [NOTICE](../../NOTICE.md)，Python 依赖继续遵循各自许可证。构建后的 wheel 不包含课程资产和发布目录，部署时另外提供；不要将 `.venv/`、`.content/`、`build/` 或 `dist/` 提交到仓库。
