import type { LearningRelations } from "../reading/relations";
import { useEditValue } from "../refresh/useEditRevision";
import { useDraftBackup } from "../refresh/drafts";
import { useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  MessagesSquare,
  SquarePen,
  Tag,
  Trash2,
  Check,
  Pencil,
  CornerUpLeft,
} from "lucide-react";
import { AlertDialog, ContextMenu, Popover } from "radix-ui";
import type { Conversation, Robot } from "@solvemate/contracts";
import type { ConversationChange } from "../state/conversations";
import styles from "./ConversationList.module.css";
import { PaneHeader } from "./PaneHeader";

interface Props {
  relations: LearningRelations;
  conversations: Conversation[];
  robots: Robot[];
  activeId: string | null;
  onOpen: (conversation: Conversation) => void;
  onReturn: (conversation: Conversation) => void;
  onNew: () => void;
  onUpdate: (
    id: string,
    change: ConversationChange,
    revision?: number,
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const presetLabels = ["重要", "一般", "无标签"];

export function ConversationList({
  relations,
  conversations,
  robots,
  activeId,
  onOpen,
  onReturn,
  onNew,
  onUpdate,
  onDelete,
}: Props) {
  const [activeOpen, setActiveOpen] = useState(true);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [labelTarget, setLabelTarget] = useState<string | null>(null);
  const [customLabel, setCustomLabel] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [labelError, setLabelError] = useState("");
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameOriginal, setRenameOriginal] = useState<string | undefined>();
  const checkRename = useEditValue(
    renameOriginal,
    conversations.find(
      (item) => item.id === renameTarget && item.status !== "deleted",
    )?.title,
    renameTarget ?? "none",
  );
  const [renameError, setRenameError] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const releaseRename = useDraftBackup(
    `conversation-name:${renameTarget ?? "none"}`,
    "对话名称草稿",
    { title: renameTitle },
    !!renameTarget &&
      renameTitle !==
        conversations.find((item) => item.id === renameTarget)?.title,
  );
  useDraftBackup(
    `conversation-label:${labelTarget ?? "none"}`,
    "对话标签草稿",
    { label: customLabel },
    !!labelTarget && !!customLabel,
  );
  const customLabels = [
    ...new Set(
      conversations
        .map((item) => item.label)
        .filter(
          (label): label is string => !!label && !presetLabels.includes(label),
        ),
    ),
  ];

  async function setLabel(id: string, label: string) {
    try {
      await onUpdate(
        id,
        { label },
        conversations.find((item) => item.id === id)?.revision,
      );
      setLabelTarget(null);
    } catch (error) {
      setLabelError(error instanceof Error ? error.message : "标签未能保存。");
    }
  }

  function renderItem(conversation: Conversation) {
    const source = conversation.material ?? conversation.selection;
    const context = source ? relations.material(source).context : "普通对话";
    // 直接显示最近一次提问的原文，省略只由样式处理，不生成或保存摘要。
    const lastQuestion =
      conversation.messages.filter((item) => item.role === "user").at(-1)
        ?.content ?? "还没有提问";
    const label = conversation.label || "无标签";
    const renaming = renameTarget === conversation.id;
    return (
      <Popover.Root
        key={conversation.id}
        open={labelTarget === conversation.id || renaming}
        onOpenChange={(open) => {
          if (!open && !renameSaving) {
            setLabelTarget(null);
            setRenameTarget(null);
          }
        }}
      >
        <ContextMenu.Root>
          <ContextMenu.Trigger asChild>
            <Popover.Anchor asChild>
              <div
                className={styles.item}
                data-active={conversation.id === activeId}
              >
                <button
                  className={styles.openItem}
                  aria-label={conversation.title}
                  aria-pressed={conversation.id === activeId}
                  onClick={() => onOpen(conversation)}
                >
                  <span className={styles.icon}>
                    <MessagesSquare aria-hidden="true" />
                  </span>
                  <span className={styles.copy}>
                    <span className={styles.titleRow}>
                      <strong>{conversation.title}</strong>
                      <span
                        className={styles.label}
                        data-important={label === "重要"}
                      >
                        {label}
                      </span>
                    </span>
                    <small
                      className={styles.details}
                      title={`${context} · ${lastQuestion}`}
                    >
                      <span className={styles.context}>{context}</span>
                      <span aria-hidden="true">·</span>
                      <span className={styles.preview}>{lastQuestion}</span>
                    </small>
                  </span>
                </button>
                {conversation.status === "active" && (
                  <button
                    className={styles.returnButton}
                    aria-label={`返回对话：${conversation.title}`}
                    onClick={() => onReturn(conversation)}
                  >
                    <CornerUpLeft aria-hidden="true" />
                    返回对话
                  </button>
                )}
              </div>
            </Popover.Anchor>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content
              className={styles.menu}
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <ContextMenu.Item
                className={styles.menuItem}
                disabled={renameSaving}
                onSelect={() => {
                  setLabelTarget(null);
                  setRenameTitle(conversation.title);
                  setRenameOriginal(conversation.title);
                  checkRename.accept(conversation.title);
                  setRenameError("");
                  setRenameTarget(conversation.id);
                }}
              >
                <Pencil aria-hidden="true" />
                重命名
              </ContextMenu.Item>
              <ContextMenu.Item
                className={styles.menuItem}
                onSelect={() => {
                  setRenameTarget(null);
                  setCustomLabel(presetLabels.includes(label) ? "" : label);
                  setCustomOpen(false);
                  setLabelError("");
                  setLabelTarget(conversation.id);
                }}
              >
                <Tag aria-hidden="true" />
                标签
              </ContextMenu.Item>
              <ContextMenu.Item
                className={styles.menuItem}
                onSelect={() => {
                  void onUpdate(
                    conversation.id,
                    {
                      status:
                        conversation.status === "archived"
                          ? "active"
                          : "archived",
                    },
                    conversation.revision,
                  ).catch((error) => setLabelError(String(error)));
                }}
              >
                {conversation.status === "archived" ? (
                  <ArchiveRestore aria-hidden="true" />
                ) : (
                  <Archive aria-hidden="true" />
                )}
                {conversation.status === "archived" ? "移回进行中" : "归档"}
              </ContextMenu.Item>
              <ContextMenu.Separator className={styles.separator} />
              <ContextMenu.Item
                className={`${styles.menuItem} ${styles.delete}`}
                onSelect={() => {
                  setDeleteTarget(conversation.id);
                }}
              >
                <Trash2 aria-hidden="true" />
                删除
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
        <Popover.Portal>
          <Popover.Content
            className={`${styles.popover} ${renaming ? styles.renamePopover : ""}`}
            side={renaming ? "bottom" : "right"}
            align="start"
            sideOffset={10}
            collisionPadding={12}
            aria-label={renaming ? "重命名对话" : "对话标签"}
          >
            {renaming ? (
              <>
                <h3>重命名对话</h3>
                <form
                  className={styles.renameForm}
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (renameSaving) return;
                    const title = renameTitle.trim();
                    if (!title) {
                      setRenameError("请输入对话名称。");
                      return;
                    }
                    setRenameSaving(true);
                    try {
                      checkRename();
                      await onUpdate(
                        conversation.id,
                        { title },
                        conversation.revision,
                      );
                      releaseRename();
                      setRenameTarget(null);
                    } catch (error) {
                      setRenameError(
                        error instanceof Error
                          ? error.message
                          : "名称未能保存。",
                      );
                    } finally {
                      setRenameSaving(false);
                    }
                  }}
                >
                  <label>
                    对话名称
                    <input
                      value={renameTitle}
                      disabled={renameSaving}
                      maxLength={100}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => {
                        setRenameTitle(event.target.value);
                        setRenameError("");
                      }}
                      aria-invalid={!!renameError}
                    />
                  </label>
                  {renameError && <p role="alert">{renameError}</p>}
                  <div className={styles.renameActions}>
                    <button
                      type="button"
                      disabled={renameSaving}
                      onClick={() => setRenameTarget(null)}
                    >
                      取消
                    </button>
                    <button type="submit" disabled={renameSaving}>
                      {renameSaving ? "保存中…" : "保存"}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <h3>标签</h3>
                <div className={styles.labelOptions}>
                  {[...presetLabels, ...customLabels].map((option) => (
                    <button
                      key={option}
                      aria-pressed={label === option}
                      onClick={() => setLabel(conversation.id, option)}
                    >
                      <span>{option}</span>
                      {label === option && <Check aria-hidden="true" />}
                    </button>
                  ))}
                </div>
                <button
                  className={styles.customTrigger}
                  aria-expanded={customOpen}
                  onClick={() => setCustomOpen(!customOpen)}
                >
                  自定义标签
                </button>
                {customOpen && (
                  <form
                    className={styles.customForm}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const value = customLabel.trim();
                      if (!value) {
                        setLabelError("请输入标签名称。");
                        return;
                      }
                      setLabel(conversation.id, value);
                    }}
                  >
                    <label>
                      标签名称
                      <input
                        autoFocus
                        value={customLabel}
                        maxLength={24}
                        onChange={(event) => {
                          setCustomLabel(event.target.value);
                          setLabelError("");
                        }}
                      />
                    </label>
                    {labelError && <p role="alert">{labelError}</p>}
                    <button type="submit">保存标签</button>
                  </form>
                )}
              </>
            )}
            <Popover.Arrow className={styles.arrow} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  const active = conversations
    .filter((item) => item.status === "active")
    .toSorted(
      (a, b) =>
        (b.lastActivityAt ?? b.createdAt ?? 0) -
        (a.lastActivityAt ?? a.createdAt ?? 0),
    );
  const archived = conversations.filter((item) => item.status === "archived");
  return (
    <section className={styles.library} aria-label="会话列表">
      <PaneHeader
        icon={MessagesSquare}
        title="对话"
        detail={`${conversations.length} 个会话`}
        actions={
          <button type="button" disabled={!robots.length} onClick={onNew}>
            <SquarePen aria-hidden="true" />
            新建对话
          </button>
        }
      />
      {labelError && !labelTarget && <p role="alert">{labelError}</p>}
      {/* 两组分别滚动，归档入口不会被进行中的条目推到窗口外。 */}
      <div className={styles.groups}>
        <section
          className={`${styles.group} ${styles.activeGroup}`}
          data-open={activeOpen}
        >
          <button
            className={styles.groupHeading}
            aria-expanded={activeOpen}
            aria-controls="active-conversations"
            onClick={() => setActiveOpen(!activeOpen)}
          >
            <ChevronDown aria-hidden="true" />
            <span>进行中</span>
            <small>{active.length}</small>
          </button>
          <div
            className={styles.list}
            id="active-conversations"
            hidden={!activeOpen}
          >
            {active.length ? (
              active.map(renderItem)
            ) : (
              <p className={styles.empty}>暂无进行中的对话</p>
            )}
          </div>
        </section>
        <section
          className={`${styles.group} ${styles.archivedGroup}`}
          data-open={archivedOpen}
        >
          <button
            className={styles.groupHeading}
            aria-expanded={archivedOpen}
            aria-controls="archived-conversations"
            onClick={() => setArchivedOpen(!archivedOpen)}
          >
            <ChevronDown aria-hidden="true" />
            <span>已归档</span>
            <small>{archived.length}</small>
          </button>
          <div
            className={styles.list}
            id="archived-conversations"
            hidden={!archivedOpen}
          >
            {archived.length ? (
              archived.map(renderItem)
            ) : (
              <p className={styles.empty}>暂无已归档的对话</p>
            )}
          </div>
        </section>
      </div>
      {deleteTarget && (
        <DeleteConversationDialog
          key={deleteTarget}
          conversationId={deleteTarget}
          onDelete={onDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </section>
  );
}

function DeleteConversationDialog({
  conversationId,
  onDelete,
  onClose,
}: {
  conversationId: string;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  return (
    <AlertDialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !deleting) onClose();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={styles.dialogOverlay} />
        <AlertDialog.Content className={styles.deleteDialog}>
          <AlertDialog.Title>删除对话</AlertDialog.Title>
          <AlertDialog.Description>
            当前操作仅删除本对话记录，原会话仍可在第三方 AI Harness 软件中查看。
          </AlertDialog.Description>
          {error && (
            <p className={styles.delete} role="alert">
              {error}
            </p>
          )}
          <div className={styles.dialogActions}>
            <AlertDialog.Cancel disabled={deleting}>取消</AlertDialog.Cancel>
            <AlertDialog.Action
              className={styles.confirmDelete}
              disabled={deleting}
              onClick={async (event) => {
                event.preventDefault();
                if (deleting) return;
                setDeleting(true);
                setError("");
                try {
                  await onDelete(conversationId);
                  onClose();
                } catch (failure) {
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : "删除失败，请重试。",
                  );
                  setDeleting(false);
                }
              }}
            >
              {deleting ? "正在删除…" : "删除对话"}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
