import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import {
  ArchiveRestore,
  Check,
  ChevronRight,
  RefreshCw,
  FileArchive,
  LoaderCircle,
  X,
} from "lucide-react";
import {
  discardBackup,
  exportBackup,
  inspectBackup,
  restoreBackup,
  type BackupPreview,
} from "../backups/client";
import { DataDirectorySettings } from "./DataDirectorySettings";
import { ExportDialog } from "./ExportDialog";
import styles from "./ExportDialog.module.css";
import backupStyles from "./BackupDialog.module.css";

/** 恢复通过本机服务整体替换，再调用既有刷新机制，页面不分别改写业务数据。 */
export function BackupDialog({
  onClose,
  onRefresh,
}: {
  onClose: () => void;
  onRefresh: () => Promise<boolean>;
}) {
  const [exporting, setExporting] = useState(false);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [phase, setPhase] = useState<
    "idle" | "checking" | "restoring" | "success"
  >("idle");
  const [reload, setReload] = useState<"idle" | "loading" | "done" | "failed">(
    "idle",
  );
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const operation = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const token = useRef("");
  const busy = phase === "checking" || phase === "restoring";
  useEffect(
    () => () => {
      operation.current?.abort();
      if (token.current) void discardBackup(token.current);
    },
    [],
  );
  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - start) / 1000)),
      250,
    );
    return () => clearInterval(timer);
  }, [busy, phase]);
  async function loadUserData() {
    setReload("loading");
    try {
      setReload((await onRefresh()) ? "done" : "failed");
    } catch {
      setReload("failed");
    }
  }
  function leavePreview() {
    const staged = token.current;
    token.current = "";
    if (staged) void discardBackup(staged);
    setPreview(null);
    setError("");
    setPhase("idle");
  }
  async function select(file: File | undefined) {
    if (!file || pending.current) return;
    if (
      !file.name.toLowerCase().endsWith(".zip") ||
      file.size > 4 * 1024 ** 3
    ) {
      setError("请选择不超过 4 GiB 的 ZIP 备份。");
      return;
    }
    pending.current = true;
    setPhase("checking");
    setElapsed(0);
    setError("");
    setPreview(null);
    if (token.current) await discardBackup(token.current);
    token.current = "";
    const controller = new AbortController();
    operation.current = controller;
    try {
      const info = await inspectBackup(file, controller.signal);
      setFilename(file.name);
      token.current = info.token;
      setPreview(info);
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "无法检查备份，请重新选择。",
        );
    } finally {
      pending.current = false;
      if (!controller.signal.aborted) setPhase("idle");
    }
  }
  async function restore() {
    if (!preview || pending.current) return;
    pending.current = true;
    setPhase("restoring");
    setElapsed(0);
    setError("");
    try {
      const restored = await restoreBackup(preview.token);
      token.current = "";
      const refreshed = await onRefresh().catch(() => false);
      setResult(`恢复前的数据备份：${restored.safetyBackup}`);
      setPhase("success");
      if (!refreshed)
        setError("数据已恢复。部分内容未能加载，请返回后点击“加载用户数据”。");
    } catch (failure) {
      setPhase("idle");
      setError(
        failure instanceof Error
          ? failure.message
          : "恢复未完成，请检查本机服务后重试。",
      );
    } finally {
      pending.current = false;
    }
  }
  if (exporting)
    return (
      <ExportDialog
        title="导出备份"
        name="SolveMate备份"
        extension="zip"
        icon={FileArchive}
        description="备份不含第三方 AI 服务的登录信息和原生会话文件。"
        perform={exportBackup}
        onClose={() => setExporting(false)}
      />
    );
  const detail = !!preview;
  const locked = busy || reload === "loading";
  const dismiss = () => {
    if (locked) return;
    if (detail) leavePreview();
    else onClose();
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={`${styles.dialog} ${backupStyles.dialog}`}
          aria-describedby={undefined}
          onPointerDownOutside={(event) => {
            if (locked || detail) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (locked) event.preventDefault();
          }}
        >
          <header className={styles.heading}>
            <span className={styles.mark}>
              <ArchiveRestore aria-hidden="true" />
            </span>
            <div>
              <Dialog.Title>{detail ? "恢复备份" : "备份与恢复"}</Dialog.Title>
            </div>
            {!detail && (
              <button
                className={styles.close}
                aria-label="关闭备份与恢复"
                disabled={locked}
                onClick={onClose}
              >
                <X />
              </button>
            )}
          </header>
          <div className={backupStyles.body}>
            {detail ? (
              <>
                {phase !== "success" ? (
                  <>
                    <h3 className={backupStyles.file}>{filename}</h3>
                    <p className={backupStyles.caption}>
                      {new Date(preview.createdAt).toLocaleString()} ·{" "}
                      {preview.files} 个文件 ·{" "}
                      {(preview.bytes / 1024 ** 2).toFixed(1)} MiB
                    </p>
                    <p className={backupStyles.warning}>
                      恢复将替换当前资料和记录。应用会先备份现有数据。
                    </p>
                  </>
                ) : (
                  <div className={styles.success} role="status">
                    <Check />
                    <div>
                      <strong>数据已恢复</strong>
                      <span>{result}</span>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className={backupStyles.rows}>
                  <button
                    className={backupStyles.row}
                    disabled={locked}
                    onClick={() => setExporting(true)}
                  >
                    <FileArchive />
                    <span>
                      <strong>导出备份</strong>
                      <small>将资料、学习记录和配置保存为 ZIP 文件。</small>
                    </span>
                    <ChevronRight />
                  </button>
                  <button
                    className={backupStyles.row}
                    disabled={locked}
                    onClick={() => fileInput.current?.click()}
                  >
                    <ArchiveRestore />
                    <span>
                      <strong>恢复备份</strong>
                      <small>选择 ZIP 备份文件。</small>
                    </span>
                    <ChevronRight />
                  </button>
                  <input
                    hidden
                    ref={fileInput}
                    type="file"
                    accept=".zip,application/zip"
                    onChange={(e) => {
                      void select(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </div>
                {busy && (
                  <p role="status" className={backupStyles.progress}>
                    <LoaderCircle className={styles.spinning} />
                    正在检查备份… {elapsed}s
                  </p>
                )}
                {error && (
                  <p role="alert" className={styles.error}>
                    {error}
                  </p>
                )}
                <DataDirectorySettings disabled={locked} />
                <button
                  className={backupStyles.row}
                  disabled={locked}
                  onClick={() => void loadUserData()}
                >
                  <RefreshCw
                    className={
                      reload === "loading" ? styles.spinning : undefined
                    }
                  />
                  <span>
                    <strong>加载用户数据</strong>
                    <small>在其他窗口修改数据后，可在这里读取最新记录。</small>
                  </span>
                  {reload === "done" ? (
                    <Check role="img" aria-label="已加载" />
                  ) : (
                    <ChevronRight />
                  )}
                </button>
                {reload === "failed" && (
                  <p className={styles.error} role="alert">
                    部分数据未能加载。请检查本机服务后重试。
                  </p>
                )}
                {reload === "loading" && (
                  <p role="status" className={styles.hint}>
                    正在加载…
                  </p>
                )}
              </>
            )}
            {detail && error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
          </div>
          {detail && (
            <footer className={styles.actions}>
              <button disabled={busy} onClick={leavePreview}>
                {phase === "success" ? "返回" : "取消"}
              </button>
              {phase !== "success" && (
                <button
                  className={styles.primary}
                  disabled={busy}
                  onClick={() => void restore()}
                >
                  {busy ? `正在恢复… ${elapsed}s` : "确认恢复"}
                </button>
              )}
            </footer>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
