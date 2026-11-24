# SolveMate 开发指导

本文整理从下载代码到本地运行、再到 Windows 桌面打包的完整流程，并记录需要留意的约定。模块与架构见[系统架构](architecture/overview.md)，贡献约定见[贡献说明](../CONTRIBUTING.md)。

## 1. 下载代码后的环境准备

拿到新代码后，在仓库根目录安装 Node 依赖：

```bash
npm ci
```

再准备 Python 虚拟环境。macOS / Linux：

```bash
cd apps/server
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.lock
python -m pip install -r ../local/requirements.lock
python -m pip install --no-deps --no-build-isolation -e .
python -m pip install --no-deps --no-build-isolation -e ../local
cd ../..
```

Windows PowerShell（从仓库根目录执行）：

```powershell
cd apps/server
py -3 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.lock
.venv\Scripts\python.exe -m pip install -r ..\local\requirements.lock
.venv\Scripts\python.exe -m pip install --no-deps --no-build-isolation -e .
.venv\Scripts\python.exe -m pip install --no-deps --no-build-isolation -e ..\local
cd ..\..
```

> **`-e ../local` 必须安装。** 桌面打包时 PyInstaller 用 `--collect-data solvemate_local` 收集校验用 JSON Schema；`solvemate_local` 没安装成包时会被跳过收集，打包出的本机服务启动时会因找不到 `schemas/*.json` 而失败。

## 2. 本地运行与开发

- 一条命令构建网页、发布内容，并同时启动网页、内容服务和本机 AI 服务：

  ```bash
  npm start
  ```

  看到 `SolveMate is ready` 后打开 <http://127.0.0.1:4173/>；按一次 `Ctrl+C` 统一停止三个服务。

- 同时调试多个实例时，每个终端使用不同的网页端口，例如 `npm start -- --port 4174 --isolated`。隔离实例的后端默认由系统分配空闲端口，也可以通过 `--content-port` 和 `--local-port` 分别指定。网页通过同源代理访问本实例的后端。调试记录和社区发布内容位于 `.debug-instances/<网页端口>/`，网页单独构建到 `apps/web/.debug-builds/<网页端口>/dist/`。使用相同端口重启隔离实例会继续使用此前的数据。仅更换端口而未加 `--isolated` 时，沿用原来的数据和构建目录。

- 前端热更新开发：

  ```bash
  npm run dev
  ```

  按终端显示的地址访问，改代码即时生效。开发时同时启动[本机服务](../apps/local/README.md#启动)以读取和保存个人记录；联调社区课程下载时再启动内容服务。

- 提交前执行：

  ```bash
  npm run check
  npm run format:check
  npm test
  npm run build
  ```

  Python 检查见[内容服务说明](../apps/server/README.md#检查)和[本机 AI 服务说明](../apps/local/README.md#检查)。

## 3. Windows 桌面打包

macOS 与 Windows 必须分别在对应系统上构建，不能交叉生成另一系统的 Python 程序。

1. 先完成第 1 节的环境准备，再安装桌面构建工具（PyInstaller）：

   ```powershell
   apps\server\.venv\Scripts\python.exe -m pip install -r apps\desktop\requirements-build.lock
   ```

2. 生成未压缩应用目录（验证打包链路，CI 也执行此步）：

   ```bash
   npm run desktop:package
   ```

   产物位于 `apps/desktop/out/win-unpacked/`（Windows）或对应系统的目录。

3. 生成安装包：

   ```bash
   npm run desktop:make
   ```

   Windows 生成 `apps/desktop/out/SolveMate-<版本>-<架构>-Setup.exe`（NSIS，可选安装目录）；macOS 生成 DMG。

4. 运行时注意：PPTX 导入需另装 LibreOffice，PDF 不需要；当前安装包未签名（Windows 可能触发 SmartScreen 提示），公开分发前需完成代码签名与公证。详见[桌面应用说明](../apps/desktop/README.md)。

## 4. 约定与已知事项

- **KaTeX override 与许可证检查**：根 `package.json` 的 `overrides` 为修复 KaTeX 安全公告把 `katex` 抬到 `^0.19.1`，超出 `rehype-katex`、`micromark-extension-math` 声明的 `^0.16.0`，`npm ls` 会将其标为 `invalid` 并非零退出。`scripts/generate-license-notices.mjs` 已改为容忍这种非零退出（只要仍能列出包路径），因此 `npm run build` 与 `npm start` 不再因此失败；上游发布声明 `^0.19` 的版本后，可移除 override 并相应简化该脚本。
- **本机数据目录**：源码版默认使用仓库根 `user/`，桌面版使用系统应用数据目录；两者均可在「系统设置 → 备份与恢复 → 用户数据」中查看或更改路径，并通过完整 ZIP 备份转移。
