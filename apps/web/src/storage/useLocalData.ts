import { operations } from "../operations/store";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { AppData, Course } from "@solvemate/contracts";
import {
  courses,
  createInitialData,
  validateContentReferences,
} from "../data/catalog";
import { upgradeRobotCatalog } from "../state/robots";
import { appStorage, userStorageStatus } from "./local-service";
import { LocalDataController } from "./controller";
import { logError } from "../logger";
import { initializeTeachingTools } from "../research/initialize";
import { initializeNotes } from "../state/notes";
import { useRefreshResource } from "../refresh/useDataRefresh";

let initialLoad: Promise<AppData> | undefined;
function loadInitialData(available: Course[], live: boolean): Promise<AppData> {
  const prepare = async (saved: AppData | null) => {
    if (saved) {
      const upgraded = await initializeTeachingTools(
        initializeNotes(upgradeRobotCatalog(saved)),
      );
      try {
        validateContentReferences(upgraded, available);
      } catch (error) {
        logError(
          "Saved reading content is unavailable; preserving its references.",
          error,
        );
      }
      if (
        !live &&
        upgraded !== saved &&
        userStorageStatus.snapshot().online &&
        !userStorageStatus.snapshot().loadFailure
      )
        await appStorage.save(upgraded);
      return upgraded;
    }
    const initial = await initializeTeachingTools(createInitialData());
    if (!live) await appStorage.save(initial);
    return initial;
  };
  if (live)
    return Promise.resolve(initialLoad)
      .catch(() => undefined)
      .then(() => appStorage.refresh())
      .then(({ value }) => prepare(value));
  initialLoad ??= appStorage
    .load()
    .then(prepare)
    .finally(() => {
      initialLoad = undefined;
    });
  return initialLoad;
}

export function useLocalData(available: Course[] = courses) {
  const controller = useRef<LocalDataController | null>(null);
  controller.current ??= new LocalDataController(
    appStorage,
    createInitialData(),
  );
  const store = controller.current;
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.snapshot,
  );
  const firstCourses = useRef(available).current;
  const load = useCallback(
    async (report = true) => {
      const operation = report
        ? operations.start({
            key: "records:load",
            label: "打开对话、笔记和配置",
          })
        : null;
      try {
        const saved = await loadInitialData(firstCourses, !report);
        store.initialize(saved);
        if (operation) operations.finish(operation);
        else operations.resolve("records:load");
        await store
          .restoreRecoveries()
          .catch((error: unknown) =>
            logError("Failed to restore retained changes.", error),
          );
      } catch (error) {
        logError("Failed to open local learning data.", error);
        store.failLoad(error);
        if (operation) operations.finish(operation, error);
        throw error;
      }
    },
    [firstCourses, store],
  );
  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);
  const refresh = useCallback(async () => {
    if (store.snapshot().loadState !== "ready") await load(false);
    else await store.refresh();
  }, [load, store]);
  useRefreshResource("records", refresh);
  return {
    ...snapshot,
    readData: store.readData,
    readSaveState: () => store.snapshot().saveState,
    setData: store.update,
    saveChanges: async (change: (previous: AppData) => AppData) => {
      if (store.snapshot().loadState !== "ready") await load(false);
      return store.commit(change);
    },
    retrySave: (key?: string) =>
      store.snapshot().loadState !== "ready" ? load() : store.retry(key),
    retryRead: refresh,
    reload: () => load(false),
    restoreRecovery: store.restoreRecovery,
    resolveConflict: store.resolve,
  };
}
