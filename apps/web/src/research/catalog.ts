import { assertMetadata, type TeachingTool } from "@solvemate/contracts";
import {
  ContentError,
  digest,
  items,
  record,
  text,
} from "../content/contracts";

export interface RemoteTool {
  id: string;
  title: string;
  description: string;
  latest_version: string;
  updatedAt: number;
}
export function parseTools(value: unknown): RemoteTool[] {
  const result = items(record(value).tools).map((value) => {
    const row = record(value),
      id = text(row.id);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))
      throw new ContentError("工具编号无效。");
    return {
      id,
      title: text(row.title),
      description: text(row.description),
      latest_version: digest(row.latest_version),
      updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : 0,
    };
  });
  if (new Set(result.map((t) => t.id)).size !== result.length)
    throw new ContentError("工具目录包含重复编号。");
  return result;
}
export async function decodeTool(
  bytes: Uint8Array,
  entry: RemoteTool,
): Promise<TeachingTool> {
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  if (hash !== entry.latest_version)
    throw new ContentError("工具校验失败，原有版本未被替换。");
  const value = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  const tool = { ...value, version: hash };
  assertMetadata("TeachingTool", tool);
  if (
    tool.id !== entry.id ||
    tool.source !== "official" ||
    tool.title !== entry.title
  )
    throw new ContentError("工具内容与目录不一致，原有版本未被替换。");
  return tool;
}
