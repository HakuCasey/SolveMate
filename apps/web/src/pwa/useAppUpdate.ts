import { useEffect, useRef, useState } from "react";
import { AppUpdateController, type UpdateState } from "./update-controller";
import { clearReloadCheckpoint } from "./reload-checkpoint";
import { logError } from "../logger";

const initial: UpdateState = { status: "idle", error: "" };
const automaticCheckInterval = 60 * 60 * 1000;

declare global {
  interface Window {
    solvemateAppUpdate?: {
      getState(): Promise<UpdateState>;
      check(): Promise<UpdateState>;
      download(): Promise<UpdateState>;
      install(): Promise<UpdateState>;
      subscribe(listener: (state: UpdateState) => void): () => void;
    };
  }
}

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
  const desktop = import.meta.env.VITE_DESKTOP === "1";
  const nativeUpdate = desktop ? window.solvemateAppUpdate : undefined;
  const webSupported =
    import.meta.env.PROD && !desktop && "serviceWorker" in navigator;
  const nativeState = useRef(initial);
  const nativeActionPending = useRef(false);
  useEffect(() => {
    if (!nativeUpdate) return;
    let active = true;
    let receivedState = false;
    const receive = (next: UpdateState) => {
      if (nativeState.current.status === "reloading" && next.status === "ready")
        clearReloadCheckpoint(localStorage);
      nativeState.current = next;
      setState(next);
    };
    const unsubscribe = nativeUpdate.subscribe((next) => {
      receivedState = true;
      receive(next);
    });
    void nativeUpdate.getState().then(
      (next) => {
        if (active && !receivedState) receive(next);
      },
      (error: unknown) =>
        logError("Failed to read the macOS update state.", error),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [nativeUpdate]);
  useEffect(() => {
    if (!webSupported) return;
    let active = true;
    let notified = false;
    let lastCheck = 0;
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    let stopWaiting: (() => void) | undefined;
    let committingReload = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
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
      if (next.status === "error") {
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          if (active && updates.snapshot().status === "error")
            void updates.check();
        }, 30000);
      }
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
      if (!active || previous === previousController) return;
      if (updates.snapshot().status === "reloading") finishReload();
      else if (previous) updates.markReady();
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
          // activated 不代表当前页面已经由新版控制；以实际接管为准。
          if (
            waiting.state === "activated" &&
            navigator.serviceWorker.controller === waiting
          )
            finishReload();
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
      if (retryTimer) clearTimeout(retryTimer);
      clearInterval(interval);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        controlled,
      );
      window.removeEventListener("focus", focused);
      window.removeEventListener("online", check);
      if (controller.current === updates) controller.current = null;
    };
  }, [webSupported]);

  async function desktopAction(action: "check" | "download" | "install") {
    if (!nativeUpdate || nativeActionPending.current) return;
    nativeActionPending.current = true;
    let checkpointSaved = false;
    try {
      if (action === "install") {
        callbacks.current.prepareReload();
        checkpointSaved = true;
      }
      const next = await nativeUpdate[action]();
      if (checkpointSaved && next.status === "ready")
        clearReloadCheckpoint(localStorage);
    } catch (error) {
      if (checkpointSaved) clearReloadCheckpoint(localStorage);
      setState({
        ...nativeState.current,
        error:
          action === "install" && !checkpointSaved && error instanceof Error
            ? error.message
            : "未能完成更新操作，请重试。",
      });
    } finally {
      nativeActionPending.current = false;
    }
  }

  return {
    state,
    offlineReady,
    supported: webSupported || !!nativeUpdate,
    desktop,
    check: () =>
      nativeUpdate ? void desktopAction("check") : checkAction.current(),
    download: () => void desktopAction("download"),
    reload: () =>
      nativeUpdate ? void desktopAction("install") : reloadAction.current(),
    clearReloadError: () => {
      if (nativeUpdate) setState((current) => ({ ...current, error: "" }));
      if (controller.current?.snapshot().status === "ready")
        controller.current.markReady();
    },
  };
}
