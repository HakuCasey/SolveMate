import { useEffect, useRef, useSyncExternalStore } from "react";
import type { AppData, Course } from "@solvemate/contracts";
import {
  courses,
  createInitialData,
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
        if (upgraded !== saved && userStorageStatus.snapshot().online)
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
  controller.current ??= new LocalDataController(appStorage);
  const store = controller.current;
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.snapshot,
  );
  const firstCourses = useRef(available).current;
  useEffect(() => {
    let cancelled = false;
    void loadInitialData(firstCourses)
      .then((saved) => {
        if (!cancelled) store.initialize(saved);
        if (!cancelled)
          void store
            .restoreRecoveries()
            .catch((error: unknown) =>
              logError("Failed to restore retained changes.", error),
            );
      })
      .catch((error: unknown) => {
        logError("Failed to open local learning data.", error);
        if (!cancelled) store.failLoad();
      });
    return () => {
      cancelled = true;
    };
  }, [firstCourses, store]);
  useRefreshResource("records", store.refresh);
  return {
    ...snapshot,
    readData: store.readData,
    readSaveState: () => store.snapshot().saveState,
    setData: store.update,
    saveChanges: store.commit,
    retrySave: store.retry,
    resolveConflict: store.resolve,
  };
}
