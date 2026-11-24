import { FileLabel } from "./FileLabel";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
import picker from "../research/QuestionResearchPanel.module.css";
import library from "./SubjectContentList.module.css";
import styles from "./ExportDialog.module.css";
import backupStyles from "./BackupDialog.module.css";

const sections = ["备份文件", "用户数据", "操作记录"] as const;

/** 恢复通过本机服务整体替换，再调用既有刷新机制，页面不分别改写业务数据。 */
export function BackupDialog({
  needsAttention,
  onClose,
  onRefresh,
  children,
}: {
  needsAttention: boolean;
  onClose: () => void;
  onRefresh: () => Promise<boolean>;
  children: ReactNode;
}) {
  const [section, setSection] = useState<(typeof sections)[number]>(
    needsAttention ? "操作记录" : "备份文件",
  );
  const [exporting, setExporting] = useState(false);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [phase, setPhase] = useState<
    "idle" | "checking" | "restoring" | "success"
  >("idle");
  const [reload, setReload] = useState<"idle" | "loading" | "done">("idle");
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [safetyBackup, setSafetyBackup] = useState("");
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
      const ok = await onRefresh();
      setReload(ok ? "done" : "idle");
      if (!ok) setSection("操作记录");
    } catch (failure) {
      setReload("idle");
      setError(
        failure instanceof Error ? failure.message : "加载用户数据失败。",
      );
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
      setSafetyBackup(restored.safetyBackup);
      setPhase("success");
      if (!refreshed)
        setError(
          "数据已恢复。部分内容未能加载，请在“用户数据”中点击“加载用户数据”。",
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
    onClose();
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={picker.overlay} />
        <Dialog.Content
          className={`${picker.picker} ${backupStyles.dialog}`}
          aria-describedby={undefined}
          onPointerDownOutside={(event) => {
            if (locked || detail) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (locked || detail) {
              event.preventDefault();
              if (!locked) leavePreview();
            }
          }}
        >
          <header className={picker.pickerHeader}>
            <Dialog.Title>
              <ArchiveRestore />
              备份与恢复
            </Dialog.Title>
            <button
              aria-label="关闭备份与恢复"
              disabled={locked}
              onClick={onClose}
            >
              <X />
            </button>
          </header>
          <div className={`${library.library} ${library.pickerLibrary}`}>
            <nav className={library.subjectRail} aria-label="备份与恢复分类">
              <div className={library.subjectRailItems}>
                {sections.map((item) => (
                  <button
                    key={item}
                    aria-current={section === item ? "true" : undefined}
                    disabled={locked}
                    onClick={() => {
                      if (section === item) return;
                      if (detail) leavePreview();
                      setError("");
                      setSection(item);
                    }}
                  >
                    {item}
                    {item === "操作记录" && needsAttention && (
                      <span
                        className={backupStyles.dot}
                        aria-label="有操作需要处理"
                      />
                    )}
                  </button>
                ))}
              </div>
            </nav>
            <section className={library.listPane} aria-label={section}>
              {detail && (
                <header className={`${library.header} ${library.pickerHeader}`}>
                  <h3
                    className={`${library.pickerHeading} ${backupStyles.title}`}
                  >
                    恢复备份
                  </h3>
                </header>
              )}
              <div
                className={backupStyles.body}
                key={section}
                hidden={section === "操作记录"}
              >
                {detail ? (
                  <>
                    {phase !== "success" ? (
                      <>
                        <h3 className={backupStyles.file}>
                          <FileLabel value={filename} />
                        </h3>
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
                          <span>数据已恢复</span>
                          <span>恢复前的数据备份</span>
                          <FileLabel value={safetyBackup} />
                        </div>
                      </div>
                    )}
                  </>
                ) : section === "备份文件" ? (
                  <>
                    <div className={backupStyles.rows}>
                      <button
                        className={backupStyles.row}
                        disabled={locked}
                        onClick={() => setExporting(true)}
                      >
                        <FileArchive />
                        <span>
                          <span className={backupStyles.rowLabel}>
                            导出备份
                          </span>
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
                          <span className={backupStyles.rowLabel}>
                            恢复备份
                          </span>
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
                  </>
                ) : section === "用户数据" ? (
                  <>
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
                        <span className={backupStyles.rowLabel}>
                          加载用户数据
                        </span>
                        <small>
                          在其他窗口修改数据后，可在这里读取最新记录。
                        </small>
                      </span>
                      {reload === "done" ? (
                        <Check role="img" aria-label="已加载" />
                      ) : (
                        <ChevronRight />
                      )}
                    </button>
                    {reload === "loading" && (
                      <p role="status" className={styles.hint}>
                        正在加载…
                      </p>
                    )}
                  </>
                ) : null}
                {error && (
                  <p role="alert" className={styles.error}>
                    {error}
                  </p>
                )}
              </div>
              <div
                className={backupStyles.recordPanel}
                hidden={section !== "操作记录"}
              >
                {children}
              </div>
              {detail && (
                <footer className={`${styles.actions} ${backupStyles.footer}`}>
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
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
