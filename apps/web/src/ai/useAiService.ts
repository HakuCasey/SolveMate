import { useCallback, useEffect, useRef, useState } from "react";
import type { AppData } from "@solvemate/contracts";
import {
  localAi,
  LocalAiError,
  type AiSettings,
  type AiTurn,
  type TurnInput,
} from "./local-api";
import { decodeAiTurn } from "./metadata";
import { mergeAiTurn } from "./state";

type Update = (change: (data: AppData) => AppData) => void;

export function useAiService(update: Update) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [error, setError] = useState("");
  const [connectionErrors, setConnectionErrors] = useState<
    Record<string, string>
  >({});
  const streams = useRef(new Map<string, AbortController>());
  const [turns, setTurns] = useState<Record<string, AiTurn>>({});
  const updateRef = useRef(update);
  useEffect(() => {
    updateRef.current = update;
  }, [update]);
  const polling = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const mounted = useRef(true);
  const restoreRequests = useRef(new Map<string, Promise<void>>());

  const accept = useCallback((turn: AiTurn) => {
    if (!mounted.current) return;
    updateRef.current((data) => {
      try {
        return mergeAiTurn(data, turn);
      } catch (failure) {
        setError(
          failure instanceof Error ? failure.message : "执行记录不一致。",
        );
        return data;
      }
    });
    setTurns((previous) => {
      const existing = previous[turn.id];
      if (
        existing &&
        (existing.revision >= turn.revision ||
          (existing.status !== "running" && turn.status === "running"))
      )
        return previous;
      return { ...previous, [turn.id]: turn };
    });
  }, []);

  const watch = useCallback(
    function watch(id: string) {
      if (polling.current.has(id) || !mounted.current) return;
      let streaming = true;
      let failures = 0;
      const received = (turn: AiTurn) => {
        accept(turn);
        failures = 0;
        if (mounted.current)
          setConnectionErrors((previous) => ({ ...previous, [id]: "" }));
      };
      const tick = async () => {
        const controller = new AbortController();
        streams.current.set(id, controller);
        try {
          if (streaming) {
            try {
              await localAi.stream(id, received, controller.signal);
              polling.current.delete(id);
              return;
            } catch (failure) {
              if (!mounted.current || controller.signal.aborted) return;
              if (
                failure instanceof LocalAiError &&
                [
                  "http_404",
                  "http_405",
                  "http_501",
                  "stream_unsupported",
                ].includes(failure.code)
              )
                streaming = false;
              else
                setConnectionErrors((previous) => ({
                  ...previous,
                  [id]: "实时回复连接中断，正在重新连接。",
                }));
            }
          }
          // 断线后先读取已有执行；旧版服务不支持 SSE 时继续轮询，不能重新提交问题。
          const turn = await localAi.turn(id);
          received(turn);
          if (turn.status !== "running") {
            polling.current.delete(id);
            return;
          }
        } catch (failure) {
          if (!mounted.current) return;
          if (failure instanceof LocalAiError && failure.code === "http_404") {
            updateRef.current((data) => ({
              ...data,
              conversations: data.conversations.map((conversation) => ({
                ...conversation,
                turns: conversation.turns?.map((turn) =>
                  turn.id === id && turn.status === "running"
                    ? {
                        ...turn,
                        status: "interrupted" as const,
                        completedAt: Date.now(),
                        error: "本机服务没有保存这次请求，请确认后重新提问。",
                      }
                    : turn,
                ),
              })),
            }));
            polling.current.delete(id);
            return;
          }
          failures += 1;
          setConnectionErrors((previous) => ({
            ...previous,
            [id]:
              failure instanceof Error ? failure.message : "读取 AI 回复失败。",
          }));
        } finally {
          if (streams.current.get(id) === controller)
            streams.current.delete(id);
          controller.abort();
        }
        if (failures >= 6) {
          polling.current.delete(id);
          setConnectionErrors((previous) => ({
            ...previous,
            [id]: "暂时无法读取生成状态，自动重连已停止。请重新查询这次请求。",
          }));
          return;
        }
        if (mounted.current)
          polling.current.set(
            id,
            setTimeout(
              () => void tick(),
              Math.min(1000 * 2 ** Math.min(failures, 3), 8000),
            ),
          );
      };
      polling.current.set(
        id,
        setTimeout(() => void tick(), 0),
      );
    },
    [accept],
  );

  const refresh = useCallback(async () => {
    try {
      const next = await localAi.settings();
      if (mounted.current) {
        setSettings(next);
        setError("");
      }
      return next;
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error ? failure.message : "读取连接设置失败。",
        );
      return null;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timers = polling.current;
    const subscriptions = streams.current;
    return () => {
      mounted.current = false;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const controller of subscriptions.values()) controller.abort();
      subscriptions.clear();
    };
  }, [refresh]);

  const restore = useCallback(
    (conversationId: string, pendingIds: string[] = []) => {
      const existing = restoreRequests.current.get(conversationId);
      if (existing) return existing;
      const promise = localAi
        .history(conversationId)
        .then((items) => {
          for (const turn of items) {
            accept(turn);
            if (turn.status === "running") watch(turn.id);
          }
          for (const id of pendingIds)
            if (!items.some((turn) => turn.id === id)) watch(id);
        })
        .catch(() => {
          // 离线查看历史时保留记录，未结束请求继续按原编号读取，不能重新提交。
          for (const id of pendingIds) watch(id);
        })
        .finally(() => {
          restoreRequests.current.delete(conversationId);
        });
      restoreRequests.current.set(conversationId, promise);
      return promise;
    },
    [accept, watch],
  );

  async function start(input: TurnInput) {
    setError("");
    try {
      const turn = await localAi.start(input);
      accept(turn);
      if (turn.status === "running") watch(turn.id);
    } catch (failure) {
      const message =
        failure instanceof Error ? failure.message : "提问未能完成。";
      setError(message);
      if (
        failure instanceof LocalAiError &&
        failure.code === "configuration_conflict"
      )
        await refresh();
      // 请求可能已被服务接收；保留请求编号，先读取结果，不能直接重发模型任务。
      try {
        const turn = await localAi.turn(input.id);
        accept(turn);
        if (turn.status === "running") watch(turn.id);
      } catch {
        const uncertain =
          failure instanceof LocalAiError &&
          [
            "local_service_unavailable",
            "contract_invalid",
            "turn_mismatch",
          ].includes(failure.code);
        accept(
          decodeAiTurn({
            id: input.id,
            conversationId: input.conversationId,
            connectionId: input.connectionId,
            text: input.text,
            teacher: input.teacher,
            reference: input.reference,
            references: input.references,
            userMessageId: input.userMessageId,
            assistantMessageId: input.id + "-assistant",
            model: input.model,
            status: uncertain ? "running" : "failed",
            submissionStatus: uncertain ? "uncertain" : "rejected",
            startedAt: Date.now(),
            ...(uncertain ? {} : { completedAt: Date.now() }),
            content: "",
            error: message,
            tools: [],
            permissions: [],
          }),
        );
        if (uncertain) watch(input.id);
      }
    }
  }

  async function cancel(id: string) {
    try {
      accept(await localAi.cancel(id));
      watch(id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "停止请求失败。");
    }
  }

  async function decide(id: string, permissionId: string, optionId: string) {
    try {
      await localAi.decide(id, permissionId, optionId);
      accept(await localAi.turn(id));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "权限确认失败。");
    }
  }

  return {
    settings,
    setSettings,
    error,
    turns,
    connectionErrors,
    refresh,
    restore,
    start,
    cancel,
    decide,
  };
}
export type AiService = ReturnType<typeof useAiService>;
