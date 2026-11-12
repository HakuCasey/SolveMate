import { Fragment, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Bot,
  CornerDownLeft,
  GraduationCap,
  Link,
  Sparkles,
  Square,
  Settings2,
  X,
} from "lucide-react";
import type {
  Conversation,
  Robot,
  ReadingReference,
} from "@solvemate/contracts";
import { resolveConversationAi } from "../ai/robot-config";
import type { AiService } from "../ai/useAiService";
import {
  messageReferences,
  referencePreview,
  type DraftReference,
} from "../reading/reference";
import { ReplyActivity } from "./ReplyActivity";
import { Markdown } from "./Markdown";
import styles from "./ChatPanel.module.css";

interface ChatPanelProps {
  robots: Robot[];
  robotId: string | null;
  conversation?: Conversation;
  contextLabel: string | null;
  textbook: boolean;
  onRobotChange: (id: string) => void;
  onSend: (text: string) => Promise<void>;
  references: DraftReference[];
  onRemoveReference: (id: string) => void;
  onOpenReference: (reference: ReadingReference) => void;
  ai: AiService;
  onConfigure: () => void;
  aiSettingsOpen: boolean;
}

export function ChatPanel({
  robots,
  robotId,
  conversation,
  contextLabel,
  textbook,
  onRobotChange,
  onSend,
  references,
  onRemoveReference,
  onOpenReference,
  ai,
  onConfigure,
  aiSettingsOpen,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
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
  const archived = conversation?.status === "archived";
  const lastTurn = conversation?.turns?.at(-1);
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
  const lastUserText =
    turn?.text ||
    [...messages].reverse().find((message) => message.role === "user")?.content;
  const prompts = !contextLabel
    ? ["能帮我理清这个想法吗？", "我们可以从哪些方面讨论？"]
    : textbook
      ? ["这一节的核心概念是什么？", "能举一个本节的例子吗？"]
      : ["用到了哪些概念或公式？", "能把关键步骤展开讲吗？"];

  const latestContent = messages.at(-1)?.content;
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

  async function submit(text: string) {
    const value = text.trim();
    if (!value || !robot || busy || archived) return;
    if (configured && effectiveAi.error) {
      setNotice(effectiveAi.error);
      return;
    }
    setSending(true);
    followReply.current = true;
    try {
      await onSend(value);
      setDraft("");
      setNotice(
        configured ? "" : "问题已保存在本地。请配置 AI 连接后继续提问。",
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "问题未能保存，请重试。",
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
          ) : !busy && !archived && lastUserText ? (
            <button onClick={() => submit(lastUserText)}>重新提问</button>
          ) : null}
        </div>
      )}

      {!busy && lastTurn?.status === "cancelled" && (
        <p className={styles.replyNote} role="status">
          已停止生成，已收到的内容仍保留。
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
    <section className={styles.chat} aria-label="聊天栏">
      <header className={styles.heading}>
        <span className={styles.avatar}>
          <Icon aria-hidden="true" />
        </span>
        <select
          aria-label="选择机器人"
          value={robot?.id ?? ""}
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
        <div className={styles.connectionGroup}>
          <button
            className={styles.connection}
            onClick={onConfigure}
            title={`${robot?.name ?? "机器人"} · ${effectiveAi.label}`}
            aria-label="打开 AI 配置"
            aria-haspopup="dialog"
            aria-expanded={aiSettingsOpen}
            aria-controls={aiSettingsOpen ? "ai-settings-popover" : undefined}
          >
            <Settings2 aria-hidden="true" />
            <span>
              {configured || effectiveAi.hasSelection ? effectiveAi.label : ""}
            </span>
          </button>
          {(!configured || effectiveAi.error) && (
            <small className={styles.configurationWarning}>
              {effectiveAi.error || "请先在设置中配置 AI"}
            </small>
          )}
        </div>
      </header>
      <div className={styles.main}>
        <div
          className={styles.history}
          ref={history}
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
                ? "已停止生成，已收到的内容仍保留。"
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
                    </div>
                  )}
                  {message.example && (
                    <small className={styles.example}>示例记录</small>
                  )}
                  {messageReferences(message).map((reference, index) => (
                    <details className={styles.reference} key={index}>
                      <summary>
                        引用：{referencePreview(reference.content)}
                      </summary>
                      <button
                        type="button"
                        className={styles.returnReference}
                        onClick={() => onOpenReference(reference)}
                      >
                        返回原文
                      </button>
                      <pre>{reference.content}</pre>
                    </details>
                  ))}
                  <Markdown>{message.content}</Markdown>
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
                aria-label="教师回复"
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
            对话已归档。右键选择“移回进行中”后可继续提问。
          </p>
        ) : (
          <>
            {!!robot && !messages.length && !busy && (
              <section
                className={styles.recommendations}
                aria-label="推荐问题示例"
              >
                <p>
                  <Sparkles aria-hidden="true" />
                  AI 推荐问题<span>示例</span>
                </p>
                {prompts.map((prompt) => (
                  <button
                    key={prompt}
                    className={styles.suggestion}
                    onClick={() => submit(prompt)}
                  >
                    <span>{prompt}</span>
                    <CornerDownLeft aria-hidden="true" />
                  </button>
                ))}
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
                placeholder="选中内容，添加到侧边聊天后提问。"
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
                {contextLabel && (
                  <span className={styles.context}>
                    <Link aria-hidden="true" />
                    {contextLabel}
                  </span>
                )}
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
            <p className={styles.voice}>
              长按空格键可语音输入… <span>尚未开放</span>
            </p>
          </>
        )}
      </div>
    </section>
  );
}
