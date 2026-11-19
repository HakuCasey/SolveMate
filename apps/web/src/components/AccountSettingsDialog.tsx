import { useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { UserRoundCog } from "lucide-react";
import {
  maxUserNameLength,
  maxSignatureLength,
  type Settings,
} from "@solvemate/contracts";
import styles from "../materials/MaterialActions.module.css";

import { readProfileAvatar } from "./profile-avatar";
import profileStyles from "./AccountSettingsDialog.module.css";

export type ProfileSettings = Pick<
  Settings,
  "userName" | "profileAvatar" | "profileSignature"
>;

function limit(value: string, length: number) {
  return Array.from(value).slice(0, length).join("");
}

export function AccountSettingsDialog({
  profile,
  defaultAvatar,
  onSave,
  onClose,
  onReturnFocus,
}: {
  profile: ProfileSettings;
  defaultAvatar: string;
  onSave: (changes: ProfileSettings) => Promise<unknown>;
  onClose: () => void;
  onReturnFocus: () => void;
}) {
  const [initial] = useState(() => ({
    name: profile.userName ?? "mumumeow",
    avatar: profile.profileAvatar ?? null,
    signature: profile.profileSignature ?? "",
  }));
  const [draft, setDraft] = useState(initial.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [avatar, setAvatar] = useState(initial.avatar);
  const [signature, setSignature] = useState(initial.signature);
  const [reading, setReading] = useState(false);
  const nicknameInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const value = limit(draft, maxUserNameLength).trim();
  const changes: ProfileSettings = {};
  if (value !== initial.name) changes.userName = value;
  if (signature.trim() !== initial.signature)
    changes.profileSignature = signature.trim();
  if (avatar !== initial.avatar) changes.profileAvatar = avatar;
  const canSave =
    !!value && Object.keys(changes).length > 0 && !reading && !saving;

  async function selectAvatar(file?: File) {
    if (!file) return;
    setReading(true);
    setError("");
    try {
      setAvatar(await readProfileAvatar(file));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "无法读取头像，请重新选择。",
      );
    } finally {
      setReading(false);
    }
  }

  async function save() {
    if (!canSave || composing.current) return;
    setSaving(true);
    setError("");
    try {
      await onSave(changes);
      onClose();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "账号设置保存失败，请重试。",
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
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            nicknameInput.current?.focus();
          }}
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            if (saving || composing.current || event.isComposing)
              event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onReturnFocus();
          }}
        >
          <Dialog.Title>
            <UserRoundCog aria-hidden="true" />
            账号设置
          </Dialog.Title>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className={profileStyles.avatarRow}>
              <img src={avatar ?? defaultAvatar} alt="头像预览" />
              <button
                type="button"
                disabled={reading || saving}
                onClick={() => fileInput.current?.click()}
              >
                {reading ? "读取中…" : "更换头像"}
              </button>
              {avatar && (
                <button
                  type="button"
                  disabled={reading || saving}
                  onClick={() => {
                    setAvatar(null);
                    setError("");
                  }}
                >
                  恢复默认
                </button>
              )}
              <input
                type="file"
                hidden
                ref={fileInput}
                aria-label="选择头像文件"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  void selectAvatar(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </div>
            <label>
              昵称
              <input
                ref={nicknameInput}
                value={draft}
                disabled={saving}
                onFocus={(event) => event.currentTarget.select()}
                onCompositionStart={() => {
                  composing.current = true;
                }}
                onCompositionEnd={(event) => {
                  composing.current = false;
                  setDraft(limit(event.currentTarget.value, maxUserNameLength));
                }}
                onChange={(event) => {
                  setDraft(
                    composing.current
                      ? event.target.value
                      : limit(event.target.value, maxUserNameLength),
                  );
                  setError("");
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (composing.current ||
                      event.nativeEvent.isComposing ||
                      event.nativeEvent.keyCode === 229)
                  )
                    event.preventDefault();
                }}
              />
            </label>
            <label>
              个性签名
              <textarea
                className={profileStyles.signature}
                rows={2}
                placeholder="选填"
                value={signature}
                disabled={saving}
                onCompositionStart={() => {
                  composing.current = true;
                }}
                onCompositionEnd={(event) => {
                  composing.current = false;
                  setSignature(
                    limit(event.currentTarget.value, maxSignatureLength),
                  );
                }}
                onChange={(event) =>
                  setSignature(
                    composing.current
                      ? event.target.value
                      : limit(event.target.value, maxSignatureLength),
                  )
                }
              />
            </label>
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            <div className={styles.actions}>
              <button type="button" disabled={saving} onClick={onClose}>
                取消
              </button>
              <button
                type="submit"
                className={styles.primary}
                disabled={!canSave}
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
