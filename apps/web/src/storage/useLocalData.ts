import { useEffect, useRef, useState } from "react";
import type { AppData, Course } from "@solvemate/contracts";
import {
  courses,
  createInitialData,
  validateContentReferences,
} from "../data/catalog";
import { pinLegacyVersions } from "../content/selection";
import { logError } from "../logger";
import { upgradeRobotCatalog } from "../state/robots";
import { appStorage, LocalDataConflictError } from "./index";

let initialLoad: Promise<AppData> | undefined;

function loadInitialData(available: Course[]): Promise<AppData> {
  // React 开发模式会重复挂载；共用初始化请求，避免重复写入示例记录。
  initialLoad ??= appStorage
    .load()
    .then(async (saved) => {
      if (saved) {
        const upgraded = pinLegacyVersions(upgradeRobotCatalog(saved));
        validateContentReferences(upgraded, available);
        if (upgraded !== saved) await appStorage.save(upgraded);
        return upgraded;
      }
      const initial = createInitialData();
      await appStorage.save(initial);
      return initial;
    })
    .finally(() => {
      initialLoad = undefined;
    });
  return initialLoad;
}

export function useLocalData(available: Course[] = courses) {
  const initialCourses = useRef(available).current;
  const [data, setData] = useState<AppData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveState, setSaveState] = useState<"saving" | "saved" | "error">(
    "saved",
  );
  const [conflict, setConflict] = useState(false);
  const [retry, setRetry] = useState(0);
  const lastSubmitted = useRef<{ data: AppData; retry: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadInitialData(initialCourses)
      .then((saved) => {
        if (!cancelled) {
          lastSubmitted.current = { data: saved, retry: 0 };
          setData(saved);
        }
      })
      .catch((error: unknown) => {
        logError("Failed to open local learning data.", error);
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [initialCourses]);

  useEffect(() => {
    if (
      !data ||
      (lastSubmitted.current?.data === data &&
        lastSubmitted.current.retry === retry)
    )
      return;
    lastSubmitted.current = { data, retry };
    let cancelled = false;
    setSaveState("saving");
    void Promise.resolve()
      .then(() => appStorage.save(data))
      .then(() => {
        if (!cancelled) {
          setSaveState("saved");
          setConflict(false);
        }
      })
      .catch((error: unknown) => {
        logError("Failed to save local learning data.", error);
        if (!cancelled) {
          setSaveState("error");
          setConflict(error instanceof LocalDataConflictError);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [data, retry]);

  return {
    data,
    setData,
    loadFailed,
    saveState,
    conflict,
    retrySave: () => setRetry((value) => value + 1),
  };
}
