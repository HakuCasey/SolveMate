import { useEffect, useRef, useSyncExternalStore } from "react";
import type { AppData, Course } from "@solvemate/contracts";
import {
  courses,
  createInitialData,
  validateContentReferences,
} from "../data/catalog";
import { pinLegacyVersions } from "../content/selection";
import { upgradeRobotCatalog } from "../state/robots";
import { appStorage } from "./index";
import { LocalDataController } from "./controller";
import { logError } from "../logger";

let initialLoad: Promise<AppData> | undefined;
function loadInitialData(available: Course[]): Promise<AppData> {
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
      })
      .catch((error: unknown) => {
        logError("Failed to open local learning data.", error);
        if (!cancelled) store.failLoad();
      });
    return () => {
      cancelled = true;
    };
  }, [firstCourses, store]);
  return {
    ...snapshot,
    setData: store.update,
    saveChanges: store.commit,
    retrySave: store.retry,
  };
}
