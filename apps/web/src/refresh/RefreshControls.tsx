import { UserStorageRecovery } from "../storage/UserStorageGate";
import { useSyncExternalStore } from "react";
import type { AppData } from "@solvemate/contracts";
import type { DataConflict } from "./merge";
import { ListChecks } from "lucide-react";
import { operations } from "../operations/store";
import { exportOperationDiagnostics } from "../operations/diagnostics";
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
  fontSize: "阅读字号",
  userName: "昵称",
  petName: "宠物名称",
  profileAvatar: "头像",
  profileSignature: "个性签名",
  chatFontSize: "对话字号",
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

function conflictValue(path: string[], value: unknown) {
  if (path.at(-1) === "profileAvatar")
    return typeof value === "string" &&
      value.startsWith("data:image/png;base64,") ? (
      <img src={value} width={56} height={56} alt="头像预览" />
    ) : (
      <span>默认头像</span>
    );
  return <textarea readOnly value={display(value)} />;
}

export function RefreshControls({
  data,
  conflicts,
  onResolve,
  loadFailure,
  readError,
  onRetryRead,
  onRetry,
  onRefresh,
  refreshing,
  needsAttention,
  conflict,
}: {
  data: AppData | null;
  conflicts: DataConflict[];
  onResolve: (index: number, choice: "local" | "remote") => void;
  loadFailure?: unknown;
  readError?: string;
  onRetryRead: () => Promise<void>;
  onRetry: (key?: string) => void;
  onRefresh: () => Promise<boolean>;
  refreshing: boolean;
  conflict: boolean;
  needsAttention: boolean;
}) {
  const snapshot = useSyncExternalStore(
    operations.subscribe,
    operations.snapshot,
    operations.snapshot,
  );
  return (
    <details className={styles.records} open={needsAttention}>
      <summary>
        <ListChecks aria-hidden="true" />
        操作记录
      </summary>
      <div>
        {readError && <p>读取社区内容失败：{readError}</p>}
        {loadFailure instanceof Error &&
          !snapshot.failures.some((item) => item.key === "records:load") && (
            <p>读取学习记录失败：{loadFailure.message}</p>
          )}
        <UserStorageRecovery failure={loadFailure} onReload={onRetryRead} />
        {conflicts.map((item, index) => (
          <section key={JSON.stringify(item.path)}>
            <h3>{titleOf(item.path, data)}</h3>
            <label>
              本页修改
              {conflictValue(item.path, item.local)}
            </label>
            <label>
              最新记录
              {conflictValue(item.path, item.remote)}
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
          <section key={item.id}>
            <header>
              <strong>
                {item.label}失败
                {item.targetName ? ` · ${item.targetName}` : ""}
              </strong>
              <time>
                {new Date(item.finishedAt ?? item.startedAt).toLocaleString()}
              </time>
            </header>
            {item.failures?.length ? (
              <ul>
                {item.failures.map((failure) => (
                  <li key={failure.label}>
                    <span>{failure.label}</span>
                    {failure.message ? `：${failure.message}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p>{item.error}</p>
            )}
            {item.guidance && <p>{item.guidance}</p>}
            {item.key.startsWith("records:") && !conflict && !loadFailure && (
              <button onClick={() => onRetry(item.key)}>重试</button>
            )}
            {item.key === "refresh:data" && (
              <button disabled={refreshing} onClick={() => void onRefresh()}>
                重试刷新
              </button>
            )}
          </section>
        ))}
        {!needsAttention && <p>当前没有未解决的失败操作。</p>}
        {snapshot.diagnostics.length > 0 && (
          <button onClick={exportOperationDiagnostics}>导出诊断日志</button>
        )}
      </div>
    </details>
  );
}
