import { isConversationLimitError } from "../state/conversation-limits";
import { Popover, Slider } from "radix-ui";
import { SettingsSelect } from "./SettingsSelect";
import { PopoverPanel } from "./PopoverPanel";
import {
  type CSSProperties,
  Fragment,
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  ArrowUp,
  Bot,
  ChevronDown,
  MessagesSquare,
  Plus,
  LoaderCircle,
  GraduationCap,
  Link,
  Sparkles,
  Square,
  Brain,
  X,
} from "lucide-react";
import type {
  Conversation,
  Robot,
  ReadingReference,
  RobotAiDefaults,
} from "@solvemate/contracts";
import { AiSelectionPopover } from "./AiSelectionPopover";
import { liveTurnFor } from "../ai/state";
import { resolveConversationAi } from "../ai/robot-config";
import type { AiService } from "../ai/useAiService";
import {
  messageReadingReferences,
  makeMessageReference,
  referencePreview,
  type DraftReference,
} from "../reading/reference";
import {
  ConversationActions,
  type ConversationActionsProps,
} from "./ConversationActions";
import { useReadingSelection } from "../reading/useReadingSelection";
import { ReplyActivity, ReplyTimer } from "./ReplyActivity";
import { Markdown } from "./Markdown";
import {
  ReadingContextControl,
  type ReadingPageSelection,
} from "./ReadingContextControl";
import paneHeader from "./PaneHeader.module.css";
import styles from "./ChatPanel.module.css";

// AI 推荐问题功能未实现，暂不向用户展示推荐栏。
const showRecommendedQuestions = false;

const stoppedReplyNote = "已停止生成，内容可能不完整。";

interface ChatPanelProps extends ConversationActionsProps {
  researchMode?: boolean;
  fontSize: number;
  onFontSizeChange: (fontSize: number) => void;
  suggestions?: string[];
  focusMessage?: { id: string; request: number; conversationId: string };
  draft: string;
  onDraftChange: (draft: string) => void;
  robots: Robot[];
  robotId: string | null;
  conversation?: Conversation;
  contextLabel: string | null;
  pageSelection?: ReadingPageSelection;
  recommendationsExpanded: boolean;
  onToggleRecommendations: () => void;
  onRobotChange: (id: string) => void;
  tabs: Conversation[];
  onSelectTab: (conversation: Conversation) => void;
  onNew: () => Promise<void>;
  onSend: (text: string) => Promise<void>;
  onRetryMessage: (id: string) => Promise<void>;
  references: DraftReference[];
  onRemoveReference: (id: string) => void;
  onOpenReference: (reference: ReadingReference) => void;
  ai: AiService;
  aiSelection: RobotAiDefaults;
  onAiSelectionSave: (config: RobotAiDefaults) => Promise<void>;
}

