import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "dist", "website");
const siteFiles = ["index.html", "site.css", "site.js"];
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
  ["docs/website/assets/ink-landscape.jpg", "assets/ink-landscape.jpg"],
];

// 仅把官网用到的静态文件放进发布产物。
await rm(output, { recursive: true, force: true });
for (const [source, target] of files) {
  const destination = join(output, target);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(root, source), destination);
}
console.log(`Website ready: ${output}`);
