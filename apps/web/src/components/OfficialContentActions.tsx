import { useRef, useState, type ReactElement } from "react";
import { ContextMenu, Dialog } from "radix-ui";
import { Trash2 } from "lucide-react";
import type { OfficialMaterial } from "../content/library";
import styles from "../materials/MaterialActions.module.css";

/** 学科列表和官方目录共用删除操作，保留版本文件及历史引用。 */
export function OfficialContentActions({
  item,
  onRemove,
  children,
}: {
  item: OfficialMaterial;
  onRemove: (id: string) => Promise<void>;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className={styles.menu} collisionPadding={12}>
            <ContextMenu.Item
              className={`${styles.menuItem} ${styles.dangerText}`}
              disabled={!item.listed}
              onSelect={() => {
                setError("");
                setOpen(true);
              }}
            >
              <Trash2 aria-hidden="true" />
              {item.kind === "questions" ? "删除题目集" : "删除"}
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      <Dialog.Root
        open={open}
        onOpenChange={(value) => {
          if (!saving) setOpen(value);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={styles.overlay} />
          <Dialog.Content
            className={styles.dialog}
            role="alertdialog"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              cancel.current?.focus();
            }}
          >
            <Dialog.Title>
              {item.kind === "questions" ? "删除官方题目集" : "删除官方资料"}
            </Dialog.Title>
            <Dialog.Description>
              {item.kind === "questions"
                ? "这组题目将从列表中删除，文件和历史对话保留。可从官方内容中重新添加。"
                : "该资料将从列表中删除，文件和历史对话保留。可从官方内容中重新添加。"}
            </Dialog.Description>
            {error && <p role="alert">{error}</p>}
            <div className={styles.actions}>
              <button
                ref={cancel}
                disabled={saving}
                onClick={() => setOpen(false)}
              >
                取消
              </button>
              <button
                disabled={saving}
                onClick={() => {
                  setSaving(true);
                  void onRemove(item.id)
                    .then(() => setOpen(false))
                    .catch((failure: unknown) => {
                      setError(
                        failure instanceof Error
                          ? failure.message
                          : "删除失败，请重试。",
                      );
                    })
                    .finally(() => setSaving(false));
                }}
              >
                {saving ? "正在删除…" : "删除"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
