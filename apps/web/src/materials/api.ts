import { uploadRequest } from "./upload-request";
import Dexie, { type Table } from "dexie";
import {
  assertMetadata,
  type Material,
  type MaterialLocation,
} from "@solvemate/contracts";
import { DataRequestError } from "../refresh/errors";
import { dataRefresh } from "../refresh/coordinator";

class MaterialCache extends Dexie {
  materials!: Table<Material, string>;
  files!: Table<{ key: string; blob: Blob }, string>;
  pages!: Table<{ key: string; text: string }, string>;
  constructor() {
    super("solvemate-materials");
    this.version(1).stores({ materials: "id", files: "key", pages: "key" });
  }
}
const cache = new MaterialCache();
export const locationKey = (location: MaterialLocation) =>
  `${location.materialId}/${location.contentVersion}/${location.pageNumber}`;
const prefix = "/local-api/v1/materials";
let cacheGeneration = 0;

async function request(path = "", options: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(prefix + path, {
      ...options,
      headers: { "X-SolveMate-Client": "web", ...options.headers },
      cache: "no-store",
      signal: options.signal ?? AbortSignal.timeout(120000),
    });
  } catch {
    throw new DataRequestError(
      "无法连接本机资料服务，请使用 npm start 启动 SolveMate 后重试。",
      "unavailable",
    );
  }
  return checkedResponse(response);
}
async function checkedResponse(response: Response) {
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as {
      detail?: unknown;
      code?: string;
    };
    const failure = new DataRequestError(
      typeof error.detail === "string"
        ? error.detail
        : "资料请求失败，请重试。",
      error.code ?? `http_${response.status}`,
      response.status,
    );
    dataRefresh.recover(failure, ["records", "materials"]);
    throw failure;
  }
  return response;
}
function material(value: unknown): Material {
  assertMetadata("Material", value);
  return value as Material;
}
export const materialApi = {
  cached: () => cache.materials.toArray(),
  async remember(record: Material) {
    cacheGeneration++;
    try {
      await cache.transaction("rw", cache.materials, async () => {
        const previous = await cache.materials.get(record.id);
        if (!previous || previous.revision <= record.revision)
          await cache.materials.put(record);
      });
      return "";
    } catch {
      return "资料已保存，但浏览器未能缓存本次修改。";
    }
  },
  async list() {
    const generation = ++cacheGeneration;
    const response = await request();
    const values: unknown = await response.json();
    if (!Array.isArray(values))
      throw new Error("资料列表格式无效，请重新读取。");
    let items = values.map(material);
    // 本机记录是原件保存结果，浏览器缓存失败不能把原件标为保存失败。
    const unreadable = Number(
      response.headers.get("X-SolveMate-Material-Errors") || 0,
    );
    let warning =
      unreadable > 0
        ? `有 ${unreadable} 份资料记录无法读取，原文件仍保留。请检查本机服务日志。`
        : "";
    if (unreadable > 0) {
      const previous = await cache.materials.toArray().catch(() => []);
      items = [
        ...items,
        ...previous
          .filter((old) => !items.some((item) => item.id === old.id))
          .map((old) => ({
            ...old,
            availability: {
              originalAvailable: false,
              readerAvailable: false,
              error: "资料记录暂时无法读取，请恢复文件后刷新。",
            },
          })),
      ];
    }
    dataRefresh.reportIssue(
      "materials",
      warning ||
        items
          .map((item) => item.availability?.error)
          .filter(Boolean)
          .slice(0, 1)
          .join(""),
    );
    try {
      await cache.transaction("rw", cache.materials, async () => {
        // 修改完成后，较早发出的列表请求不能覆盖已缓存的新名称或删除标记。
        if (generation !== cacheGeneration) return;
        await cache.materials.clear();
        await cache.materials.bulkPut(items);
      });
    } catch {
      warning = "资料已保存在本机，但浏览器未能缓存资料列表。";
    }
    return { items, warning };
  },
  async import(
    file: File,
    courseId: string,
    onProgress?: (loaded: number, total: number) => void,
  ) {
    if (file.size > 100 * 1024 * 1024)
      throw new Error("文件超过 100 MiB，请拆分或压缩后重新导入。");
    const query = new URLSearchParams({
      filename: file.name,
      ...(courseId ? { courseId } : {}),
    });
    return material(
      await (
        await (onProgress
          ? uploadRequest(`${prefix}?${query}`, file, onProgress).then(
              checkedResponse,
            )
          : request(`?${query}`, {
              method: "POST",
              headers: { "Content-Type": "application/octet-stream" },
              body: file,
            }))
      ).json(),
    );
  },
  async assignCourse(item: Material, courseId: string | null) {
    return material(
      await (
        await request(`/${encodeURIComponent(item.id)}/course`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ courseId, expectedRevision: item.revision }),
        })
      ).json(),
    );
  },
  async rename(item: Material, title: string) {
    return material(
      await (
        await request(`/${encodeURIComponent(item.id)}/title`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, expectedRevision: item.revision }),
        })
      ).json(),
    );
  },
  async remove(item: Material) {
    return material(
      await (
        await request(`/${encodeURIComponent(item.id)}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedRevision: item.revision }),
        })
      ).json(),
    );
  },
  async retry(id: string) {
    return material(
      await (
        await request(`/${encodeURIComponent(id)}/retry`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).json(),
    );
  },
  async reader(
    location: Pick<MaterialLocation, "materialId" | "contentVersion">,
    force = false,
  ): Promise<{ blob: Blob; warning: string }> {
    const key = `${location.materialId}/${location.contentVersion}`;
    const saved = await cache.files.get(key).catch(() => undefined);
    if (saved && !force && (await saved.blob.slice(0, 5).text()) === "%PDF-")
      return { blob: saved.blob, warning: "" };
    const blob = await (await request(`/${key}/reader`)).blob();
    if ((await blob.slice(0, 5).text()) !== "%PDF-")
      throw new Error("本机服务返回的阅读文件不是有效 PDF，请重试读取。");
    let warning = "";
    try {
      await cache.files.put({ key, blob });
    } catch {
      warning =
        "原件已保存在本机，浏览器未能缓存阅读文件；本机服务停止时可能无法重新打开。";
    }
    return { blob, warning };
  },
  async page(location: MaterialLocation) {
    const key = locationKey(location);
    try {
      const value = (await (
        await request(
          `/${location.materialId}/${location.contentVersion}/pages/${location.pageNumber}`,
          { signal: AbortSignal.timeout(15000) },
        )
      ).json()) as Record<string, unknown>;
      if (
        value.materialId !== location.materialId ||
        value.contentVersion !== location.contentVersion ||
        value.pageNumber !== location.pageNumber ||
        typeof value.text !== "string"
      )
        throw new Error("本页文字与资料位置不一致。");
      const text = value.text;
      await cache.pages.put({ key, text }).catch(() => undefined);
      return text;
    } catch (error) {
      if (
        !(error instanceof DataRequestError) ||
        (error.code !== "unavailable" && error.status < 500)
      )
        throw error;
      const saved = await cache.pages.get(key).catch(() => undefined);
      if (saved) return saved.text;
      throw error;
    }
  },
};
