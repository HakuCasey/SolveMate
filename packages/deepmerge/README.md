# deepmerge 构建依赖安全补丁

这是 deepmerge 4.3.1 的本地补丁副本，仅替代 PWA 构建中 `@rollup/plugin-node-resolve` 的依赖，不进入网页运行代码。

- 原始代码：npm `deepmerge@4.3.1` 的 `dist/cjs.js` 与 `index.d.ts`，保留 [MIT 版权和许可证](LICENSE)。
- 原项目：https://github.com/TehShrike/deepmerge
- 漏洞：https://github.com/advisories/GHSA-gcqx-w48m-w2h4
- 修复依据：https://github.com/TehShrike/deepmerge/issues/273

上游当前没有修复发行版。补丁同时在 target 和 source 的复制路径拒绝 `__proto__`、`constructor`、`prototype`，并用 `Object.defineProperty` 写入自有属性，防止 null 占位值或空原型对象绕过旧检查。除此之外保留原来的合并、数组和克隆行为。

根 `package.json` 使用 npm `overrides` 指向本目录；更名为 `@solvemate/deepmerge-patched`，以区分修改后的代码与上游原版，并非隐藏未修复依赖。`npm test` 会先执行漏洞复现及兼容性测试，再执行网页测试。

上游提供修复发行版后，重新验证并移除 override 与本副本。升级 Workbox 或 Rollup 插件时，也应检查是否还需要此补丁。此副本不提供 npm 发布。
