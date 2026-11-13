import { lazy, Suspense, useEffect, useId, useState } from "react";
import {
  ChevronRight,
  Download,
  FileText,
  FolderInput,
  NotebookPen,
  Pencil,
  Tag,
  Trash2,
} from "lucide-react";
import { ContextMenu } from "radix-ui";
import type { NoteLibrary } from "@solvemate/contracts";
import type { SubjectDirectory } from "../state/subjects";
import {
  notePreview,
  noteTags,
  unclassifiedNotebookId,
  type NoteAction,
} from "../state/notes";
import {
  NoteManagementDialog,
  type NoteManagementTarget,
} from "./NoteManagementDialog";
import styles from "./NotebookList.module.css";
import management from "./NoteManagement.module.css";
import { PaneHeader } from "./PaneHeader";

const NotebookExportDialog = lazy(() =>
  import("./NotebookExportDialog").then((module) => ({
    default: module.NotebookExportDialog,
  })),
);

export function NotebookList({
  library,
  directory,
  activeNoteId,
  onSelect,
  onAction,
}: {
  library: NoteLibrary;
  directory: SubjectDirectory;
  activeNoteId: string | null;
  onSelect: (id: string) => void;
  onAction: (action: NoteAction) => Promise<void>;
}) {
  const { notebooks, notes } = library;
  const groupPrefix = useId();
  const activeNotebookId = notes.find(
    (note) => note.id === activeNoteId,
  )?.notebookId;
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    activeNotebookId ? { [activeNotebookId]: true } : {},
  );
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
          const open = !!expanded[notebook.id];
          const groupId = `${groupPrefix}-${notebook.id}`;
          return (
            <section
              className={styles.notebook}
              aria-label={notebook.title}
              key={notebook.id}
            >
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
              {open && (
                <div
                  className={styles.entries}
                  id={groupId}
                  role="group"
                  aria-label={`${notebook.title}条目`}
                >
                  {items.map((note) => (
                    <ContextMenu.Root key={note.id}>
                      <ContextMenu.Trigger asChild>
                        <button
                          className={styles.entry}
                          aria-label={note.title}
                          aria-pressed={note.id === activeNoteId}
                          onClick={() => onSelect(note.id)}
                        >
                          <FileText aria-hidden="true" />
                          <span className={styles.copy}>
                            <strong title={note.title}>{note.title}</strong>
                            <span className={styles.details}>
                              <span
                                className={styles.tags}
                                title={note.tagIds
                                  .map((id) => tags.get(id) ?? "标签不可用")
                                  .join("、")}
                              >
                                {note.tagIds.length ? (
                                  <>
                                    {note.tagIds.slice(0, 2).map((id) => (
                                      <span className={styles.tag} key={id}>
                                        {tags.get(id) ?? "标签不可用"}
                                      </span>
                                    ))}
                                    {note.tagIds.length > 2 && (
                                      <span className={styles.tag}>
                                        +{note.tagIds.length - 2}
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span className={styles.noTag}>无标签</span>
                                )}
                              </span>
                              <span
                                className={styles.preview}
                                title={notePreview(note.content)}
                              >
                                {notePreview(note.content) || "暂无正文"}
                              </span>
                            </span>
                          </span>
                        </button>
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
                  ))}
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
          }}
        />
      )}
    </section>
  );
}
