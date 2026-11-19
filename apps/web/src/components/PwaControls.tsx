import { useState } from "react";
import { useAppUpdate } from "../pwa/useAppUpdate";
import { useSaveFeedback } from "./SaveFeedback";
import { StatusPopover } from "../status/StatusPopover";
import { applicationStatus } from "../status/state";
import styles from "../status/StatusBar.module.css";
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
  const showNotice = useSaveFeedback();
  const { state, supported, desktop, check, reload, clearReloadError } =
    useAppUpdate(prepareReload, () =>
      showNotice("应用新版本已就绪，可在侧栏状态栏中点击“更新应用”。"),
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
  return (
    <StatusPopover
      open={open}
      onOpenChange={setOpen}
      category="应用更新"
      value={view.label}
      status={
        supported
          ? view.status
          : desktop
            ? "当前安装版本暂不提供应用内更新"
            : import.meta.env.PROD
              ? "当前浏览器不支持应用更新"
              : "开发预览不提供应用更新"
      }
      action={
        supported &&
        !view.busy &&
        !(ready && saveFailure) && (
          <button
            type="button"
            className={
              ready
                ? `${styles.inlineAction} ${styles.primary}`
                : styles.inlineAction
            }
            onClick={ready ? reload : check}
          >
            {view.action}
          </button>
        )
      }
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
    </StatusPopover>
  );
}
