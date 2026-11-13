import { afterEach, expect, it, vi } from "vitest";
import { uploadRequest } from "./upload-request";
function xhr() {
  const request = {
    open: vi.fn(),
    setRequestHeader: vi.fn(),
    send: vi.fn(),
    timeout: 0,
    status: 202,
    responseText: '{"saved":true}',
    upload: {
      onprogress: null as null | ((event: { loaded: number }) => void),
    },
    onload: null as null | (() => void),
    onerror: null as null | (() => void),
    ontimeout: null as null | (() => void),
    onabort: null as null | (() => void),
  };
  vi.stubGlobal(
    "XMLHttpRequest",
    vi.fn(function () {
      return request;
    }),
  );
  return request;
}
afterEach(() => vi.unstubAllGlobals());
it("reports actual bytes but waits for the service response before confirming upload", async () => {
  const request = xhr(),
    file = new File(["1234"], "test.pdf"),
    progress = vi.fn();
  const pending = uploadRequest("/local-api/test", file, progress);
  let confirmed = false;
  void pending.then(() => {
    confirmed = true;
  });
  request.upload.onprogress?.({ loaded: 4 });
  await Promise.resolve();
  expect(confirmed).toBe(false);
  expect(progress).toHaveBeenCalledWith(4, 4);
  expect(request.timeout).toBe(120000);
  request.onload?.();
  expect((await pending).status).toBe(202);
  expect(request.send).toHaveBeenCalledWith(file);
  expect(request.setRequestHeader).toHaveBeenCalledWith(
    "X-SolveMate-Client",
    "web",
  );
});
it("preserves response errors and makes interrupted uploads explicit", async () => {
  const request = xhr(),
    pending = uploadRequest(
      "/local-api/test",
      new File(["x"], "test.pdf"),
      vi.fn(),
    );
  request.status = 409;
  request.responseText = '{"detail":"学科已删除"}';
  request.onload?.();
  expect((await pending).status).toBe(409);
  const timed = xhr(),
    timeout = uploadRequest(
      "/local-api/test",
      new File(["x"], "test.pdf"),
      vi.fn(),
    );
  timed.ontimeout?.();
  await expect(timeout).rejects.toThrow("超时");
  const broken = xhr(),
    network = uploadRequest(
      "/local-api/test",
      new File(["x"], "test.pdf"),
      vi.fn(),
    );
  broken.onerror?.();
  await expect(network).rejects.toMatchObject({ code: "unavailable" });
});
