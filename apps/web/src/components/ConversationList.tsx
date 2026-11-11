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
  Pencil,
  CornerUpLeft,
} from "lucide-react";
import { ContextMenu, Popover } from "radix-ui";
import type { Course, Conversation, Robot } from "@solvemate/contracts";
import type { ConversationChange } from "../state/conversations";
import styles from "./ConversationList.module.css";

interface Props {
  availableCourses: Course[];
  conversations: Conversation[];
  robots: Robot[];
  activeId: string | null;
  onOpen: (conversation: Conversation) => void;
  onReturn: (conversation: Conversation) => void;
  onNew: () => void;
  onUpdate: (
    id: string,
    change: ConversationChange,
    revision?: number,
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const presetLabels = ["重要", "一般", "无标签"];

export function ConversationList({
  availableCourses,
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
  const [labelTarget, setLabelTarget] = useState<string | null>(null);
  const [customLabel, setCustomLabel] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [labelError, setLabelError] = useState("");
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameError, setRenameError] = useState("");
  const customLabels = [
    ...new Set(
      conversations
        .map((item) => item.label)
        .filter(
          (label): label is string => !!label && !presetLabels.includes(label),
        ),
    ),
  ];

  async function setLabel(id: string, label: string) {
    try {
      await onUpdate(
        id,
        { label },
        conversations.find((item) => item.id === id)?.revision,
      );
      setLabelTarget(null);
    } catch (error) {
      setLabelError(error instanceof Error ? error.message : "标签未能保存。");
    }
  }

  function renderItem(conversation: Conversation) {
    const course = availableCourses.find(
      (item) =>
        item.id === conversation.selection?.courseId &&
        (!conversation.selection.version ||
          item.version === conversation.selection.version),
    );
    const selection = conversation.selection;
    const contentTitle = selection
      ? selection.kind === "textbooks"
        ? course?.textbooks.find((item) => item.id === selection.itemId)
            ?.chapters[selection.chapterIndex]?.title
        : course?.questions.find((item) => item.id === selection.itemId)?.title
      : null;
    const context = selection
      ? `${course?.title ?? "课程不可用"} · ${contentTitle ?? "关联内容不可用"}`
      : "普通对话";
    // 直接显示最近一次提问的原文，省略只由样式处理，不生成或保存摘要。
    const lastQuestion =
      conversation.messages.filter((item) => item.role === "user").at(-1)
        ?.content ?? "还没有提问";
    const label = conversation.label || "无标签";
    const renaming = renameTarget === conversation.id;
    return (
      <Popover.Root
        key={conversation.id}
        open={labelTarget === conversation.id || renaming}
        onOpenChange={(open) => {
          if (!open) {
            setLabelTarget(null);
            setRenameTarget(null);
          }
        }}
      >
        <ContextMenu.Root>
          <ContextMenu.Trigger asChild>
            <Popover.Anchor asChild>
              <div
                className={styles.item}
                data-active={conversation.id === activeId}
              >
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
                  setLabelTarget(null);
                  setRenameTitle(conversation.title);
                  setRenameError("");
                  setRenameTarget(conversation.id);
                }}
              >
                <Pencil aria-hidden="true" />
                重命名
              </ContextMenu.Item>
              <ContextMenu.Item
                className={styles.menuItem}
                onSelect={() => {
                  setRenameTarget(null);
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
                onSelect={() => {
                  void onUpdate(
                    conversation.id,
                    {
                      status:
                        conversation.status === "archived"
                          ? "active"
                          : "archived",
                    },
                    conversation.revision,
                  ).catch((error) => setLabelError(String(error)));
                }}
              >
                {conversation.status === "archived" ? (
                  <ArchiveRestore aria-hidden="true" />
                ) : (
                  <Archive aria-hidden="true" />
                )}
                {conversation.status === "archived" ? "移回进行中" : "归档"}
              </ContextMenu.Item>
              <ContextMenu.Separator className={styles.separator} />
              <ContextMenu.Item
                className={`${styles.menuItem} ${styles.delete}`}
                onSelect={() => {
                  void onDelete(conversation.id).catch((error) =>
                    setLabelError(String(error)),
                  );
                }}
              >
                <Trash2 aria-hidden="true" />
                删除
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
        <Popover.Portal>
          <Popover.Content
            className={`${styles.popover} ${renaming ? styles.renamePopover : ""}`}
            side={renaming ? "bottom" : "right"}
            align="start"
            sideOffset={10}
            collisionPadding={12}
            aria-label={renaming ? "重命名对话" : "对话标签"}
          >
            {renaming ? (
              <>
                <h3>重命名对话</h3>
                <form
                  className={styles.renameForm}
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const title = renameTitle.trim();
                    if (!title) {
                      setRenameError("请输入对话名称。");
                      return;
                    }
                    try {
                      await onUpdate(
                        conversation.id,
                        { title },
                        conversation.revision,
                      );
                      setRenameTarget(null);
                    } catch (error) {
                      setRenameError(
                        error instanceof Error
                          ? error.message
                          : "名称未能保存。",
                      );
                    }
                  }}
                >
                  <label>
                    对话名称
                    <input
                      value={renameTitle}
                      maxLength={100}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => {
                        setRenameTitle(event.target.value);
                        setRenameError("");
                      }}
                      aria-invalid={!!renameError}
                    />
                  </label>
                  {renameError && <p role="alert">{renameError}</p>}
                  <div className={styles.renameActions}>
                    <button type="button" onClick={() => setRenameTarget(null)}>
                      取消
                    </button>
                    <button type="submit">保存</button>
                  </div>
                </form>
              </>
            ) : (
              <>
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
              </>
            )}
            <Popover.Arrow className={styles.arrow} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
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
      <header className={styles.heading}>
        <div>
          <h2>对话</h2>
          <span>{conversations.length} 个会话</span>
          {labelError && !labelTarget && <p role="alert">{labelError}</p>}
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
