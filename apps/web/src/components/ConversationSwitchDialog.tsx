import { useState } from "react";
import { AlertDialog } from "radix-ui";
import styles from "./ConversationSwitchDialog.module.css";

export interface ConversationSwitch {
  kind: "teacher" | "service";
  confirm: () => void | Promise<void>;
}

export function ConversationSwitchDialog({
  pending,
  onClose,
}: {
  pending: ConversationSwitch | null;
  onClose: () => void;
}) {
  return pending ? <SwitchContent pending={pending} onClose={onClose} /> : null;
}
function SwitchContent({
  pending,
  onClose,
}: {
  pending: ConversationSwitch;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false),
    [error, setError] = useState("");
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
          <AlertDialog.Title>确认切换</AlertDialog.Title>
          <AlertDialog.Description>
            {pending.kind === "teacher"
              ? "切换教师后对话重新开始，请确认是否切换？"
              : "当前操作会切换 Harness 服务，对话将重新开始，请确认是否切换？"}
          </AlertDialog.Description>
          {error && <p role="alert">{error}</p>}
          <div className={styles.actions}>
            <AlertDialog.Cancel disabled={saving}>取消</AlertDialog.Cancel>
            <AlertDialog.Action
              disabled={saving}
              onClick={async (event) => {
                event.preventDefault();
                setSaving(true);
                try {
                  await pending.confirm();
                  onClose();
                } catch (failure) {
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : "保存失败，请重试。",
                  );
                  setSaving(false);
                }
              }}
            >
              {saving ? "正在保存…" : "确认"}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
