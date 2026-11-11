import type {
  AiSettings,
  AiTurn,
  AiConfig,
  Detection,
  TurnInput,
} from "@solvemate/contracts";
export type {
  ModelOption,
  AiConfig,
  Detection,
  AiConnection,
  AiServiceInfo,
  AiSettings,
  AiPermission,
  AiTurn,
  TurnInput,
} from "@solvemate/contracts";
import { decodeAiSettings, decodeAiTurn } from "./metadata";

import { LocalAiError } from "./errors";
export { LocalAiError } from "./errors";

async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/local-api/v1${path}`, {
      method,
      headers: {
        "X-SolveMate-Client": "web",
        ...(method === "GET" ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(60000),
      cache: "no-store",
    });
  } catch {
    throw new LocalAiError(
      "无法连接本机 AI 服务，请使用 npm start 启动 SolveMate 后重试。",
    );
  }
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new LocalAiError(
      "本机 AI 服务没有返回有效数据，请检查服务是否已启动。",
    );
  }
  if (!response.ok) {
    const failure = result as { detail?: unknown; code?: string };
    throw new LocalAiError(
      typeof failure.detail === "string"
        ? failure.detail
        : "AI 请求未能完成，请检查连接设置。",
      failure.code ?? `http_${response.status}`,
    );
  }
  return result as T;
}

/** 处理跨数据块的 UTF-8 与 SSE 帧；正文按完整快照合并，重连不会重复追加。 */
export async function readTurnEvents(
  response: Response,
  id: string,
  accept: (turn: AiTurn) => void,
  onActivity?: () => void,
) {
  if (
    !response.body ||
    !response.headers.get("content-type")?.includes("text/event-stream")
  )
    throw new LocalAiError(
      "本机服务没有提供实时回复连接。",
      "stream_unsupported",
    );
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done)
        throw new LocalAiError(
          "实时回复连接已断开，正在重新连接。",
          "stream_closed",
        );
      onActivity?.();
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 8 * 1024 * 1024)
        throw new LocalAiError(
          "本机服务返回的实时数据过大。",
          "stream_invalid",
        );
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const lines = frame.split(/\r?\n/);
        if (!lines.some((line) => line === "event: turn")) continue;
        const data = lines
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        let turn: AiTurn;
        try {
          turn = decodeAiTurn(JSON.parse(data));
        } catch {
          throw new LocalAiError(
            "本机服务返回了无效的实时数据。",
            "stream_invalid",
          );
        }
        if (
          !turn ||
          turn.id !== id ||
          typeof turn.conversationId !== "string" ||
          typeof turn.content !== "string" ||
          !turn.teacher ||
          ![
            "running",
            "completed",
            "failed",
            "cancelled",
            "interrupted",
          ].includes(turn.status)
        )
          throw new LocalAiError(
            "本机服务返回的执行记录不匹配。",
            "stream_invalid",
          );
        accept(turn);
        if (turn.status !== "running") return turn;
      }
    }
  } finally {
    await reader.cancel().catch(() => {
      /* 断线后的清理错误不能覆盖原始连接错误。 */
    });
    reader.releaseLock();
  }
}

async function streamTurn(
  id: string,
  accept: (turn: AiTurn) => void,
  signal: AbortSignal,
) {
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), 12000);
  const resetTimeout = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), 12000);
  };
  try {
    const response = await fetch(
      `/local-api/v1/turns/${encodeURIComponent(id)}/events`,
      {
        headers: { "X-SolveMate-Client": "web", Accept: "text/event-stream" },
        cache: "no-store",
        signal: AbortSignal.any([signal, controller.signal]),
      },
    );
    if (!response.ok) {
      const failure = (await response.json().catch(() => ({}))) as {
        detail?: string;
        code?: string;
      };
      throw new LocalAiError(
        typeof failure.detail === "string"
          ? failure.detail
          : "实时回复连接未能建立。",
        failure.code ?? `http_${response.status}`,
      );
    }
    // 心跳不改变执行状态，仅用于检查浏览器到本机服务的连接。
    return await readTurnEvents(response, id, accept, resetTimeout);
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof LocalAiError) throw error;
    throw new LocalAiError(
      "实时回复连接中断，正在重新连接。",
      "stream_disconnected",
    );
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export const localAi = {
  settings: async () => decodeAiSettings(await request<unknown>("/settings")),
  detect: (
    executablePath: string,
    model = "",
    provider: AiConfig["provider"] = "deepseek-harness",
    resetProbe = false,
  ) =>
    request<Detection>("/detect", "POST", {
      executablePath,
      model,
      provider,
      resetProbe,
    }),
  save: async (
    config: AiConfig,
    settings?: AiSettings | null,
    options?: { enabled: boolean; makeDefault: boolean },
  ) =>
    decodeAiSettings(
      await request<unknown>("/settings", "PUT", {
        ...config,
        ...options,
        ...(settings
          ? {
              expectedRevision:
                settings.connections.find(
                  (item) => item.config.provider === config.provider,
                )?.revision ?? 0,
              expectedPreferencesRevision: settings.preferencesRevision,
            }
          : {}),
      }),
    ),
  setConnectionEnabled: async (
    id: string,
    enabled: boolean,
    revision: number,
  ) =>
    decodeAiSettings(
      await request<unknown>(
        `/connections/${encodeURIComponent(id)}`,
        "PATCH",
        { enabled, expectedRevision: revision },
      ),
    ),
  setDefaultConnection: async (
    connectionId: string,
    expectedRevision: number,
  ) =>
    decodeAiSettings(
      await request<unknown>("/default-connection", "PUT", {
        connectionId,
        expectedRevision,
      }),
    ),
  deleteConnection: async (
    id: string,
    revision: number,
    preferencesRevision: number,
  ) =>
    decodeAiSettings(
      await request<unknown>(
        `/connections/${encodeURIComponent(id)}`,
        "DELETE",
        {
          expectedRevision: revision,
          expectedPreferencesRevision: preferencesRevision,
        },
      ),
    ),
  disable: async (settings?: AiSettings | null) =>
    decodeAiSettings(
      await request<unknown>(
        "/settings",
        "DELETE",
        settings ? { expectedRevision: settings.preferencesRevision } : {},
      ),
    ),
  start: async (input: TurnInput) =>
    decodeAiTurn(await request<unknown>("/turns", "POST", input)),
  turn: async (id: string) =>
    decodeAiTurn(await request<unknown>(`/turns/${encodeURIComponent(id)}`)),
  stream: streamTurn,
  history: async (id: string) =>
    (
      await request<unknown[]>(`/conversations/${encodeURIComponent(id)}/turns`)
    ).map(decodeAiTurn),
  cancel: async (id: string) =>
    decodeAiTurn(
      await request<unknown>(
        `/turns/${encodeURIComponent(id)}/cancel`,
        "POST",
        {},
      ),
    ),
  decide: (id: string, requestId: string, optionId: string) =>
    request<{ status: string }>(
      `/turns/${encodeURIComponent(id)}/permission`,
      "POST",
      { requestId, optionId },
    ),
};
