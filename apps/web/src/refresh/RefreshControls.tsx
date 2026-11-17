import { UserStorageRecovery } from "../storage/UserStorageGate";
import { useEffect, useSyncExternalStore } from "react";
import { Dialog } from "radix-ui";
import type { AppData } from "@solvemate/contracts";
import type { DataConflict } from "./merge";
import { useDataRefresh } from "./useDataRefresh";
import { Check, CircleAlert, ListChecks, LoaderCircle } from "lucide-react";
import { operations, operationStatus } from "../operations/store";
import {
  exportOperationDiagnostics,
  retainOperationDiagnostics,
} from "../operations/diagnostics";
import { StatusPopover } from "../status/StatusPopover";
import statusStyles from "../status/StatusBar.module.css";
import styles from "./RefreshControls.module.css";

const labels: Record<string, string> = {
  robots: "机器人",
  conversations: "对话",
  noteLibrary: "笔记",
  notes: "笔记",
  notebooks: "笔记本",
  subjects: "学科",
  settings: "显示设置",
  title: "标题",
  name: "名称",
  prompt: "角色指令",
  content: "内容",
  fontSize: "字号",
  appearance: "外观",
  aiConfig: "AI 配置",
  aiDefaults: "AI 配置",
  defaultRobotId: "默认机器人",
  drafts: "提问草稿",
};
function titleOf(path: string[], data: AppData | null) {
  let current: unknown = data;
  const names: string[] = [];
  for (const part of path) {
    if (part.startsWith("@") && Array.isArray(current)) {
      current = current.find(
        (item: { id: string }) => item.id === part.slice(1),
      );
      const value = current as { title?: string; name?: string } | undefined;
      names.push(value?.title ?? value?.name ?? "已删除的记录");
    } else {
      if (labels[part]) names.push(labels[part]);
      current =
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[part]
          : undefined;
    }
  }
  return names.join(" · ") || "未保存修改";
}
const display = (value: unknown) =>
  value === undefined
    ? "记录已删除"
    : typeof value === "string"
      ? value
      : JSON.stringify(value, null, 2);

