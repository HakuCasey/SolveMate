import { describe, expect, it, vi } from "vitest";
import type { Material } from "@solvemate/contracts";
import { createMaterialQuery } from "./query";
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const list = (id: string) => ({ items: [{ id } as Material], warning: "" });
describe("material query ordering", () => {
  it("does not overwrite a newer query when an earlier request returns last", async () => {
    const first = deferred<ReturnType<typeof list>>(),
      second = deferred<ReturnType<typeof list>>(),
      publish = vi.fn();
    const query = createMaterialQuery(
      vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
      publish,
      vi.fn(),
    );
    const old = query.refresh(),
      current = query.refresh();
    second.resolve(list("new"));
    await current;
    first.resolve(list("old"));
    await old;
    expect(publish.mock.calls).toEqual([[list("new")]]);
  });
  it("ignores responses and errors from before a saved mutation", async () => {
    const waiting = deferred<ReturnType<typeof list>>(),
      publish = vi.fn(),
      fail = vi.fn();
    const query = createMaterialQuery(() => waiting.promise, publish, fail);
    const reading = query.refresh();
    query.invalidate();
    waiting.resolve(list("old"));
    await reading;
    expect(publish).not.toHaveBeenCalled();
    const failure = deferred<ReturnType<typeof list>>();
    const failing = createMaterialQuery(() => failure.promise, publish, fail);
    const old = failing.refresh();
    failing.invalidate();
    failure.reject(new Error("Old connection failure"));
    await old;
    expect(fail).not.toHaveBeenCalled();
  });
  it("does not restore an old browser cache over freshly saved records", async () => {
    const cache = deferred<Material[]>(),
      publish = vi.fn();
    const query = createMaterialQuery(
      async () => list("new"),
      publish,
      vi.fn(),
    );
    const restoring = query.restoreCached(() => cache.promise);
    query.invalidate();
    cache.resolve(list("old").items);
    await restoring;
    expect(publish).not.toHaveBeenCalled();
    await query.refresh();
    expect(publish).toHaveBeenCalledWith(list("new"));
  });
  it("reports the current failure without replacing existing records", async () => {
    const publish = vi.fn(),
      fail = vi.fn();
    const query = createMaterialQuery(
      async () => {
        throw new Error("Service unavailable");
      },
      publish,
      fail,
    );
    expect(await query.refresh()).toBeNull();
    expect(publish).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith("Service unavailable");
  });
});
