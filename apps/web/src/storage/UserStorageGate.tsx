import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  ensureUserStorage,
  MigrationRequired,
  resolveMigration,
  userStorageStatus,
  LocalServiceError,
} from "./local-service";
import { LocalDataConflictError } from "./index";
import { logError } from "../logger";
import styles from "../App.module.css";

/** 旧浏览器记录与正式记录并存时，先备份并由用户选择，不能自动覆盖。 */
export function UserStorageGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void ensureUserStorage()
      .then(() => {
        if (active) setReady(true);
      })
      .catch((error: unknown) => {
        logError("Failed to prepare local user records.", error);
        if (active) setFailure(error);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  if (ready) return children;
  const required = failure instanceof MigrationRequired ? failure : null;
  async function decide(decision: "keep" | "replace") {
    if (!required) return;
    setBusy(true);
    try {
      await resolveMigration(required, decision);
      setFailure(null);
      setReplacing(false);
      setAttempt((value) => value + 1);
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={styles.loading}>
      <h1>SolveMate</h1>
      {required ? (
        <>
          <h2>{replacing ? "确认替换本机记录" : "选择要使用的学习记录"}</h2>
          <p>此浏览器的记录已备份到 user/backups，原浏览器数据仍保留。</p>
          <p>
            {replacing
              ? "导入后，对话、笔记和机器人配置将使用此浏览器的记录。本机原有记录会另存备份，第三方 Harness 会话不会删除。"
              : "本机和此浏览器中都有记录。请选择继续使用本机记录，或导入此浏览器的记录。"}
          </p>
          {replacing ? (
            <>
              <button disabled={busy} onClick={() => void decide("replace")}>
                确认替换
              </button>
              <button disabled={busy} onClick={() => setReplacing(false)}>
                取消
              </button>
            </>
          ) : (
            <>
              <button disabled={busy} onClick={() => void decide("keep")}>
                使用本机记录
              </button>
              <button disabled={busy} onClick={() => setReplacing(true)}>
                导入浏览器记录
              </button>
            </>
          )}
        </>
      ) : failure ? (
        <>
          <p role="alert">
            {failure instanceof LocalServiceError ||
            failure instanceof LocalDataConflictError
              ? failure.message
              : "无法读取或迁移学习记录，原数据已保留。请检查应用版本和浏览器存储权限后重试。"}
          </p>
          <button
            onClick={() => {
              setFailure(null);
              setAttempt((value) => value + 1);
            }}
          >
            重新读取
          </button>
        </>
      ) : (
        <p role="status">正在读取本机记录并检查旧数据…</p>
      )}
    </main>
  );
}
export function useUserStorageStatus() {
  return useSyncExternalStore(
    userStorageStatus.subscribe,
    userStorageStatus.snapshot,
    userStorageStatus.snapshot,
  );
}
