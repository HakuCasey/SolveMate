export type UpdateStatus =
  | "idle"
  | "checking"
  | "downloading"
  | "current"
  | "ready"
  | "reloading"
  | "error";
export interface UpdateState {
  status: UpdateStatus;
  error: string;
}
interface UpdateDependencies {
  register: () => Promise<{
    url: string;
    registration: ServiceWorkerRegistration;
  }>;
  fetchScript: (url: string, signal: AbortSignal) => Promise<Response>;
  online: () => boolean;
}
class UpdateCheckError extends Error {}
const checkTimeout = 20000;
const downloadTimeout = 120000;

/** 检测、下载和启用分别记录；过期检测结果不能覆盖已经就绪的新版本。 */
export class AppUpdateController {
  private state: UpdateState = { status: "idle", error: "" };
  private listeners = new Set<() => void>();
  private registration?: ServiceWorkerRegistration;
  private scriptUrl = "";
  private worker?: ServiceWorker;
  private detachRegistration?: () => void;
  private detachWorker?: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<void>;
  private checkTimer?: ReturnType<typeof setTimeout>;
  private abort?: AbortController;
  private generation = 0;
  private disposed = false;
  constructor(private readonly dependencies: UpdateDependencies) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(status: UpdateStatus, error = "") {
    if (this.disposed) return;
    if (status !== "downloading" && this.timer) clearTimeout(this.timer);
    this.state = { status, error };
    for (const listener of this.listeners) listener();
  }
  private attach(registration: ServiceWorkerRegistration) {
    if (this.registration === registration) return;
    this.detachRegistration?.();
    this.registration = registration;
    const found = () => this.observeWorker();
    registration.addEventListener("updatefound", found);
    this.detachRegistration = () =>
      registration.removeEventListener("updatefound", found);
  }
  private installingWorker() {
    const worker = this.registration?.installing;
    return worker?.state === "redundant" ? null : worker;
  }
  private observeWorker() {
    const registration = this.registration;
    const worker = this.installingWorker();
    if (registration?.waiting) {
      this.markReady();
      return;
    }
    if (!registration || !worker) return;
    if (worker === this.worker) {
      this.startDownloadTimer();
      return;
    }
    this.detachWorker?.();
    this.worker = worker;
    const hadActive = !!registration.active;
    const changed = () => {
      if (this.disposed || this.worker !== worker) return;
      if (worker.state === "redundant") {
        if (registration.waiting) this.markReady();
        else this.publish("error", "更新下载失败，请重试。");
      } else if (worker.state === "installed" && hadActive) this.markReady();
      else if (worker.state === "activated" && !hadActive)
        this.publish("current");
    };
    worker.addEventListener("statechange", changed);
    this.detachWorker = () =>
      worker.removeEventListener("statechange", changed);
    this.startDownloadTimer();
    changed();
  }
  private startDownloadTimer() {
    if (["ready", "reloading"].includes(this.state.status)) return;
    if (this.timer) clearTimeout(this.timer);
    this.publish("downloading");
    this.timer = setTimeout(
      () => this.publish("error", "更新下载超时，请重试。"),
      downloadTimeout,
    );
  }
  markReady = () => {
    if (this.state.status !== "reloading") this.publish("ready");
  };
  waitingWorker = () => this.registration?.waiting;
  beginReload = () => this.publish("reloading");
  reloadFailed = (error: string) => this.publish("ready", error);
  resetCurrent = () => {
    if (this.state.status === "current") this.publish("idle");
  };
  check = (): Promise<void> => {
    if (
      this.disposed ||
      ["ready", "reloading", "downloading"].includes(this.state.status)
    )
      return Promise.resolve();
    if (this.pending) return this.pending;
    const generation = ++this.generation;
    const abort = new AbortController();
    this.abort = abort;
    this.publish("checking");
    let timeout: ReturnType<typeof setTimeout>;
    const expired = new Promise<never>((_, reject) => {
      timeout = this.checkTimer = setTimeout(() => {
        abort.abort();
        reject(new UpdateCheckError("检查更新超时，请重试。"));
      }, checkTimeout);
    });
    const work = async () => {
      if (!this.registration) {
        const result = await this.dependencies.register();
        if (this.disposed || generation !== this.generation) return;
        this.scriptUrl = result.url;
        this.attach(result.registration);
      }
      if (this.registration!.waiting) {
        this.markReady();
        return;
      }
      if (!this.dependencies.online())
        throw new UpdateCheckError("当前离线，无法检查更新。");
      if (this.installingWorker()) {
        this.observeWorker();
        return;
      }
      // 明确访问服务端，离线缓存或不可达服务不能被当成“已是最新版本”。
      const response = await this.dependencies.fetchScript(
        this.scriptUrl,
        abort.signal,
      );
      if (
        !response.ok ||
        !/javascript|ecmascript/.test(
          response.headers.get("content-type") ?? "",
        )
      )
        throw new UpdateCheckError("无法获取应用更新，请确认服务和网络可用。");
      if (this.disposed || generation !== this.generation) return;
      await this.registration!.update();
      if (this.disposed || generation !== this.generation) return;
      if (this.registration!.waiting) this.markReady();
      else if (this.installingWorker()) this.observeWorker();
      else if (
        !["ready", "reloading", "downloading"].includes(this.state.status)
      )
        this.publish("current");
    };
    const pending = Promise.race([work(), expired])
      .catch((failure: unknown) => {
        if (this.disposed || generation !== this.generation) return;
        if (["ready", "reloading", "downloading"].includes(this.state.status))
          return;
        ++this.generation;
        this.publish(
          "error",
          failure instanceof UpdateCheckError
            ? failure.message
            : "检查更新失败，请确认服务和网络可用后重试。",
        );
      })
      .finally(() => {
        clearTimeout(timeout!);
        if (this.pending === pending) this.pending = undefined;
      });
    this.pending = pending;
    return pending;
  };
  dispose() {
    this.disposed = true;
    this.abort?.abort();
    if (this.checkTimer) clearTimeout(this.checkTimer);
    ++this.generation;
    if (this.timer) clearTimeout(this.timer);
    this.detachWorker?.();
    this.detachRegistration?.();
    this.listeners.clear();
  }
}
