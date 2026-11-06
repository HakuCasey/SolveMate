import { useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  MessagesSquare,
  SquarePen,
  Tag,
  Trash2,
  Check,
} from "lucide-react";
import { ContextMenu, Popover } from "radix-ui";
import type { Course, Conversation, Robot } from "@solvemate/contracts";
import styles from "./ConversationList.module.css";

interface Props {
  availableCourses: Course[];
  conversations: Conversation[];
  robots: Robot[];
  activeId: string | null;
  onOpen: (conversation: Conversation) => void;
  onNew: () => void;
  onUpdate: (
    id: string,
    change: Pick<Conversation, "label" | "archived">,
  ) => void;
  onDelete: (id: string) => void;
}

const presetLabels = ["重要", "一般", "无标签"];

export function ConversationList({
  availableCourses,
  conversations,
  robots,
  activeId,
  onOpen,
  onNew,
  onUpdate,
  onDelete,
}: Props) {
  const [activeOpen, setActiveOpen] = useState(true);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [labelTarget, setLabelTarget] = useState<string | null>(null);
  const [customLabel, setCustomLabel] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [labelError, setLabelError] = useState("");
  const customLabels = [
    ...new Set(
      conversations
        .map((item) => item.label)
        .filter(
          (label): label is string => !!label && !presetLabels.includes(label),
        ),
    ),
  ];

  function setLabel(id: string, label: string) {
    onUpdate(id, { label });
    setLabelTarget(null);
  }

  function renderItem(conversation: Conversation) {
    const course = availableCourses.find(
      (item) =>
        item.id === conversation.selection?.courseId &&
        (!conversation.selection.version ||
          item.version === conversation.selection.version),
    );
    const robot = robots.find((item) => item.id === conversation.robotId);
    const label = conversation.label || "无标签";
    return (
      <Popover.Root
        key={conversation.id}
        open={labelTarget === conversation.id}
        onOpenChange={(open) => {
          if (!open) setLabelTarget(null);
        }}
      >
        <ContextMenu.Root>
          <ContextMenu.Trigger asChild>
            <Popover.Anchor asChild>
              <button
                className={styles.item}
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
                  <small>
                    {conversation.selection
                      ? `${course?.title} · ${conversation.selection.itemId}`
                      : "普通对话"}{" "}
                    · {robot?.name ?? "未选择机器人"}
                  </small>
                  <span className={styles.preview}>
                    {conversation.messages
                      .filter((item) => item.role === "user")
                      .at(-1)?.content ?? "还没有消息"}
                  </span>
                </span>
              </button>
            </Popover.Anchor>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content
              className={styles.menu}
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <ContextMenu.Item
                className={styles.menuItem}
                onSelect={() => {
                  setCustomLabel(presetLabels.includes(label) ? "" : label);
                  setCustomOpen(false);
                  setLabelError("");
                  setLabelTarget(conversation.id);
                }}
              >
                <Tag aria-hidden="true" />
                标签
              </ContextMenu.Item>
              <ContextMenu.Item
                className={styles.menuItem}
                onSelect={() =>
                  onUpdate(conversation.id, {
                    archived: !conversation.archived,
                  })
                }
              >
                {conversation.archived ? (
                  <ArchiveRestore aria-hidden="true" />
                ) : (
                  <Archive aria-hidden="true" />
                )}
                {conversation.archived ? "移回进行中" : "归档"}
              </ContextMenu.Item>
              <ContextMenu.Separator className={styles.separator} />
              <ContextMenu.Item
                className={`${styles.menuItem} ${styles.delete}`}
                onSelect={() => onDelete(conversation.id)}
              >
                <Trash2 aria-hidden="true" />
                删除
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
        <Popover.Portal>
          <Popover.Content
            className={styles.popover}
            side="right"
            align="start"
            sideOffset={10}
            collisionPadding={12}
            aria-label="对话标签"
          >
            <h3>标签</h3>
            <div className={styles.labelOptions}>
              {[...presetLabels, ...customLabels].map((option) => (
                <button
                  key={option}
                  aria-pressed={label === option}
                  onClick={() => setLabel(conversation.id, option)}
                >
                  <span>{option}</span>
                  {label === option && <Check aria-hidden="true" />}
                </button>
              ))}
            </div>
            <button
              className={styles.customTrigger}
              aria-expanded={customOpen}
              onClick={() => setCustomOpen(!customOpen)}
            >
              自定义标签
            </button>
            {customOpen && (
              <form
                className={styles.customForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = customLabel.trim();
                  if (!value) {
                    setLabelError("请输入标签名称。");
                    return;
                  }
                  setLabel(conversation.id, value);
                }}
              >
                <label>
                  标签名称
                  <input
                    autoFocus
                    value={customLabel}
                    maxLength={24}
                    onChange={(event) => {
                      setCustomLabel(event.target.value);
                      setLabelError("");
                    }}
                  />
                </label>
                {labelError && <p role="alert">{labelError}</p>}
                <button type="submit">保存标签</button>
              </form>
            )}
            <Popover.Arrow className={styles.arrow} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  const active = conversations.filter((item) => !item.archived);
  const archived = conversations.filter((item) => item.archived);
  return (
    <section className={styles.library} aria-label="会话列表">
      <header className={styles.heading}>
        <div>
          <h2>对话</h2>
          <span>{conversations.length} 个会话</span>
        </div>
        <button
          className={styles.newButton}
          disabled={!robots.length}
          onClick={onNew}
        >
          <SquarePen aria-hidden="true" />
          新建对话
        </button>
      </header>
      {/* 两组分别滚动，归档入口不会被进行中的条目推到窗口外。 */}
      <div className={styles.groups}>
        <section className={styles.group} data-open={activeOpen}>
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
        <section className={styles.group} data-open={archivedOpen}>
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
