# 009 主题配色设计

## 文件职责

网页主题代码位于 `apps/web/src/theme/`：

- `definition.ts` 定义主题格式、颜色名称与 CSS 变量的对应关系；明暗模式类型直接引用共享的 `Settings.appearance`。
- `default.ts` 保存默认主题的完整日间与夜间颜色，提供其他色调缺省时的颜色。
- `presets.ts` 集中维护水晶、晴空、谷雨和灰度的编号、名称与两组颜色，缺少或未知编号回退水晶。
- `theme.ts` 校验、补齐颜色并应用到页面根节点；不读取业务记录或更改浏览器数据库。
- `base.css` 保存共用阴影样式、原始图片及 PDF 所需的固定白底和原生控件的明暗声明。

明暗开关的滑块位置由已保存的 `settings.appearance` 决定，通过 CSS 位移过渡；四叶草按钮继续按 `themeId` 判断选中，预览颜色来自相同模式的内置主题。两组按钮保留文字、键盘焦点及 `aria-pressed`，减少动态效果的系统偏好会关闭过渡动画，不另存界面选择状态。

组件继续使用现有 CSS Modules。位置、尺寸与行为由组件决定，颜色通过公共变量读取。现有 `--sm-paper`、`--sm-ground` 等名称继续有效，不逐个改写所有公共变量。

## 主题格式

`ThemeDefinition` 包含以下字段：

| 字段 | 含义 |
| --- | --- |
| `schemaVersion` | 配置格式版本，当前为 `1` |
| `id` | 稳定编号，1–100 个字符，以小写字母或数字开头，其余可用小写字母、数字、连字符、下划线 |
| `name` | 显示名称，去除首尾空白后非空，原值不超过 100 个字符 |
| `colors.light` | 日间配色，可只提供部分颜色 |
| `colors.dark` | 夜间配色，可只提供部分颜色 |

例如，下面是一份可交给 `resolveTheme` 或 `applyTheme` 的配置。配置内容可用 JSON 表达；当前没有文件导入界面。

```json
{
  "schemaVersion": 1,
  "id": "forest",
  "name": "森林",
  "colors": {
    "light": {
      "accent": "#176b43",
      "accentBackground": "#e8f5ec"
    },
    "dark": {
      "accent": "#8ed9ac",
      "accentBackground": "#203b2c"
    }
  }
}
```

## 可配置颜色

| 用途 | 字段 |
| --- | --- |
| 面板与页面背景 | `surface`、`background` |
| 文字层次 | `text`、`mutedText`、`placeholder` |
| 边框 | `border` |
| 强调区域与按钮 | `accent`、`accentBackground`、`onAccent` |
| 错误、危险操作与成功提示 | `danger`、`dangerBackground`、`onDanger`、`success` |
| 学生消息与教师消息 | `userMessageBackground`、`userMessageBorder`、`assistantMessageBackground` |
| 代码区域 | `codeBackground`、`codeText` |
| 阅读选段 | `selection` |
| 笔记纸页与装饰 | `notePaper`、`noteDot`、`noteMargin`、`noteHole`、`noteInset` |
| 阴影与遮罩 | `shadow`、`shadowSoft`、`overlay` |

颜色支持 `#RGB`、`#RGBA`、`#RRGGBB` 和 `#RRGGBBAA`，不接受 CSS 选择器、规则、函数、变量引用或外部资源地址。带透明度的颜色用于选区、装饰、阴影和遮罩。悬停、选中等状态沿用组件对这些颜色的使用方式；主题不重新定义操作行为。

公共阴影只将颜色开放给主题，几何参数在 `base.css` 中统一定义。笔记纸纹仍使用随应用打包的原素材；主题调整纸页底色和装饰。学习热图由强调色与背景混合，无需复制五份独立配色。

## 默认值、校验与切换

`resolveTheme` 先复制所选明暗模式的默认颜色，再应用合法的覆盖项。两组配色同时校验；某项颜色缺失时正常继承，非法值和未知字段记录在 `issues`，不写入页面样式。未知字段不参与 CSS 变量生成。

元数据无效或格式版本不支持时，整份配置回退默认主题。某种模式的配色不是对象或缺失时，该模式使用默认值并返回校验说明。默认主题本身必须提供所有颜色，类型检查和测试共同核对。

`applyTheme` 使用补齐后的完整结果设置已声明的 CSS 变量、`data-theme`、`data-appearance`、`color-scheme` 和页面 `theme-color`。每次覆盖所有主题颜色，避免上一主题的值残留；其他用途的样式不受影响。校验失败使用现有日志工具记录英文错误，不打印原始配置。后续导入界面需要展示返回的校验结果，本次没有新增相关表单。

首屏在 React 渲染前应用系统当前明暗对应的默认主题；个人数据加载后，应用在 `settings.appearance` 或 `settings.themeId` 改变时应用对应配色。模式继续使用 `AppData.settings.appearance`；色调编号独立保存在可选的 `Settings.themeId`，与其他设置一起通过个人记录接口保存。共享 Schema 与本机校验同时接受这一字段；旧数据无需迁移，缺少或未知编号时使用水晶。水晶沿用原 `default` 编号，其他编号为 `sky`、`rain`、`grayscale`。切换明暗不会改写色调。

PWA 安装清单的颜色由 Vite 从默认主题读取。页面运行后的浏览器栏颜色取当前背景；原始图片和 PDF 内容继续使用原件颜色，不把文档本身反色。

## 参考依据

- [VS Code Color Theme](https://code.visualstudio.com/api/extension-guides/color-theme)：界面颜色使用有明确用途的字段，代码高亮另外定义。
- [Obsidian Build a theme](https://docs.obsidian.md/Themes/App%20themes/Build%20a%20theme)：公共 CSS 变量，以及同一主题中的日间与夜间配色。

本项目采用自己的颜色字段，与现有组件及阅读需求对应，不直接兼容上述产品的主题文件。当前没有主题市场、远程下载或任意 CSS 扩展。

## 验证记录

2026-11-12：183 项网页测试、12 项脚本测试、TypeScript、ESLint、Prettier 和生产构建通过。主题专项覆盖完整默认配色、局部覆盖与模式隔离、非法字段与颜色、不支持的格式、完整回退、切换后清除旧配色，以及组件颜色的集中定义。

在独立地址使用正式构建检查日间和夜间的题目、代码、聊天气泡、输入提示、笔记纸页和机器人配置；实际设置切换后颜色同步，刷新仍恢复保存的夜间模式。PDF 在两种界面模式下均保持原页白底与原始内容。浏览器栏颜色随当前背景变化；离线资源缓存完成。没有调用模型服务，没有进行主题文件导入或社区主题安装。

主题提交内容另经独立源码验证：从暂存内容导出源码，按锁文件安装依赖；144 项网页测试、11 项脚本测试、TypeScript、ESLint、Prettier 与生产构建通过。此项检查确认主题改动可独立使用，不依赖工作区内其他开发事项。

2026-11-12 内置色调扩展验证：262 项网页测试、19 项脚本测试、20 项本机数据专项测试通过；共享 Schema 同步、TypeScript、ESLint、Prettier、Ruff 和生产构建通过。覆盖四种色调的两组配色、灰度无彩色残留、未知编号回退、浏览器缓存恢复和本机记录保存重开。macOS Chrome 实测四种色调及明暗切换，刷新后恢复谷雨与夜间模式；使用独立测试数据，没有调用模型。
