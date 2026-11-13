import { PopoverPanel } from "./PopoverPanel";
import { useState, type ReactElement } from "react";
import { AlertDialog, ContextMenu, DropdownMenu, Popover } from "radix-ui";
import {
  CircleAlert,
  Archive,
  ArchiveRestore,
  Tag,
  Trash2,
  Check,
  Pencil,
} from "lucide-react";
import type { Conversation } from "@solvemate/contracts";
import type { ConversationChange } from "../state/conversations";
import { useEditValue } from "../refresh/useEditRevision";
import { useDraftBackup } from "../refresh/drafts";
import styles from "./ConversationActions.module.css";

export interface ConversationActionsProps {
  conversations: Conversation[];
  onUpdate: (
    id: string,
    change: ConversationChange,
    revision?: number,
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}
const presetLabels = ["重要", "一般", "无标签"];

/** 列表右键和聊天栏入口共用菜单、编辑表单、删除确认与版本检查。 */
export function ConversationActions({
  conversation,
  conversations,
  onUpdate,
  onDelete,
  children,
  kind = "dropdown",
}: ConversationActionsProps & {
  conversation: Conversation;
  children: ReactElement;
  kind?: "context" | "dropdown";
}) {
  const Menu = kind === "context" ? ContextMenu : DropdownMenu;
  const [panel, setPanel] = useState<"rename" | "label" | "error" | null>(null);
  const [customLabel, setCustomLabel] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [labelError, setLabelError] = useState("");
  const [renameTitle, setRenameTitle] = useState("");
  const [renameOriginal, setRenameOriginal] = useState<string | undefined>();
  const checkRename = useEditValue(
    renameOriginal,
    conversation.title,
    conversation.id,
  );
  const [renameError, setRenameError] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [actionError, setActionError] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const releaseRename = useDraftBackup(
    `conversation-name:${conversation.id}`,
    "对话名称草稿",
    { title: renameTitle },
    panel === "rename" && renameTitle !== conversation.title,
  );
  const releaseLabel = useDraftBackup(
    `conversation-label:${conversation.id}`,
    "对话标签草稿",
    { label: customLabel },
    panel === "label" && !!customLabel,
  );
  const customLabels =
    panel === "label"
      ? [
          ...new Set(
            conversations
              .filter((item) => item.status !== "deleted")
              .map((item) => item.label)
              .filter(
                (value): value is string =>
                  !!value && !presetLabels.includes(value),
              ),
          ),
        ]
      : [];
  const label = conversation.label || "无标签";
  const busy = renameSaving || updating;
  async function setLabel(value: string) {
    if (busy) return;
    setUpdating(true);
    setLabelError("");
    try {
      await onUpdate(conversation.id, { label: value }, conversation.revision);
      releaseLabel();
      setPanel(null);
    } catch (error) {
      setLabelError(error instanceof Error ? error.message : "标签未能保存。");
    } finally {
      setUpdating(false);
    }
  }
  async function toggleArchive() {
    if (busy) return;
    setUpdating(true);
    try {
      await onUpdate(
        conversation.id,
        {
          status: conversation.status === "archived" ? "active" : "archived",
        },
        conversation.revision,
      );
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "对话状态未能保存，请重试。",
      );
      setPanel("error");
    } finally {
      setUpdating(false);
    }
  }
  return (
    <>
      <Popover.Root
        open={panel !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setPanel(null);
        }}
      >
        <Menu.Root modal={false}>
          <Menu.Trigger asChild>
            <Popover.Anchor asChild>{children}</Popover.Anchor>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content
              className={styles.menu}
              onCloseAutoFocus={(event) => {
                if (panel || deleteOpen) event.preventDefault();
              }}
            >
              <Menu.Item
                className={styles.menuItem}
                disabled={busy}
                onSelect={() => {
                  setRenameTitle(conversation.title);
                  setRenameOriginal(conversation.title);
                  checkRename.accept(conversation.title);
                  setRenameError("");
                  setPanel("rename");
                }}
              >
                <Pencil aria-hidden="true" />
                重命名
              </Menu.Item>
              <Menu.Item
                className={styles.menuItem}
                disabled={busy}
                onSelect={() => {
                  setCustomLabel(presetLabels.includes(label) ? "" : label);
                  setCustomOpen(false);
                  setLabelError("");
                  setPanel("label");
                }}
              >
                <Tag aria-hidden="true" />
                标签
              </Menu.Item>
              <Menu.Item
                className={styles.menuItem}
                disabled={busy}
                onSelect={() => void toggleArchive()}
              >
                {conversation.status === "archived" ? (
                  <ArchiveRestore aria-hidden="true" />
                ) : (
                  <Archive aria-hidden="true" />
                )}
                {conversation.status === "archived" ? "移回进行中" : "归档"}
              </Menu.Item>
              <Menu.Separator className={styles.separator} />
              <Menu.Item
                className={`${styles.menuItem} ${styles.delete}`}
                disabled={busy}
                onSelect={() => setDeleteOpen(true)}
              >
                <Trash2 aria-hidden="true" />
                删除
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
        <Popover.Portal>
          <PopoverPanel
            title={
              panel === "rename"
                ? "重命名对话"
                : panel === "label"
                  ? "标签"
                  : "对话操作失败"
            }
            icon={
              panel === "rename"
                ? Pencil
                : panel === "label"
                  ? Tag
                  : CircleAlert
            }
            width={panel === "rename" ? 280 : 240}
            side={
              kind === "dropdown" || panel === "rename" ? "bottom" : "right"
            }
            align="start"
            sideOffset={10}
            collisionPadding={12}
            aria-label={
              panel === "rename"
                ? "重命名对话"
                : panel === "label"
                  ? "对话标签"
                  : "对话操作失败"
            }
          >
            {panel === "rename" ? (
              <>
                <form
                  className={styles.renameForm}
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (busy) return;
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
                      setPanel(null);
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
                      disabled={busy}
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
                      disabled={busy}
                      onClick={() => {
                        releaseRename();
                        setPanel(null);
                      }}
                    >
                      取消
                    </button>
                    <button type="submit" disabled={busy}>
                      {renameSaving ? "保存中…" : "保存"}
                    </button>
                  </div>
                </form>
              </>
            ) : panel === "label" ? (
              <>
                <div className={styles.labelOptions}>
                  {[...presetLabels, ...customLabels].map((option) => (
                    <button
                      key={option}
                      disabled={busy}
                      aria-pressed={label === option}
                      onClick={() => void setLabel(option)}
                    >
                      <span>{option}</span>
                      {label === option && <Check aria-hidden="true" />}
                    </button>
                  ))}
                </div>
                <button
                  className={styles.customTrigger}
                  disabled={busy}
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
                      void setLabel(value);
                    }}
                  >
                    <label>
                      标签名称
                      <input
                        autoFocus
                        value={customLabel}
                        disabled={busy}
                        maxLength={24}
                        onChange={(event) => {
                          setCustomLabel(event.target.value);
                          setLabelError("");
                        }}
                      />
                    </label>
                    <button type="submit" disabled={busy}>
                      保存标签
                    </button>
                  </form>
                )}
                {labelError && (
                  <p className={styles.delete} role="alert">
                    {labelError}
                  </p>
                )}
              </>
            ) : (
              <p className={styles.delete} role="alert">
                {actionError}
              </p>
            )}
          </PopoverPanel>
        </Popover.Portal>
      </Popover.Root>
      {deleteOpen && (
        <DeleteConversationDialog
          conversationId={conversation.id}
          onDelete={onDelete}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </>
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
