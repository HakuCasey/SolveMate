import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ContentApi } from "./api";
import {
  ContentError,
  type RemoteCourse,
  type UpdateResponse,
} from "./contracts";
import {
  makeSnapshot,
  storedVersion,
  type ContentSnapshot,
  type InstalledCourse,
} from "./storage";
import { contentStorage } from "./local-storage";
import { logError } from "../logger";
import { useRefreshResource } from "../refresh/useDataRefresh";
import { dataRefresh } from "../refresh/coordinator";

type Phase =
  "downloading" | "verifying" | "saving" | "done" | "error" | "cancelled";
export interface Transfer {
  courseId: string;
  phase: Phase;
  received: number;
  total: number;
  message: string;
}
function message(error: unknown, fallback: string): string {
  if (error instanceof ContentError) return error.message;
  if (error instanceof Error && error.name === "QuotaExceededError")
    return "本地存储空间不足，原有版本仍可使用。";
  return fallback;
}

export function useOfficialContent() {
  const api = useMemo(() => new ContentApi(), []);
  const [snapshot, setSnapshot] = useState<ContentSnapshot>(() =>
    makeSnapshot(),
  );
  const snapshotRef = useRef(snapshot);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [remote, setRemote] = useState<RemoteCourse[]>([]);
  const [updates, setUpdates] = useState<Record<string, UpdateResponse>>({});
  const [checking, setChecking] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const downloading = useRef<AbortController | null>(null);
  const refreshing = useRef<Promise<void> | null>(null);

  const applySnapshot = useCallback((next: ContentSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);
  const readSnapshot = useCallback(() => snapshotRef.current, []);
  const reloadLocal = useCallback(async () => {
    if (!(await dataRefresh.refresh(["content"], true)))
      throw new Error("无法重新读取本机课程，已有文件和记录仍保留。");
    return snapshotRef.current;
  }, []);
  useEffect(() => {
    let active = true;
    void contentStorage
      .load()
      .then((saved) => {
        if (active) {
          applySnapshot(saved);
          setReady(true);
        }
      })
      .catch((error: unknown) => {
        logError("Failed to restore downloaded courses.", error);
        if (active)
          setLoadError(
            error instanceof Error
              ? error.message
              : "无法读取本机课程，原有记录已保留，请重新读取。",
          );
      });
    return () => {
      active = false;
    };
  }, [applySnapshot]);
  useEffect(() => () => downloading.current?.abort(), []);
  const contentGeneration = useRef(0);
  useRefreshResource("content", async () => {
    if (downloading.current) return;
    const request = ++contentGeneration.current;
    const latest = await contentStorage.load();
    if (request === contentGeneration.current && !downloading.current)
      applySnapshot(latest);
  });

  const refresh = useCallback((): Promise<void> => {
    if (refreshing.current) return refreshing.current;
    if (downloading.current) return Promise.resolve();
    const request = ++contentGeneration.current;
    setChecking(true);
    setConnectionError("");
    setTransfer((previous) =>
      previous &&
      ["downloading", "verifying", "saving"].includes(previous.phase)
        ? previous
        : null,
    );
    const task = (async () => {
      try {
        if (!(await dataRefresh.refresh(["records"], true)))
          throw new ContentError("无法刷新资料归属和删除状态，请重试。");
        // 先读取本机版本，避免其他窗口已完成下载后仍按旧指针查询。
        const local = await contentStorage.load();
        if (request !== contentGeneration.current || downloading.current)
          return;
        applySnapshot(local);
        const catalog = await api.catalog();
        const results = await Promise.all(
          catalog.map((course) =>
            api.update(course.id, storedVersion(local, course.id)),
          ),
        );
        if (request !== contentGeneration.current || downloading.current)
          return;
        setRemote(catalog);
        setUpdates(
          Object.fromEntries(results.map((item) => [item.course_id, item])),
        );
      } catch (error) {
        if (request !== contentGeneration.current) return;
        logError("Failed to check official course updates.", error);
        setConnectionError(
          message(error, "无法连接官方内容服务，已下载的内容仍可使用。"),
        );
      } finally {
        setChecking(false);
        refreshing.current = null;
      }
    })();
    refreshing.current = task;
    return task;
  }, [api, applySnapshot]);

  const install = useCallback(
    async (
      courseId: string,
      forceUpdate = false,
    ): Promise<InstalledCourse | null> => {
      if (downloading.current) return null;
      contentGeneration.current++;
      const controller = new AbortController();
      downloading.current = controller;
      const current = snapshotRef.current;
      const previousVersion = storedVersion(current, courseId);
      const local = current.installed.find(
        (item) =>
          item.courseId === courseId && item.version === previousVersion,
      );
      const repair =
        !forceUpdate && local?.available === false ? local : undefined;
      const operation: { phase: Phase } = { phase: "downloading" };
      const report = (next: Phase, received = 0, total = 0, text = "") => {
        operation.phase = next;
        setTransfer({ courseId, phase: next, received, total, message: text });
      };
      report("downloading");
      try {
        const update = repair
          ? {
              latest: repair.manifest,
              status: "up_to_date" as const,
              course_id: courseId,
              current_version: previousVersion,
              update_available: false,
            }
          : await api.update(courseId, previousVersion, controller.signal);
        if (update.status === "unknown_version")
          throw new ContentError("官方服务无法确认本地版本，已保留当前内容。");
        if (
          update.status === "up_to_date" &&
          local &&
          local.available !== false
        ) {
          setUpdates((previous) => ({ ...previous, [courseId]: update }));
          report("done", 0, 0, "当前已是最新版本。");
          return null;
        }
        const manifest = update.latest;
        const bytes =
          repair?.archive ??
          (await api.download(manifest, controller.signal, (received) =>
            report("downloading", received, manifest.size_bytes),
          ));
        report("verifying", bytes.length, bytes.length);
        const installed = await contentStorage.install(
          manifest,
          bytes,
          previousVersion,
          controller.signal,
          () => report("saving", bytes.length, bytes.length),
        );
        const nextInstalled = [
          ...current.installed.filter(
            (item) =>
              !(
                item.courseId === courseId && item.version === installed.version
              ),
          ),
          installed,
        ];
        const nextHeads = [
          ...current.heads.filter((head) => head.courseId !== courseId),
          { courseId, version: installed.version },
        ];
        applySnapshot(
          makeSnapshot(
            nextInstalled,
            nextHeads,
            current.missingHeads.filter((head) => head.courseId !== courseId),
          ),
        );
        if (!repair)
          setUpdates((previous) => ({
            ...previous,
            [courseId]: {
              ...update,
              status: "up_to_date",
              current_version: installed.version,
              update_available: false,
            },
          }));
        report(
          "done",
          bytes.length,
          bytes.length,
          previousVersion
            ? "更新已保存，可继续阅读新版本。"
            : "课程已下载并保存，可离线阅读。",
        );
        return installed;
      } catch (error) {
        if (controller.signal.aborted && operation.phase !== "saving")
          report("cancelled", 0, 0, "已取消下载，原有内容未被替换。");
        else {
          logError("Failed to install official course content.", error);
          report(
            "error",
            0,
            0,
            message(
              error,
              operation.phase === "saving"
                ? "保存失败，原有版本未被替换，请重试。"
                : "下载或校验失败，原有版本未被替换，请重试。",
            ),
          );
        }
        return null;
      } finally {
        downloading.current = null;
        // 写入期间略过的读取在操作结束后执行，不重复下载或保存。
        void dataRefresh.refresh(["content"], true);
      }
    },
    [api, applySnapshot],
  );

  return {
    snapshot,
    readSnapshot,
    reloadLocal,
    ready,
    loadError,
    remote,
    updates,
    checking,
    connectionError,
    transfer,
    refresh,
    install,
    cancel: () => {
      if (transfer?.phase !== "saving") downloading.current?.abort();
    },
  };
}
export type OfficialContent = ReturnType<typeof useOfficialContent>;
