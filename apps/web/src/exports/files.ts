export type ExportExtension = "json" | "pdf";
export interface ExportReceipt {
  filename: string;
  directory: string;
}
export type DirectoryPicker = (options: {
  id: string;
  startIn: "downloads";
  mode: "readwrite";
}) => Promise<FileSystemDirectoryHandle>;

/** 使用用户本地日期，避免午夜前后被 UTC 日期提前或延后一天。 */
export function exportFilename(
  name: string,
  extension: ExportExtension,
  date = new Date(),
) {
  const safe =
    Array.from(name.replace(/[<>:"/\\|?*]/g, "_").replace(/[. ]+$/, ""))
      .map((character) => (character.charCodeAt(0) < 32 ? "_" : character))
      .slice(0, 60)
      .join("") || "未命名";
  const day = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  return `${safe}_${day}.${extension}`;
}
export function filenameError(filename: string) {
  if (
    !filename.trim() ||
    /[<>:"/\\|?*]/.test(filename) ||
    [...filename].some((c) => c.charCodeAt(0) < 32) ||
    /[. ]$/.test(filename) ||
    /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(filename) ||
    new TextEncoder().encode(filename).length > 240
  )
    return "请使用不含路径或特殊符号的文件名，名称过长时请缩短。";
  return "";
}
async function responseJson(response: Response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      typeof result.detail === "string"
        ? result.detail
        : "文件未能保存，请重试。",
    );
  return result;
}
export async function defaultExportDirectory(
  signal: AbortSignal,
): Promise<string> {
  const result = await responseJson(
    await fetch("/local-api/v1/user/exports/directory", {
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      headers: { "X-SolveMate-Client": "web" },
    }),
  );
  if (typeof result.directory !== "string" || !result.directory)
    throw new Error("无法读取下载目录，请选择保存位置。");
  return result.directory;
}
export function numberedFilename(filename: string, number: number) {
  const point = filename.lastIndexOf(".");
  return number
    ? `${filename.slice(0, point)} (${number})${filename.slice(point)}`
    : filename;
}
export async function saveToDirectory(
  directory: FileSystemDirectoryHandle,
  filename: string,
  blob: Blob,
  signal: AbortSignal,
): Promise<ExportReceipt> {
  for (let number = 0; number < 1000; number++) {
    signal.throwIfAborted();
    const name = numberedFilename(filename, number);
    try {
      await directory.getFileHandle(name);
      continue;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError"))
        throw error;
    }
    const file = await directory.getFileHandle(name, { create: true });
    let output: FileSystemWritableFileStream | undefined;
    try {
      output = await file.createWritable();
      await output.write(blob);
      signal.throwIfAborted();
      await output.close();
      return { filename: name, directory: directory.name };
    } catch (error) {
      await output?.abort().catch(() => undefined);
      // 只清理本次创建的未完成文件，不触碰已有同名文件。
      await directory.removeEntry(name).catch(() => undefined);
      throw error;
    }
  }
  throw new Error("同名文件过多，请修改文件名后重试。");
}
export async function saveExport(
  blob: Blob,
  filename: string,
  directory: FileSystemDirectoryHandle | null,
  signal: AbortSignal,
): Promise<ExportReceipt> {
  const invalid = filenameError(filename);
  if (invalid) throw new Error(invalid);
  if (directory) return saveToDirectory(directory, filename, blob, signal);
  let response: Response;
  try {
    response = await fetch(
      `/local-api/v1/user/exports/save?filename=${encodeURIComponent(filename)}`,
      {
        method: "POST",
        headers: { "Content-Type": blob.type, "X-SolveMate-Client": "web" },
        body: blob,
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      },
    );
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error(
      "保存结果未能确认，请检查下载目录和本机服务后重试，或选择其他保存位置。",
      { cause: error },
    );
  }
  const result = await responseJson(response);
  if (
    typeof result.filename !== "string" ||
    typeof result.directory !== "string"
  )
    throw new Error("保存结果未能确认，请检查下载目录后再重试。");
  return result;
}
