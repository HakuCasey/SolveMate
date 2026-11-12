import { isStaleData } from "./errors";
export type DataScope = "records" | "materials" | "content" | "ai";
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
  private resources = new Map<DataScope, Resource>();
  private listeners = new Set<() => void>();
  private state: RefreshState = {
    refreshing: false,
    error: "",
    notice: "",
    revision: 0,
  };
  private issues = new Map<DataScope, string>();
  private failures = new Set<DataScope>();
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
    this.publish({ refreshing: true });
    const requested = [...new Set(scopes)];
    const results = await Promise.allSettled(
      requested.map((scope) => this.run(scope, trailing)),
    );
    results.forEach((item, index) => {
      if (item.status === "rejected") this.failures.add(requested[index]);
      else this.failures.delete(requested[index]);
    });
    const failures = results.filter(
      (item): item is PromiseRejectedResult => item.status === "rejected",
    );
    this.publish({
      refreshing: [...this.resources.values()].some((item) => !!item.pending),
      error: this.failures.size
        ? "部分数据未能刷新，当前内容和未保存输入仍保留，请重试。"
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
