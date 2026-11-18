import {
  operations,
  type OperationResult,
  type OperationFailure,
} from "../operations/store";
import { isStaleData } from "./errors";
export type DataScope = "records" | "materials" | "content" | "ai" | "study";
const resourceNames: Record<DataScope, string> = {
  records: "对话、笔记和配置",
  materials: "资料列表",
  content: "社区内容记录",
  ai: "AI 配置",
  study: "学习时长",
};
interface Resource {
  read: () => Promise<unknown>;
  pending?: Promise<void>;
  again: boolean;
}
interface RefreshState {
  refreshing: boolean;
  error: string;
  notice: string;
  revision: number;
}

/** 集中安排数据刷新；合并并发请求，旧读取作废后至多补读一次，不重试业务写入。 */
export class DataRefreshCoordinator {
  private round?: {
    operation: OperationResult;
    pending: number;
    feedback: boolean;
  };
  private resources = new Map<DataScope, Resource>();
  private listeners = new Set<() => void>();
  private state: RefreshState = {
    refreshing: false,
    error: "",
    notice: "",
    revision: 0,
  };
  private issues = new Map<DataScope, string>();
  private failures = new Map<DataScope, unknown>();
  snapshot = () => this.state;
  subscribe = (callback: () => void) => {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  };
  private publish(change: Partial<RefreshState>) {
    this.state = { ...this.state, ...change };
    for (const callback of this.listeners) callback();
  }
  register(scope: DataScope, read: () => Promise<unknown>) {
    const resource: Resource = { read, again: false };
    this.resources.set(scope, resource);
    return () => {
      if (this.resources.get(scope) === resource) this.resources.delete(scope);
    };
  }
  private run(scope: DataScope, trailing: boolean): Promise<void> {
    const resource = this.resources.get(scope);
    if (!resource) return Promise.resolve();
    if (resource.pending) {
      if (trailing) resource.again = true;
      return resource.pending;
    }
    const task = Promise.resolve()
      .then(async () => {
        let count = 0;
        do {
          resource.again = false;
          await resource.read();
          count++;
        } while (
          resource.again &&
          count < 2 &&
          this.resources.get(scope) === resource
        );
      })
      .then(
        () => {
          this.failures.delete(scope);
        },
        (error) => {
          this.failures.set(scope, error);
          throw error;
        },
      )
      .finally(() => {
        if (resource.pending === task) resource.pending = undefined;
      });
    resource.pending = task;
    return task;
  }
  refresh = async (
    scopes: DataScope[] = [...this.resources.keys()],
    trailing = false,
    feedback = false,
  ) => {
    // 所有并发调用加入当前轮次，各自仍等待自己的读取结果，不相互等待。
    const round = (this.round ??= {
      operation: operations.start({
        key: "refresh:data",
        label: feedback ? "加载用户数据" : "自动刷新数据",
      }),
      pending: 0,
      feedback,
    });
    round.pending++;
    round.feedback ||= feedback;
    this.publish({ refreshing: true });
    const requested = [...new Set(scopes)];
    const results = await Promise.allSettled(
      requested.map((scope) => this.run(scope, trailing)),
    );
    const failures = results.filter(
      (item): item is PromiseRejectedResult => item.status === "rejected",
    );
    this.publish({
      refreshing: [...this.resources.values()].some((item) => !!item.pending),
      error: this.failures.size
        ? [...this.failures]
            .map(
              ([scope, error]) =>
                `${resourceNames[scope]}未能刷新${error instanceof Error ? `：${error.message}` : "。"}`,
            )
            .join("\n")
        : "",
      revision: this.state.revision + 1,
      ...(feedback && !this.failures.size
        ? {
            notice:
              [...this.issues.values()].join(" ") ||
              "数据已刷新，未保存输入仍保留。",
          }
        : {}),
    });
    round.pending--;
    if (round.pending === 0) {
      this.round = undefined;
      const details: OperationFailure[] = [...this.failures].map(
        ([scope, error]) => {
          const value = error as { code?: string; status?: number } | undefined;
          return {
            label: resourceNames[scope],
            message:
              error instanceof Error ? error.message : "读取失败，请重试。",
            errorCode: value?.code,
            httpStatus: value?.status,
          };
        },
      );
      const error = details.length
        ? Object.assign(new Error("部分内容刷新失败。"), {
            code: "refresh_failed",
          })
        : undefined;
      operations.finish(
        {
          ...round.operation,
          label: round.feedback ? "加载用户数据" : "自动刷新数据",
        },
        error,
        details,
      );
    }
    return failures.length === 0;
  };
  recover(error: unknown, scopes: DataScope[]) {
    if (!isStaleData(error)) return;
    this.publish({
      notice: "内容已变更，正在读取最新记录；未保存的输入仍保留。",
    });
    // 复用正在进行的读取，必要时补读一次；即使读取中再次报告错误，也不另建递归请求。
    void this.refresh(scopes, true, true);
  }
  clearNotice = () => this.publish({ notice: "" });
  reportIssue(scope: DataScope, message: string) {
    if (message) this.issues.set(scope, message);
    else this.issues.delete(scope);
    this.publish({ notice: [...this.issues.values()].join(" ") });
  }
}
export const dataRefresh = new DataRefreshCoordinator();
