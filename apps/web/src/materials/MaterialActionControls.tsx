import { useRef, useState, type ReactElement } from "react";
import { ContextMenu, Dialog } from "radix-ui";
import { FolderInput, Pencil, Trash2 } from "lucide-react";
import type { SubjectDirectory } from "../state/subjects";
import { SettingsSelect } from "../components/SettingsSelect";
import { useSaveFeedback } from "../components/SaveFeedback";
import { useUnsavedForm } from "../refresh/drafts";
import styles from "./MaterialActions.module.css";

export type MaterialAction = "rename" | "move" | "delete";
const labels = { rename: "重命名", move: "移动", delete: "删除" };
const unclassified = "__unclassified__";
function ActionIcon({ action }: { action: MaterialAction }) {
  const Icon =
    action === "rename" ? Pencil : action === "move" ? FolderInput : Trash2;
  return <Icon aria-hidden="true" />;
}

/** 同类资料共用操作界面；存储差异由调用方的资料服务处理。 */
export function MaterialActionMenu({
  children,
  onAction,
  disabled = false,
  listed = true,
  unit = "资料",
}: {
  children: ReactElement;
  onAction: (action: MaterialAction) => void;
  disabled?: boolean;
  listed?: boolean;
  unit?: "资料" | "题目集";
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className={styles.menu}
          collisionPadding={12}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {(["rename", "move", "delete"] as const).map((kind) => {
            return (
              <ContextMenu.Item
                key={kind}
                className={`${styles.menuItem} ${kind === "delete" ? styles.dangerText : ""}`}
                disabled={disabled || (kind !== "rename" && !listed)}
                onSelect={() => onAction(kind)}
              >
                <ActionIcon action={kind} />
                {labels[kind]}
                {unit === "题目集" ? unit : ""}
              </ContextMenu.Item>
            );
          })}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export function MaterialActionDialog({
  action,
  id,
  initialTitle,
  initialSubjectId,
  directory,
  unit = "资料",
  onSubmit,
  onClose: finish,
}: {
  action: MaterialAction;
  id: string;
  initialTitle: string;
  initialSubjectId: string | null;
  directory: SubjectDirectory;
  unit?: "资料" | "题目集";
  onSubmit: (title: string, subjectId: string | null) => Promise<unknown>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [courseId, setCourseId] = useState(initialSubjectId ?? unclassified);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const saved = useSaveFeedback();
  const cancel = useRef<HTMLButtonElement>(null);
  const deleting = action === "delete";
  const release = useUnsavedForm(
    `material:${action}:${id}`,
    !deleting &&
      (title !== initialTitle ||
        courseId !== (initialSubjectId ?? unclassified)),
  );
  const onClose = () => {
    release();
    finish();
  };
  async function submit() {
    if (saving) return;
    if (
      action === "rename" &&
      (!title.trim() || [...title].some((char) => char.charCodeAt(0) < 32))
    ) {
      setError("请输入有效的资料名称，不能包含控制字符。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSubmit(title.trim(), courseId === unclassified ? null : courseId);
      saved(
        action === "rename"
          ? `${unit}已重命名`
          : action === "move"
            ? `${unit}已移动`
            : `${unit}已删除`,
      );
      onClose();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "操作未能完成，请重试。",
      );
      setSaving(false);
    }
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.dialog}
          role={deleting ? "alertdialog" : "dialog"}
          onOpenAutoFocus={(event) => {
            if (deleting) {
              event.preventDefault();
              cancel.current?.focus();
            }
          }}
        >
          <Dialog.Title>
            <ActionIcon action={action} />
            {labels[action]}
            {unit}
          </Dialog.Title>
          <Dialog.Description>
            {deleting
              ? `该${unit}将从列表中删除，文件和历史对话保留。`
              : action === "move"
                ? "选择目标学科。"
                : `修改${unit}名称。`}
          </Dialog.Description>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {action === "rename" && (
              <label>
                {unit}名称
                <input
                  value={title}
                  maxLength={240}
                  disabled={saving}
                  aria-invalid={!!error}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setError("");
                  }}
                />
              </label>
            )}
            {action === "move" && (
              <SettingsSelect
                className={styles.destination}
                label="目标学科"
                value={courseId}
                disabled={saving}
                options={[
                  { value: unclassified, name: "未分类" },
                  ...directory.active.map((subject) => ({
                    value: subject.id,
                    name: subject.title,
                  })),
                ]}
                onValueChange={setCourseId}
              />
            )}
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <div className={styles.actions}>
              <button
                ref={cancel}
                type="button"
                disabled={saving}
                onClick={onClose}
              >
                取消
              </button>
              <button
                type="submit"
                disabled={saving || (action === "rename" && !title.trim())}
                className={deleting ? styles.danger : styles.primary}
              >
                {saving
                  ? deleting
                    ? "正在删除…"
                    : "正在保存…"
                  : deleting
                    ? "确认删除"
                    : action === "move"
                      ? "移动"
                      : "保存"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
