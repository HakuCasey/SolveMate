import { useState } from "react";
import { Dialog } from "radix-ui";
import { Pencil } from "lucide-react";
import styles from "../materials/MaterialActions.module.css";

/** 名称提交成功后才关闭；保存失败保留输入，允许直接重试。 */
export function RenameDialog({
  name,
  maxLength,
  onSave,
  onClose,
}: {
  name: string;
  maxLength: number;
  onSave: (title: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    if (saving || !title.trim()) return;
    setSaving(true);
    setError("");
    try {
      await onSave(title.trim());
      onClose();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "名称保存失败，请重试。",
      );
    } finally {
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
          aria-describedby={undefined}
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            if (saving) event.preventDefault();
          }}
        >
          <Dialog.Title>
            <Pencil size={18} aria-hidden="true" /> 重命名
          </Dialog.Title>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label>
              名称
              <input
                autoFocus
                value={title}
                maxLength={maxLength}
                disabled={saving}
                onFocus={(event) => event.target.select()}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setError("");
                }}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <div className={styles.actions}>
              <button type="button" disabled={saving} onClick={onClose}>
                取消
              </button>
              <button
                type="submit"
                disabled={saving || !title.trim() || title.trim() === name}
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
