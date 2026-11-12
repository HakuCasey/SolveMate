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
/** 所有业务数据共用窗口事件和定时器，与 PWA 程序版本更新分开。 */
export function useDataRefresh() {
  const state = useSyncExternalStore(
    dataRefresh.subscribe,
    dataRefresh.snapshot,
    dataRefresh.snapshot,
  );
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void dataRefresh.refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 15000);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  }, []);
  return { ...state, refresh: dataRefresh.refresh };
}
