import { useEffect, useState } from "react";
import { Dialog } from "radix-ui";
import type { AppData } from "@solvemate/contracts";
import type { UnsavedRecord } from "../storage";
import type { DataConflict } from "./merge";
import { useDataRefresh } from "./useDataRefresh";
import { formDrafts, useFormDrafts } from "./drafts";
import { useSaveFeedback } from "../components/SaveFeedback";
import { Check, CircleAlert, LoaderCircle, Pencil } from "lucide-react";
import { recordStatus } from "../status/state";
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
function download(value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "solvemate-unsaved.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function RefreshControls({
  data,
  conflicts,
  recoveries,
  onResolve,
  chatDrafts,
  saveState,
  conflict,
  online,
  errors,
  onRetry,
  onRestoreRecovery,
  detailsOpen,
  onDetailsOpenChange,
  unsavedOpen,
  onUnsavedOpenChange,
}: {
  data: AppData | null;
  conflicts: DataConflict[];
  recoveries: UnsavedRecord[];
  onResolve: (index: number, choice: "local" | "remote") => void;
  chatDrafts: Record<string, string>;
  saveState: "saving" | "saved" | "error";
  conflict: boolean;
  online: boolean;
  errors: string[];
  onRetry: () => void;
  onRestoreRecovery: (id: string) => Promise<boolean>;
  unsavedOpen: boolean;
  onUnsavedOpenChange: (open: boolean) => void;
  detailsOpen: boolean;
  onDetailsOpenChange: (open: boolean) => void;
}) {
  const saved = useSaveFeedback();
  const state = useDataRefresh();
  const drafts = useFormDrafts();
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState("");

  useEffect(() => {
    void formDrafts.restore();
  }, []);
  const hasPending =
    saveState === "error" || conflict || drafts.activeCount > 0;
  const hasRetained = drafts.items.length > 0 || recoveries.length > 0;
  const hasDetails = hasPending || hasRetained;
  const messages = [
    ...new Set([...errors, state.error, drafts.error].filter(Boolean)),
  ];
  const status = recordStatus({
    saveState,
    conflict,
    online,
    unsaved: drafts.activeCount > 0,
    readError: state.error || drafts.error,
  });
  const Icon = status.attention
    ? status.label === "有未保存修改"
      ? Pencil
      : CircleAlert
    : saveState === "saving"
      ? LoaderCircle
      : Check;
  const tone =
    status.label === "有未保存修改"
      ? "active"
      : status.attention
        ? "danger"
        : saveState === "saving"
          ? "active"
          : "neutral";
  const saving = saveState === "saving" && !status.attention;
  const needsRefresh = conflict || !online || !!(state.error || drafts.error);
  const hasActions =
    (saveState === "error" && !conflict) || needsRefresh || hasDetails;
  return (
    <>
      <StatusPopover
        category="记录保存"
        value={status.label}
        icon={Icon}
        tone={tone}
        busy={saving}
        open={detailsOpen}
        onOpenChange={onDetailsOpenChange}
      >
        {conflict && (
          <div
            className={`${statusStyles.alert} ${statusStyles.error}`}
            role="alert"
          >
            存在修改冲突，请选择要保留的内容。
          </div>
        )}
        {messages.map((message) => (
          <div
            className={`${statusStyles.alert} ${status.attention ? statusStyles.error : ""}`}
            key={message}
            role={status.attention ? "alert" : "status"}
          >
            {message}
          </div>
        ))}
        {hasActions && (
          <div className={statusStyles.actions}>
            {saveState === "error" && !conflict && (
              <button className={statusStyles.primary} onClick={onRetry}>
                重试保存
              </button>
            )}
            {needsRefresh && (
              <button
                disabled={state.refreshing}
                onClick={() => void state.refresh(undefined, false, true)}
              >
                {state.refreshing ? "正在刷新…" : "刷新数据"}
              </button>
            )}
            {hasDetails && (
              <button
                className={conflict ? statusStyles.primary : undefined}
                onClick={() => {
                  onDetailsOpenChange(false);
                  onUnsavedOpenChange(true);
                }}
              >
                {conflicts.length
                  ? `处理修改冲突（${conflicts.length} 项）`
                  : hasPending
                    ? "处理未保存内容"
                    : "恢复记录"}
              </button>
            )}
          </div>
        )}
      </StatusPopover>
      <Dialog.Root open={unsavedOpen} onOpenChange={onUnsavedOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.overlay} />
          <Dialog.Content className={styles.dialog}>
            <Dialog.Title>
              {hasPending ? "未保存内容" : "草稿与保存备份"}
            </Dialog.Title>
            <Dialog.Description>
              保存失败的记录可以重新保存；有冲突时选择要保留的内容。未提交的表单需返回编辑窗口保存，提问草稿不会自动发送。
            </Dialog.Description>
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
                    {item.deleted ? "保留备份，移除已删除条目" : "使用最新内容"}
                  </button>
                </div>
              </section>
            ))}
            {restoreError && (
              <p role="alert" className={styles.error}>
                {restoreError}
              </p>
            )}
            {drafts.items.map((item) => (
              <details key={item.id}>
                <summary>{item.title}</summary>
                <textarea
                  aria-label={item.title}
                  readOnly
                  value={display(item.value)}
                />
                <button onClick={() => download(item)}>导出草稿</button>
                {formDrafts.isActive(item.id) && (
                  <button onClick={() => onUnsavedOpenChange(false)}>
                    返回编辑
                  </button>
                )}
              </details>
            ))}
            {Object.entries(chatDrafts)
              .filter(
                ([key, value]) =>
                  !!value && hasPending && data?.drafts?.[key] !== value,
              )
              .map(([key, value]) => (
                <details key={key}>
                  <summary>
                    提问草稿
                    {key.startsWith("conversation:")
                      ? ` · ${data?.conversations.find((item) => `conversation:${item.id}` === key)?.title ?? "原对话"}`
                      : ""}
                  </summary>
                  <textarea
                    aria-label="保留的提问草稿"
                    readOnly
                    value={value}
                  />
                </details>
              ))}
            {recoveries.map((item) => (
              <details key={item.id}>
                <summary>
                  保存失败时保留的记录 ·{" "}
                  {new Date(item.createdAt).toLocaleString()}
                </summary>
                <p>
                  包含当时未保存的修改。重新保存时与当前记录合并，有冲突会要求确认。
                </p>
                <button
                  disabled={
                    restoringId !== null || saveState === "saving" || conflict
                  }
                  onClick={async () => {
                    setRestoringId(item.id);
                    setRestoreError("");
                    try {
                      if (await onRestoreRecovery(item.id)) saved("记录已保存");
                    } catch (error) {
                      setRestoreError(
                        error instanceof Error
                          ? error.message
                          : "记录未能保存，请重试。",
                      );
                    } finally {
                      setRestoringId(null);
                    }
                  }}
                >
                  {restoringId === item.id ? "正在保存…" : "重新保存这份记录"}
                </button>
                <button onClick={() => download(item)}>导出这份记录</button>
              </details>
            ))}
            <div className={styles.actions}>
              {saveState === "error" && !conflict && (
                <button onClick={onRetry}>重试保存</button>
              )}
              <button
                onClick={() =>
                  download({
                    conflicts,
                    recoveries,
                    forms: drafts.items,
                    chatDrafts,
                  })
                }
              >
                导出这些记录
              </button>
              <Dialog.Close>关闭</Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
