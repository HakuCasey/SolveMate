import { useEffect, useRef, useState } from "react";
import { AppUpdateController, type UpdateState } from "./update-controller";
import { clearReloadCheckpoint } from "./reload-checkpoint";
import { logError } from "../logger";

const initial: UpdateState = { status: "idle", error: "" };
const automaticCheckInterval = 60 * 60 * 1000;

/** 原生更新事件集中在此处理；只有用户确认的当前窗口能够重载。 */
export function useAppUpdate(prepareReload: () => void, onReady: () => void) {
  const callbacks = useRef({ prepareReload, onReady });
  useEffect(() => {
    callbacks.current = { prepareReload, onReady };
  }, [prepareReload, onReady]);
  const [state, setState] = useState(initial);
  const [offlineReady, setOfflineReady] = useState(false);
  const controller = useRef<AppUpdateController | null>(null);
  const reloadAction = useRef<() => void>(() => undefined);
  const checkAction = useRef<() => void>(() => undefined);
  const supported = import.meta.env.PROD && "serviceWorker" in navigator;
  useEffect(() => {
    if (!supported) return;
    let active = true;
    let notified = false;
    let lastCheck = 0;
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    let stopWaiting: (() => void) | undefined;
    let committingReload = false;
    const base = new URL(import.meta.env.BASE_URL, window.location.href);
    const url = new URL("sw.js", base).href;
    const updates = new AppUpdateController({
      register: async () => {
        try {
          const registration = await navigator.serviceWorker.register(url, {
            scope: base.href,
            updateViaCache: "none",
          });
          return { url, registration };
        } catch (failure) {
          // 离线时仍读取已注册的等待版本，不把网络故障当成缓存丢失。
          const existing = await navigator.serviceWorker.getRegistration(
            base.href,
          );
          if (existing) return { url, registration: existing };
          logError(
            "Failed to register the application update worker.",
            failure,
          );
          throw new Error("无法连接应用更新服务，请确认服务和网络可用。", {
            cause: failure,
          });
        }
      },
      fetchScript: (script, signal) =>
        fetch(script, { cache: "no-store", signal }),
      online: () => navigator.onLine,
    });
    controller.current = updates;
    const unsubscribe = updates.subscribe(() => {
      const next = updates.snapshot();
      setState(next);
      if (next.status === "ready" && !notified) {
        notified = true;
        callbacks.current.onReady();
      }
    });
    const finishReload = () => {
      if (
        !active ||
        updates.snapshot().status !== "reloading" ||
        committingReload
      )
        return;
      committingReload = true;
      try {
        // 等待版本启用期间，保存状态和用户输入仍可能变化，因此重载前再次核对。
        callbacks.current.prepareReload();
        window.location.reload();
      } catch (failure) {
        clearReloadCheckpoint();
        updates.reloadFailed(
          failure instanceof Error
            ? failure.message
            : "无法保存当前内容，请重试。",
        );
        committingReload = false;
      }
    };
    const check = () => {
      lastCheck = Date.now();
      void updates.check();
    };
    checkAction.current = check;
    const focused = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastCheck > 60000
      )
        check();
    };
    let previousController = navigator.serviceWorker.controller;
    const controlled = () => {
      const previous = previousController;
      previousController = navigator.serviceWorker.controller;
      if (!active || !previous) return;
      if (updates.snapshot().status === "reloading") finishReload();
      else updates.markReady();
    };
    reloadAction.current = () => {
      if (updates.snapshot().status !== "ready") return;
      try {
        callbacks.current.prepareReload();
        updates.beginReload();
        const waiting = updates.waitingWorker();
        if (!waiting) {
          finishReload();
          return;
        }
        const changed = () => {
          if (waiting.state === "activated") finishReload();
          else if (waiting.state === "redundant") {
            clearReloadCheckpoint();
            updates.reloadFailed("新版启用失败，请再次点击“更新应用”。");
          }
        };
        stopWaiting?.();
        if (reloadTimer) clearTimeout(reloadTimer);
        waiting.addEventListener("statechange", changed);
        stopWaiting = () => waiting.removeEventListener("statechange", changed);
        waiting.postMessage({ type: "SKIP_WAITING" });
        reloadTimer = setTimeout(() => {
          if (updates.snapshot().status === "reloading") {
            clearReloadCheckpoint();
            updates.reloadFailed("新版启用超时，请再次点击“更新应用”。");
          }
        }, 15000);
      } catch (failure) {
        clearReloadCheckpoint();
        updates.reloadFailed(
          failure instanceof Error ? failure.message : "应用更新失败，请重试。",
        );
      }
    };
    void navigator.serviceWorker.ready.then(() => {
      if (active) setOfflineReady(true);
    });
    navigator.serviceWorker.addEventListener("controllerchange", controlled);
    window.addEventListener("focus", focused);
    window.addEventListener("online", check);
    const interval = setInterval(focused, automaticCheckInterval);
    check();
    return () => {
      active = false;
      unsubscribe();
      updates.dispose();
      stopWaiting?.();
      if (reloadTimer) clearTimeout(reloadTimer);
      clearInterval(interval);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        controlled,
      );
      window.removeEventListener("focus", focused);
      window.removeEventListener("online", check);
      if (controller.current === updates) controller.current = null;
    };
  }, [supported]);
  useEffect(() => {
    if (state.status !== "current") return;
    const timer = setTimeout(() => controller.current?.resetCurrent(), 3000);
    return () => clearTimeout(timer);
  }, [state.status]);
  return {
    state,
    offlineReady,
    supported,
    check: () => checkAction.current(),
    reload: () => reloadAction.current(),
  };
}
