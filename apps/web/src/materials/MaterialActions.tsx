import { useRef, useState, type ReactElement } from "react";
import { ContextMenu, Dialog } from "radix-ui";
import { FolderInput, Pencil, Trash2 } from "lucide-react";
import type { Material } from "@solvemate/contracts";
import type { SubjectDirectory } from "../state/subjects";
import { materialCourse } from "../reading/library";
import { SettingsSelect } from "../components/SettingsSelect";
import { useSaveFeedback } from "../components/SaveFeedback";
import type { PersonalMaterials } from "./useMaterials";
import styles from "./MaterialActions.module.css";

type Action = "rename" | "move" | "delete";
const labels = { rename: "重命名", move: "移动", delete: "删除" };
const unclassified = "__unclassified__";

export function MaterialActions({
  item,
  directory,
  library,
  children,
}: {
  item: Material;
  directory: SubjectDirectory;
  library: PersonalMaterials;
  children: ReactElement;
}) {
  // 打开窗口时保留修订号，后台处理或其他页面的更新不能绕过冲突检查。
  const [action, setAction] = useState<{ kind: Action; item: Material } | null>(
    null,
  );
  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content
            className={styles.menu}
            collisionPadding={12}
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            {(["rename", "move", "delete"] as const).map((kind) => {
              const Icon =
                kind === "rename"
                  ? Pencil
                  : kind === "move"
                    ? FolderInput
                    : Trash2;
              return (
                <ContextMenu.Item
                  key={kind}
                  className={`${styles.menuItem} ${kind === "delete" ? styles.dangerText : ""}`}
                  disabled={!!action}
                  onSelect={() => setAction({ kind, item })}
                >
                  <Icon aria-hidden="true" />
                  {labels[kind]}
                </ContextMenu.Item>
              );
            })}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {action && (
        <MaterialActionDialog
          action={action}
          directory={directory}
          library={library}
          onClose={() => setAction(null)}
        />
      )}
    </>
  );
}

function MaterialActionDialog({
  action,
  directory,
  library,
  onClose,
}: {
  action: { kind: Action; item: Material };
  directory: SubjectDirectory;
  library: PersonalMaterials;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(action.item.title);
  const [courseId, setCourseId] = useState(
    materialCourse(action.item, directory) ?? unclassified,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const saved = useSaveFeedback();
  const cancel = useRef<HTMLButtonElement>(null);
  const deleting = action.kind === "delete";
  async function submit() {
    if (saving) return;
    if (
      action.kind === "rename" &&
      (!title.trim() || [...title].some((char) => char.charCodeAt(0) < 32))
    ) {
      setError("请输入有效的资料名称，不能包含控制字符。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (action.kind === "rename")
        await library.rename(action.item, title.trim());
      else if (action.kind === "move")
        await library.assignCourse(
          action.item,
          courseId === unclassified ? null : courseId,
        );
      else await library.remove(action.item);
      saved(
        action.kind === "rename"
          ? "资料已重命名"
          : action.kind === "move"
            ? "资料已移动"
            : "资料已删除",
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
          <Dialog.Title>{labels[action.kind]}资料</Dialog.Title>
          <Dialog.Description>
            {deleting
              ? "该资料将从列表中删除，文件和历史对话保留。"
              : action.kind === "move"
                ? "选择目标学科。"
                : "修改资料名称。"}
          </Dialog.Description>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {action.kind === "rename" && (
              <label>
                资料名称
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
            {action.kind === "move" && (
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
                disabled={saving || (action.kind === "rename" && !title.trim())}
                className={deleting ? styles.danger : styles.primary}
              >
                {saving
                  ? deleting
                    ? "正在删除…"
                    : "正在保存…"
                  : deleting
                    ? "确认删除"
                    : action.kind === "move"
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
