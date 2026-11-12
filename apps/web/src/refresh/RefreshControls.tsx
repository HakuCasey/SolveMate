import { useEffect, useState } from "react";
import { Dialog } from "radix-ui";
import type { AppData } from "@solvemate/contracts";
import type { UnsavedRecord } from "../storage";
import type { DataConflict } from "./merge";
import { useDataRefresh } from "./useDataRefresh";
import { formDrafts, useFormDrafts } from "./drafts";
import { dataRefresh } from "./coordinator";
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
  defaultRobotId: "默认教师",
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
}: {
  data: AppData | null;
  conflicts: DataConflict[];
  recoveries: UnsavedRecord[];
  onResolve: (index: number, choice: "local" | "remote") => void;
  chatDrafts: Record<string, string>;
}) {
  const state = useDataRefresh();
  const drafts = useFormDrafts();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void formDrafts.restore();
  }, []);
  const hasDrafts =
    !!drafts.items.length ||
    !!recoveries.length ||
    !!conflicts.length ||
    Object.values(chatDrafts).some(Boolean);
  return (
    <>
      <span className={styles.controls} aria-label="数据刷新">
        {(state.error || state.notice || drafts.error) && (
          <span role={state.error || drafts.error ? "alert" : "status"}>
            {state.error || drafts.error || state.notice}
          </span>
        )}
        {state.notice && !state.error && (
          <button
            aria-label="关闭数据变更提示"
            onClick={dataRefresh.clearNotice}
          >
            ×
          </button>
        )}
        <button
          disabled={state.refreshing}
          onClick={() => void state.refresh(undefined, false, true)}
        >
          {state.refreshing ? "正在刷新数据…" : "刷新数据"}
        </button>
        {hasDrafts && (
          <button onClick={() => setOpen(true)}>
            {conflicts.length
              ? `未保存内容（${conflicts.length} 项冲突）`
              : "未保存内容"}
          </button>
        )}
      </span>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.overlay} />
          <Dialog.Content className={styles.dialog}>
            <Dialog.Title>未保存内容</Dialog.Title>
            <Dialog.Description>
              刷新数据会保留输入。存在冲突时，请核对后选择要使用的内容；导出可保留完整副本。
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
            {drafts.items.map((item) => (
              <details key={item.id}>
                <summary>{item.title}</summary>
                <textarea
                  aria-label={item.title}
                  readOnly
                  value={display(item.value)}
                />
              </details>
            ))}
            {Object.entries(chatDrafts)
              .filter(([, value]) => !!value)
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
                <p>包含当时的对话、配置和其他修改，可导出完整内容。</p>
                <button onClick={() => download(item)}>导出这份记录</button>
              </details>
            ))}
            <div className={styles.actions}>
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
                导出未保存内容
              </button>
              <Dialog.Close>关闭</Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
