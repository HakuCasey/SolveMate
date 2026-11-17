/** 操作结果由业务完成点报告；表单输入、后台轮询和模型生成不作为用户操作。 */
export interface Operation {
  key: string;
  label: string;
  targetId?: string;
  targetName?: string;
  guidance?: string;
}
/** 旧界面根据错误提示补造的记录没有具体操作，不能作为操作历史。 */
export function isUsefulOperation(value: {
  key: string;
  failures?: OperationFailure[];
}) {
  return (
    value.key !== "application:pending" &&
    value.key !== "application:read" &&
    (value.key !== "refresh:data" ||
      !!value.failures?.some(
        (item) =>
          !!item && typeof item.label === "string" && !!item.label.trim(),
      ))
  );
}
export interface OperationFailure {
  label: string;
  message?: string;
  errorCode?: string;
  httpStatus?: number;
}
export interface OperationResult extends Operation {
  failures?: OperationFailure[];
  id: string;
  startedAt: number;
  finishedAt?: number;
  status: "running" | "success" | "failed";
  error?: string;
  errorCode?: string;
  errorType?: string;
  httpStatus?: number;
}
interface OperationSnapshot {
  pending: OperationResult[];
  failures: OperationResult[];
  latest: OperationResult | null;
  diagnostics: OperationResult[];
}

export class OperationStore {
  private state: OperationSnapshot = {
    pending: [],
    failures: [],
    latest: null,
    diagnostics: [],
  };
  private latestAttempts = new Map<string, string>();
  private listeners = new Set<() => void>();
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(change: Partial<OperationSnapshot>) {
    this.state = { ...this.state, ...change };
    this.listeners.forEach((listener) => listener());
  }
  start(operation: Operation) {
    const result: OperationResult = {
      ...operation,
      id: crypto.randomUUID(),
      startedAt: Date.now(),
      status: "running",
    };
    this.latestAttempts.set(operation.key, result.id);
    // 发起重试不代表已经解决，成功后才移除原失败。
    this.publish({
      pending: [...this.state.pending, result],
    });
    return result;
  }
  finish(
    operation: OperationResult,
    error?: unknown,
    failures?: OperationFailure[],
  ) {
    const failure = error as { code?: unknown; status?: unknown } | undefined;
    const result: OperationResult = {
      ...operation,
      finishedAt: Date.now(),
      ...(failures?.length ? { failures } : {}),
      status: error === undefined ? "success" : "failed",
      ...(error === undefined
        ? {}
        : {
            error:
              error instanceof Error ? error.message : "操作未能完成，请重试。",
            errorType: error instanceof Error ? error.name : "UnknownError",
            errorCode:
              typeof failure?.code === "string"
                ? failure.code
                : "operation_failed",
            httpStatus:
              typeof failure?.status === "number" ? failure.status : 0,
          }),
    };
    const newer = this.latestAttempts.get(result.key) !== result.id;
    this.publish({
      pending: this.state.pending.filter((item) => item.id !== result.id),
      latest: newer ? this.state.latest : result,
      failures: newer
        ? this.state.failures
        : error === undefined
          ? this.state.failures.filter((item) => item.key !== result.key)
          : [
              result,
              ...this.state.failures.filter((item) => item.key !== result.key),
            ],
      diagnostics:
        error === undefined
          ? this.state.diagnostics
          : [result, ...this.state.diagnostics].slice(0, 50),
    });
  }
  async run<T>(operation: Operation, action: () => Promise<T>): Promise<T> {
    const pending = this.start(operation);
    try {
      const value = await action();
      this.finish(pending);
      return value;
    } catch (error) {
      this.finish(pending, error);
      throw error;
    }
  }
  resolve(key: string) {
    this.publish({
      failures: this.state.failures.filter((item) => item.key !== key),
      latest:
        this.state.latest?.key === key && this.state.latest.status === "failed"
          ? null
          : this.state.latest,
    });
  }
  removeInvalidDiagnostics() {
    this.publish({
      diagnostics: this.state.diagnostics.filter(isUsefulOperation),
      failures: this.state.failures.filter(isUsefulOperation),
      latest:
        this.state.latest &&
        (this.state.latest.status !== "failed" ||
          isUsefulOperation(this.state.latest))
          ? this.state.latest
          : null,
    });
  }
  restoreDiagnostics(rows: OperationResult[]) {
    const current = this.state.diagnostics;
    this.publish({
      diagnostics: [
        ...current,
        ...rows.filter((row) => !current.some((item) => item.id === row.id)),
      ]
        .sort(
          (a, b) =>
            (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt),
        )
        .slice(0, 50),
    });
  }
  diagnosticData() {
    // 不导出正文、配置值、完整请求或原始异常文本，避免带出凭据和用户输入。
    return this.state.diagnostics.map(
      ({
        id,
        key,
        label,
        targetId,
        targetName,
        failures,
        startedAt,
        finishedAt,
        errorCode,
        errorType,
        httpStatus,
      }) => ({
        id,
        operation: key,
        label,
        targetId,
        targetName,
        failures: failures?.map(({ label, errorCode, httpStatus }) => ({
          label,
          errorCode,
          httpStatus,
        })),
        startedAt,
        finishedAt,
        stage: "failed",
        errorCode,
        errorType,
        httpStatus,
      }),
    );
  }
}
export const operations = new OperationStore();

/** 在业务方法外统一跟踪结果，覆盖响应校验，不能把 HTTP 200 直接当作操作成功。 */
export function trackOperation<A extends unknown[], R>(
  describe: (args: NoInfer<A>) => Operation,
  action: (...args: A) => Promise<R>,
) {
  return (...args: A) => operations.run(describe(args), () => action(...args));
}
export function operationStatus(state: OperationSnapshot) {
  const failed = state.failures.find(
    (item) => !state.pending.some((pending) => pending.key === item.key),
  );
  if (failed)
    return {
      label: "操作失败",
      result: failed,
      attention: true,
      busy: false,
    };
  if (state.pending.length)
    return {
      label: "操作中…",
      result: state.pending[0],
      attention: false,
      busy: true,
    };
  if (state.latest)
    return {
      label: "操作成功",
      result: state.latest,
      attention: false,
      busy: false,
    };
  return { label: "就绪", result: null, attention: false, busy: false };
}
