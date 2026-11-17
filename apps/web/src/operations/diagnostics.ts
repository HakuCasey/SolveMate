import { operations, isUsefulOperation, type OperationResult } from "./store";

/** 导出仅包含定位所需的操作编号、时间、阶段和错误代码，不包含用户正文或配置。 */
export function exportOperationDiagnostics() {
  const url = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            operations: operations.diagnosticData(),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `operation-errors_${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface DiagnosticCache {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<unknown>;
}
const diagnosticKey = "operation-diagnostics";
/** 只重写操作历史这一条缓存，不访问学习记录、配置或待保存内容。 */
export async function removeInvalidOperationDiagnostics(
  cache: DiagnosticCache,
) {
  const rows = await cache.get<unknown>(diagnosticKey);
  if (!Array.isArray(rows)) return [];
  const valid = rows.filter(
    (row) =>
      row &&
      typeof row.operation === "string" &&
      typeof row.id === "string" &&
      typeof row.label === "string" &&
      !!row.label.trim() &&
      typeof row.startedAt === "number" &&
      Number.isFinite(row.startedAt) &&
      isUsefulOperation({
        key: row.operation,
        failures: Array.isArray(row.failures) ? row.failures : undefined,
      }),
  );
  if (valid.length !== rows.length) await cache.put(diagnosticKey, valid);
  return valid;
}

/** 诊断副本缓存于本浏览器，刷新后仍可导出；不把历史失败恢复为当前操作状态。 */
export async function retainOperationDiagnostics() {
  const { userCache } = await import("../storage/local-client");
  const { logError } = await import("../logger");
  const key = diagnosticKey;
  let previous = "";
  let write = Promise.resolve();
  const unsubscribe = operations.subscribe(() => {
    const records = operations.diagnosticData();
    const serialized = JSON.stringify(records);
    if (serialized === previous) return;
    previous = serialized;
    write = write
      .then(() => userCache.put(key, records))
      .catch((error) => {
        logError("Failed to cache operation diagnostics.", error);
      });
  });
  try {
    const rows = await removeInvalidOperationDiagnostics(userCache);
    operations.removeInvalidDiagnostics();
    if (Array.isArray(rows)) {
      const valid: OperationResult[] = [];
      for (const row of rows.slice(0, 50)) {
        if (
          !row ||
          typeof row.id !== "string" ||
          typeof row.operation !== "string" ||
          typeof row.label !== "string" ||
          typeof row.startedAt !== "number"
        )
          continue;
        valid.push({
          id: row.id,
          key: row.operation,
          label: row.label,
          startedAt: row.startedAt,
          status: "failed",
          ...(typeof row.finishedAt === "number"
            ? { finishedAt: row.finishedAt }
            : {}),
          ...(typeof row.targetId === "string"
            ? { targetId: row.targetId }
            : {}),
          ...(typeof row.targetName === "string"
            ? { targetName: row.targetName }
            : {}),
          ...(Array.isArray(row.failures)
            ? {
                failures: row.failures
                  .filter(
                    (item: unknown) =>
                      !!item &&
                      typeof item === "object" &&
                      "label" in item &&
                      typeof item.label === "string",
                  )
                  .map(
                    (item: {
                      label: string;
                      errorCode?: unknown;
                      httpStatus?: unknown;
                    }) => ({
                      label: item.label,
                      ...(typeof item.errorCode === "string"
                        ? { errorCode: item.errorCode }
                        : {}),
                      ...(typeof item.httpStatus === "number"
                        ? { httpStatus: item.httpStatus }
                        : {}),
                    }),
                  ),
              }
            : {}),
          ...(typeof row.errorCode === "string"
            ? { errorCode: row.errorCode }
            : {}),
          ...(typeof row.errorType === "string"
            ? { errorType: row.errorType }
            : {}),
          ...(typeof row.httpStatus === "number"
            ? { httpStatus: row.httpStatus }
            : {}),
        });
      }
      operations.restoreDiagnostics(valid);
      await write;
    }
  } catch (error) {
    logError("Failed to read operation diagnostics.", error);
  }
  return unsubscribe;
}
