import { useCallback, useEffect, useRef, useState } from "react";
import type { AppData, TeachingTool } from "@solvemate/contracts";
import { ContentApi } from "../content/api";
import { operations } from "../operations/store";
import { userCache } from "../storage/local-client";
import { logError } from "../logger";
import { parseTools, type RemoteTool } from "./catalog";
import {
  installTool,
  renameTool,
  removeTool,
  researchWorkspace,
  saveTool,
  selectTool,
} from "./state";
const api = new ContentApi();
/** 页面只读共享工具目录；下载完整校验后一次提交，失败不替换已有工具。 */
export function useTeachingTools(
  data: AppData | null,
  commit: (change: (data: AppData) => AppData) => Promise<AppData>,
) {
  const [remote, setRemote] = useState<RemoteTool[]>([]),
    [checking, setChecking] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState<string | null>(null);
  const generation = useRef(0);
  const lock = useRef(false);
  useEffect(() => {
    let alive = true;
    const initial = generation.current;
    void userCache
      .get("official-tools-catalog")
      .then((value) => {
        if (alive && value && initial === generation.current)
          setRemote(parseTools(value));
      })
      .catch((e) => logError("Failed to read cached tool catalog.", e));
    return () => {
      alive = false;
    };
  }, []);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setChecking(true);
    setError("");
    try {
      const tools = await api.tools();
      if (request !== generation.current) return;
      setRemote(tools);
      void userCache
        .put("official-tools-catalog", { tools })
        .catch((e) => logError("Failed to cache tool catalog.", e));
    } catch (e) {
      if (request === generation.current)
        setError(e instanceof Error ? e.message : "工具目录读取失败，请重试。");
    } finally {
      if (request === generation.current) setChecking(false);
    }
  }, []);
  const run = async <T>(
    id: string,
    label: string,
    action: () => Promise<T>,
  ) => {
    if (lock.current) throw new Error("正在处理工具，请稍后再试。");
    lock.current = true;
    setBusy(id);
    setError("");
    try {
      return await operations.run(
        {
          key: `teaching-tool:${id}`,
          label,
          targetId: id,
          guidance: "请在教研室中重试。",
        },
        action,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "工具操作失败，请重试。");
      throw e;
    } finally {
      lock.current = false;
      setBusy(null);
    }
  };
  return {
    items: data ? researchWorkspace(data).tools : [],
    remote,
    checking,
    error,
    busy,
    refresh,
    save: (tool: TeachingTool) =>
      run(tool.id, "保存教研工具", () => commit((d) => saveTool(d, tool))),
    select: (id: string, expected?: TeachingTool) =>
      run(id, "选择教研工具", () => commit((d) => selectTool(d, id, expected))),
    rename: (id: string, title: string, expectedTitle: string) =>
      run(id, "重命名教研工具", () =>
        commit((d) => renameTool(d, id, title, expectedTitle)),
      ),
    remove: (id: string) =>
      run(id, "删除教研工具", () => commit((d) => removeTool(d, id))),
    download: (entry: RemoteTool) =>
      run(entry.id, "下载教研工具", async () => {
        const tool = await api.downloadTool(entry);
        return commit((d) => installTool(d, tool));
      }),
  };
}
export type TeachingTools = ReturnType<typeof useTeachingTools>;
