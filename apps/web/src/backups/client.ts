import { saveToDirectory, type ExportReceipt } from "../exports/files";

const root = "/local-api/v1/user/backups";
export interface BackupPreview {
  token: string;
  createdAt: string;
  files: number;
  bytes: number;
}
async function request(path: string, options: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(root + path, {
      ...options,
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(300000)])
        : AbortSignal.timeout(300000),
      headers: {
        "X-SolveMate-Client": "web",
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new TypeError("Local backup response could not be received.", {
      cause: error,
    });
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      typeof error.detail === "string"
        ? error.detail
        : "备份操作未完成，请检查本机服务后重试。",
    );
  }
  return response;
}
export async function exportBackup(
  filename: string,
  directory: FileSystemDirectoryHandle | null,
  signal: AbortSignal,
): Promise<ExportReceipt> {
  let token = "";
  try {
    const result = await (
      await request("/export", {
        method: "POST",
        signal,
        body: JSON.stringify({ filename, saveToDownloads: !directory }),
      })
    ).json();
    if (!directory) {
      if (
        typeof result.filename !== "string" ||
        typeof result.directory !== "string"
      )
        throw new Error("备份结果未能确认，请检查下载目录后重试。");
      return result as ExportReceipt;
    }
    token = result.token;
    const download = await request(`/${encodeURIComponent(token)}/download`, {
      signal,
    });
    if (!download.body) throw new Error("没有收到备份文件，请重试。");
    return await saveToDirectory(directory, filename, download.body, signal);
  } catch (error) {
    if (
      error instanceof TypeError ||
      (error instanceof DOMException &&
        ["TimeoutError", "AbortError"].includes(error.name) &&
        !signal.aborted)
    )
      throw new Error("备份结果未能确认，请检查下载目录和本机服务后重试。", {
        cause: error,
      });
    throw error;
  } finally {
    if (token) void discardBackup(token);
  }
}
export async function inspectBackup(
  file: File,
  signal: AbortSignal,
): Promise<BackupPreview> {
  try {
    const result = await (
      await request("/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
        signal,
      })
    ).json();
    if (
      typeof result.token !== "string" ||
      !Number.isFinite(Date.parse(result.createdAt)) ||
      !Number.isSafeInteger(result.files) ||
      !Number.isSafeInteger(result.bytes)
    )
      throw new Error("备份检查结果无效，请重新选择文件。");
    return result as BackupPreview;
  } catch (error) {
    if (
      (error instanceof TypeError || error instanceof SyntaxError) &&
      !signal.aborted
    )
      throw new Error("无法完成备份检查，请检查本机服务后重新选择文件。", {
        cause: error,
      });
    throw error;
  }
}
export async function restoreBackup(token: string) {
  try {
    const result = await (
      await request(`/${encodeURIComponent(token)}/restore`, {
        method: "POST",
        body: "{}",
      })
    ).json();
    if (result.status !== "restored" || typeof result.safetyBackup !== "string")
      throw new TypeError("Local restore receipt is invalid.");
    return result as { status: string; safetyBackup: string };
  } catch (error) {
    if (error instanceof TypeError || error instanceof SyntaxError)
      throw new Error(
        "恢复结果未能确认，请刷新数据查看。重新操作前请确认当前记录；恢复前的备份已保留。",
        { cause: error },
      );
    throw error;
  }
}
export async function discardBackup(token: string) {
  await request(`/${encodeURIComponent(token)}`, {
    method: "DELETE",
    body: "{}",
    signal: AbortSignal.timeout(10000),
  }).catch(() => undefined);
}
