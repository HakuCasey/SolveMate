import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
// 这些 npm 包未附许可证文件；只对已核对的版本使用上游原文副本。
const supplemental = {
  "rehype-katex@7.0.1": "remark-math",
  "remark-math@6.0.0": "remark-math",
  "react-remove-scroll-bar@2.3.8": "react-remove-scroll-bar",
};
// npm run 提供 CLI 路径；通过 Node 调用，避免 Windows 无法直接执行 npm.cmd。
const npmCli = process.env.npm_execpath;
if (!npmCli)
  throw new Error(
    "Run this script with npm run licenses:generate or npm run licenses:check.",
  );
const paths = execFileSync(
  process.execPath,
  [npmCli, "ls", "--omit=dev", "--all", "--parseable"],
  {
    cwd: root,
    encoding: "utf8",
  },
)
  .trim()
  .split(/\r?\n/);
const notices = new Map();
// 字体单独使用 OFL；从原字体的 name 表读取版权与保留名称，不套用代码的 MIT。
function fontLicense(path) {
  const bytes = readFileSync(path);
  for (let i = 0; i < bytes.readUInt16BE(4); i++) {
    const record = 12 + i * 16;
    if (bytes.toString("ascii", record, record + 4) !== "name") continue;
    const offset = bytes.readUInt32BE(record + 8);
    const start = offset + bytes.readUInt16BE(offset + 4);
    for (let j = 0; j < bytes.readUInt16BE(offset + 2); j++) {
      const name = offset + 6 + j * 12;
      if (bytes.readUInt16BE(name + 6) !== 13) continue;
      const platform = bytes.readUInt16BE(name);
      const length = bytes.readUInt16BE(name + 8);
      const position = start + bytes.readUInt16BE(name + 10);
      const text = new TextDecoder(
        platform === 0 || platform === 3 ? "utf-16be" : "latin1",
      ).decode(bytes.subarray(position, position + length));
      if (!text.includes("SIL Open Font License, Version 1.1"))
        throw new Error(`Unrecognized font license: ${path}`);
      return text;
    }
  }
  throw new Error(`Missing font license: ${path}`);
}
for (const path of paths) {
  const pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
  if (pkg.name === "solvemate" || pkg.name.startsWith("@solvemate/")) continue;
  const key = `${pkg.name}@${pkg.version}`;
  const files = readdirSync(path)
    .filter((file) => /^(licen[cs]e|copying|notice)(\.|$|-)/i.test(file))
    .sort();
  let body = files
    .map((file) => `${file}\n${readFileSync(join(path, file), "utf8").trim()}`)
    .join("\n\n");
  if (!body && supplemental[key]) {
    body = readFileSync(
      join(root, "scripts/licenses", `${supplemental[key]}.txt`),
      "utf8",
    ).trim();
  }
  if (!body) throw new Error(`Missing license text for ${key}`);
  if (pkg.name === "katex") {
    const fonts = join(path, "dist/fonts");
    const records = readdirSync(fonts)
      .filter((file) => file.endsWith(".ttf"))
      .sort()
      .map((file) => `${file}\n${fontLicense(join(fonts, file))}`)
      .join("\n\n");
    if (!records) throw new Error("Missing KaTeX fonts");
    body +=
      "\n\nFont copyright and reserved names (also apply to corresponding WOFF/WOFF2 files):\n\n" +
      records +
      "\n\n" +
      readFileSync(join(root, "scripts/licenses/OFL-1.1.txt"), "utf8").trim();
  }
  // 统一上游文件的换行符，保留许可证正文与版权信息。
  notices.set(
    key,
    `${key}\nDeclared license: ${pkg.license}\n\n${body.replace(/\r\n?/g, "\n")}`,
  );
}
const text =
  "SolveMate third-party licenses\n\nGenerated from installed production dependencies.\nDependencies retain their respective copyrights and licenses.\n\n" +
  [...notices.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([, value]) => value)
    .join("\n\n" + "=".repeat(72) + "\n\n") +
  "\n";
const outputs = new Map([
  ["apps/web/public/third-party-licenses.txt", text],
  ["apps/web/public/LICENSE.txt", readFileSync(join(root, "LICENSE"), "utf8")],
  ["apps/server/LICENSE", readFileSync(join(root, "LICENSE"), "utf8")],
]);
for (const [file, content] of outputs) {
  const path = join(root, file);
  if (check) {
    if (readFileSync(path, "utf8") !== content)
      throw new Error(
        `Outdated ${relative(root, path)}; run npm run licenses:generate`,
      );
  } else writeFileSync(path, content);
}
console.log(
  `License notices ${check ? "verified" : "generated"} for ${notices.size} dependencies.`,
);
