import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeMathDelimiters } from "../apps/web/src/reading/normalize-math.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const execute = promisify(execFile);
const chrome = process.env.SOLVEMATE_CHROME;
if (!chrome)
  throw new Error("Set SOLVEMATE_CHROME to a Chrome or Chromium executable.");
const python =
  process.env.SOLVEMATE_PYTHON ||
  join(
    root,
    "apps/server/.venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
const hash = (value) => createHash("sha256").update(value).digest("hex");
const catalog = JSON.parse(
  await readFile(join(root, "data/catalog.json"), "utf8"),
);
const katex = pathToFileURL(
  join(root, "node_modules/katex/dist/katex.min.css"),
).href;
const temporary = await mkdtemp(join(tmpdir(), "solvemate-textbooks-"));
try {
  for (const course of catalog.courses) {
    const source = course.files.find((file) => file.kind === "textbook");
    const path = join(root, "data", course.id, source.path);
    const markdown = await readFile(path, "utf8");
    const headings = [
      ...markdown.matchAll(/^<a id="([^"]+)"><\/a>\s*\n##\s+([^\n]+)\n/gm),
    ];
    const chunks = [
      markdown.slice(0, headings[0].index),
      ...headings.map((heading, index) =>
        markdown.slice(
          heading.index + heading[0].indexOf("##"),
          headings[index + 1]?.index,
        ),
      ),
    ];
    const html = chunks
      .map(
        (chunk) =>
          `<section>${renderToStaticMarkup(
            createElement(ReactMarkdown, {
              skipHtml: true,
              remarkPlugins: [remarkGfm, remarkMath],
              rehypePlugins: [
                [
                  rehypeKatex,
                  { throwOnError: true, trust: false, strict: "ignore" },
                ],
              ],
              children: normalizeMathDelimiters(chunk),
            }),
          )}</section>`,
      )
      .join("");
    const input = join(temporary, `${course.id}.html`);
    const pdf = path.replace(/\.md$/, ".pdf");
    await writeFile(
      input,
      `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="${katex}"><style>
      @page { size: A4; margin: 19mm 18mm 20mm; }
      body { color: #222831; font: 12px/1.85 "PingFang SC", "Microsoft YaHei", sans-serif; }
      section + section { break-before: page; }
      h1 { font-size: 29px; margin: 35mm 0 12mm; }
      h2 { font-size: 23px; margin: 0 0 9mm; padding-bottom: 4mm; border-bottom: 1px solid #ddd; }
      h3 { font-size: 15px; margin: 7mm 0 3mm; break-after: avoid; }
      p { margin: 0 0 3.5mm; orphans: 3; widows: 3; }
      pre { font: 10.5px/1.65 "SFMono-Regular", Consolas, monospace; background: #f5f6f8; padding: 4mm; border: 1px solid #e5e7eb; border-radius: 5px; break-inside: avoid; white-space: pre-wrap; overflow-wrap: anywhere; }
      code { font-family: "SFMono-Regular", Consolas, monospace; }
      .katex-display { margin: 4mm 0; break-inside: avoid; font-size: .95em; }
      strong { font-weight: 600; }
    </style></head><body>${html}</body></html>`,
    );
    await execute(
      chrome,
      [
        "--headless",
        "--no-pdf-header-footer",
        "--allow-file-access-from-files",
        `--user-data-dir=${join(temporary, course.id)}`,
        `--print-to-pdf=${pdf}`,
        pathToFileURL(input).href,
      ],
      { timeout: 60000 },
    );
    const { stdout } = await execute(
      python,
      [join(root, "scripts/textbook-pages.py"), pdf],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    const pages = JSON.parse(stdout);
    const compact = (value) => value.normalize("NFKC").replace(/\s+/g, "");
    const chapterPages = headings.map((heading) => {
      const page = pages.findIndex((text) =>
        compact(text).includes(compact(heading[2])),
      );
      if (page < 0) throw new Error(`Chapter not found in PDF: ${heading[2]}`);
      return page + 1;
    });
    await writeFile(
      path.replace(/\.md$/, ".pages.json"),
      JSON.stringify(
        {
          textbookId: source.id,
          sourceSha256: hash(markdown),
          pdfSha256: hash(await readFile(pdf)),
          pages,
          chapterPages,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`Exported ${course.id}: ${pages.length} pages.`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
