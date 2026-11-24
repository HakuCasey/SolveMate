# SolveMate 桌面应用

桌面应用复用 `apps/web/` 的界面和 `apps/local/` 的本机接口。Electron 负责窗口、单实例和本机服务生命周期；个人数据默认写入系统应用数据目录。

## 准备构建环境

先按仓库根 README 准备 Node.js、Python 环境和项目依赖，再安装桌面构建工具。本机构建要求 `apps/server/.venv` 中以可编辑方式安装 `apps/local`（根 README 的 Python 环境步骤已包含），否则 PyInstaller 会跳过 `solvemate_local` 的校验 schema 收集，打包出的本机服务启动时会因找不到 schema 而失败。

```bash
apps/server/.venv/bin/python -m pip install -r apps/desktop/requirements-build.lock
```

Windows PowerShell 使用：

```powershell
apps\server\.venv\Scripts\python.exe -m pip install -r apps\desktop\requirements-build.lock
```

## 构建

在仓库根目录执行：

```bash
npm run desktop:package
```

该命令生成当前操作系统的未压缩应用目录。生成安装包使用：

```bash
npm run desktop:make
```

macOS 和 Windows 必须分别在对应系统上构建。macOS 生成 DMG，Windows 生成 Setup.exe；输出位于 `apps/desktop/out/`。

Windows 的应用程序和窗口共用 `apps/desktop/assets/icon.ico`。替换图标时，应保留各尺寸图像的透明圆角。

构建时会重新生成桌面网页和 Python 本机服务。桌面网页不注册 PWA Service Worker。本机服务包含 Python 运行环境和运行依赖，安装后的用户无需安装 Node.js 或 Python。

## 当前限制

- 当前已生成 `apps/desktop/out/SolveMate-0.1.0-arm64.dmg`。内部包中的应用使用 ad hoc 临时签名。公开分发前需完成 Developer ID 签名和公证。
- macOS 和 Windows 的 CI 执行 `desktop:package`，检查未压缩应用的构建。Windows 安装程序须另用 `desktop:make` 生成，并在 Windows 上验收。
- 社区内容服务不装入客户端。可在“系统设置 → 社区内容”保存服务地址；未连接服务时仍可使用已保存的资料和工具。
- PPTX 转换仍需另装 LibreOffice；PDF 不需要。

具体范围和验证见 [020 特性规格](../../docs/features/020-desktop-application/spec.md)与[设计说明](../../docs/features/020-desktop-application/design.md)。
