import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { AppData, Course } from "@solvemate/contracts";
import {
  courses,
  createInitialData,
  createEmptyData,
  validateContentReferences,
  sampleNotebooks,
  sampleNotes,
} from "../data/catalog";
import { upgradeRobotCatalog } from "../state/robots";
import { appStorage, userStorageStatus } from "./local-service";
import { LocalDataController } from "./controller";
import { logError } from "../logger";
import { initializeNotes } from "../state/notes";
import { useRefreshResource } from "../refresh/useDataRefresh";

let initialLoad: Promise<AppData> | undefined;
function loadInitialData(available: Course[]): Promise<AppData> {
  initialLoad ??= appStorage
    .load()
    .then(async (saved) => {
      if (saved) {
        const upgraded = initializeNotes(
          upgradeRobotCatalog(saved),
          sampleNotebooks,
          sampleNotes,
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
          upgraded !== saved &&
          userStorageStatus.snapshot().online &&
          !userStorageStatus.snapshot().loadFailure
        )
          await appStorage.save(upgraded);
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
  const controller = useRef<LocalDataController | null>(null);
  controller.current ??= new LocalDataController(appStorage, createEmptyData());
  const store = controller.current;
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.snapshot,
  );
  const firstCourses = useRef(available).current;
  const load = useCallback(async () => {
    try {
      const saved = await loadInitialData(firstCourses);
      store.initialize(saved);
      await store
        .restoreRecoveries()
        .catch((error: unknown) =>
          logError("Failed to restore retained changes.", error),
        );
    } catch (error) {
      logError("Failed to open local learning data.", error);
      store.failLoad(error);
      throw error;
    }
  }, [firstCourses, store]);
  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);
  const refresh = useCallback(async () => {
    if (store.snapshot().loadState !== "ready") await load();
    else await store.refresh();
  }, [load, store]);
  useRefreshResource("records", refresh);
  return {
    ...snapshot,
    readData: store.readData,
    readSaveState: () => store.snapshot().saveState,
    setData: store.update,
    saveChanges: store.commit,
    retrySave: () =>
      store.snapshot().loadState !== "ready" ? load() : store.retry(),
    retryRead: refresh,
    restoreRecovery: store.restoreRecovery,
    resolveConflict: store.resolve,
  };
}
