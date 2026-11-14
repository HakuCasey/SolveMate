import type { AppData } from "@solvemate/contracts";
import { migrateAiMetadata } from "../data/migrate-ai-metadata";
import { ContentStorage } from "../content/storage";
import { sha256 } from "../content/package";
import { DexieStorage, LocalDataConflictError } from "./index";
import {
  userCache,
  writerId,
  publishStorageStatus,
  localRequest,
  LocalServiceError,
  envelope,
  cachedEnvelope,
  remember,
  toBase64,
  type StateEnvelope,
} from "./local-client";

interface MigrationPayload {
  legacyState: unknown;
  value: AppData | null;
  versions: unknown[];
  heads: unknown[];
}
interface MigrationRequest {
  sourceId: string;
  payload: MigrationPayload;
  expectedRevision: number;
  decision?: "keep" | "replace";
}
export class MigrationRequired extends Error {
  constructor(
    readonly request: MigrationRequest,
    readonly pendingId?: string,
  ) {
    super("本机和此浏览器中都有记录。浏览器记录已备份，请选择使用哪份记录。");
  }
}
const legacy = new DexieStorage();
const legacyContent = new ContentStorage();
let bootstrap: Promise<void> | undefined;
let initialEnvelope: StateEnvelope | undefined;

async function migrate(
  request: MigrationRequest,
  fingerprint: string,
  pendingId?: string,
) {
  try {
    const saved = envelope(
      await (
        await localRequest("/migrate", {
          method: "POST",
          body: JSON.stringify(request),
        })
      ).json(),
    );
    initialEnvelope = saved;
    if (pendingId) await userCache.pending.delete(pendingId);
    else
      await userCache.put("migration-receipt", {
        storeId: saved.storeId,
        fingerprint,
      });
    return saved;
  } catch (error) {
    if (
      error instanceof LocalServiceError &&
      error.code === "migration_conflict"
    )
      throw new MigrationRequired(request, pendingId);
    throw error;
  }
}
export async function resolveMigration(
  required: MigrationRequired,
  decision: "keep" | "replace",
) {
  const current = envelope(await (await localRequest("/state")).json());
  // 用户确认只针对看到的版本；确认后有新写入时必须重新选择。
  if (current.revision !== required.request.expectedRevision)
    throw new LocalDataConflictError();
  const request = { ...required.request, decision };
  await migrate(
    request,
    await sha256(new TextEncoder().encode(JSON.stringify(request.payload))),
    required.pendingId,
  );
  bootstrap = undefined;
}
async function initialize() {
  let current: StateEnvelope;
  try {
    current = envelope(await (await localRequest("/state")).json());
  } catch (error) {
    // 只对连接故障使用缓存，格式错误、权限错误和迁移冲突不能伪装成空数据库。
    if (
      !(error instanceof LocalServiceError) ||
      (error.code !== "unavailable" && error.status < 500)
    )
      throw error;
    const saved = await userCache.get<StateEnvelope>("state");
    const old = saved ? null : await legacy.rawRecord();
    if (!saved && !old) throw error;
    initialEnvelope = saved
      ? await cachedEnvelope(saved)
      : {
          storeId: "legacy-offline",
          revision: 0,
          value: migrateAiMetadata(old!.value),
        };
    publishStorageStatus({ online: false });
    return;
  }
  const pending = await userCache.pending.toArray();
  for (const draft of pending) {
    // 新窗口不接管其他窗口正在提交的请求；较早留下的未确认记录可在启动时恢复。
    if (draft.id !== writerId && Date.now() - (draft.updatedAt ?? 0) < 120000)
      continue;
    // 未确认的保存结果在重新打开时先备份并询问，不因读取较新记录而丢弃。
    const body = {
      sourceId: draft.id,
      expectedRevision: current.revision,
      payload: {
        legacyState: { unsaved: draft.value },
        value: draft.value,
        versions: [],
        heads: [],
      },
    };
    current = await migrate(body, "", draft.id);
  }
  const raw = await legacy.rawRecord();
  const oldContent = await legacyContent.load();
  if (raw || oldContent.installed.length) {
    const payload: MigrationPayload = {
      legacyState: raw ?? null,
      value: raw ? migrateAiMetadata(raw.value) : null,
      versions: oldContent.installed.map(
        ({ manifest, archive, installedAt }) => ({
          manifest,
          archive: toBase64(archive),
          installedAt,
        }),
      ),
      heads: oldContent.heads,
    };
    // 迁移只校验记录结构，资料是否可定位在使用时判断；失效引用不能阻止读取其他记录。
    // 请求结构不发送解析后的 Course，也不改变旧数据和任何第三方会话编号。
    const fingerprint = await sha256(
      new TextEncoder().encode(JSON.stringify(payload)),
    );
    const receipt = await userCache.get<{
      storeId: string;
      fingerprint: string;
    }>("migration-receipt");
    if (
      !receipt ||
      receipt.storeId !== current.storeId ||
      receipt.fingerprint !== fingerprint
    ) {
      let sourceId = await userCache.get<string>("sourceId");
      if (!sourceId) {
        sourceId = crypto.randomUUID();
        await userCache.put("sourceId", sourceId);
      }
      current = await migrate(
        { sourceId, payload, expectedRevision: current.revision },
        fingerprint,
      );
    }
  }
  initialEnvelope = current;
  await remember("state", current);
}
export function ensureUserStorage(force = false): Promise<void> {
  if (force) bootstrap = undefined;
  bootstrap ??= initialize().catch((error: unknown) => {
    bootstrap = undefined;
    throw error;
  });
  return bootstrap;
}

export const initialUserState = () => initialEnvelope;
