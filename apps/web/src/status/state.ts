import type { AiTurn, Conversation } from "@solvemate/contracts";
import type { UpdateState } from "../pwa/update-controller";

/** 常驻文字说明当前状态；操作按钮单独命名，不能用操作名代替就绪状态。 */
export function applicationStatus(state: UpdateState) {
  const views = {
    idle: {
      label: "检查更新",
      status: "尚未检查",
      action: "检查更新",
    },
    checking: {
      label: "正在检查…",
      status: "正在检查更新",
      action: "正在检查…",
    },
    downloading: {
      label: "正在下载…",
      status: "正在下载新版",
      action: "正在下载…",
    },
    current: {
      label: "检查更新",
      status: "已是最新版本",
      action: "再次检查",
    },
    ready: {
      label: "新版就绪",
      status: "新版就绪",
      action: "更新应用",
    },
    reloading: {
      label: "正在更新…",
      status: "正在启用新版",
      action: "正在更新…",
    },
    error: {
      label: "更新失败",
      status: "更新失败",
      action: "重试",
    },
  };
  return {
    ...views[state.status],
    busy: ["checking", "downloading", "reloading"].includes(state.status),
  };
}

export function conversationTasks(
  conversations: Conversation[],
  turns: Record<string, AiTurn>,
  activeId: string | null,
  connectionErrors: Record<string, string> = {},
) {
  return conversations
    .filter((item) => item.status !== "deleted")
    .flatMap((conversation) => {
      const latest = [...conversation.turns].sort(
        (a, b) => b.startedAt - a.startedAt,
      )[0];
      if (!latest) return [];
      const received = turns[latest.id];
      const turn =
        received && received.revision >= latest.revision ? received : latest;
      if (turn.status === "running")
        return [
          {
            id: turn.id,
            conversation,
            startedAt: turn.startedAt,
            label:
              turn === received && received.permissions.length
                ? "等待确认"
                : "正在回复…",
            error: connectionErrors[turn.id] || turn.error || "",
            attention:
              !!(turn === received && received.permissions.length) ||
              !!connectionErrors[turn.id],
          },
        ];
      if (
        ["failed", "interrupted"].includes(turn.status) &&
        (conversation.id === activeId || !!received)
      )
        return [
          {
            id: turn.id,
            conversation,
            startedAt: turn.startedAt,
            label: "回复失败",
            error: turn.error || "本次回复未能完成，请进入对话查看。",
            attention: true,
          },
        ];
      return [];
    })
    .sort((a, b) => Number(b.attention) - Number(a.attention));
}
