import { useDraftBackup } from "../refresh/drafts";
import { useEditRevision } from "../refresh/useEditRevision";
import { useId, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import type { Note, Notebook, NoteLibrary } from "@solvemate/contracts";
import type { SubjectDirectory } from "../state/subjects";
import {
  availableNoteTags,
  type NoteAction,
  type NoteDestination,
} from "../state/notes";
import { useSaveFeedback } from "./SaveFeedback";
import { NotebookDestinationSelect } from "./NotebookDestinationSelect";
import styles from "./NoteManagement.module.css";

export type NoteManagementTarget =
  | { kind: "renameNotebook" | "deleteNotebook"; item: Notebook }
  | { kind: "renameNote" | "deleteNote" | "tags" | "moveNote"; item: Note };

const headings = {
  renameNotebook: "重命名笔记本",
  deleteNotebook: "删除笔记本",
  renameNote: "重命名笔记",
  deleteNote: "删除笔记",
  tags: "笔记标签",
  moveNote: "更换笔记本",
};
export function NoteManagementDialog({
  target,
  library,
  directory,
  onAction,
  onClose: finish,
}: {
  target: NoteManagementTarget;
  library: NoteLibrary;
  directory: SubjectDirectory;
  onAction: (action: NoteAction) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(target.item.title);
  const [tagIds, setTagIds] = useState(
    target.kind === "tags" ? target.item.tagIds : [],
  );
  const [newNames, setNewNames] = useState<string[]>([]);
  const [tagName, setTagName] = useState("");
  const [destination, setDestination] = useState<NoteDestination>({
    kind: "existing",
    notebookId: target.kind === "moveNote" ? target.item.notebookId : "",
  });
  const [deleteNotes, setDeleteNotes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const cancel = useRef<HTMLButtonElement>(null);
  const radioName = useId();
  const newTagId = useId();
  const saved = useSaveFeedback();
  const deleting =
    target.kind === "deleteNotebook" || target.kind === "deleteNote";
  const tags = availableNoteTags(
    library,
    directory,
    target.kind === "tags" ? target.item.tagIds : [],
  );

  const release = useDraftBackup(
    `note:${target.kind}:${target.item.id}`,
    headings[target.kind] + "草稿",
    { name, tagIds, newNames, tagName, destination },
    !deleting &&
      (name !== target.item.title ||
        newNames.length > 0 ||
        !!tagName ||
        (target.kind === "moveNote" &&
          (destination.kind === "new" ||
            destination.notebookId !== target.item.notebookId)) ||
        (target.kind === "tags" &&
          JSON.stringify(tagIds) !== JSON.stringify(target.item.tagIds))),
  );
  const onClose = () => {
    release();
    finish();
  };
  const getRevision = useEditRevision(
    target.item,
    (target.kind.endsWith("Notebook") ? library.notebooks : library.notes).find(
      (item) => item.id === target.item.id,
    ),
  );
  function addTag() {
    const value = tagName.trim();
    if (
      !value ||
      [...value].length > 80 ||
      [...value].some((char) => char.charCodeAt(0) < 32)
    ) {
      setError("标签名称须为 1–80 个字符，不能包含控制字符。");
      return;
    }
    const existing = tags.find(
      (tag) => tag.title.toLowerCase() === value.toLowerCase(),
    );
    if (existing)
      setTagIds((previous) => [...new Set([...previous, existing.id])]);
    else
      setNewNames((previous) =>
        previous.some((item) => item.toLowerCase() === value.toLowerCase())
          ? previous
          : [...previous, value],
      );
    setTagName("");
    setError("");
  }
  async function save() {
    if (saving) return;
    let revision: number;
    try {
      revision = getRevision();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "记录已变化，请刷新。",
      );
      return;
    }
    const base = { id: target.item.id, revision };
    let action: NoteAction;
    if (target.kind === "renameNotebook" || target.kind === "renameNote")
      action = { ...base, kind: target.kind, title: name };
    else if (target.kind === "deleteNotebook")
      action = { ...base, kind: target.kind, deleteNotes };
    else if (target.kind === "deleteNote")
      action = { ...base, kind: target.kind };
    else if (target.kind === "moveNote")
      action = {
        ...base,
        kind: "moveNote",
        destination,
      };
    else
      action = {
        ...base,
        kind: "tags",
        tagIds,
        names: [...newNames, ...(tagName.trim() ? [tagName] : [])],
      };
    setSaving(true);
    setError("");
    try {
      await onAction(action);
      saved(
        deleting
          ? target.kind === "deleteNotebook"
            ? "笔记本已删除"
            : "笔记已删除"
          : target.kind === "tags"
            ? "笔记标签已保存"
            : target.kind === "moveNote"
              ? "笔记本已更换"
              : target.kind === "renameNotebook"
                ? "笔记本名称已保存"
                : "笔记名称已保存",
      );
      onClose();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "操作未能保存，请重试。",
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
          <Dialog.Title>{headings[target.kind]}</Dialog.Title>
          <Dialog.Description>
            {target.kind === "deleteNotebook"
              ? "请选择是否同时删除笔记本中的所有笔记。"
              : target.kind === "deleteNote"
                ? "确认删除这篇笔记？"
                : target.kind === "tags"
                  ? "选择已有标签，也可以添加新标签。"
                  : target.kind === "moveNote"
                    ? "选择已有笔记本，也可以新建笔记本。"
                    : "修改名称后，编号和已有内容保持不变。"}
          </Dialog.Description>
          {target.kind === "deleteNotebook" && (
            <p className={styles.warning}>高危操作，请谨慎确认。</p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            {(target.kind === "renameNotebook" ||
              target.kind === "renameNote") && (
              <label className={styles.name}>
                {target.kind === "renameNotebook" ? "笔记本名称" : "笔记名称"}
                <input
                  value={name}
                  maxLength={80}
                  disabled={saving}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
            )}
            {target.kind === "moveNote" && (
              <NotebookDestinationSelect
                label="目标笔记本"
                library={library}
                value={destination}
                disabled={saving}
                onChange={setDestination}
              />
            )}
            {target.kind === "deleteNotebook" && (
              <fieldset className={styles.deleteChoice} disabled={saving}>
                <legend>是否删除所有笔记？</legend>
                <label>
                  <input
                    type="radio"
                    name={radioName}
                    checked={!deleteNotes}
                    onChange={() => setDeleteNotes(false)}
                  />
                  否，将笔记移入“未分类”笔记本
                </label>
                <label>
                  <input
                    type="radio"
                    name={radioName}
                    checked={deleteNotes}
                    onChange={() => setDeleteNotes(true)}
                  />
                  是，删除其中所有笔记
                </label>
              </fieldset>
            )}
            {target.kind === "tags" && (
              <>
                <div
                  className={styles.tagChoices}
                  role="group"
                  aria-label="笔记标签"
                >
                  {tags.map((tag) => (
                    <label key={tag.id}>
                      <input
                        type="checkbox"
                        disabled={saving}
                        checked={tagIds.includes(tag.id)}
                        onChange={(event) =>
                          setTagIds((previous) =>
                            event.target.checked
                              ? [...previous, tag.id]
                              : previous.filter((id) => id !== tag.id),
                          )
                        }
                      />
                      {tag.title}
                    </label>
                  ))}
                  {newNames.map((value) => (
                    <label key={`new:${value}`}>
                      <input
                        type="checkbox"
                        checked
                        disabled={saving}
                        onChange={() =>
                          setNewNames((previous) =>
                            previous.filter((item) => item !== value),
                          )
                        }
                      />
                      {value}
                    </label>
                  ))}
                </div>
                <div className={styles.name}>
                  <label htmlFor={newTagId}>新标签</label>
                  <span className={styles.newTag}>
                    <input
                      id={newTagId}
                      placeholder="例如：考前复习"
                      maxLength={80}
                      value={tagName}
                      disabled={saving}
                      onChange={(event) => setTagName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addTag();
                        }
                      }}
                    />
                    <button
                      type="button"
                      disabled={saving || !tagName.trim()}
                      onClick={addTag}
                    >
                      添加
                    </button>
                  </span>
                </div>
              </>
            )}
            {error && (
              <p role="alert" className={styles.error}>
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
                className={deleting ? styles.danger : styles.primary}
                disabled={
                  saving ||
                  (target.kind === "moveNote" &&
                    (destination.kind === "new"
                      ? !destination.title.trim()
                      : destination.notebookId === target.item.notebookId))
                }
              >
                {saving
                  ? deleting
                    ? "正在删除…"
                    : "正在保存…"
                  : deleting
                    ? "确认删除"
                    : "保存"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
