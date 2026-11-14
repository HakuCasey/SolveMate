import { renderToStaticMarkup } from "react-dom/server";
import type { Note, Notebook, NoteOrigin } from "@solvemate/contracts";
import katexCss from "katex/dist/katex.min.css?inline";
import { DataRequestError } from "../refresh/errors";
import { dataRefresh } from "../refresh/coordinator";
import { NotebookDocument, notebookPrintCss } from "./NotebookDocument";

let embeddedFonts: Promise<string> | null = null;
function fontStyles(base: string) {
  if (!embeddedFonts)
    embeddedFonts = (async () => {
      // 每种字体仅保留 WOFF2，避免重复嵌入 WOFF、TTF；资源随应用离线提供。
      let css = katexCss.replace(/src:([^;}]+);/g, (all, src: string) => {
        const first = src.match(/url\([^)]+\)\s*format\(["']woff2["']\)/);
        return first ? `src:${first[0]};` : all;
      });
      const urls = [
        ...new Set(
          [...css.matchAll(/url\(["']?([^)'"\s]+)["']?\)/g)].map(
            (item) => item[1],
          ),
        ),
      ];
      for (const resource of urls) {
        if (resource.startsWith("data:")) continue;
        const url = new URL(resource, base);
        if (url.origin !== new URL(base).origin)
          throw new Error("导出字体地址无效，请更新应用后重试。");
        const response = await fetch(url, {
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok)
          throw new Error("导出所需字体未能读取，请更新应用后重试。");
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 32768)
          binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        css = css.replaceAll(
          resource,
          `data:font/woff2;base64,${btoa(binary)}`,
        );
      }
      return css;
    })().catch((error) => {
      embeddedFonts = null;
      throw error;
    });
  return embeddedFonts;
}
export async function notebookHtml(
  notebook: Notebook,
  notes: Note[],
  tags: Record<string, string>,
  base = window.location.href,
  originLabel?: (origin: NoteOrigin) => string,
) {
  return `<style>${await fontStyles(base)}\n${notebookPrintCss}</style>${renderToStaticMarkup(<NotebookDocument notebook={notebook} notes={notes} tags={tags} originLabel={originLabel} />)}`;
}

export async function exportNotebook(
  notebook: Notebook,
  notes: Note[],
  tags: Record<string, string>,
  signal?: AbortSignal,
  originLabel?: (origin: NoteOrigin) => string,
) {
  const html = await notebookHtml(
    notebook,
    notes,
    tags,
    window.location.href,
    originLabel,
  );
  let response: Response;
  try {
    response = await fetch("/local-api/v1/user/exports/notebook.pdf", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SolveMate-Client": "web",
      },
      body: JSON.stringify({
        notebookId: notebook.id,
        revision: notebook.revision,
        notes: Object.fromEntries(
          notes.map((note) => [note.id, note.revision]),
        ),
        html,
      }),
      signal: AbortSignal.any([
        signal ?? new AbortController().signal,
        AbortSignal.timeout(65000),
      ]),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("无法完成 PDF 导出，请确认本机服务正在运行后重试。", {
      cause: error,
    });
  }
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    const error = new DataRequestError(
      typeof failure.detail === "string"
        ? failure.detail
        : "PDF 未能生成，请重试。",
      failure.code ?? "pdf_export_failed",
      response.status,
    );
    if (failure.code === "revision_conflict")
      dataRefresh.recover(error, ["records"]);
    throw error;
  }
  if (!response.headers.get("content-type")?.includes("application/pdf"))
    throw new Error("服务没有返回 PDF，请重试。");
  return response.blob();
}
