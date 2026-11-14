import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import {
  ArchiveRestore,
  Check,
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
        setError(
          "数据已恢复，部分页面尚未刷新。请在设置中点击“刷新数据”；未保存输入仍保留。",
        );
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
        title="数据备份导出"
        name="SolveMate备份"
        extension="zip"
        icon={FileArchive}
        description="包含资料、对话、笔记和配置。"
        perform={exportBackup}
        onClose={() => setExporting(false)}
      />
    );
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.dialog}
          aria-busy={busy}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <header className={styles.heading}>
            <span className={styles.mark}>
              <ArchiveRestore aria-hidden="true" />
            </span>
            <div>
              <Dialog.Title>备份与恢复</Dialog.Title>
              <Dialog.Description>
                保存完整备份，或恢复已有资料和记录。
              </Dialog.Description>
            </div>
            <button
              className={styles.close}
              aria-label="关闭备份与恢复"
              disabled={busy}
              onClick={onClose}
            >
              <X />
            </button>
          </header>
          <div className={backupStyles.sections}>
            <section>
              <h3>备份数据</h3>
              <p>资料、对话、笔记、机器人、AI 配置及学习记录。</p>
              <button disabled={busy} onClick={() => setExporting(true)}>
                <FileArchive />
                导出备份
              </button>
            </section>
            <section>
              <h3>恢复数据</h3>
              <p>选择此前导出的 ZIP 备份，默认保存在系统“下载”文件夹。</p>
              <p>恢复会替换当前资料和记录，替换前会自动备份现有数据。</p>
              <input
                ref={fileInput}
                type="file"
                accept=".zip,application/zip"
                hidden
                onChange={(event) => {
                  void select(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <button
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                <ArchiveRestore />
                选择备份文件
              </button>
              {preview && (
                <dl>
                  <dt>备份时间</dt>
                  <dd>{new Date(preview.createdAt).toLocaleString()}</dd>
                  <dt>文件</dt>
                  <dd>
                    {preview.files} 个 ·{" "}
                    {(preview.bytes / 1024 ** 2).toFixed(1)} MiB
                  </dd>
                </dl>
              )}
            </section>
            <p className={styles.hint}>
              备份不含第三方 Harness
              的登录信息和原生会话文件。恢复后继续对话，需要对应 Harness
              中仍有原会话。
            </p>
          </div>
          <div className={styles.feedback} aria-live="polite">
            {busy && (
              <p className={backupStyles.progress}>
                <LoaderCircle className={styles.spinning} />
                {phase === "checking" ? "正在检查备份…" : "正在恢复数据…"}{" "}
                {elapsed}s
              </p>
            )}
            {phase === "success" && (
              <div className={styles.success} role="status">
                <Check />
                <div>
                  <strong>数据已恢复</strong>
                  <span>{result}</span>
                </div>
              </div>
            )}
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
          </div>
          <footer className={styles.actions}>
            <button disabled={busy} onClick={onClose}>
              {phase === "success" ? "关闭" : "取消"}
            </button>
            {preview && phase !== "success" && (
              <button
                className={styles.primary}
                disabled={busy}
                onClick={() => void restore()}
              >
                确认恢复
              </button>
            )}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
