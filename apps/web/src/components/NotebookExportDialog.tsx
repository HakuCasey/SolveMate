import { NotebookPen } from "lucide-react";
import type { Note, Notebook, NoteOrigin } from "@solvemate/contracts";
import { exportNotebook } from "./notebook-export";
import { ExportDialog } from "./ExportDialog";

export function NotebookExportDialog({
  notebook,
  notes,
  tags,
  originLabel,
  onClose,
}: {
  notebook: Notebook;
  notes: Note[];
  tags: Record<string, string>;
  originLabel: (origin: NoteOrigin) => string;
  onClose: () => void;
}) {
  return (
    <ExportDialog
      title="笔记本导出"
      name={notebook.title}
      icon={NotebookPen}
      extension="pdf"
      description={`${notebook.title} · ${notes.length} 篇笔记`}
      generate={(signal) =>
        exportNotebook(notebook, notes, tags, signal, originLabel)
      }
      onClose={onClose}
    />
  );
}
