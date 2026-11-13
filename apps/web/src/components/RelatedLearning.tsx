import { PopoverPanel } from "./PopoverPanel";
import { useState } from "react";
import { Popover } from "radix-ui";
import { FileText, Link2, MessagesSquare, NotebookPen } from "lucide-react";
import type {
  Conversation,
  LearningLocation,
  Note,
} from "@solvemate/contracts";
import { sourceForNote, type LearningRelations } from "../reading/relations";
import styles from "./RelatedLearning.module.css";

export function RelatedLearning({
  source,
  relations,
  onConversation,
  onNote,
  onCreateNote,
}: {
  source: LearningLocation;
  relations: LearningRelations;
  onConversation: (conversation: Conversation) => void;
  onNote: (note: Note) => void;
  onCreateNote: (source: LearningLocation) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"conversations" | "notes">("conversations");
  const related = relations.related(source);
  const material = relations.material(source);
  function choose(action: () => void) {
    setOpen(false);
    action();
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={styles.trigger} aria-label="查看资料相关内容">
        <Link2 aria-hidden="true" />
        相关内容
        <span>{related.conversations.length + related.notes.length}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <PopoverPanel
          title={material.title}
          icon={FileText}
          width={360}
          closeLabel="关闭相关内容"
          className={styles.popover}
          align="end"
          sideOffset={8}
          collisionPadding={12}
          aria-label="资料相关内容"
        >
          <div className={styles.tabs} role="group" aria-label="相关内容类型">
            <button
              aria-pressed={tab === "conversations"}
              onClick={() => setTab("conversations")}
            >
              <MessagesSquare aria-hidden="true" />
              对话 {related.conversations.length}
            </button>
            <button
              aria-pressed={tab === "notes"}
              onClick={() => setTab("notes")}
            >
              <FileText aria-hidden="true" />
              笔记 {related.notes.length}
            </button>
          </div>
          <div className={styles.entries}>
            {tab === "conversations" ? (
              related.conversations.length ? (
                related.conversations.map((item) => (
                  <button
                    className={styles.entry}
                    key={item.id}
                    onClick={() => choose(() => onConversation(item))}
                  >
                    <MessagesSquare aria-hidden="true" />
                    <span>
                      <strong>{item.title}</strong>
                      <small>
                        {item.status === "archived" ? "已归档" : "进行中"}
                      </small>
                    </span>
                  </button>
                ))
              ) : (
                <p className={styles.empty}>暂无相关对话</p>
              )
            ) : related.notes.length ? (
              related.notes.map((item) => {
                const origin = sourceForNote(item);
                return (
                  <button
                    className={styles.entry}
                    key={item.id}
                    onClick={() => choose(() => onNote(item))}
                  >
                    <FileText aria-hidden="true" />
                    <span>
                      <strong>{item.title}</strong>
                      <small>
                        {origin ? relations.material(origin).position : ""}
                      </small>
                    </span>
                  </button>
                );
              })
            ) : (
              <p className={styles.empty}>暂无相关笔记</p>
            )}
          </div>
          <button
            className={styles.create}
            onClick={() => choose(() => onCreateNote(structuredClone(source)))}
          >
            <NotebookPen aria-hidden="true" />
            记录笔记
          </button>
        </PopoverPanel>
      </Popover.Portal>
    </Popover.Root>
  );
}
