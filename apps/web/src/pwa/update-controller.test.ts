import { afterEach, describe, expect, it, vi } from "vitest";
import { AppUpdateController } from "./update-controller";
import { applicationStatus } from "../status/state";

class Worker extends EventTarget {
  state: ServiceWorkerState = "installing";
  change(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}
class Registration extends EventTarget {
  active: Worker | null = new Worker();
  waiting: Worker | null = null;
  installing: Worker | null = null;
  update = vi.fn(async () => this as unknown as ServiceWorkerRegistration);
  start(worker: Worker) {
    this.installing = worker;
    this.dispatchEvent(new Event("updatefound"));
  }
}
const held = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const controllers: AppUpdateController[] = [];
function setup() {
  const registration = new Registration();
  const dependencies = {
    register: vi.fn(async () => ({
      url: "/sw.js",
      registration: registration as unknown as ServiceWorkerRegistration,
    })),
    fetchScript: vi.fn(
      async () =>
        new Response("worker", {
          headers: { "content-type": "text/javascript" },
        }),
    ),
    online: vi.fn(() => true),
  };
  const controller = new AppUpdateController(dependencies);
  controllers.push(controller);
  return { controller, registration, dependencies };
}
afterEach(() => {
  controllers.splice(0).forEach((item) => item.dispose());
  vi.useRealTimers();
});

describe("application updates", () => {
  it("publishes a background update as ready without another click or check", async () => {
    const { controller, registration } = setup();
    await controller.check();
    expect(controller.snapshot().status).toBe("current");
    const worker = new Worker();
    registration.start(worker);
    expect(applicationStatus(controller.snapshot()).label).toBe("正在下载…");
    registration.waiting = worker;
    registration.installing = null;
    worker.change("installed");
    expect(applicationStatus(controller.snapshot())).toMatchObject({
      label: "新版就绪",
      status: "新版就绪",
      action: "更新应用",
      busy: false,
    });
    expect(registration.update).toHaveBeenCalledOnce();
    controller.reloadFailed("配置尚未保存。");
    expect(applicationStatus(controller.snapshot()).label).toBe("新版就绪");
  });
  it("checks manually, reports current only after a successful server check and reuses an in-flight request", async () => {
    const { controller, dependencies, registration } = setup();
    const request = held<Response>();
    dependencies.fetchScript.mockReturnValue(request.promise);
    const first = controller.check();
    expect(controller.check()).toBe(first);
    expect(controller.snapshot().status).toBe("checking");
    await Promise.resolve();
    request.resolve(
      new Response("worker", {
        headers: { "content-type": "application/javascript" },
      }),
    );
    await first;
    expect(registration.update).toHaveBeenCalledOnce();
    expect(controller.snapshot().status).toBe("current");
    controller.resetCurrent();
    expect(controller.snapshot().status).toBe("idle");
  });
  it("reports offline and bad HTTP responses without claiming the cached app is current, then retries", async () => {
    const { controller, dependencies } = setup();
    dependencies.online.mockReturnValue(false);
    await controller.check();
    expect(controller.snapshot()).toMatchObject({
      status: "error",
      error: "当前离线，无法检查更新。",
    });
    expect(dependencies.fetchScript).not.toHaveBeenCalled();
    dependencies.online.mockReturnValue(true);
    dependencies.fetchScript.mockResolvedValueOnce(
      new Response("unavailable", { status: 503 }),
    );
    await controller.check();
    expect(controller.snapshot().status).toBe("error");
    dependencies.fetchScript.mockResolvedValueOnce(
      new Response("<html>fallback</html>", {
        headers: { "content-type": "text/html" },
      }),
    );
    await controller.check();
    expect(controller.snapshot().status).toBe("error");
    await controller.check();
    expect(controller.snapshot().status).toBe("current");
  });
  it("reports downloading and ready from actual worker events without clearing a late ready result", async () => {
    const { controller, registration } = setup();
    const worker = new Worker();
    const finished = held<ServiceWorkerRegistration>();
    registration.update.mockImplementation(() => {
      registration.start(worker);
      return finished.promise;
    });
    const checking = controller.check();
    await vi.waitFor(() =>
      expect(controller.snapshot().status).toBe("downloading"),
    );
    await controller.check();
    expect(controller.snapshot().status).toBe("downloading");
    expect(registration.update).toHaveBeenCalledOnce();
    registration.waiting = worker;
    registration.installing = null;
    worker.change("installed");
    expect(controller.snapshot().status).toBe("ready");
    finished.resolve(registration as unknown as ServiceWorkerRegistration);
    await checking;
    expect(controller.snapshot().status).toBe("ready");
    expect(controller.waitingWorker()).toBe(worker);
  });
  it("keeps an already downloaded update available while offline", async () => {
    const { controller, registration, dependencies } = setup();
    registration.waiting = new Worker();
    dependencies.online.mockReturnValue(false);
    await controller.check();
    expect(controller.snapshot().status).toBe("ready");
    expect(dependencies.fetchScript).not.toHaveBeenCalled();
  });
  it("reports failed asset installation and allows a later successful update", async () => {
    const { controller, registration } = setup();
    await controller.check();
    const first = new Worker();
    registration.start(first);
    first.change("redundant");
    expect(controller.snapshot().status).toBe("error");
    const second = new Worker();
    registration.update.mockImplementationOnce(async () => {
      registration.start(second);
      return registration as unknown as ServiceWorkerRegistration;
    });
    // 浏览器尚未清除失败 worker 的 installing 字段时，也能立即重试。
    await controller.check();
    expect(controller.snapshot().status).toBe("downloading");
    registration.waiting = second;
    second.change("installed");
    expect(controller.snapshot().status).toBe("ready");
  });
  it("retries registration failures and replaces browser error details with a readable message", async () => {
    const { controller, dependencies } = setup();
    dependencies.register.mockRejectedValueOnce(
      new TypeError("browser internal detail"),
    );
    await controller.check();
    expect(controller.snapshot()).toMatchObject({
      status: "error",
      error: "检查更新失败，请确认服务和网络可用后重试。",
    });
    await controller.check();
    expect(controller.snapshot().status).toBe("current");
    dependencies.fetchScript.mockRejectedValueOnce(
      new TypeError("Failed to fetch"),
    );
    await controller.check();
    expect(controller.snapshot().error).not.toContain("Failed to fetch");
  });

  it("bounds a hanging check and ignores its late success", async () => {
    vi.useFakeTimers();
    const { controller, dependencies } = setup();
    const request = held<Response>();
    dependencies.fetchScript.mockReturnValueOnce(request.promise);
    const checking = controller.check();
    await vi.advanceTimersByTimeAsync(20001);
    await checking;
    expect(controller.snapshot()).toMatchObject({
      status: "error",
      error: "检查更新超时，请重试。",
    });
    request.resolve(
      new Response("worker", {
        headers: { "content-type": "text/javascript" },
      }),
    );
    await Promise.resolve();
    expect(controller.snapshot().status).toBe("error");
    await controller.check();
    expect(controller.snapshot().status).toBe("current");
  });
  it("bounds a hanging download while accepting eventual installation", async () => {
    vi.useFakeTimers();
    const { controller, registration } = setup();
    await controller.check();
    const worker = new Worker();
    registration.start(worker);
    await vi.advanceTimersByTimeAsync(120001);
    expect(controller.snapshot()).toMatchObject({
      status: "error",
      error: "更新下载超时，请重试。",
    });
    registration.waiting = worker;
    worker.change("installed");
    expect(controller.snapshot().status).toBe("ready");
  });
  it("does not show a first install as a pending reload and cleans up events", async () => {
    const { controller, registration } = setup();
    registration.active = null;
    const worker = new Worker();
    registration.installing = worker;
    await controller.check();
    worker.change("installed");
    expect(controller.snapshot().status).toBe("downloading");
    worker.change("activated");
    expect(controller.snapshot().status).toBe("current");
    controller.dispose();
    registration.start(new Worker());
    expect(controller.snapshot().status).toBe("current");
  });
  it("keeps the ready action available after a reload guard rejects", async () => {
    const { controller, registration } = setup();
    registration.waiting = new Worker();
    await controller.check();
    controller.beginReload();
    controller.markReady();
    expect(controller.snapshot().status).toBe("reloading");
    controller.reloadFailed("机器人配置尚未保存。");
    expect(controller.snapshot()).toEqual({
      status: "ready",
      error: "机器人配置尚未保存。",
    });
  });
});
