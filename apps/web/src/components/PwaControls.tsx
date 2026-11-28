import { useState } from "react";
import { useAppUpdate } from "../pwa/useAppUpdate";
import { useSaveFeedback } from "./SaveFeedback";
import { StatusPopover } from "../status/StatusPopover";
import { applicationStatus } from "../status/state";
import { appVersion } from "../version";
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
  const {
    state,
    supported,
    desktop,
    check,
    download,
    cancelDownload,
    reload,
    showInstaller,
    clearReloadError,
  } = useAppUpdate(prepareReload, () =>
    showNotice("应用新版本已就绪，可在侧栏状态栏中点击“更新应用”。"),
  );
  const view = applicationStatus(
    state,
    desktop && supported ? appVersion : undefined,
  );
  const ready = state.status === "ready";
  const available = state.status === "available";
  const downloadingInstaller = desktop && state.status === "downloading";
  const downloaded = state.status === "downloaded";
  const installerFile = state.installerFile;
  const statusDetail = (ready && saveFailure) || state.error;
  const updateAction = downloaded
    ? () => showInstaller("revealInstaller")
    : available
      ? download
      : ready
        ? reload
        : check;
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
      statusDetail={view.detail}
      statusDetailAside={
        state.status === "downloading" &&
        state.downloadPercent !== undefined && (
          <span
            className={styles.downloadPercent}
            role="progressbar"
            aria-label="下载进度"
            aria-valuenow={state.downloadPercent}
          >
            {state.downloadPercent}%
          </span>
        )
      }
      titleDetail={
        !view.detail && (
          <span className={styles.appVersion} title="当前版本">
            v{appVersion}
          </span>
        )
      }
      action={
        supported &&
        (!view.busy || downloadingInstaller) &&
        !(ready && saveFailure) && (
          <button
            type="button"
            className={
              ready
                ? `${styles.inlineAction} ${styles.primary}`
                : styles.inlineAction
            }
            onClick={downloadingInstaller ? cancelDownload : updateAction}
          >
            {downloadingInstaller ? "取消下载" : view.action}
          </button>
        )
      }
      tone={tone}
      busy={view.busy}
    >
      {installerFile && (
        <div className={styles.installerFile}>
          <button
            type="button"
            aria-label={`打开安装包 ${installerFile.name}`}
            title={installerFile.path}
            onClick={() => showInstaller("openInstaller")}
          >
            {installerFile.name}
          </button>
          <p title={installerFile.path}>{installerFile.directory}</p>
        </div>
      )}
      {!!statusDetail && (
        <div className={`${styles.alert} ${styles.error}`} role="alert">
          {statusDetail}
        </div>
      )}
      {ready && !!saveFailure && (
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
