import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { desktopInstaller } from "../apps/desktop/src/installers.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "dist", "website");
const siteFiles = ["site.css", "downloads.json"];
const screenshots = ["overview", "conversations", "notes", "teaching"];
const files = [
  ...siteFiles.map((name) => [`docs/website/${name}`, name]),
  ...screenshots.map((name) => [
    `docs/product/manual/images/${name}.jpg`,
    `assets/${name}.jpg`,
  ]),
  [
    "apps/web/src/assets/solvemate-wordmark.png",
    "assets/solvemate-wordmark.png",
  ],
  ["apps/web/public/icon-192.png", "assets/icon-192.png"],
  ...[
    "lize-ink.jpg",
    "lize-hexagram-header.png",
    "architecture.svg",
    "architecture-mobile.svg",
  ].map((name) => [`docs/website/assets/${name}`, `assets/${name}`]),
];

const versions = JSON.parse(
  await readFile(join(root, "docs/website/downloads.json"), "utf8"),
);
const downloadButtons = [
  ["darwin-arm64", "primary", "macOS"],
  ["win32-x64", "secondary", "Windows"],
].map(([target, style, platform]) => {
  const className = `button button-${style}`;
  if (!Object.hasOwn(versions, target)) {
    return `<button class="${className}" type="button" disabled>${platform} 版暂未发布</button>`;
  }
  const { url } = desktopInstaller(target, versions[target]);
  return `<a class="${className}" href="${url}">下载 ${platform} 版</a>`;
});
const template = await readFile(join(root, "docs/website/index.html"), "utf8");
const index = template.replace(
  "{{download-buttons}}",
  downloadButtons.join("\n              "),
);

// 官网按钮和桌面应用共用已发布版本清单。
await rm(output, { recursive: true, force: true });
for (const [source, target] of files) {
  const destination = join(output, target);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(root, source), destination);
}
await writeFile(join(output, "index.html"), index);
console.log(`Website ready: ${output}`);
