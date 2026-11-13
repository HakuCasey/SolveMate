import { useEffect, useRef, useSyncExternalStore } from "react";
import { dataRefresh, type DataScope } from "./coordinator";

export function useRefreshResource(
  scope: DataScope,
  read: () => Promise<unknown>,
) {
  const current = useRef(read);
  useEffect(() => {
    current.current = read;
  });
  useEffect(
    () => dataRefresh.register(scope, () => current.current()),
    [scope],
  );
}
/** 所有业务数据共用窗口事件，与 PWA 程序版本更新分开。 */
export function useDataRefresh() {
  const state = useSyncExternalStore(
    dataRefresh.subscribe,
    dataRefresh.snapshot,
    dataRefresh.snapshot,
  );
  useEffect(() => {
    let lastRefresh = 0;
    const refresh = () => {
      if (
        document.visibilityState !== "visible" ||
        Date.now() - lastRefresh < 1000
      )
        return;
      lastRefresh = Date.now();
      void dataRefresh.refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return { ...state, refresh: dataRefresh.refresh };
}
