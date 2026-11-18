import { useEffect, useState } from "react";
import { Dialog } from "radix-ui";
import { FolderOpen } from "lucide-react";
import { localRequest } from "../storage/local-client";
import styles from "./BackupDialog.module.css";
import shared from "./ExportDialog.module.css";

interface DirectoryInfo {
  current: string;
  default: string;
  pending: { path: string; migrate: boolean } | null;
  error: string;
  configurable: boolean;
}
const restart =
  import.meta.env.VITE_DESKTOP === "1"
    ? "退出并重新打开应用后生效。"
    : "重启本机服务并刷新页面后生效。";

export function DataDirectorySettings({ disabled }: { disabled: boolean }) {
  const [info, setInfo] = useState<DirectoryInfo | null>(null);
  const [editing, setEditing] = useState(false);
  const [path, setPath] = useState("");
  const [migrate, setMigrate] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void localRequest("/directory")
      .then((r) => r.json())
      .then((value: DirectoryInfo) => {
        if (active) setInfo(value);
      })
      .catch(() => {
        if (active)
          setError("无法读取用户数据路径，请检查本机服务后重新打开。");
      });
    return () => {
      active = false;
    };
  }, []);

  async function save(target: string) {
    setSaving(true);
    setError("");
    try {
      const response = await localRequest("/directory", {
        method: "PUT",
        body: JSON.stringify({ path: target, migrate }),
      });
      setInfo(await response.json());
      setEditing(false);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "路径未保存，请重试。",
      );
    } finally {
      setSaving(false);
    }
  }

  const changed =
    info &&
    (path.trim() !== (info.pending?.path ?? info.current) ||
      (info.pending && migrate !== info.pending.migrate));
  return (
    <section className={styles.directorySection}>
      <div className={styles.directoryHeader}>
        <h3>用户数据路径</h3>
        <Dialog.Root
          open={editing}
          onOpenChange={(open) => {
            if (saving) return;
            if (open && info) {
              setPath(info.pending?.path ?? info.current);
              setMigrate(info.pending?.migrate ?? true);
            }
            setError("");
            setEditing(open);
          }}
        >
          <Dialog.Trigger
            className={styles.link}
            disabled={disabled || saving || !info?.configurable}
          >
            更改路径
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className={shared.overlay} />
            <Dialog.Content
              className={shared.dialog}
              aria-describedby={undefined}
              onPointerDownOutside={(e) => e.preventDefault()}
            >
              <header className={shared.heading}>
                <span className={shared.mark}>
                  <FolderOpen />
                </span>
                <Dialog.Title>更改用户数据路径</Dialog.Title>
              </header>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (path.trim() && changed && !saving) void save(path.trim());
                }}
              >
                <div className={shared.fields}>
                  <label htmlFor="user-data-directory">数据文件夹</label>
                  <div className={shared.filename}>
                    <input
                      id="user-data-directory"
                      disabled={saving}
                      autoComplete="off"
                      spellCheck={false}
                      value={path}
                      onChange={(e) => {
                        setPath(e.target.value);
                        setError("");
                      }}
                    />
                  </div>
                </div>
                <label className={styles.migrate}>
                  <input
                    type="checkbox"
                    checked={migrate}
                    disabled={saving}
                    onChange={(e) => setMigrate(e.target.checked)}
                  />
                  将现有数据复制到新目录
                </label>
                <p className={shared.hint}>
                  {migrate
                    ? "请选择空文件夹，原目录会保留。"
                    : "使用目标目录中的记录。空目录将从初始内容开始。"}
                  {restart}
                </p>
                {error && (
                  <p role="alert" className={shared.error}>
                    {error}
                  </p>
                )}
                <footer className={shared.actions}>
                  <Dialog.Close type="button" disabled={saving}>
                    取消
                  </Dialog.Close>
                  <button
                    className={shared.primary}
                    disabled={saving || !changed || !path.trim()}
                  >
                    {saving ? "正在保存…" : "保存路径"}
                  </button>
                </footer>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
      <p className={styles.path}>{info?.current ?? (error ? "" : "读取中…")}</p>
      {info?.pending && (
        <div className={styles.pending}>
          <span role="status">
            将切换到 {info.pending.path}。{restart}
          </span>
          <button
            className={styles.link}
            disabled={disabled || saving}
            onClick={() => void save(info.current)}
          >
            撤销切换
          </button>
        </div>
      )}
      {info && !info.configurable && (
        <p className={shared.hint}>数据目录由启动参数指定。</p>
      )}
      {!editing && (error || info?.error) && (
        <p role="alert" className={shared.error}>
          {error || info?.error}
        </p>
      )}
    </section>
  );
}
