import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import {
  Check,
  ChevronRight,
  FileDown,
  Folder,
  LoaderCircle,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  defaultExportDirectory,
  exportFilename,
  filenameError,
  saveExport,
  type DirectoryPicker,
  type ExportExtension,
  type ExportReceipt,
} from "../exports/files";
import styles from "./ExportDialog.module.css";

/** 两种导出共用表单与状态，业务仅负责生成相应格式的文件。 */
export function ExportDialog({
  title,
  name,
  icon: Icon = FileDown,
  extension,
  description,
  generate,
  onClose,
}: {
  title: string;
  name: string;
  icon?: LucideIcon;
  extension: ExportExtension;
  description?: string;
  generate: (signal: AbortSignal) => Promise<Blob>;
  onClose: () => void;
}) {
  const [filename, setFilename] = useState(() =>
    exportFilename(name, extension).slice(0, -(extension.length + 1)),
  );
  const [directory, setDirectory] = useState<FileSystemDirectoryHandle | null>(
    null,
  );
  const [defaultDirectory, setDefaultDirectory] = useState("下载");
  const [phase, setPhase] = useState<"idle" | "exporting" | "success">("idle");
  const [choosing, setChoosing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<ExportReceipt | null>(null);
  const operation = useRef<AbortController | null>(null),
    pending = useRef(false);
  const closed = useRef(onClose);
  closed.current = onClose;
  const busy = phase === "exporting" || choosing;
  const picker = (
    window as unknown as { showDirectoryPicker?: DirectoryPicker }
  ).showDirectoryPicker;
  const fullName = `${filename.trim()}.${extension}`,
    invalid = !filename.trim() ? "请填写文件名。" : filenameError(fullName);
  useEffect(() => {
    const controller = new AbortController();
    void defaultExportDirectory(controller.signal)
      .then(setDefaultDirectory)
      .catch(() => undefined);
    return () => {
      controller.abort();
      operation.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (phase !== "exporting") return;
    const started = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      250,
    );
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    if (phase !== "success") return;
    const timer = window.setTimeout(() => closed.current(), 3000);
    return () => clearTimeout(timer);
  }, [phase]);
  async function chooseDirectory() {
    if (!picker || busy) return;
    setChoosing(true);
    setError("");
    try {
      setDirectory(
        await picker.call(window, {
          id: "solvemate-export",
          startIn: "downloads",
          mode: "readwrite",
        }),
      );
    } catch (failure) {
      if (!(failure instanceof DOMException && failure.name === "AbortError"))
        setError("无法使用所选目录，请重新选择保存位置。");
    } finally {
      setChoosing(false);
    }
  }
  async function confirm() {
    if (pending.current || invalid) return;
    pending.current = true;
    setElapsed(0);
    setError("");
    setPhase("exporting");
    const controller = new AbortController();
    operation.current = controller;
    try {
      const blob = await generate(controller.signal);
      controller.signal.throwIfAborted();
      const result = await saveExport(
        blob,
        fullName,
        directory,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      setReceipt(result);
      setPhase("success");
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(
          failure instanceof DOMException &&
            ["NotAllowedError", "SecurityError"].includes(failure.name)
            ? "无法写入所选位置，请重新选择，或恢复到下载目录。"
            : failure instanceof Error
              ? failure.message
              : "导出失败，请重试。",
        );
        setPhase("idle");
      }
    } finally {
      pending.current = false;
    }
  }
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
              <Icon aria-hidden="true" />
            </span>
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>{description || name}</Dialog.Description>
            </div>
            <button
              className={styles.close}
              aria-label="关闭导出窗口"
              disabled={busy}
              onClick={onClose}
            >
              <X />
            </button>
          </header>
          <div className={styles.fields}>
            <label htmlFor="export-filename">文件名</label>
            <div className={styles.filename}>
              <input
                id="export-filename"
                value={filename}
                maxLength={150}
                autoComplete="off"
                spellCheck={false}
                disabled={busy || phase === "success"}
                onChange={(event) => {
                  setFilename(event.target.value);
                  setError("");
                }}
              />
              <span>.{extension}</span>
            </div>
            <label htmlFor="export-location">保存位置</label>
            <div className={styles.location}>
              <Folder aria-hidden="true" />
              <span
                id="export-location"
                title={directory?.name || defaultDirectory}
              >
                {directory?.name || defaultDirectory}
              </span>
              <button
                aria-label="选择保存位置"
                title={
                  picker
                    ? "选择保存位置"
                    : "当前浏览器不支持选择其他目录，可保存到下载目录。"
                }
                disabled={busy || phase === "success" || !picker}
                onClick={() => void chooseDirectory()}
              >
                更改
                <ChevronRight />
              </button>
            </div>
            {directory && phase !== "success" && (
              <button
                className={styles.reset}
                disabled={busy}
                onClick={() => {
                  setDirectory(null);
                  setError("");
                }}
              >
                恢复到下载目录
              </button>
            )}
            {!picker && (
              <p className={styles.hint}>
                当前浏览器可导出到下载目录；选择其他目录需使用 Chrome 或 Edge。
              </p>
            )}
          </div>
          <div className={styles.feedback} aria-live="polite">
            {phase === "success" ? (
              <div className={styles.success} role="status">
                <Check />
                <div>
                  <strong>导出成功</strong>
                  <span>{receipt?.filename}</span>
                  <small>3 秒后自动关闭</small>
                </div>
              </div>
            ) : error || invalid ? (
              <p className={styles.error} role="alert">
                {error || invalid}
              </p>
            ) : null}
          </div>
          <footer className={styles.actions}>
            <button disabled={busy} onClick={onClose}>
              {phase === "success" ? "关闭" : "取消"}
            </button>
            <button
              className={styles.primary}
              disabled={busy || !!invalid || phase === "success"}
              onClick={() => void confirm()}
            >
              {phase === "exporting" ? (
                <>
                  <LoaderCircle className={styles.spinning} />
                  导出中… {elapsed}s
                </>
              ) : phase === "success" ? (
                <>
                  <Check />
                  已导出
                </>
              ) : (
                "确认"
              )}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
