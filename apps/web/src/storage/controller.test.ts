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

describe("refreshing shared local records", () => {
  it("keeps this window's reading selection while loading other browser edits", async () => {
    const original = createInitialData();
    const remote = structuredClone(original);
    remote.conversations[0].title = "另一浏览器改名";
    remote.selection.itemId = "M002";
    const controller = new LocalDataController({
      load: async () => remote,
      save: vi.fn(),
    });
    controller.initialize(original);
    await controller.refresh();
    expect(controller.readData()?.conversations[0].title).toBe(
      "另一浏览器改名",
    );
    expect(controller.readData()?.selection).toEqual(original.selection);
  });
  it("does not replace unsaved changes with a newer server snapshot", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const load = vi.fn(async () => createInitialData());
    const controller = new LocalDataController({
      load,
      save: async () => {
        throw new Error("Unavailable");
      },
    });
    controller.initialize(createInitialData());
    controller.update((previous) => ({
      ...previous!,
      settings: { ...previous!.settings, fontSize: 21 },
    }));
    await vi.waitFor(() =>
      expect(controller.snapshot().saveState).toBe("error"),
    );
    await controller.refresh();
    expect(load).toHaveBeenCalledOnce();
    expect(controller.readData()?.settings.fontSize).toBe(21);
  });
});

describe("refresh conflict recovery", () => {
  it("backs up failed saves, refreshes independent edits, and only writes again on explicit retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const base = createInitialData(),
      remote = structuredClone(base);
    remote.settings.appearance = "dark";
    const save = vi
        .fn()
        .mockRejectedValueOnce(new Error("Offline"))
        .mockResolvedValue(undefined),
      preserve = vi.fn(async () => {});
    const controller = new LocalDataController({
      load: async () => base,
      refresh: async () => remote,
      save,
      preserve,
    });
    controller.initialize(base);
    controller.update({
      ...base,
      settings: { ...base.settings, fontSize: 21 },
    });
    await vi.waitFor(() =>
      expect(controller.snapshot().saveState).toBe("error"),
    );
    await controller.refresh();
    expect(controller.readData()?.settings).toMatchObject({
      fontSize: 21,
      appearance: "dark",
    });
    expect(preserve).toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    controller.retry();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0].settings.appearance).toBe("dark");
  });
  it("requires resolution of the latest same-field conflict across repeated refreshes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const base = createInitialData(),
      remote = structuredClone(base);
    remote.settings.fontSize = 18;
    const save = vi.fn().mockRejectedValue(new Error("Offline"));
    const controller = new LocalDataController({
      load: async () => remote,
      save,
      preserve: vi.fn(async () => {}),
    });
    controller.initialize(base);
    controller.update({
      ...base,
      settings: { ...base.settings, fontSize: 21 },
    });
    await vi.waitFor(() =>
      expect(controller.snapshot().saveState).toBe("error"),
    );
    await controller.refresh();
    await controller.refresh();
    expect(controller.snapshot().conflicts).toHaveLength(1);
    remote.settings.fontSize = 19;
    await controller.refresh();
    expect(controller.snapshot().conflicts[0].remote).toBe(19);
    await expect(controller.commit((x) => x)).rejects.toThrow("修改冲突");
    controller.resolve(0, "remote");
    expect(controller.readData()?.settings.fontSize).toBe(19);
    expect(controller.snapshot().conflicts).toHaveLength(0);
    expect(save).toHaveBeenCalledTimes(1);
  });
  it("retains a failed transactional candidate even when it was never published", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const base = createInitialData(),
      preserve = vi.fn(async () => {});
    const controller = new LocalDataController({
      load: async () => base,
      save: async () => {
        throw new Error("Offline");
      },
      preserve,
    });
    controller.initialize(base);
    await expect(
      controller.commit((x) => ({
        ...x,
        settings: { ...x.settings, fontSize: 21 },
      })),
    ).rejects.toThrow("Offline");
    await controller.refresh();
    expect(controller.readData()?.settings.fontSize).toBe(14);
    expect(controller.snapshot().recoveries[0].value.settings.fontSize).toBe(
      21,
    );
  });
  it("keeps background message events while a refresh is pending", async () => {
    const pending = deferred(),
      base = createInitialData(),
      remote = structuredClone(base);
    remote.settings.appearance = "dark";
    const controller = new LocalDataController({
      load: async () => {
        await pending.promise;
        return remote;
      },
      save: vi.fn(async () => {}),
    });
    controller.initialize(base);
    const refreshing = controller.refresh();
    await Promise.resolve();
    await Promise.resolve();
    controller.update((previous) => ({
      ...previous!,
      conversations: previous!.conversations.map((x, i) =>
        i
          ? x
          : {
              ...x,
              messages: [
                ...x.messages,
                { id: "incoming", role: "assistant", content: "继续生成" },
              ],
            },
      ),
    }));
    pending.resolve();
    await refreshing;
    expect(controller.readData()?.settings.appearance).toBe("dark");
    expect(controller.readData()?.conversations[0].messages.at(-1)?.id).toBe(
      "incoming",
    );
  });
  it("retains the working view when reading or backup fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const base = createInitialData(),
      controller = new LocalDataController({
        load: async () => {
          throw new Error("Offline");
        },
        save: vi.fn(),
      });
    controller.initialize(base);
    await expect(controller.refresh()).rejects.toThrow("Offline");
    expect(controller.readData()).toBe(base);
    expect(controller.snapshot().refreshError).toContain("仍保留");
  });
});

it("keeps failed transactional candidates separately from subsequent working updates", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const base = createInitialData(),
    controller = new LocalDataController({
      load: async () => base,
      save: async () => {
        throw new Error("Offline");
      },
      preserve: async () => {},
    });
  controller.initialize(base);
  await expect(
    controller.commit((x) => ({
      ...x,
      settings: { ...x.settings, fontSize: 21 },
    })),
  ).rejects.toThrow();
  controller.update((x) => ({
    ...x!,
    settings: { ...x!.settings, appearance: "dark" },
  }));
  await vi.waitFor(() =>
    expect(controller.snapshot().recoveries.length).toBe(2),
  );
  expect(
    controller
      .snapshot()
      .recoveries.some((x) => x.value.settings.fontSize === 21),
  ).toBe(true);
});
