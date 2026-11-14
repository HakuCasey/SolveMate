import { afterEach, describe, expect, it, vi } from "vitest";
import { clearReopenParameter, reopenApplication } from "./reopen";

function setup() {
  const replace = vi.fn();
  const unregister = vi.fn(async () => true);
  const registration = { scope: "http://127.0.0.1:4173/", unregister };
  const getRegistration = vi.fn(
    async () =>
      registration as unknown as ServiceWorkerRegistration | undefined,
  );
  const fetchPage = vi.fn(
    async () =>
      new Response("<!doctype html><title>SolveMate</title>", {
        headers: { "content-type": "text/html" },
      }),
  );
  const replaceState = vi.fn();
  vi.stubGlobal("window", {
    location: { href: "http://127.0.0.1:4173/", replace },
    history: { state: { saved: true }, replaceState },
  });
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration } });
  vi.stubGlobal("fetch", fetchPage);
  // 恢复不得通过删除浏览器数据来解决版本问题。
  vi.stubGlobal("indexedDB", {
    deleteDatabase: vi.fn(() => {
      throw new Error("Do not delete records.");
    }),
  });
  vi.stubGlobal("caches", {
    delete: vi.fn(() => {
      throw new Error("Do not delete caches.");
    }),
  });
  return {
    replace,
    unregister,
    getRegistration,
    registration,
    fetchPage,
    replaceState,
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("reopen the served application after startup failure", () => {
  it("checks the served page before detaching only the app worker and navigating once", async () => {
    const test = setup();
    await reopenApplication();
    const [url, options] = test.fetchPage.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url.origin).toBe("http://127.0.0.1:4173");
    expect(url.searchParams.has("__solvemate_reopen")).toBe(true);
    expect(options.cache).toBe("no-store");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(test.getRegistration).toHaveBeenCalledWith("http://127.0.0.1:4173/");
    expect(test.unregister).toHaveBeenCalledOnce();
    expect(test.replace).toHaveBeenCalledWith(url.href);
    expect(test.fetchPage.mock.invocationCallOrder[0]).toBeLessThan(
      test.unregister.mock.invocationCallOrder[0],
    );
    expect(test.unregister.mock.invocationCallOrder[0]).toBeLessThan(
      test.replace.mock.invocationCallOrder[0],
    );
  });
  it("retains registration and current page when offline and allows another attempt", async () => {
    const test = setup();
    test.fetchPage.mockRejectedValueOnce(new TypeError("offline"));
    await expect(reopenApplication()).rejects.toThrow(
      "在项目目录运行 npm start",
    );
    expect(test.unregister).not.toHaveBeenCalled();
    expect(test.replace).not.toHaveBeenCalled();
    await reopenApplication();
    expect(test.replace).toHaveBeenCalledOnce();
  });
  it("does not detach caches or navigate for failed or non-HTML responses", async () => {
    const test = setup();
    for (const response of [
      new Response("failure", { status: 503 }),
      new Response("{}", { headers: { "content-type": "application/json" } }),
    ]) {
      test.fetchPage.mockResolvedValueOnce(response);
      await expect(reopenApplication()).rejects.toThrow("原记录未修改");
    }
    expect(test.unregister).not.toHaveBeenCalled();
    expect(test.replace).not.toHaveBeenCalled();
  });
  it("does not remove a registration belonging to another scope", async () => {
    const test = setup();
    test.registration.scope = "http://127.0.0.1:4173/other/";
    await expect(reopenApplication()).rejects.toThrow("退出旧版网页");
    expect(test.unregister).not.toHaveBeenCalled();
    expect(test.replace).not.toHaveBeenCalled();
  });
  it("retains the page when unregistering fails", async () => {
    const test = setup();
    test.unregister.mockResolvedValueOnce(false);
    await expect(reopenApplication()).rejects.toThrow("再次点击");
    expect(test.replace).not.toHaveBeenCalled();
  });
  it("stops waiting for a blocked worker operation and keeps the page available for retry", async () => {
    vi.useFakeTimers();
    const test = setup();
    test.getRegistration.mockReturnValueOnce(new Promise(() => {}));
    const attempt = expect(reopenApplication()).rejects.toThrow("再次点击");
    await vi.advanceTimersByTimeAsync(10000);
    await attempt;
    expect(test.replace).not.toHaveBeenCalled();
  });
  it("opens normally when there is no registration or worker support", async () => {
    const test = setup();
    test.getRegistration.mockResolvedValueOnce(undefined);
    await reopenApplication();
    vi.stubGlobal("navigator", {});
    await reopenApplication();
    expect(test.replace).toHaveBeenCalledTimes(2);
  });
  it("removes only the internal parameter after the current page loads", () => {
    const test = setup();
    window.location.href =
      "http://127.0.0.1:4173/?keep=1&__solvemate_reopen=uuid#notes";
    clearReopenParameter();
    expect(test.replaceState).toHaveBeenCalledWith(
      { saved: true },
      "",
      "http://127.0.0.1:4173/?keep=1#notes",
    );
    window.location.href = "http://127.0.0.1:4173/?keep=1";
    clearReopenParameter();
    expect(test.replaceState).toHaveBeenCalledOnce();
  });
});
