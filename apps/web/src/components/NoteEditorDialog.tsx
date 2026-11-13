import { useState } from "react";
import { Dialog } from "radix-ui";
import type { LearningLocation, Note, NoteLibrary } from "@solvemate/contracts";
import { useDraftBackup } from "../refresh/drafts";
import { useEditRevision } from "../refresh/useEditRevision";
import { unclassifiedNotebookId, type NoteContent } from "../state/notes";
import styles from "./NoteManagement.module.css";
import editor from "./NoteEditorDialog.module.css";
import { NotebookDestinationSelect } from "./NotebookDestinationSelect";

export interface NoteEditorTarget {
  id: string;
  note?: Note;
  source: LearningLocation | null;
}
export function NoteEditorDialog({
  target,
  library,
  sourceLabel,
  onSave,
  onClose,
}: {
  target: NoteEditorTarget;
  library: NoteLibrary;
  sourceLabel: string;
  onSave: (value: NoteContent, revision: number) => Promise<void>;
  onClose: () => void;
}) {
  const initial = target.note;
  const [value, setValue] = useState<NoteContent>({
    title: initial?.title ?? "",
    content: initial?.content ?? "",
    notebookId: initial?.notebookId ?? unclassifiedNotebookId,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty =
    value.title !== (initial?.title ?? "") ||
    value.content !== (initial?.content ?? "") ||
    (!initial &&
      (value.destination?.kind === "new" ||
        value.notebookId !== unclassifiedNotebookId));
  const release = useDraftBackup(
    `note-editor:${target.id}`,
    "笔记正文草稿",
    { ...value, source: target.source },
    dirty,
  );
  const getRevision = useEditRevision(
    initial ?? { revision: 0 },
    library.notes.find((item) => item.id === target.id),
    target.id,
    !initial,
  );
  function close() {
    if (saving) return;
    release();
    onClose();
  }
  async function save() {
    if (saving) return;
    setError("");
    setSaving(true);
    try {
      await onSave(value, getRevision());
      release();
      onClose();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "笔记未能保存，请重试。",
      );
    } finally {
      setSaving(false);
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
          data-study-area="note"
          className={`${styles.dialog} ${editor.editor}`}
          aria-describedby={initial ? undefined : "note-editor-source"}
          onInteractOutside={(event) => {
            if (dirty || saving) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (dirty || saving) event.preventDefault();
          }}
        >
          <Dialog.Title>{initial ? "编辑笔记" : "记录笔记"}</Dialog.Title>
          {!initial && (
            <Dialog.Description id="note-editor-source">
              {sourceLabel || "独立笔记"}
            </Dialog.Description>
          )}
          <label>
            标题
            <input
              value={value.title}
              maxLength={80}
              placeholder="为笔记起一个标题"
              onChange={(event) =>
                setValue({ ...value, title: event.target.value })
              }
            />
          </label>
          {!initial && (
            <NotebookDestinationSelect
              library={library}
              value={
                value.destination ?? {
                  kind: "existing",
                  notebookId: value.notebookId,
                }
              }
              disabled={saving}
              onChange={(destination) =>
                setValue({
                  ...value,
                  destination,
                  ...(destination.kind === "existing"
                    ? { notebookId: destination.notebookId }
                    : {}),
                })
              }
            />
          )}
          <label>
            正文
            <textarea
              value={value.content}
              maxLength={100000}
              placeholder="写下你的理解、疑问或想法，支持 Markdown。"
              onChange={(event) =>
                setValue({ ...value, content: event.target.value })
              }
            />
          </label>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <button disabled={saving} onClick={close}>
              取消
            </button>
            <button
              className={styles.primary}
              disabled={saving || !dirty}
              onClick={() => void save()}
            >
              {saving ? "正在保存…" : "保存笔记"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
