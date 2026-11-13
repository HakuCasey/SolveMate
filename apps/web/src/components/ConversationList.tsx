import { useState } from "react";
import {
  ChevronDown,
  MessagesSquare,
  SquarePen,
  CornerUpLeft,
} from "lucide-react";
import type { Conversation, Robot } from "@solvemate/contracts";
import type { LearningRelations } from "../reading/relations";
import { PaneHeader } from "./PaneHeader";
import styles from "./ConversationList.module.css";
import {
  ConversationActions,
  type ConversationActionsProps,
} from "./ConversationActions";

interface Props extends ConversationActionsProps {
  relations: LearningRelations;
  robots: Robot[];
  activeId: string | null;
  onOpen: (conversation: Conversation) => void;
  onReturn: (conversation: Conversation) => void;
  onNew: () => void;
}

export function ConversationList({
  relations,
  conversations,
  robots,
  activeId,
  onOpen,
  onReturn,
  onNew,
  onUpdate,
  onDelete,
}: Props) {
  const [activeOpen, setActiveOpen] = useState(true);
  const [archivedOpen, setArchivedOpen] = useState(false);
  function renderItem(conversation: Conversation) {
    const source = conversation.material ?? conversation.selection;
    const context = source ? relations.material(source).context : "普通对话";
    // 直接显示最近一次提问的原文，省略只由样式处理，不生成或保存摘要。
    const lastQuestion =
      conversation.messages.filter((item) => item.role === "user").at(-1)
        ?.content ?? "还没有提问";
    const label = conversation.label || "无标签";
    return (
      <ConversationActions
        key={conversation.id}
        kind="context"
        conversation={conversation}
        conversations={conversations}
        onUpdate={onUpdate}
        onDelete={onDelete}
      >
        <div className={styles.item} data-active={conversation.id === activeId}>
          <button
            className={styles.openItem}
            aria-label={conversation.title}
            aria-pressed={conversation.id === activeId}
            onClick={() => onOpen(conversation)}
          >
            <span className={styles.icon}>
              <MessagesSquare aria-hidden="true" />
            </span>
            <span className={styles.copy}>
              <span className={styles.titleRow}>
                <strong>{conversation.title}</strong>
                <span
                  className={styles.label}
                  data-important={label === "重要"}
                >
                  {label}
                </span>
              </span>
              <small
                className={styles.details}
                title={`${context} · ${lastQuestion}`}
              >
                <span className={styles.context}>{context}</span>
                <span aria-hidden="true">·</span>
                <span className={styles.preview}>{lastQuestion}</span>
              </small>
            </span>
          </button>
          {conversation.status === "active" && (
            <button
              className={styles.returnButton}
              aria-label={`返回对话：${conversation.title}`}
              onClick={() => onReturn(conversation)}
            >
              <CornerUpLeft aria-hidden="true" />
              返回对话
            </button>
          )}
        </div>
      </ConversationActions>
    );
  }

  const active = conversations
    .filter((item) => item.status === "active")
    .toSorted(
      (a, b) =>
        (b.lastActivityAt ?? b.createdAt ?? 0) -
        (a.lastActivityAt ?? a.createdAt ?? 0),
    );
  const archived = conversations.filter((item) => item.status === "archived");
  return (
    <section className={styles.library} aria-label="会话列表">
      <PaneHeader
        icon={MessagesSquare}
        title="对话"
        detail={`${conversations.length} 个会话`}
        actions={
          <button type="button" disabled={!robots.length} onClick={onNew}>
            <SquarePen aria-hidden="true" />
            新建对话
          </button>
        }
      />
      {/* 两组分别滚动，归档入口不会被进行中的条目推到窗口外。 */}
      <div className={styles.groups}>
        <section
          className={`${styles.group} ${styles.activeGroup}`}
          data-open={activeOpen}
        >
          <button
            className={styles.groupHeading}
            aria-expanded={activeOpen}
            aria-controls="active-conversations"
            onClick={() => setActiveOpen(!activeOpen)}
          >
            <ChevronDown aria-hidden="true" />
            <span>进行中</span>
            <small>{active.length}</small>
          </button>
          <div
            className={styles.list}
            id="active-conversations"
            hidden={!activeOpen}
          >
            {active.length ? (
              active.map(renderItem)
            ) : (
              <p className={styles.empty}>暂无进行中的对话</p>
            )}
          </div>
        </section>
        <section
          className={`${styles.group} ${styles.archivedGroup}`}
          data-open={archivedOpen}
        >
          <button
            className={styles.groupHeading}
            aria-expanded={archivedOpen}
            aria-controls="archived-conversations"
            onClick={() => setArchivedOpen(!archivedOpen)}
          >
            <ChevronDown aria-hidden="true" />
            <span>已归档</span>
            <small>{archived.length}</small>
          </button>
          <div
            className={styles.list}
            id="archived-conversations"
            hidden={!archivedOpen}
          >
            {archived.length ? (
              archived.map(renderItem)
            ) : (
              <p className={styles.empty}>暂无已归档的对话</p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
