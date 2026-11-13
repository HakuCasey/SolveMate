import { useState } from "react";
import {
  MessagesSquare,
  LoaderCircle,
  CircleAlert,
  ChevronRight,
} from "lucide-react";
import { StatusPopover } from "./StatusPopover";
import type { AiTurn, Conversation } from "@solvemate/contracts";
import { conversationTasks } from "./state";
import styles from "./StatusBar.module.css";
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
  const label = first?.attention
    ? first.label
    : tasks.length > 1
      ? `${tasks.length} 个对话正在回复…`
      : (first?.label ?? "AI 空闲");
  const Icon = first?.attention
    ? CircleAlert
    : first
      ? LoaderCircle
      : MessagesSquare;
  const tone =
    first?.label === "回复失败" ? "danger" : first ? "active" : "neutral";
  return (
    <StatusPopover
      category="对话状态"
      value={label}
      icon={Icon}
      tone={tone}
      busy={!!first && !first.attention}
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