export function ChatPanel({
  researchMode = false,
  fontSize,
  onFontSizeChange,
  suggestions,
  focusMessage,
  draft,
  onDraftChange: setDraft,
  robots,
  robotId,
  conversation,
  contextLabel,
  pageSelection,
  conversations,
  onUpdate,
  onDelete,
  recommendationsExpanded,
  onToggleRecommendations,
  onRobotChange,
  tabs,
  onSelectTab,
  onNew,
  onSend,
  onRetryMessage,
  references,
  onRemoveReference,
  onOpenReference,
  ai,
  aiSelection,
  onAiSelectionSave,
}: ChatPanelProps) {
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const [previewSize, setPreviewSize] = useState<number | null>(null);
  const displayedSize = previewSize ?? fontSize;
  const [submission, setSubmission] = useState<"send" | "retry" | null>(null);
  const recommendationsId = useId();
  const history = useRef<HTMLDivElement>(null);
  const followReply = useRef(true);
  const robot = robots.find((item) => item.id === robotId);
  const Icon =
    robot?.icon === "graduation-cap"
      ? GraduationCap
      : robot?.icon === "sparkles"
        ? Sparkles
        : Bot;
  const messages = conversation?.messages ?? [];
  const lastSentText = [...messages]
    .reverse()
    .find((message) => message.role === "user" && !message.example)?.content;
  const selectedText = useReadingSelection(
    history,
    conversation?.id ?? "",
    !!conversation,
    (selection) => {
      if (!conversation) throw new Error("当前对话不可用，请重新打开。");
      return makeMessageReference(
        conversation,
        selection.messageIds ?? [],
        selection.text,
      );
    },
  );
  const archived = conversation?.status === "archived";
  const savedTurn = conversation?.turns?.at(-1);
  const turn = liveTurnFor(savedTurn, savedTurn && ai.turns[savedTurn.id]);
  const lastTurn = turn ?? savedTurn;
  const lastObservedTurn = useRef(lastTurn);
  const running = lastTurn?.status === "running";
  const busy = running || submission !== null;
  const canStop = running && lastTurn.submissionStatus === "accepted";
  const connectionError = lastTurn ? ai.connectionErrors[lastTurn.id] : "";
  const currentReply = messages.find(
    (message) =>
      message.role === "assistant" && message.turnId === lastTurn?.id,
  );
  const effectiveAi = resolveConversationAi(conversation, robot, ai.settings);

  const failure = lastTurn?.error || turn?.error;
  const failedMessage = lastTurn
    ? messages.find(
        (message) =>
          message.role === "user" &&
          (message.id === lastTurn.userMessageId ||
            message.turnId === lastTurn.id),
      )
    : undefined;
  const prompts = suggestions ?? [
    "可以把这里的推导过程详细讲一下吗？",
    "如何理解这段话，能举一个例子吗？",
  ];
  const tabList = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const strip = tabList.current;
    const selected = strip?.querySelector<HTMLElement>(
      '[aria-selected="true"]',
    );
    if (!strip || !selected) return;
    const bounds = strip.getBoundingClientRect();
    const tab = selected.getBoundingClientRect();
    if (tab.right > bounds.right) strip.scrollLeft += tab.right - bounds.right;
    else if (tab.left < bounds.left) strip.scrollLeft += tab.left - bounds.left;
  }, [conversation?.id, tabs.length]);

  function selectTab(item: Conversation) {
    onSelectTab(item);
    requestAnimationFrame(() =>
      document
        .getElementById(`chat-tab-${item.id}`)
        ?.focus({ preventScroll: true }),
    );
  }

  const latestContent = messages.at(-1)?.content;
  useEffect(() => {
    const previous = lastObservedTurn.current;
    lastObservedTurn.current = lastTurn;
    // 仅对当前页面刚发生的恢复失败弹窗，重开历史记录或取消后不反复打扰。
    if (
      previous?.id === lastTurn?.id &&
      previous?.status === "running" &&
      lastTurn?.status === "failed" &&
      lastTurn.errorCode === "session_missing" &&
      lastTurn.connectionId === conversation?.aiConfig.connectionId &&
      lastTurn.userMessageId &&
      !archived
    )
      void onRetryMessage(lastTurn.userMessageId).catch((error: unknown) =>
        setNotice(
          error instanceof Error ? error.message : "无法重新发起会话，请重试。",
        ),
      );
  }, [lastTurn, archived, onRetryMessage, conversation?.aiConfig.connectionId]);
  useEffect(() => {
    if (followReply.current)
      history.current?.scrollTo({ top: history.current.scrollHeight });
  }, [
    messages.length,
    latestContent,
    conversation?.id,
    busy,
    turn?.phase,
    connectionError,
  ]);

  useEffect(() => {
    if (!focusMessage || focusMessage.conversationId !== conversation?.id)
      return;
    const node = history.current?.querySelector<HTMLElement>(
      `[data-message-content="${CSS.escape(focusMessage.id)}"]`,
    );
    if (node) {
      followReply.current = false;
      node.scrollIntoView({ block: "center" });
      node.focus({ preventScroll: true });
    }
  }, [focusMessage, conversation?.id]);

  async function submit(text: string) {
    const value = text.trim();
    if (!value || !robot || busy || archived) return;
    setSubmission("send");
    followReply.current = true;
    try {
      await onSend(value);
      setNotice("");
    } catch (error) {
      if (isConversationLimitError(error)) return;
      setNotice(
        error instanceof Error ? error.message : "问题未能保存，请重试。",
      );
    } finally {
      setSubmission(null);
    }
  }

  async function retryMessage(id: string) {
    if (busy || archived) return;
    setSubmission("retry");
    followReply.current = true;
    setNotice("");
    try {
      await onRetryMessage(id);
    } catch (error) {
      if (!isConversationLimitError(error))
        setNotice(
          error instanceof Error ? error.message : "重试未能保存，请重试。",
        );
    } finally {
      setSubmission(null);
    }
  }

  const feedback = (
    <>
      {running && lastTurn && (
        <ReplyActivity
          key={lastTurn.id}
          phase={
            turn?.phase ??
            lastTurn.phase ??
            (turn
              ? currentReply?.content
                ? "responding"
                : "waiting"
              : "queued")
          }
          startedAt={savedTurn!.startedAt}
          received={!!currentReply?.content}
          disconnected={!!connectionError}
        />
      )}
      {running && archived && lastTurn && (
        <button
          className={styles.stopButton}
          disabled={!canStop}
          onClick={() => void ai.cancel(lastTurn.id)}
        >
          <Square aria-hidden="true" />
          停止生成
        </button>
      )}
      {turn?.tools && turn.tools.length > 0 && (
        <details className={styles.tools}>
          <summary>工具执行 · {turn.tools.length}</summary>
          {turn.tools.map((tool) => (
            <p key={tool.id}>
              {tool.title} ·{" "}
              {{
                pending: "等待中",
                in_progress: "执行中",
                completed: "已完成",
                failed: "失败",
              }[tool.status] ?? tool.status}
            </p>
          ))}
        </details>
      )}
      {turn?.permissions.map((permission) => (
        <section
          className={styles.permission}
          key={permission.id}
          aria-label="工具权限请求"
        >
          <p>{permission.title}</p>
          <div>
            {permission.options.map((option) => (
              <button
                key={option.optionId}
                onClick={() =>
                  void ai.decide(turn.id, permission.id, option.optionId)
                }
              >
                {option.kind === "allow_once" ? "允许本次" : "拒绝本次"}
              </button>
            ))}
          </div>
        </section>
      ))}
      {busy && connectionError && (
        <p className={styles.failure} role="alert">
          {connectionError}
          <button
            onClick={() => {
              if (conversation && lastTurn)
                void ai.restore(conversation.id, [lastTurn.id]);
            }}
          >
            重新查询
          </button>
        </p>
      )}
      {failure && (
        <div className={styles.failure} role="alert">
          <p>{failure}</p>
          {!busy &&
          !archived &&
          lastTurn?.submissionStatus === "uncertain" &&
          conversation ? (
            <button
              onClick={() => void ai.restore(conversation.id, [lastTurn.id])}
            >
              重新查询
            </button>
          ) : !busy &&
            !archived &&
            failedMessage &&
            !conversation?.turns.some(
              (item) =>
                item.userMessageId === failedMessage.id &&
                item.status === "completed",
            ) ? (
            <button onClick={() => void retryMessage(failedMessage.id)}>
              {lastTurn?.errorCode === "session_missing"
                ? "重新发起会话"
                : "重试回复"}
            </button>
          ) : null}
        </div>
      )}

      {!busy && lastTurn?.status === "cancelled" && (
        <p className={styles.replyNote} role="status">
          {stoppedReplyNote}
        </p>
      )}
      {!busy && lastTurn?.status === "interrupted" && !failure && (
        <p className={styles.replyNote} role="status">
          生成已中断，已收到的内容仍保留。
        </p>
      )}
    </>
  );

  return (
    <section
      className={styles.chat}
      style={{ "--sm-chat-font-size": `${displayedSize}px` } as CSSProperties}
      aria-label="聊天栏"
      data-study-area="conversation"
    >
      <header className={styles.heading}>
        <Icon className={paneHeader.titleIcon} aria-hidden="true" />
        <SettingsSelect
          className={styles.robotPicker}
          label="选择机器人"
          title={robot?.name ?? conversation?.robotIdentity?.name ?? undefined}
          value={robot?.id ?? ""}
          placeholder={
            conversation?.robotIdentity?.name
              ? `${conversation.robotIdentity.name}（已不可用）`
              : "未选择机器人"
          }
          options={robots.map((item) => ({ value: item.id, name: item.name }))}
          disabled={!robots.length || busy || archived}
          onValueChange={onRobotChange}
        />
        <div className={styles.conversationTab}>
          <div
            className={styles.tabList}
            role="tablist"
            aria-label="对话页签"
            ref={tabList}
            onKeyDown={(event) => {
              if (!event.currentTarget.contains(event.target as Node)) return;
              const index = tabs.findIndex(
                (item) => item.id === conversation?.id,
              );
              if (index < 0) return;
              let next;
              switch (event.key) {
                case "ArrowRight":
                  next = (index + 1) % tabs.length;
                  break;
                case "ArrowLeft":
                  next = (index + tabs.length - 1) % tabs.length;
                  break;
                case "Home":
                  next = 0;
                  break;
                case "End":
                  next = tabs.length - 1;
                  break;
                default:
                  return;
              }
              event.preventDefault();
              selectTab(tabs[next]);
            }}
          >
            {tabs.map((item) => {
              const active = item.id === conversation?.id;
              const saved = item.turns.at(-1);
              const turn =
                liveTurnFor(saved, saved && ai.turns[saved.id]) ?? saved;
              const generating = turn?.status === "running";
              const button = (
                <button
                  id={`chat-tab-${item.id}`}
                  role="tab"
                  aria-label={item.title}
                  aria-selected={active}
                  aria-controls={active ? "chat-history-panel" : undefined}
                  tabIndex={active || !conversation ? 0 : -1}
                  className={styles.manage}
                  type="button"
                  title={item.title}
                  onClick={active ? undefined : () => selectTab(item)}
                >
                  {generating ? (
                    <LoaderCircle
                      className={styles.activitySpinner}
                      aria-hidden="true"
                    />
                  ) : (
                    <MessagesSquare aria-hidden="true" />
                  )}
                  <span className={styles.tabTitle}>{item.title}</span>
                  {generating && saved && (
                    <ReplyTimer key={saved.id} startedAt={saved.startedAt} />
                  )}
                </button>
              );
              return (
                <ConversationActions
                  key={item.id}
                  conversation={item}
                  conversations={conversations}
                  onUpdate={onUpdate}
                  onDelete={onDelete}
                >
                  {button}
                </ConversationActions>
              );
            })}
            {!conversation && <span className={styles.emptyTab}>新对话</span>}
          </div>
          <button
            className={styles.newChat}
            type="button"
            aria-label="在聊天栏新建对话"
            title="新建对话"
            disabled={creating || submission !== null || !robots.length}
            onClick={async () => {
              setCreating(true);
              try {
                await onNew();
              } finally {
                setCreating(false);
              }
            }}
          >
            <Plus aria-hidden="true" />
          </button>
        </div>
        <div className={styles.chatSettings}>
          <Popover.Root
            onOpenChange={(open) => {
              if (!open) setPreviewSize(null);
            }}
          >
            <Popover.Trigger
              className={styles.fontTrigger}
              aria-label="调整对话字号"
              title="对话字号"
            >
              Aa
            </Popover.Trigger>
            <Popover.Portal>
              <PopoverPanel
                aria-label="对话字号"
                width={232}
                padding={12}
                align="end"
              >
                <div className={styles.fontRow}>
                  <span>对话字号</span>
                  <Slider.Root
                    className={styles.fontSlider}
                    min={8}
                    max={21}
                    step={1}
                    value={[displayedSize]}
                    onValueChange={([size]) => setPreviewSize(size)}
                    onValueCommit={([size]) => {
                      onFontSizeChange(size);
                      setPreviewSize(null);
                    }}
                  >
                    <Slider.Track className={styles.fontTrack}>
                      <Slider.Range />
                    </Slider.Track>
                    <Slider.Thumb
                      className={styles.fontThumb}
                      aria-label="对话字号"
                      aria-valuetext={`${displayedSize}px`}
                    />
                  </Slider.Root>
                  <output>{displayedSize}px</output>
                </div>
              </PopoverPanel>
            </Popover.Portal>
          </Popover.Root>
          <div className={styles.connectionGroup}>
            {robot && (
              <AiSelectionPopover
                key={conversation?.id ?? robot.id}
                robot={robot}
                saved={aiSelection}
                scopeId={conversation?.id ?? robot.id}
                ai={ai}
                onSave={onAiSelectionSave}
              >
                <button
                  className={styles.connection}
                  disabled={busy || archived}
                  title={
                    effectiveAi.error || `${robot.name} · ${effectiveAi.label}`
                  }
                  aria-description={effectiveAi.error || undefined}
                  aria-label="打开 AI 选择"
                >
                  <Brain aria-hidden="true" />
                  <span>{effectiveAi.label}</span>
                </button>
              </AiSelectionPopover>
            )}
          </div>
        </div>
      </header>
      <div className={styles.main}>
        <div
          className={styles.history}
          role="tabpanel"
          id="chat-history-panel"
          aria-labelledby={
            conversation ? `chat-tab-${conversation.id}` : undefined
          }
          ref={history}
          onMouseUp={selectedText.onMouseUp}
          onTouchEnd={selectedText.onTouchEnd}
          onKeyUp={selectedText.onKeyUp}
          aria-label="聊天记录"
          onScroll={() => {
            const element = history.current;
            if (element)
              followReply.current =
                element.scrollHeight -
                  element.scrollTop -
                  element.clientHeight <
                80;
          }}
        >
          {!messages.length && !archived && (
            <div className={styles.welcome}>
              <h3>
                {!robot
                  ? "请先选择机器人"
                  : researchMode
                    ? "需要完成什么任务？"
                    : "有什么想讨论的？"}
              </h3>
              <p>
                {!robot
                  ? "在左侧“机器人”中新建一个机器人，就可以记录想讨论的问题。"
                  : researchMode
                    ? "说明内容范围和具体要求，生成后可以继续提出修改意见。"
                    : "可以提出问题，也可以说说你的理解和想法。"}
              </p>
            </div>
          )}
          {conversation?.example && (
            <p className={styles.example}>以下为示例对话，未调用 AI 服务。</p>
          )}
          {messages.map((message) => {
            const associatedTurn = conversation?.turns?.find(
              (item) => item.id === message.turnId,
            );
            const olderTerminal =
              associatedTurn &&
              associatedTurn.id !== lastTurn?.id &&
              associatedTurn.status !== "running" &&
              associatedTurn.status !== "completed";
            const terminalText =
              associatedTurn?.error ||
              (associatedTurn?.status === "cancelled"
                ? stoppedReplyNote
                : "生成已中断，已收到的内容仍保留。");
            const missingReply =
              message.role === "user" &&
              olderTerminal &&
              !messages.some(
                (item) =>
                  item.role === "assistant" &&
                  item.turnId === associatedTurn.id,
              );
            const author = robots.find((item) => item.id === message.botId);
            const authorIcon = message.botIcon ?? author?.icon;
            const AuthorIcon =
              authorIcon === "graduation-cap"
                ? GraduationCap
                : authorIcon === "sparkles"
                  ? Sparkles
                  : Bot;
            return (
              <Fragment key={message.id}>
                <article
                  className={
                    message.role === "user"
                      ? styles.userMessage
                      : styles.assistantMessage
                  }
                >
                  {message.role === "assistant" && (
                    <div className={styles.author}>
                      <AuthorIcon aria-hidden="true" />
                      {message.botName ?? author?.name ?? "机器人"}
                      {associatedTurn?.status === "cancelled" && (
                        <span className={styles.stoppedBadge}>
                          <Square aria-hidden="true" />
                          已停止
                        </span>
                      )}
                    </div>
                  )}
                  {message.example && (
                    <small className={styles.example}>示例记录</small>
                  )}
                  {messageReadingReferences(message).map((reference, index) => (
                    <details className={styles.reference} key={index}>
                      <summary>
                        {reference === message.readingContext
                          ? `关联：${reference.title}`
                          : `引用：${referencePreview(reference.content)}`}
                      </summary>
                      <button
                        type="button"
                        className={styles.returnReference}
                        onClick={() => onOpenReference(reference)}
                      >
                        {reference.message ? "返回原消息" : "返回原文"}
                      </button>
                      {reference.content ? (
                        <pre>{reference.content}</pre>
                      ) : reference.pageNumbers?.length ? (
                        <p>已关联原 PDF 的指定页码。</p>
                      ) : (
                        <pre>关联内容未能读取。</pre>
                      )}
                    </details>
                  ))}
                  <div data-message-content={message.id} tabIndex={-1}>
                    <Markdown>{message.content}</Markdown>
                  </div>
                  {message.id === currentReply?.id && feedback}
                  {message.role === "assistant" && olderTerminal && (
                    <p className={styles.replyNote}>{terminalText}</p>
                  )}
                </article>
                {missingReply && (
                  <article
                    className={styles.assistantMessage}
                    aria-label="执行结果"
                  >
                    <div className={styles.author}>
                      {ai.turns[associatedTurn.id]?.teacher.name ?? "机器人"}
                    </div>
                    <p className={styles.replyNote}>{terminalText}</p>
                    {!busy &&
                      !archived &&
                      !!robot &&
                      (associatedTurn.submissionStatus === "uncertain" ? (
                        <button
                          onClick={() => {
                            if (conversation)
                              void ai.restore(conversation.id, [
                                associatedTurn.id,
                              ]);
                          }}
                        >
                          重新查询
                        </button>
                      ) : (
                        <button onClick={() => void retryMessage(message.id)}>
                          {associatedTurn.errorCode === "session_missing"
                            ? "重新发起会话"
                            : "重试回复"}
                        </button>
                      ))}
                  </article>
                )}
              </Fragment>
            );
          })}
          {!currentReply &&
            lastTurn &&
            (running ||
              failure ||
              lastTurn.status === "cancelled" ||
              lastTurn.status === "interrupted") && (
              <article
                className={`${styles.assistantMessage} ${styles.pendingReply}`}
                aria-label="机器人回复"
              >
                <div className={styles.author}>
                  <Icon aria-hidden="true" />
                  {turn?.teacher.name ?? robot?.name ?? "机器人"}
                </div>
                {feedback}
              </article>
            )}
        </div>
        {archived ? (
          <ArchivedNotice
            key={conversation.id}
            conversation={conversation}
            onUpdate={onUpdate}
          />
        ) : (
          <>
            {showRecommendedQuestions && !!robot && (
              <section
                className={styles.recommendations}
                aria-label="AI 推荐问题"
              >
                <button
                  className={styles.recommendationToggle}
                  type="button"
                  aria-label={
                    recommendationsExpanded ? "收起推荐问题" : "展开推荐问题"
                  }
                  aria-expanded={recommendationsExpanded}
                  aria-controls={recommendationsId}
                  onClick={onToggleRecommendations}
                >
                  <Sparkles aria-hidden="true" />
                  推荐问题
                  <ChevronDown
                    className={styles.recommendationChevron}
                    aria-hidden="true"
                  />
                </button>
                <div
                  id={recommendationsId}
                  className={styles.suggestions}
                  hidden={!recommendationsExpanded}
                >
                  {prompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className={styles.suggestion}
                      title={prompt}
                      disabled={busy}
                      onClick={() => submit(prompt)}
                    >
                      <span>{prompt}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            <form
              className={styles.compose}
              onSubmit={(event) => {
                event.preventDefault();
                submit(draft);
              }}
            >
              {!!references.length && (
                <div className={styles.quoteList} aria-label="待发送引用">
                  {references.map(({ id, reference }) => (
                    <div key={id} className={styles.quoteDraft}>
                      <div>
                        <span>{referencePreview(reference.content)}</span>
                        <button
                          type="button"
                          onClick={() => onRemoveReference(id)}
                          aria-label={`删除引用：${referencePreview(reference.content)}`}
                        >
                          <X aria-hidden="true" />
                        </button>
                      </div>
                      <details>
                        <summary>查看引用内容</summary>
                        <pre>{reference.content}</pre>
                      </details>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                aria-label={
                  researchMode ? "提出教研任务要求" : "向阅读助手提问"
                }
                placeholder={
                  researchMode
                    ? "描述你想完成的任务，或提出修改要求…"
                    : contextLabel
                      ? "围绕当前内容提问，也可以添加选段。"
                      : "有什么疑问或想法？"
                }
                rows={2}
                maxLength={10000}
                disabled={!robot || busy}
                value={submission === "send" ? "" : draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    submit(draft);
                  } else if (
                    event.key === "ArrowUp" &&
                    !draft.trim() &&
                    !event.shiftKey &&
                    !event.altKey &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    lastSentText
                  ) {
                    event.preventDefault();
                    setDraft(lastSentText);
                  }
                }}
              />
              <div className={styles.composeBottom}>
                <div className={styles.composeMeta}>
                  {contextLabel &&
                    (pageSelection ? (
                      <ReadingContextControl
                        label={contextLabel}
                        selection={pageSelection}
                      />
                    ) : (
                      <span className={styles.context} title={contextLabel}>
                        <Link aria-hidden="true" />
                        <span>{contextLabel}</span>
                      </span>
                    ))}
                  <span
                    className={styles.voice}
                    title="长按空格键可语音输入…（尚未开放）"
                  >
                    长按空格键可语音输入… <span>尚未开放</span>
                  </span>
                </div>
                {running ? (
                  <button
                    className={styles.send}
                    type="button"
                    aria-label="停止生成"
                    disabled={!canStop}
                    onClick={() => {
                      if (lastTurn) void ai.cancel(lastTurn.id);
                    }}
                  >
                    <Square aria-hidden="true" />
                  </button>
                ) : (
                  <button
                    className={styles.send}
                    type="submit"
                    aria-label="提问"
                    disabled={busy || !robot || !draft.trim()}
                  >
                    <ArrowUp aria-hidden="true" />
                  </button>
                )}
              </div>
            </form>
            {notice && (
              <p className={styles.notice} role="status">
                {notice}
              </p>
            )}
          </>
        )}
      </div>
      {selectedText.overlay}
    </section>
  );
}

function ArchivedNotice({
  conversation,
  onUpdate,
}: {
  conversation: Conversation;
  onUpdate: ConversationActionsProps["onUpdate"];
}) {
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState("");
  async function restore() {
    setRestoring(true);
    setError("");
    try {
      await onUpdate(
        conversation.id,
        { status: "active" },
        conversation.revision,
      );
    } catch (failure) {
      if (!isConversationLimitError(failure))
        setError(
          failure instanceof Error ? failure.message : "恢复对话失败，请重试。",
        );
    } finally {
      setRestoring(false);
    }
  }
  return (
    <p className={styles.archivedNotice}>
      对话已归档
      <button type="button" disabled={restoring} onClick={() => void restore()}>
        移回进行中
      </button>
      {error && <span role="alert">{error}</span>}
    </p>
  );
}
