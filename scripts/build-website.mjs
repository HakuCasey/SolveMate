import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadStatisticsEndpoint } from "../apps/desktop/src/download-statistics.mjs";
import { desktopInstaller } from "../apps/desktop/src/installers.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "dist", "website");
const configuredEndpoint = process.env.SOLVEMATE_DOWNLOAD_STATS_URL;
const statisticsUrl = downloadStatisticsEndpoint(configuredEndpoint);
if (configuredEndpoint && !statisticsUrl) {
  throw new Error("SOLVEMATE_DOWNLOAD_STATS_URL must be an HTTPS endpoint.");
}
const siteFiles = ["site.css"];
const screenshots = ["overview", "conversations", "notes", "teaching"];
const files = [
  ...siteFiles.map((name) => [`docs/website/${name}`, name]),
  ...(statisticsUrl
    ? [
        ["docs/website/download-clicks.mjs", "download-clicks.mjs"],
        ["apps/desktop/src/download-statistics.mjs", "download-statistics.mjs"],
      ]
    : []),
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

const websiteVersions = JSON.parse(
  await readFile(join(root, "docs/website/website-downloads.json"), "utf8"),
);
const downloadButtons = [
  ["darwin-arm64", "primary", "macOS"],
  ["win32-x64", "secondary", "Windows"],
].map(([target, style, platform]) => {
  const className = `button button-${style}`;
  if (!Object.hasOwn(websiteVersions, target)) {
    return `<button class="${className}" type="button" disabled>${platform} 版暂未发布</button>`;
  }
  const { url, version } = desktopInstaller(target, websiteVersions[target]);
  const data = statisticsUrl
    ? ` data-download-target="${target}" data-download-version="${version}"`
    : "";
  return `<a class="${className}" href="${url}"${data}>下载 ${platform} 版</a>`;
});
const statisticsScript = statisticsUrl
  ? `<script type="module" src="./download-clicks.mjs" data-download-endpoint="${statisticsUrl.replaceAll("&", "&amp;")}"></script>`
  : "";
const template = await readFile(join(root, "docs/website/index.html"), "utf8");
const index = template
  .replace("{{download-buttons}}", downloadButtons.join("\n              "))
  .replace("{{download-statistics}}", () => statisticsScript);
const updates = JSON.parse(
  await readFile(join(root, "docs/website/downloads.json"), "utf8"),
);
if (statisticsUrl) updates.statisticsUrl = statisticsUrl;

await rm(output, { recursive: true, force: true });
for (const [source, target] of files) {
  const destination = join(output, target);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(root, source), destination);
}
await writeFile(join(output, "index.html"), index);
await writeFile(
  join(output, "downloads.json"),
  `${JSON.stringify(updates, null, 2)}\n`,
);
console.log(`Website ready: ${output}`);
