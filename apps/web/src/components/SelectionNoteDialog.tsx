import { useState } from "react";
import { Dialog } from "radix-ui";
import type { NoteLibrary, ReadingReference } from "@solvemate/contracts";
import { unclassifiedNotebookId, type NoteDestination } from "../state/notes";
import { useDraftBackup } from "../refresh/drafts";
import { NotebookDestinationSelect } from "./NotebookDestinationSelect";
import styles from "./NoteManagement.module.css";

export function SelectionNoteDialog({
  id,
  reference,
  library,
  onSave,
  onClose,
}: {
  id: string;
  reference: ReadingReference;
  library: NoteLibrary;
  onSave: (destination: NoteDestination) => Promise<void>;
  onClose: () => void;
}) {
  const [destination, setDestination] = useState<NoteDestination>({
    kind: "existing",
    notebookId: unclassifiedNotebookId,
  });
  const [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const release = useDraftBackup(
    `selection-note:${id}`,
    "选段笔记草稿",
    { reference, destination },
    true,
  );
  function close() {
    if (!saving) {
      release();
      onClose();
    }
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.dialog}
          onInteractOutside={(event) => {
            if (saving) event.preventDefault();
          }}
        >
          <Dialog.Title>添加到笔记</Dialog.Title>
          <Dialog.Description>{reference.title}</Dialog.Description>
          <blockquote className={styles.excerpt}>
            {reference.content}
          </blockquote>
          <NotebookDestinationSelect
            library={library}
            value={destination}
            onChange={setDestination}
            disabled={saving}
          />
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <button disabled={saving} onClick={close}>
              取消
            </button>
            <button
              className={styles.primary}
              disabled={
                saving ||
                (destination.kind === "new" && !destination.title.trim())
              }
              onClick={async () => {
                setSaving(true);
                setError("");
                try {
                  await onSave(destination);
                  release();
                  onClose();
                } catch (failure) {
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : "保存失败，请重试。",
                  );
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "正在保存…" : "保存笔记"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
