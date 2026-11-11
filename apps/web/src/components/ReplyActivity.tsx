import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { SessionTurn } from "@solvemate/contracts";
import styles from "./ChatPanel.module.css";

export function ReplyActivity({
  phase,
  startedAt,
  received,
  disconnected,
}: {
  phase: SessionTurn["phase"];
  startedAt: number;
  received: boolean;
  disconnected: boolean;
}) {
  const [time, setTime] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const elapsed = Math.max(0, Math.floor((time - startedAt) / 1000));
  const label = disconnected
    ? "连接暂时中断，正在重连…"
    : {
        queued: "正在发送问题…",
        connecting: "正在连接 AI…",
        waiting: "正在等待回复…",
        thinking: "AI 正在思考…",
        responding: "正在接收回复…",
        tool: "正在执行工具…",
        permission: "等待你的确认…",
        stopping: "正在停止…",
        finished: "正在保存回复…",
      }[phase ?? (received ? "responding" : "queued")];
  return (
    <div className={styles.activity} aria-label="回复进度">
      <div className={styles.activityLine} role="status" aria-live="polite">
        <LoaderCircle className={styles.activitySpinner} aria-hidden="true" />
        <span>{label}</span>
      </div>
      <span className={styles.elapsed}>已用时 {elapsed} 秒</span>
      {elapsed >= 20 && !received && !disconnected && (
        <p className={styles.waitHint}>
          还未收到回复正文，可以继续等待或停止生成。
        </p>
      )}
    </div>
  );
}
