import { useEffect, useState } from "react";
import { useAppUpdate } from "../pwa/useAppUpdate";
import { useSaveFeedback } from "./SaveFeedback";
import { RefreshCw, CircleArrowUp, CircleAlert, Check } from "lucide-react";
import { StatusPopover } from "../status/StatusPopover";
import { applicationStatus } from "../status/state";
import styles from "../status/StatusBar.module.css";
import { logError } from "../logger";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaControls({
  prepareReload,
  saveFailure,
  saveConflict,
  onRetrySave,
  onReviewSave,
}: {
  prepareReload: () => void;
  saveFailure: string;
  saveConflict: boolean;
  onRetrySave: () => Promise<boolean>;
  onReviewSave: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [retryingSave, setRetryingSave] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(
    null,
  );
  const showNotice = useSaveFeedback();
  const { state, supported, check, reload, clearReloadError } = useAppUpdate(
    prepareReload,
    () => showNotice("应用新版本已就绪，可在右下角点击“更新应用”。"),
  );
  const view = applicationStatus(state);
  const ready = state.status === "ready";
  const tone = ready
    ? "ready"
    : state.status === "error"
      ? "danger"
      : view.busy
        ? "active"
        : "neutral";
  const Icon = ready
    ? CircleArrowUp
    : state.status === "error"
      ? CircleAlert
      : state.status === "current"
        ? Check
        : RefreshCw;
  useEffect(() => {
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    const installed = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  async function install() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }
  return (
    <StatusPopover
      open={open}
      onOpenChange={setOpen}
      category="应用更新"
      value={view.label}
      status={
        supported
          ? view.status
          : import.meta.env.PROD
            ? "当前浏览器不支持应用更新"
            : "开发预览不提供应用更新"
      }
      icon={Icon}
      tone={tone}
      busy={view.busy}
    >
      {(state.error || (ready && saveFailure)) && (
        <div className={`${styles.alert} ${styles.error}`} role="alert">
          {saveFailure || state.error}
        </div>
      )}
      {ready && saveFailure && (
        <div className={styles.actions}>
          {!saveConflict && (
            <button
              className={styles.primary}
              disabled={retryingSave}
              onClick={async () => {
                clearReloadError();
                setRetryingSave(true);
                try {
                  if (await onRetrySave()) {
                    clearReloadError();
                    showNotice("记录已保存，可以继续更新应用。");
                  }
                } catch {
                  showNotice("保存未完成，请查看保存详情。");
                } finally {
                  setRetryingSave(false);
                }
              }}
            >
              {retryingSave ? "正在保存…" : "重试保存"}
            </button>
          )}
          <button
            onClick={() => {
              clearReloadError();
              setOpen(false);
              onReviewSave();
            }}
          >
            {saveConflict ? "处理修改冲突" : "查看保存详情"}
          </button>
        </div>
      )}
      {((supported && !view.busy) || installPrompt) && (
        <div className={styles.actions}>
          {supported && !view.busy && (
            <button
              className={styles.primary}
              disabled={view.busy || retryingSave || (!!saveFailure && ready)}
              onClick={ready ? reload : check}
            >
              {view.action}
            </button>
          )}
          {installPrompt && (
            <button
              onClick={() => {
                void install().catch((error: unknown) =>
                  logError("Failed to show the installation prompt.", error),
                );
              }}
            >
              安装应用
            </button>
          )}
        </div>
      )}
    </StatusPopover>
  );
}