export function RefreshControls({
  data,
  conflicts,
  onResolve,
  saveState,
  loadFailure = null,
  loadingRecords = false,
  readError = "",
  onRetryRead,
  onOpenBackup,
  conflict,
  online,
  onRetry,
  detailsOpen,
  onDetailsOpenChange,
  unsavedOpen,
  onUnsavedOpenChange,
}: {
  data: AppData | null;
  conflicts: DataConflict[];
  onResolve: (index: number, choice: "local" | "remote") => void;
  saveState: "saving" | "saved" | "error";
  loadFailure?: unknown;
  loadingRecords?: boolean;
  readError?: string;
  onRetryRead: () => Promise<void>;
  onOpenBackup: () => void;
  conflict: boolean;
  online: boolean;
  onRetry: (key?: string) => void;
  unsavedOpen: boolean;
  onUnsavedOpenChange: (open: boolean) => void;
  detailsOpen: boolean;
  onDetailsOpenChange: (open: boolean) => void;
}) {
  const refresh = useDataRefresh();
  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void retainOperationDiagnostics().then((stop) => {
      if (disposed) stop();
      else unsubscribe = stop;
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);
  const snapshot = useSyncExternalStore(
    operations.subscribe,
    operations.snapshot,
    operations.snapshot,
  );
  const status = operationStatus(snapshot);
  const busy = !status.attention && (status.busy || loadingRecords);
  const label = status.attention ? "操作失败" : busy ? "操作中…" : status.label;
  const result = status.result;
  const text = status.attention
    ? `${result?.label ?? "操作"}失败`
    : busy
      ? `${result?.status === "running" ? result.label : "读取本机数据"}…`
      : result
        ? `${result.label}完成`
        : "暂无正在执行的操作。";
  const needsRead = !!loadFailure || !!readError || !online || !!refresh.error;
  const failedRecords = snapshot.failures.some((item) =>
    item.key.startsWith("records:"),
  );
  const errorText = status.attention ? result?.error : "";
  return (
    <>
      <StatusPopover
        category="操作状态"
        value={label}
        status={text}
        icon={status.attention ? CircleAlert : busy ? LoaderCircle : Check}
        tone={status.attention ? "danger" : busy ? "active" : "neutral"}
        busy={busy}
        open={detailsOpen}
        onOpenChange={onDetailsOpenChange}
      >
        {result?.targetName && <p>{result.targetName}</p>}
        {result?.failures?.length ? (
          <ul>
            {result.failures.map((failure) => (
              <li key={failure.label}>{failure.label}</li>
            ))}
          </ul>
        ) : (
          errorText && <p role="alert">{errorText}</p>
        )}
        {status.attention && result?.guidance && <p>{result.guidance}</p>}
        <UserStorageRecovery failure={loadFailure} onReload={onRetryRead} />
        <div className={statusStyles.actions}>
          {(saveState === "error" || failedRecords) &&
            result?.key.startsWith("records:") &&
            !conflict &&
            !loadFailure && (
              <button
                className={statusStyles.primary}
                onClick={() => onRetry(result?.key)}
              >
                重试
              </button>
            )}
          {needsRead && (
            <button
              disabled={refresh.refreshing || loadingRecords}
              onClick={() => {
                void refresh.refresh(undefined, false, true);
              }}
            >
              重新读取
            </button>
          )}
          {conflict && (
            <button
              className={statusStyles.primary}
              onClick={() => {
                onDetailsOpenChange(false);
                onUnsavedOpenChange(true);
              }}
            >
              处理修改冲突
            </button>
          )}
          {!!loadFailure && online && (
            <button onClick={onOpenBackup}>备份与恢复</button>
          )}
          <button
            onClick={() => {
              onDetailsOpenChange(false);
              onUnsavedOpenChange(true);
            }}
          >
            查看详情
          </button>
        </div>
      </StatusPopover>
      <Dialog.Root open={unsavedOpen} onOpenChange={onUnsavedOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.overlay} />
          <Dialog.Content className={styles.dialog}>
            <header className={styles.header}>
              <Dialog.Title>
                <ListChecks aria-hidden="true" />
                {conflicts.length ? "处理修改冲突" : "操作详情"}
              </Dialog.Title>
              <Dialog.Description>
                {conflicts.length
                  ? "同一内容在其他窗口发生了修改，请选择要保留的内容。"
                  : "当前未解决的失败操作，重试成功后自动移除。"}
              </Dialog.Description>
            </header>
            <div
              className={styles.records}
              role="region"
              aria-label="操作详情列表"
              tabIndex={0}
            >
              {conflicts.map((item, index) => (
                <section key={JSON.stringify(item.path)}>
                  <h3>{titleOf(item.path, data)}</h3>
                  <label>
                    本页修改
                    <textarea readOnly value={display(item.local)} />
                  </label>
                  <label>
                    最新记录
                    <textarea readOnly value={display(item.remote)} />
                  </label>
                  <div className={styles.actions}>
                    {!item.deleted && (
                      <button onClick={() => onResolve(index, "local")}>
                        保留本页修改
                      </button>
                    )}
                    <button onClick={() => onResolve(index, "remote")}>
                      {item.deleted ? "确认条目已删除" : "使用最新内容"}
                    </button>
                  </div>
                </section>
              ))}
              {snapshot.failures.map((item) => (
                <details key={item.id}>
                  <summary>
                    <span>
                      {item.label}失败
                      {item.targetName ? ` · ${item.targetName}` : ""}
                    </span>
                    <time>
                      {new Date(
                        item.finishedAt ?? item.startedAt,
                      ).toLocaleString()}
                    </time>
                  </summary>
                  {item.targetName && <p>{item.targetName}</p>}
                  {item.failures?.length ? (
                    <ul>
                      {item.failures.map((failure) => (
                        <li key={failure.label}>
                          <strong>{failure.label}</strong>
                          {failure.message ? `：${failure.message}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>{item.error}</p>
                  )}
                  {item.guidance && <p>{item.guidance}</p>}
                  {item.key.startsWith("records:") &&
                    !conflict &&
                    !loadFailure && (
                      <button onClick={() => onRetry(item.key)}>重试</button>
                    )}
                  {item.key === "refresh:data" && (
                    <button
                      disabled={refresh.refreshing}
                      onClick={() =>
                        void refresh.refresh(undefined, false, true)
                      }
                    >
                      重试刷新
                    </button>
                  )}
                </details>
              ))}
              {!conflicts.length && !snapshot.failures.length && (
                <p>当前没有未解决的失败操作。</p>
              )}
            </div>
            <footer className={`${styles.actions} ${styles.footer}`}>
              {snapshot.diagnostics.length > 0 && (
                <button onClick={exportOperationDiagnostics}>
                  导出诊断日志
                </button>
              )}
              <Dialog.Close>关闭</Dialog.Close>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
