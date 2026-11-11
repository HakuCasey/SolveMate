import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalDataController } from "./controller";
import { LocalDataConflictError } from "./index";
import { createInitialData } from "../data/catalog";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => vi.restoreAllMocks());
describe("saved metadata transactions", () => {
  it("publishes configuration only after saving and preserves events arriving during the save", async () => {
    const gate = deferred(),
      save = vi
        .fn()
        .mockReturnValueOnce(gate.promise)
        .mockResolvedValue(undefined);
    const controller = new LocalDataController({
      load: async () => null,
      save,
    });
    const data = createInitialData();
    controller.initialize(data);
    const pending = controller.commit((previous) => ({
      ...previous,
      settings: { ...previous.settings, fontSize: 21 },
    }));
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    controller.update((previous) =>
      previous
        ? {
            ...previous,
            conversations: previous.conversations.map((item, index) =>
              index
                ? item
                : {
                    ...item,
                    messages: [
                      ...item.messages,
                      {
                        id: "new-result",
                        role: "assistant",
                        content: "保存过程中收到的回复",
                      },
                    ],
                  },
            ),
          }
        : previous,
    );
    expect(controller.snapshot().data?.settings.fontSize).toBe(14);
    gate.resolve();
    await pending;
    expect(controller.snapshot().data?.settings.fontSize).toBe(21);
    expect(
      controller.snapshot().data?.conversations[0].messages.at(-1)?.id,
    ).toBe("new-result");
    expect(save).toHaveBeenCalledTimes(2);
  });
  it("keeps saved configuration on quota failure and allows an explicit retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const save = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("Full", "QuotaExceededError"))
      .mockResolvedValue(undefined);
    const controller = new LocalDataController({
      load: async () => null,
      save,
    });
    const original = createInitialData();
    controller.initialize(original);
    const change = (previous: typeof original) => ({
      ...previous,
      settings: { ...previous.settings, fontSize: 21 },
    });
    await expect(controller.commit(change)).rejects.toThrow("Full");
    expect(controller.snapshot().data).toBe(original);
    expect(controller.snapshot().saveState).toBe("error");
    await controller.commit(change);
    expect(controller.snapshot().data?.settings.fontSize).toBe(21);
    expect(controller.snapshot().saveState).toBe("saved");
  });
  it("reports a storage conflict without replacing the loaded data", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const original = createInitialData();
    const controller = new LocalDataController({
      load: async () => null,
      save: async () => {
        throw new LocalDataConflictError();
      },
    });
    controller.initialize(original);
    await expect(
      controller.commit((previous) => ({ ...previous })),
    ).rejects.toBeInstanceOf(LocalDataConflictError);
    expect(controller.snapshot().conflict).toBe(true);
    expect(controller.snapshot().data).toBe(original);
  });
  it("rejects overlapping configuration commits instead of racing their saved values", async () => {
    const gate = deferred(),
      controller = new LocalDataController({
        load: async () => null,
        save: () => gate.promise,
      });
    controller.initialize(createInitialData());
    const first = controller.commit((previous) => previous);
    await expect(controller.commit((previous) => previous)).rejects.toThrow(
      "正在保存",
    );
    gate.resolve();
    await first;
  });
});
