import { AlertDialog } from "radix-ui";
import { conversationLimits } from "@solvemate/contracts";
import styles from "./ConversationSwitchDialog.module.css";

export function ConversationLimitDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={styles.overlay} />
        <AlertDialog.Content className={styles.dialog}>
          <AlertDialog.Title>进行中的对话已达上限</AlertDialog.Title>
          <AlertDialog.Description>
            {conversationLimits.message}
          </AlertDialog.Description>
          <div className={styles.actions}>
            <AlertDialog.Cancel>知道了</AlertDialog.Cancel>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
