import type { TeachingTool } from "@solvemate/contracts";
import { RenameDialog } from "../components/RenameDialog";
import { toolTitle } from "./state";
import { ToolChoiceDialog } from "./ToolChoiceDialog";
import { useState } from "react";
import { Dialog, ContextMenu } from "radix-ui";
import { Wrench, RefreshCw, Trash2, Pencil } from "lucide-react";
import type { TeachingTools } from "./useTeachingTools";
import styles from "../components/ContentManager.module.css";
import menu from "../materials/MaterialActions.module.css";

export function OfficialTools({
  tools,
  onUse,
}: {
  tools: TeachingTools;
  onUse: () => void;
}) {
  const [renaming, setRenaming] = useState<TeachingTool | null>(null);
  const [choice, setChoice] = useState<TeachingTool | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  // 离线时仍显示已安装工具；是否安装始终从本地工具目录读取。
  const catalog = [
    ...tools.remote,
    ...tools.items
      .filter(
        (t) =>
          t.source === "official" && !tools.remote.some((r) => r.id === t.id),
      )
      .map((t) => ({
        id: t.id,
        title: toolTitle(t),
        description: t.description,
        updatedAt: t.updatedAt,
        latest_version: t.version ?? "",
      })),
  ];
  return (
    <>
      {renaming && (
        <RenameDialog
          name={toolTitle(renaming)}
          maxLength={80}
          onSave={(title) =>
            tools.rename(renaming.id, title, toolTitle(renaming))
          }
          onClose={() => setRenaming(null)}
        />
      )}
      {choice && (
        <ToolChoiceDialog
          original={choice}
          tools={tools}
          onClose={() => setChoice(null)}
          onUsed={onUse}
        />
      )}
      <h2 className={styles.sectionTitle}>教研工具</h2>
      {tools.error && (
        <p className={styles.notice} role="alert">
          {tools.error}
        </p>
      )}
      {!catalog.length && !tools.error && (
        <p className={styles.notice}>
          {tools.checking
            ? "正在读取工具目录…"
            : "工具目录暂不可用，可点击检查内容更新重试。"}
        </p>
      )}
      <div className={styles.list}>
        {catalog.map((entry) => {
          const installed = tools.items.find(
            (t) => t.id === entry.id && t.source === "official",
          );
          const title = installed ? toolTitle(installed) : entry.title;
          const remote = tools.remote.find((t) => t.id === entry.id);
          const update =
            !!installed &&
            !!remote &&
            installed.version !== remote.latest_version;
          return (
            <ContextMenu.Root key={entry.id}>
              <ContextMenu.Trigger asChild>
                <article className={styles.card} aria-label={title}>
                  <div className={styles.cardTitle}>
                    <span className={styles.icon}>
                      <Wrench />
                    </span>
                    <h2 title={title}>
                      <span className={styles.titleText}>{title}</span>
                      {update && (
                        <span
                          className={styles.updateNotice}
                          title="有新版可更新"
                          aria-label="有新版可更新"
                        >
                          <RefreshCw aria-hidden="true" />
                          <span className={styles.updateLabel}>
                            有新版可更新
                          </span>
                        </span>
                      )}
                    </h2>
                    <div className={styles.actions}>
                      {installed && (
                        <button
                          className={styles.primary}
                          disabled={!!tools.busy}
                          onClick={() => setChoice(structuredClone(installed))}
                        >
                          使用
                        </button>
                      )}
                      {(!installed || update) && (
                        <button
                          className={
                            installed ? styles.secondary : styles.primary
                          }
                          disabled={!!tools.busy || !remote}
                          onClick={() => {
                            if (remote)
                              void tools.download(remote).catch(() => {});
                          }}
                        >
                          {tools.busy === entry.id
                            ? "正在下载…"
                            : installed
                              ? "更新"
                              : "下载"}
                        </button>
                      )}
                    </div>
                  </div>
                  <p className={styles.description} title={entry.description}>
                    {entry.description}
                  </p>
                  <p className={styles.date}>
                    {installed
                      ? `更新日期 ${new Date(installed.updatedAt).toLocaleDateString()}`
                      : "尚未下载"}
                  </p>
                </article>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Content
                  className={menu.menu}
                  collisionPadding={12}
                >
                  <ContextMenu.Item
                    className={menu.menuItem}
                    disabled={!installed || !!tools.busy}
                    onSelect={() => {
                      if (installed) setRenaming(structuredClone(installed));
                    }}
                  >
                    <Pencil />
                    重命名
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    className={`${menu.menuItem} ${menu.dangerText}`}
                    disabled={!installed || !!tools.busy}
                    onSelect={() => setDeleting(entry.id)}
                  >
                    <Trash2 />
                    删除
                  </ContextMenu.Item>
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          );
        })}
      </div>
      <Dialog.Root
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !tools.busy) setDeleting(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={menu.overlay} />
          <Dialog.Content className={menu.dialog}>
            <Dialog.Title>删除社区工具</Dialog.Title>
            <Dialog.Description>
              该工具将从列表中删除，已有对话保留。可从社区内容中重新下载。
            </Dialog.Description>
            {tools.error && <p role="alert">{tools.error}</p>}
            <div className={menu.actions}>
              <button disabled={!!tools.busy} onClick={() => setDeleting(null)}>
                取消
              </button>
              <button
                disabled={!!tools.busy}
                onClick={() => {
                  if (deleting)
                    void tools
                      .remove(deleting)
                      .then(() => setDeleting(null))
                      .catch(() => {});
                }}
              >
                删除
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
