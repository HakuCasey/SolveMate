# 参与开发

欢迎提交问题、文档修正和代码改动。报告问题时，请说明复现步骤、浏览器或 Python 环境、实际结果和预期结果；避免提交个人学习记录、API 密钥或其他凭据。

## 运行与检查

网页安装与启动见 [README](README.md#本地启动与访问)，Python 服务见 [后端说明](apps/server/README.md)。前端使用 Node.js 24、npm 11 验证，后端支持 Python 3.12 及以上，当前验证环境为 Python 3.14。

修改网页代码后，在仓库根目录执行：

```bash
npm ci
npm run check
npm run format:check
npm test
npm run build
```

后端修改后，在 `apps/server` 的虚拟环境中执行：

```bash
ruff check .
ruff format --check .
python -m pytest
python -m pip check
python -m build --wheel --no-isolation
```

`npm test` 同时运行网页测试和 `packages/deepmerge/` 的安全补丁测试。依赖升级还应执行 `npm audit` 与 `npm audit --omit=dev`，根级 override 的原因及移除条件见[架构说明](docs/architecture/overview.md#依赖安全修复)。

改动接口后，从 `create_app().openapi()` 重新生成 `packages/contracts/content-api.openapi.json`，同步客户端校验与接口说明。修改内容资产时检查题号、章节锚点和记忆来源引用，并运行发布测试。

## 提交改动

特性背景、需求和验收标准位于 `docs/features/编号-名称/spec.md`，必要的技术设计位于同目录 `design.md`。PR 说明应写清具体问题、改动后的行为和实际运行的验证。当前未实现的能力应保留为待办，不写成已交付。

不要提交 `node_modules/`、虚拟环境、`.env`、构建产物或 `.content/` 发布目录。代码日志使用英文，必要注释使用中文；沿用现有工具默认检查和代码写法。

新增或升级网页运行依赖后，执行 `npm run licenses:generate`，一并检查第三方声明。许可证脚本遇到缺失原文时会报错，应从对应上游核对后补充，不能直接给第三方代码套用项目许可证。

提交自己有权贡献的内容。贡献纳入本项目后按 [MIT](LICENSE) 分发；第三方内容应附上来源和适用许可。
