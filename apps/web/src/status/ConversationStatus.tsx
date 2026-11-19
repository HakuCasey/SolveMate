import { useEffect, useState } from "react";
import { MessagesSquare, ChevronRight } from "lucide-react";
import { StatusPopover } from "./StatusPopover";
import type { AiTurn, Conversation } from "@solvemate/contracts";
import { conversationTasks } from "./state";
import styles from "./StatusBar.module.css";

function formatElapsed(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
export function ConversationStatus({
  conversations,
  turns,
  activeId,
  connectionErrors,
  onOpen,
}: {
  conversations: Conversation[];
  turns: Record<string, AiTurn>;
  activeId: string | null;
  connectionErrors: Record<string, string>;
  onOpen: (conversation: Conversation) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const tasks = conversationTasks(
    conversations,
    turns,
    activeId,
    connectionErrors,
  ).filter((item) => item.label !== "回复失败" || !dismissed.includes(item.id));
  const first = tasks[0];
  const busy = !!first && !first.attention;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  const startedAt = first?.startedAt;
  const elapsed =
    busy && startedAt != null ? formatElapsed(now - startedAt) : undefined;
  const label = first?.attention
    ? first.label
    : tasks.length > 1
      ? `${tasks.length} 个对话正在回复…`
      : (first?.label ?? "AI 空闲");
  const tone =
    first?.label === "回复失败" ? "danger" : first ? "active" : "neutral";
  return (
    <StatusPopover
      category="对话状态"
      value={label}
      tone={tone}
      busy={busy}
      busyElapsed={elapsed}
      open={open}
      onOpenChange={setOpen}
    >
      {!!tasks.length && (
        <div className={styles.taskList}>
          {tasks.map((task) => (
            <div className={styles.taskCard} key={task.id}>
              <button
                className={styles.task}
                onClick={() => {
                  onOpen(task.conversation);
                  setOpen(false);
                }}
              >
                <MessagesSquare aria-hidden="true" />
                <span className={styles.taskCopy}>
                  <strong>{task.conversation.title}</strong>
                  {tasks.length > 1 && <small>{task.label}</small>}
                </span>
                <ChevronRight aria-hidden="true" />
              </button>
              {(task.error || task.label === "回复失败") && (
                <div className={styles.taskDetails}>
                  {task.error && <p className={styles.error}>{task.error}</p>}
                  {task.label === "回复失败" && (
                    <button
                      onClick={() =>
                        setDismissed((previous) => [...previous, task.id])
                      }
                    >
                      关闭失败提示
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </StatusPopover>
  );
}
