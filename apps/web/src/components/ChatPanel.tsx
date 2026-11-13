import { isConversationLimitError } from "../state/conversation-limits";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import {
  ArrowUp,
  Bot,
  ChevronDown,
  MessagesSquare,
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
import { ReplyActivity } from "./ReplyActivity";
import { Markdown } from "./Markdown";
import styles from "./ChatPanel.module.css";

const stoppedReplyNote = "已停止生成，内容可能不完整。";

interface ChatPanelProps extends ConversationActionsProps {
  focusMessage?: { id: string; request: number; conversationId: string };
  draft: string;
  onDraftChange: (draft: string) => void;
  robots: Robot[];
  robotId: string | null;
  conversation?: Conversation;
  contextLabel: string | null;
  recommendationsExpanded: boolean;
  onToggleRecommendations: () => void;
  onRobotChange: (id: string) => void;
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
  focusMessage,
  draft,
  onDraftChange: setDraft,
  robots,
  robotId,
  conversation,
  contextLabel,
  conversations,
  onUpdate,
  onDelete,
  recommendationsExpanded,
  onToggleRecommendations,
  onRobotChange,
  onSend,
  onRetryMessage,
  references,
  onRemoveReference,
  onOpenReference,
  ai,
  aiSelection,
  onAiSelectionSave,
}: ChatPanelProps) {
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
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
  const lastTurn = conversation?.turns?.at(-1);
  const lastObservedTurn = useRef(lastTurn);
  const turn = lastTurn ? ai.turns[lastTurn.id] : undefined;
  const busy = lastTurn?.status === "running" || sending;
  const connectionError = lastTurn ? ai.connectionErrors[lastTurn.id] : "";
  const currentReply = messages.find(
    (message) =>
      message.role === "assistant" && message.turnId === lastTurn?.id,
  );
  const effectiveAi = resolveConversationAi(conversation, robot, ai.settings);
  const configured = effectiveAi.configured;
  const failure = lastTurn?.error || turn?.error;
  const failedMessage = lastTurn
    ? messages.find(
        (message) =>
          message.role === "user" &&
          (message.id === lastTurn.userMessageId ||
            message.turnId === lastTurn.id),
      )
    : undefined;
  const prompts = [
    "可以把这里的推导过程详细讲一下吗？",
    "如何理解这段话，能举一个例子吗？",
  ];
  const managementButton = (
    <button
      className={styles.manage}
      type="button"
      aria-label="对话管理"
      title={conversation ? "对话管理" : "提问后可管理对话"}
      disabled={!conversation}
    >
      <MessagesSquare aria-hidden="true" />
      对话管理
    </button>
  );

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
    setSending(true);
    followReply.current = true;
    try {
      await onSend(value);
      setDraft("");
      setNotice("");
    } catch (error) {
      if (isConversationLimitError(error)) return;
      setNotice(
        error instanceof Error ? error.message : "问题未能保存，请重试。",
      );
    } finally {
      setSending(false);
    }
  }

  async function retryMessage(id: string) {
    if (busy || archived) return;
    setSending(true);
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
      setSending(false);
    }
  }

  const feedback = (
    <>
      {busy && lastTurn && (
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
          startedAt={lastTurn.startedAt}
          received={!!currentReply?.content}
          disconnected={!!connectionError}
        />
      )}
      {busy && archived && lastTurn && (
        <button
          className={styles.stopButton}
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
      aria-label="聊天栏"
      data-study-area="conversation"
    >
      <header className={styles.heading}>
        <span className={styles.avatar}>
          <Icon aria-hidden="true" />
        </span>
        <select
          aria-label="选择机器人"
          value={robot?.id ?? ""}
          title={robot?.name ?? conversation?.robotIdentity?.name ?? undefined}
          disabled={!robots.length || busy || archived}
          onChange={(event) => onRobotChange(event.target.value)}
        >
          {!robot && (
            <option value="">
              {conversation?.robotIdentity?.name
                ? `${conversation.robotIdentity.name}（已不可用）`
                : "未选择机器人"}
            </option>
          )}
          {robots.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        {conversation ? (
          <ConversationActions
            key={conversation.id}
            conversation={conversation}
            conversations={conversations}
            onUpdate={onUpdate}
            onDelete={onDelete}
          >
            {managementButton}
          </ConversationActions>
        ) : (
          managementButton
        )}
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
                title={`${robot.name} · ${effectiveAi.label}`}
                aria-label="打开 AI 选择"
              >
                <Brain aria-hidden="true" />
                <span>{!effectiveAi.error ? effectiveAi.label : ""}</span>
              </button>
            </AiSelectionPopover>
          )}
          {(!configured || effectiveAi.error) && (
            <small
              className={styles.configurationWarning}
              title={effectiveAi.error || "请先在设置中配置 AI"}
            >
              {effectiveAi.error || "请先在设置中配置 AI"}
            </small>
          )}
        </div>
      </header>
      <div className={styles.main}>
        <div
          className={styles.history}
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
                {!robot ? "先选择一位学习伙伴" : "同学你好，有什么疑问吗？"}
              </h3>
              <p>
                {!robot
                  ? "在左侧“机器人”中新建一个机器人，就可以记录想讨论的问题。"
                  : "大胆的和我讲吧，无论是没想明白的事，还是你自己的看法，都可以和我聊聊。我会认真回应，把理由和来龙去脉讲清楚。"}
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
                      <pre>{reference.content || "关联内容未能读取。"}</pre>
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
            (busy ||
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
          <p className={styles.archivedNotice}>
            对话已归档。在上方“对话管理”中移回进行中后，可继续提问。
          </p>
        ) : (
          <>
            {!!robot && (
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
                aria-label="向阅读助手提问"
                placeholder={
                  contextLabel
                    ? "围绕当前内容提问，也可以添加选段。"
                    : "有什么疑问或想法？"
                }
                rows={2}
                maxLength={10000}
                disabled={!robot || busy}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    submit(draft);
                  }
                }}
              />
              <div className={styles.composeBottom}>
                <div className={styles.composeMeta}>
                  {contextLabel && (
                    <span className={styles.context} title={contextLabel}>
                      <Link aria-hidden="true" />
                      <span>{contextLabel}</span>
                    </span>
                  )}
                  <span
                    className={styles.voice}
                    title="长按空格键可语音输入…（尚未开放）"
                  >
                    长按空格键可语音输入… <span>尚未开放</span>
                  </span>
                </div>
                {busy ? (
                  <button
                    className={styles.send}
                    type="button"
                    aria-label="停止生成"
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
                    disabled={!robot || !draft.trim()}
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
