import { LocalAiError } from "./errors";
import {
  assertMetadata,
  type AiSettings,
  type AiTurn,
  type ProviderId,
} from "@solvemate/contracts";

const legacyIds: Record<string, string> = {
  "deepseek-harness": "deepseek-local",
  hermes: "hermes-local",
  codex: "codex-local",
};
type Value = Record<string, unknown>;
const record = (value: unknown): Value => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new LocalAiError(
      "本机服务返回的数据结构不正确，请确认应用与服务版本一致。",
      "contract_invalid",
    );
  return value as Value;
};
function assertResponse(
  name: Parameters<typeof assertMetadata>[0],
  value: unknown,
) {
  try {
    assertMetadata(name, value);
  } catch {
    throw new LocalAiError(
      "本机服务返回的数据结构不符合约定，请确认应用与服务版本一致。",
      "contract_invalid",
    );
  }
}

/** 旧版 HTTP 返回只在边界转换，配置页面使用版本 3，历史执行保持版本 2。 */
export function decodeAiSettings(value: unknown): AiSettings {
  const data = record(value);
  if (data.schemaVersion === 3) {
    assertResponse("AiSettings", data);
    return data as unknown as AiSettings;
  }
  if (data.schemaVersion !== undefined && data.schemaVersion !== 2)
    throw new Error("本机 AI 服务的数据版本不受支持，请更新应用与本机服务。");
  const config = data.config as AiSettings["config"];
  const old = (data.connections ??
    (config && data.detection
      ? [{ id: legacyIds[config.provider], config, detection: data.detection }]
      : [])) as AiSettings["connections"];
  const services =
    data.services ??
    Object.entries(legacyIds).map(([provider, id]) => ({
      provider,
      id,
      name: provider,
      defaultPath: String(data.defaultPath ?? ""),
      detectedPath: String(data.detectedPath ?? ""),
    }));
  const support = {
    models: "unknown",
    resume: "unknown",
    textUpdates: "unknown",
    rawTextDeltas: "unknown",
    rename: "unknown",
    archive: "unknown",
    attachments: "unknown",
  };
  const normalized = {
    schemaVersion: 3,
    preferencesRevision: data.preferencesRevision ?? 0,
    enabled: data.enabled ?? !!config,
    defaultConnectionId:
      data.defaultConnectionId ?? (config ? legacyIds[config.provider] : null),
    connections: old.map((item) => ({
      ...item,
      revision: item.revision ?? 1,
      enabled: Boolean(data.enabled ?? config),
      check: { status: "unknown", checkedAt: null, error: null },
      detection: { ...item.detection, capabilities: support },
    })),
    services,
    busy: !!data.busy,
  };
  assertResponse("AiSettings", normalized);
  return normalized as AiSettings;
}

export function decodeAiTurn(value: unknown): AiTurn {
  const data = record(value);
  if (data.schemaVersion === 2) {
    assertResponse("AiTurn", data);
    const turn = data as unknown as AiTurn;
    if (
      turn.snapshot.connectionId !== turn.connectionId ||
      turn.snapshot.teacher.id !== turn.teacher.id ||
      turn.snapshot.requestedModelId !== turn.model
    )
      throw new LocalAiError(
        "执行记录与请求快照不一致，未覆盖原记录。",
        "turn_mismatch",
      );
    return turn;
  }
  if (data.schemaVersion !== undefined)
    throw new Error("执行记录的数据版本不受支持。");
  const connectionId = String(
    data.connectionId ?? legacyIds[String(data.provider)] ?? "deepseek-local",
  );
  const provider = (data.provider ??
    Object.entries(legacyIds).find(([, id]) => id === connectionId)?.[0] ??
    null) as ProviderId | null;
  const teacher = {
    ...record(data.teacher),
    icon: record(data.teacher).icon ?? "bot",
  };
  const normalized = {
    ...data,
    schemaVersion: 2,
    submissionStatus: data.submissionStatus ?? "accepted",
    revision: 1,
    connectionId,
    provider,
    protocol:
      data.protocol ?? (provider === "codex" ? "codex-app-server" : "acp"),
    teacher,
    reference: data.reference ?? null,
    reasoningEffort: data.reasoningEffort ?? "",
    phase: data.phase ?? (data.status === "running" ? "waiting" : "finished"),
    lastActivityAt: data.lastActivityAt ?? data.completedAt ?? data.startedAt,
    dispatch: null,
    reportedModelId: null,
    snapshot: {
      connectionId,
      connectionRevision: null,
      conversationRevision: null,
      robotRevision: null,
      providerId: provider,
      serviceName: null,
      modelSelection: data.model
        ? { kind: "model", connectionId, modelId: data.model }
        : { kind: "connection-default" },
      requestedModelId: String(data.model ?? ""),
      requestedModelName: null,
      reasoningEffort: String(data.reasoningEffort ?? ""),
      teacher,
      client: { appVersion: null, buildId: null, clientKind: null },
      localServiceVersion: null,
    },
  };
  assertResponse("AiTurn", normalized);
  return normalized as AiTurn;
}
