import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Bot,
  CornerDownLeft,
  GraduationCap,
  Link,
  Sparkles,
} from "lucide-react";
import type { Conversation, Robot } from "@solvemate/contracts";
import { unavailableAiConnection } from "../ai";
import { Markdown } from "./Markdown";
import styles from "./ChatPanel.module.css";

interface ChatPanelProps {
  robots: Robot[];
  robotId: string | null;
  conversation?: Conversation;
  contextLabel: string | null;
  textbook: boolean;
  onRobotChange: (id: string) => void;
  onSend: (text: string) => void;
}

export function ChatPanel({
  robots,
  robotId,
  conversation,
  contextLabel,
  textbook,
  onRobotChange,
  onSend,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const history = useRef<HTMLDivElement>(null);
  const robot = robots.find((item) => item.id === robotId);
  const Icon =
    robot?.icon === "graduation-cap"
      ? GraduationCap
      : robot?.icon === "sparkles"
        ? Sparkles
        : Bot;
  const messages = conversation?.messages ?? [];
  const prompts = !contextLabel
    ? ["能帮我理清这个想法吗？", "我们可以从哪些方面讨论？"]
    : textbook
      ? ["这一节的核心概念是什么？", "能举一个本节的例子吗？"]
      : ["用到了哪些概念或公式？", "能把关键步骤展开讲吗？"];

  useEffect(() => {
    history.current?.scrollTo({ top: history.current.scrollHeight });
  }, [messages.length, conversation?.id]);

  function submit(text: string) {
    const value = text.trim();
    if (!value || !robot) return;
    onSend(value);
    setDraft("");
    setNotice("问题已加入当前会话。AI 尚未接入，暂不会生成回复。");
  }

  return (
    <section className={styles.chat} aria-label="聊天栏">
      <header className={styles.heading}>
        <span className={styles.avatar}>
          <Icon aria-hidden="true" />
        </span>
        <select
          aria-label="选择机器人"
          value={robot?.id ?? ""}
          disabled={!robots.length}
          onChange={(event) => onRobotChange(event.target.value)}
        >
          {!robots.length && <option value="">未选择机器人</option>}
          {robots.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        {!unavailableAiConnection.available && (
          <span className={styles.connection}>AI 未接入</span>
        )}
      </header>
      <div className={styles.main}>
        <div className={styles.history} ref={history} aria-label="聊天记录">
          {!messages.length && (
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
            const author = robots.find((item) => item.id === message.botId);
            const authorIcon = message.botIcon ?? author?.icon;
            const AuthorIcon =
              authorIcon === "graduation-cap"
                ? GraduationCap
                : authorIcon === "sparkles"
                  ? Sparkles
                  : Bot;
            return (
              <article
                key={message.id}
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
                <Markdown>{message.content}</Markdown>
              </article>
            );
          })}
        </div>
        {!!robot && (
          <section className={styles.recommendations} aria-label="推荐问题示例">
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
          <textarea
            aria-label="向阅读助手提问"
            placeholder="有什么疑问或想法？记录下来…"
            rows={2}
            maxLength={1000}
            disabled={!robot}
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
            <button
              className={styles.send}
              type="submit"
              aria-label="保存问题"
              disabled={!robot || !draft.trim()}
            >
              <ArrowUp aria-hidden="true" />
            </button>
          </div>
        </form>
        <p className={styles.notice} role="status">
          {notice || "AI 尚未接入，发送后仅保存你的问题。"}
        </p>
        <p className={styles.voice}>
          长按空格键可语音输入… <span>尚未开放</span>
        </p>
      </div>
    </section>
  );
}
