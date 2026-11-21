import { SidebarToggle } from "../components/SidebarLayout";
import { useState, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { BookOpen, ChevronDown, Wrench, X } from "lucide-react";
import type {
  LearningLocation,
  QuestionResearchWorkspace,
  TeachingTool,
} from "@solvemate/contracts";
import type { SubjectDirectory } from "../state/subjects";
import { toolTitle } from "./state";
import type { TeachingWorkspace } from "./state";
import { ToolChoiceDialog } from "./ToolChoiceDialog";
import type { TeachingTools } from "./useTeachingTools";
import paneHeader from "../components/PaneHeader.module.css";
import styles from "./QuestionResearchPanel.module.css";

export function QuestionResearchPanel({
  workspace,
  directory,
  sourceTitle,
  subjectId,
  onChange,
  tools,
  onOfficial,
  renderSourceList,
  renderReader,
}: {
  workspace: TeachingWorkspace;
  directory: SubjectDirectory;
  sourceTitle: string;
  subjectId: string | null;
  onChange: (patch: Partial<QuestionResearchWorkspace>) => void;
  tools: TeachingTools;
  onOfficial: () => void;
  renderSourceList: (
    subjectId: string | null,
    open: (source: LearningLocation) => void,
    uploaded: (id: string | null) => void,
  ) => ReactNode;
  renderReader: (header: ReactNode) => ReactNode;
}) {
  const [sourceOpen, setSourceOpen] = useState(false),
    [scope, setScope] = useState<string | null>(subjectId);
  const [choice, setChoice] = useState<{ original?: TeachingTool } | null>(
    null,
  );
  const current = tools.items.find((t) => t.id === workspace.selectedToolId);
  function openSources() {
    setScope(subjectId ?? directory.active[0]?.id ?? null);
    setSourceOpen(true);
  }
  const toolbar = (
    <header className={styles.toolbar} aria-label="教研室选项">
      <SidebarToggle />
      <div className={styles.fieldRow}>
        <label htmlFor="research-source">
          <BookOpen className={paneHeader.titleIcon} aria-hidden="true" />
          <span>资料</span>
        </label>
        <button
          id="research-source"
          className={styles.selectTrigger}
          onClick={openSources}
          title={sourceTitle}
          aria-label="选择研发资料"
        >
          <span>{sourceTitle || "选择资料"}</span>
          <ChevronDown />
        </button>
      </div>
      <div className={styles.fieldRow}>
        <label htmlFor="research-tool">
          <Wrench className={paneHeader.titleIcon} aria-hidden="true" />
          <span>工具</span>
        </label>
        <button
          id="research-tool"
          className={styles.selectTrigger}
          aria-label="选择教研工具"
          title={current ? toolTitle(current) : "选择工具"}
          onClick={() =>
            setChoice({
              original: current ? structuredClone(current) : undefined,
            })
          }
        >
          <span>{current ? toolTitle(current) : "选择工具"}</span>
          <ChevronDown />
        </button>
      </div>
    </header>
  );
  return (
    <>
      {workspace.source ? (
        renderReader(toolbar)
      ) : (
        <section className={styles.panel} aria-label="教研室资料">
          {toolbar}
          <div className={styles.empty}>
            <BookOpen />
            <h2>教研室</h2>
            <button onClick={openSources}>
              <BookOpen />
              选择资料
            </button>
          </div>
        </section>
      )}
      {choice && (
        <ToolChoiceDialog
          original={choice.original}
          tools={tools}
          onClose={() => setChoice(null)}
          onOfficial={() => {
            setChoice(null);
            onOfficial();
          }}
        />
      )}
      <Dialog.Root open={sourceOpen} onOpenChange={setSourceOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.overlay} />
          <Dialog.Content className={styles.picker}>
            <header className={styles.pickerHeader}>
              <Dialog.Title>
                <BookOpen />
                资料选择
              </Dialog.Title>
              <Dialog.Close aria-label="关闭资料选择">
                <X />
              </Dialog.Close>
            </header>
            <div className={styles.sourceList}>
              {renderSourceList(
                scope,
                (source) => {
                  onChange({ source });
                  setSourceOpen(false);
                },
                setScope,
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
