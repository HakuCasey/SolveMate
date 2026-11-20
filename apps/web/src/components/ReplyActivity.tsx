import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { SessionTurn } from "@solvemate/contracts";
import styles from "./ChatPanel.module.css";

export function ReplyTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <span className={styles.elapsed} aria-label={`已用时 ${elapsed} 秒`}>
      {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
    </span>
  );
}

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
  const [longWait, setLongWait] = useState(
    () => Date.now() - startedAt >= 20000,
  );
  useEffect(() => {
    if (received || disconnected || longWait) return;
    const timer = setTimeout(
      () => setLongWait(true),
      Math.max(0, startedAt + 20000 - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [received, disconnected, startedAt, longWait]);
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
      {phase === "stopping" && !disconnected && (
        <p className={styles.waitHint}>
          正在等待 AI 服务确认停止，期间可能收到已生成的内容。
        </p>
      )}
      {phase !== "stopping" && longWait && !received && !disconnected && (
        <p className={styles.waitHint}>
          还未收到回复正文，可以继续等待或停止生成。
        </p>
      )}
    </div>
  );
}
