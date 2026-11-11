import { afterEach, describe, expect, it, vi } from "vitest";
import { localAi, LocalAiError } from "./local-api";
import { aiSettings } from "./fixtures.test-support";

afterEach(() => vi.unstubAllGlobals());

describe("local AI HTTP connection", () => {
  it("uses same-origin JSON requests and sends no model credentials", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ models: [] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetcher);
    await localAi.detect("/Applications/DeepSeek Harness.app", "opaque-model");
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("/local-api/v1/detect");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "X-SolveMate-Client": "web",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body)).toEqual({
      executablePath: "/Applications/DeepSeek Harness.app",
      model: "opaque-model",
      provider: "deepseek-harness",
      resetProbe: false,
    });
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("distinguishes missing request records from a disconnected local service", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "没有找到这次提问。" }), {
          status: 404,
        }),
      ),
    );
    await expect(localAi.turn("missing")).rejects.toMatchObject({
      code: "http_404",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Network unavailable")),
    );
    await expect(localAi.turn("missing")).rejects.toMatchObject({
      code: "local_service_unavailable",
    });
  });

  it("reports a proxy HTML fallback as a connection error", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("<html>app</html>", { status: 200 })),
    );
    await expect(localAi.settings()).rejects.toBeInstanceOf(LocalAiError);
  });
});

it("deletes only the requested connection with both saved revisions", async () => {
  const settings = aiSettings();
  const result = {
    ...settings,
    defaultConnectionId: null,
    connections: settings.connections.slice(1),
    deletedConnectionIds: ["deepseek-local"],
  };
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(result), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const saved = await localAi.deleteConnection("deepseek-local", 4, 7);
  const [url, request] = fetcher.mock.calls[0];
  expect(url).toBe("/local-api/v1/connections/deepseek-local");
  expect(request.method).toBe("DELETE");
  expect(JSON.parse(request.body)).toEqual({
    expectedRevision: 4,
    expectedPreferencesRevision: 7,
  });
  expect(saved.deletedConnectionIds).toEqual(["deepseek-local"]);
});
