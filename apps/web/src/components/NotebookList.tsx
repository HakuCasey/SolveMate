import { lazy, Suspense, useEffect, useId, useState } from "react";
import {
  ChevronRight,
  CheckSquare,
  Square,
  ListChecks,
  Merge,
  Download,
  FileText,
  FolderInput,
  NotebookPen,
  Pencil,
  Tag,
  Trash2,
} from "lucide-react";
import { ContextMenu } from "radix-ui";
import type { LearningRelations } from "../reading/relations";
import type {
  LearningLocation,
  MessageSource,
  NoteLibrary,
} from "@solvemate/contracts";
import type { SubjectDirectory } from "../state/subjects";
import {
  notePreview,
  noteTags,
  customNoteTagIds,
  unclassifiedNotebookId,
  type NoteAction,
} from "../state/notes";
import {
  NoteManagementDialog,
  type NoteManagementTarget,
} from "./NoteManagementDialog";
import styles from "./NotebookList.module.css";
import management from "./NoteManagement.module.css";
import { NoteSources } from "./NoteSources";
import { PaneHeader } from "./PaneHeader";

const NotebookExportDialog = lazy(() =>
  import("./NotebookExportDialog").then((module) => ({
    default: module.NotebookExportDialog,
  })),
);

export function NotebookList({
  library,
  relations,
  directory,
  activeNoteId,
  onSelect,
  onAction,
  onLocation,
  onMessage,
}: {
  library: NoteLibrary;
  relations: LearningRelations;
  directory: SubjectDirectory;
  activeNoteId: string | null;
  onSelect: (id: string) => void;
  onAction: (action: NoteAction) => Promise<void>;
  onLocation: (source: LearningLocation) => void;
  onMessage: (source: MessageSource) => void;
}) {
  const { notebooks, notes } = library;
  const groupPrefix = useId();
  const activeNotebookId = notes.find(
    (note) => note.id === activeNoteId,
  )?.notebookId;
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    activeNotebookId ? { [activeNotebookId]: true } : {},
  );
  const [selection, setSelection] = useState<{
    notebookId: string;
    notes: { id: string; revision: number }[];
  } | null>(null);
  const [exportId, setExportId] = useState<string | null>(null);
  const exportBook = library.notebooks.find((book) => book.id === exportId);
  const [target, setTarget] = useState<NoteManagementTarget | null>(null);
  const tags = new Map(
    noteTags(library, directory).map((tag) => [tag.id, tag.title]),
  );
  useEffect(() => {
    // 当前笔记转移后展开实际所属笔记本；手动折叠不触发重开。
    if (activeNotebookId)
      setExpanded((previous) => ({ ...previous, [activeNotebookId]: true }));
  }, [activeNotebookId]);
  return (
    <section className={styles.library} aria-label="笔记列表">
      <PaneHeader
        icon={NotebookPen}
        title="笔记"
        detail={`${notebooks.length} 个笔记本 · ${notes.length} 篇笔记`}
      />
      <div className={styles.list}>
        {notebooks.map((notebook) => {
          const items = notes.filter((note) => note.notebookId === notebook.id);
          const selecting = selection?.notebookId === notebook.id;
          const open = !!expanded[notebook.id];
          const groupId = `${groupPrefix}-${notebook.id}`;
          return (
            <section
              className={styles.notebook}
              aria-label={notebook.title}
              key={notebook.id}
            >
              <div className={styles.notebookHeading}>
                <ContextMenu.Root>
                  <ContextMenu.Trigger asChild>
                    <button
                      className={styles.notebookButton}
                      aria-label={notebook.title}
                      aria-expanded={open}
                      aria-controls={groupId}
                      onClick={() =>
                        setExpanded((previous) => ({
                          ...previous,
                          [notebook.id]: !previous[notebook.id],
                        }))
                      }
                    >
                      <ChevronRight
                        className={styles.chevron}
                        data-open={open}
                        aria-hidden="true"
                      />
                      <NotebookPen
                        className={styles.bookIcon}
                        aria-hidden="true"
                      />
                      <strong>{notebook.title}</strong>
                      <span>{items.length} 篇</span>
                    </button>
                  </ContextMenu.Trigger>
                  <ContextMenu.Portal>
                    <ContextMenu.Content
                      className={management.menu}
                      onCloseAutoFocus={(event) => event.preventDefault()}
                    >
                      <ContextMenu.Item
                        className={management.menuItem}
                        onSelect={() => setExportId(notebook.id)}
                      >
                        <Download aria-hidden="true" />
                        导出 PDF
                      </ContextMenu.Item>
                      <ContextMenu.Item
                        className={management.menuItem}
                        disabled={notebook.id === unclassifiedNotebookId}
                        onSelect={() =>
                          setTarget({ kind: "renameNotebook", item: notebook })
                        }
                      >
                        <Pencil aria-hidden="true" />
                        重命名
                      </ContextMenu.Item>
                      <ContextMenu.Item
                        className={`${management.menuItem} ${management.dangerText}`}
                        disabled={notebook.id === unclassifiedNotebookId}
                        onSelect={() =>
                          setTarget({ kind: "deleteNotebook", item: notebook })
                        }
                      >
                        <Trash2 aria-hidden="true" />
                        删除
                      </ContextMenu.Item>
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                </ContextMenu.Root>
                {open && items.length > 1 && !selecting && (
                  <button
                    className={styles.selectButton}
                    onClick={() =>
                      setSelection({ notebookId: notebook.id, notes: [] })
                    }
                    aria-label={`多选${notebook.title}中的笔记`}
                  >
                    <ListChecks aria-hidden="true" />
                    多选
                  </button>
                )}
              </div>
              {open && (
                <div
                  className={styles.entries}
                  id={groupId}
                  role="group"
                  aria-label={`${notebook.title}条目`}
                >
                  {selecting && (
                    <div className={styles.selectionBar}>
                      <span>已选 {selection.notes.length} 篇</span>
                      <button
                        disabled={selection.notes.length < 2}
                        onClick={() =>
                          setTarget({
                            kind: "mergeNotes",
                            item: notebook,
                            notes: [...selection.notes].sort(
                              (a, b) =>
                                items.findIndex((note) => note.id === a.id) -
                                items.findIndex((note) => note.id === b.id),
                            ),
                          })
                        }
                      >
                        <Merge aria-hidden="true" />
                        合并
                      </button>
                      <button onClick={() => setSelection(null)}>取消</button>
                    </div>
                  )}
                  {items.map((note) => {
                    const tagIds = customNoteTagIds(note);
                    return (
                      <ContextMenu.Root key={note.id}>
                        <ContextMenu.Trigger asChild disabled={selecting}>
                          <div
                            className={styles.entry}
                            data-active={
                              selecting
                                ? selection.notes.some(
                                    (item) => item.id === note.id,
                                  )
                                : note.id === activeNoteId
                            }
                          >
                            <button
                              className={styles.openEntry}
                              aria-label={note.title}
                              role={selecting ? "checkbox" : undefined}
                              aria-checked={
                                selecting
                                  ? selection.notes.some(
                                      (item) => item.id === note.id,
                                    )
                                  : undefined
                              }
                              aria-pressed={
                                selecting ? undefined : note.id === activeNoteId
                              }
                              onClick={() => {
                                if (!selecting) {
                                  onSelect(note.id);
                                  return;
                                }
                                setSelection(
                                  (previous) =>
                                    previous && {
                                      ...previous,
                                      notes: previous.notes.some(
                                        (item) => item.id === note.id,
                                      )
                                        ? previous.notes.filter(
                                            (item) => item.id !== note.id,
                                          )
                                        : [
                                            ...previous.notes,
                                            {
                                              id: note.id,
                                              revision: note.revision,
                                            },
                                          ],
                                    },
                                );
                              }}
                            >
                              {selecting ? (
                                selection.notes.some(
                                  (item) => item.id === note.id,
                                ) ? (
                                  <CheckSquare aria-hidden="true" />
                                ) : (
                                  <Square aria-hidden="true" />
                                )
                              ) : (
                                <FileText aria-hidden="true" />
                              )}
                              <span className={styles.copy}>
                                <strong title={note.title}>{note.title}</strong>
                                <span className={styles.details}>
                                  {tagIds.length > 0 && (
                                    <span
                                      className={styles.tags}
                                      title={tagIds
                                        .map(
                                          (id) => tags.get(id) ?? "标签不可用",
                                        )
                                        .join("、")}
                                    >
                                      {tagIds.slice(0, 2).map((id) => (
                                        <span className={styles.tag} key={id}>
                                          {tags.get(id) ?? "标签不可用"}
                                        </span>
                                      ))}
                                      {tagIds.length > 2 && (
                                        <span className={styles.tag}>
                                          +{tagIds.length - 2}
                                        </span>
                                      )}
                                    </span>
                                  )}
                                  <span
                                    className={styles.preview}
                                    title={notePreview(note.content)}
                                  >
                                    {notePreview(note.content) || "暂无正文"}
                                  </span>
                                </span>
                              </span>
                            </button>
                            {!selecting && (
                              <NoteSources
                                note={note}
                                relations={relations}
                                onLocation={onLocation}
                                onMessage={onMessage}
                              />
                            )}
                          </div>
                        </ContextMenu.Trigger>
                        <ContextMenu.Portal>
                          <ContextMenu.Content
                            className={management.menu}
                            onCloseAutoFocus={(event) => event.preventDefault()}
                          >
                            <ContextMenu.Item
                              className={management.menuItem}
                              onSelect={() =>
                                setTarget({ kind: "renameNote", item: note })
                              }
                            >
                              <Pencil aria-hidden="true" />
                              重命名
                            </ContextMenu.Item>
                            <ContextMenu.Item
                              className={management.menuItem}
                              onSelect={() =>
                                setTarget({ kind: "moveNote", item: note })
                              }
                            >
                              <FolderInput aria-hidden="true" />
                              更换笔记本
                            </ContextMenu.Item>
                            <ContextMenu.Item
                              className={management.menuItem}
                              onSelect={() =>
                                setTarget({ kind: "tags", item: note })
                              }
                            >
                              <Tag aria-hidden="true" />
                              添加标签
                            </ContextMenu.Item>
                            <ContextMenu.Item
                              className={`${management.menuItem} ${management.dangerText}`}
                              onSelect={() =>
                                setTarget({ kind: "deleteNote", item: note })
                              }
                            >
                              <Trash2 aria-hidden="true" />
                              删除
                            </ContextMenu.Item>
                          </ContextMenu.Content>
                        </ContextMenu.Portal>
                      </ContextMenu.Root>
                    );
                  })}
                  {!items.length && (
                    <p className={styles.empty}>这个笔记本还没有笔记。</p>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {exportBook && (
        <Suspense fallback={<p role="status">正在准备导出…</p>}>
          <NotebookExportDialog
            notebook={exportBook}
            notes={library.notes.filter(
              (note) => note.notebookId === exportBook.id,
            )}
            tags={Object.fromEntries(tags)}
            originLabel={(origin) => relations.describeOrigin(origin).label}
            onClose={() => setExportId(null)}
          />
        </Suspense>
      )}
      {target && (
        <NoteManagementDialog
          target={target}
          library={library}
          directory={directory}
          onClose={() => setTarget(null)}
          onAction={async (action) => {
            await onAction(action);
            if (action.kind === "moveNote") onSelect(action.id);
            if (action.kind === "mergeNotes") {
              onSelect(action.notes[0].id);
              setSelection(null);
            }
          }}
        />
      )}
    </section>
  );
}
