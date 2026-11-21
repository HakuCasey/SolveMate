import { useState } from "react";
import { AlertDialog } from "radix-ui";
import styles from "./ConversationActions.module.css";

export function ConfirmDeleteDialog({
  title,
  description,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  onConfirm: () => Promise<unknown>;
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
          <AlertDialog.Title>{title}</AlertDialog.Title>
          <AlertDialog.Description>{description}</AlertDialog.Description>
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
                  await onConfirm();
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
              {deleting ? "正在删除…" : title}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
