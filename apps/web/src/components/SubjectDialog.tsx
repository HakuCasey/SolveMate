import { useId, useState } from "react";
import { AlertDialog, Dialog } from "radix-ui";
import type { Subject } from "@solvemate/contracts";
import { AlertTriangle } from "lucide-react";
import styles from "./SubjectDialog.module.css";

export type SubjectAction =
  | { kind: "create" }
  | { kind: "rename"; subject: Subject }
  | { kind: "delete"; subject: Subject };

interface Props {
  action: SubjectAction | null;
  onClose: () => void;
  onCreate: (title: string) => Promise<Subject>;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}
export function SubjectDialog(props: Props) {
  const { action } = props;
  if (!action) return null;
  return action.kind === "delete" ? (
    <DeleteSubject
      key={action.subject.id}
      {...props}
      subject={action.subject}
    />
  ) : (
    <EditSubject
      key={action.kind === "create" ? "create" : action.subject.id}
      {...props}
      action={action}
    />
  );
}
function EditSubject({
  action,
  onClose,
  onCreate,
  onRename,
}: Props & { action: Exclude<SubjectAction, { kind: "delete" }> }) {
  const [title, setTitle] = useState(
    action.kind === "create" ? "" : action.subject.title,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const nameId = useId();
  async function save() {
    setSaving(true);
    setError("");
    try {
      if (action.kind === "create") await onCreate(title);
      else await onRename(action.subject.id, title);
      onClose();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "学科未能保存，请重试。",
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
        <Dialog.Content className={styles.dialog}>
          <Dialog.Title
            className={
              action.kind === "create" ? styles.createTitle : undefined
            }
          >
            {action.kind === "create" ? "新增学科" : "重命名学科"}
          </Dialog.Title>
          <Dialog.Description>
            名称为 1–40 个字符，不能与现有学科重名。
          </Dialog.Description>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label htmlFor={nameId}>学科名称</label>
            <input
              id={nameId}
              value={title}
              maxLength={80}
              disabled={saving}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：大学物理"
            />
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <div className={styles.actions}>
              <Dialog.Close type="button" disabled={saving}>
                取消
              </Dialog.Close>
              <button
                type="submit"
                className={styles.primary}
                disabled={saving || !title.trim()}
              >
                {saving ? "正在保存…" : "保存"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function DeleteSubject({
  subject,
  onClose,
  onDelete,
}: Props & { subject: Subject }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <AlertDialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={styles.overlay} />
        <AlertDialog.Content className={styles.dialog}>
          <AlertDialog.Title className={styles.dangerTitle}>
            <AlertTriangle aria-hidden="true" />
            删除学科
          </AlertDialog.Title>
          <p className={styles.warning}>高危操作，请谨慎确认。</p>
          <AlertDialog.Description asChild>
            <div>
              <p>该学科将被删除，已上传资料也会删除。文件和历史对话保留。</p>
              <p>如需保留已上传资料，请先将资料转移到其他学科。</p>
            </div>
          </AlertDialog.Description>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <AlertDialog.Cancel disabled={saving}>取消</AlertDialog.Cancel>
            <AlertDialog.Action
              className={styles.danger}
              disabled={saving}
              onClick={async (event) => {
                event.preventDefault();
                setSaving(true);
                setError("");
                try {
                  await onDelete(subject.id);
                  onClose();
                } catch (failure) {
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : "学科未能删除，请重试。",
                  );
                  setSaving(false);
                }
              }}
            >
              {saving ? "正在删除…" : "确认删除"}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
