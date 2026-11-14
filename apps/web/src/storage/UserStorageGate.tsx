import { useState, useSyncExternalStore } from "react";
import {
  MigrationRequired,
  resolveMigration,
  userStorageStatus,
} from "./local-service";

/** 记录选择由状态栏按需展开，不再阻止整个工作区打开。 */
export function UserStorageRecovery({
  failure,
  onReload,
}: {
  failure: unknown;
  onReload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [error, setError] = useState("");
  if (!(failure instanceof MigrationRequired)) return null;
  async function decide(decision: "keep" | "replace") {
    if (!(failure instanceof MigrationRequired) || busy) return;
    setBusy(true);
    setError("");
    try {
      await resolveMigration(failure, decision);
      await onReload();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "记录未能读取，请重试。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="选择要使用的记录">
      {replacing && (
        <p>导入将替换当前记录，替换前会备份本机原记录。是否继续？</p>
      )}
      {error && <p role="alert">{error}</p>}
      {replacing ? (
        <>
          <button disabled={busy} onClick={() => void decide("replace")}>
            确认导入
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
    </section>
  );
}

export function useUserStorageStatus() {
  return useSyncExternalStore(
    userStorageStatus.subscribe,
    userStorageStatus.snapshot,
    userStorageStatus.snapshot,
  );
}
