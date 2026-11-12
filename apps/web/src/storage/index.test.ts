import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialData } from "../data/catalog";
import { DexieStorage, LocalDataConflictError } from "./index";
import { addSubject, renameSubject, removeSubject } from "../state/subjects";
import { courses } from "../data/catalog";
import { createConversation } from "../state/conversations";
import { deleteNotebook, renameNotebook, saveNoteTags } from "../state/notes";
import { createSubjectDirectory } from "../state/subjects";

const stores: DexieStorage[] = [];
const databaseNames: string[] = [];

function createStore(
  name = `solvemate-test-${crypto.randomUUID()}`,
): DexieStorage {
  const store = new DexieStorage(name);
  stores.push(store);
  if (!databaseNames.includes(name)) databaseNames.push(name);
  return store;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
  for (const name of databaseNames.splice(0)) await Dexie.delete(name);
});

describe("local storage", () => {
  it("restores renamed notebooks, custom tags and transferred notes together", async () => {
    const name = `solvemate-test-${crypto.randomUUID()}`;
    const first = createStore(name);
    let data = renameNotebook(
      createInitialData(),
      "notebook-calculus",
      "高数复习",
      1,
    );
    data = saveNoteTags(
      data,
      createSubjectDirectory(courses),
      "N001",
      ["subject:calculus"],
      ["待复习"],
      1,
      () => "note-tag-review",
    );
    data = deleteNotebook(data, "notebook-calculus", false, 2);
    await first.save(data);
    first.close();
    const restored = await createStore(name).load();
    expect(restored?.noteLibrary).toEqual(data.noteLibrary);
    expect(restored?.noteLibrary?.notes[0]).toMatchObject({
      id: "N001",
      notebookId: "notebook-unclassified",
      tagIds: ["subject:calculus", "note-tag-review"],
    });
  });
  it("persists custom subjects, renamed official subjects and deletion markers across reopening", async () => {
    const name = `solvemate-test-${crypto.randomUUID()}`;
    const first = createStore(name);
    let data = addSubject(
      createInitialData(),
      courses,
      "物理",
      "subject-physics",
    );
    data = renameSubject(data, courses, "c-language", "程序设计");
    data = removeSubject(data, courses, "calculus");
    await first.save(data);
    first.close();
    const restored = await createStore(name).load();
    expect(restored?.subjects).toEqual(data.subjects);
    expect(restored?.conversations).toEqual(data.conversations);
    expect(restored?.selection).toEqual(data.selection);
  });
  it("restores ordinary and reading sessions without borrowing the current reading selection", async () => {
    const name = `solvemate-test-${crypto.randomUUID()}`;
    const data = createInitialData();
    const session = createConversation(data, null, "calculus-teacher");
    session.messages.push({
      id: "ordinary-message",
      role: "user",
      content: "讨论一个新想法。",
    });
    data.conversations.unshift(session);
    await createStore(name).save(data);
    const restored = (await createStore(name).load())!;
    expect(restored.conversations[0].selection).toBeNull();
    expect(restored.conversations[0].messages[0].content).toBe(
      "讨论一个新想法。",
    );
    expect(restored.selection.itemId).toBe("M001");
    expect(restored.conversations[1].selection?.itemId).toBe("M001");
  });
  it("restores session labels, archive state and external bindings, while accepting older sessions", async () => {
    const name = `solvemate-test-${crypto.randomUUID()}`;
    const first = createStore(name);
    const saved = createInitialData();
    saved.conversations[0].label = "考前复习";
    saved.conversations[0].status = "archived";
    saved.conversations[0].aiConfig.connectionId = "test-harness";
    saved.conversations[0].binding = {
      conversationId: saved.conversations[0].id,
      state: "bound",
      revision: 1,
      connectionId: "test-harness",
      protocol: "opencode",
      externalSessionId: "session-test",
    };
    saved.conversations[1].deletedAt = Date.now();
    await first.save(saved);
    const restored = await createStore(name).load();
    expect(restored).toEqual(saved);
    expect(restored?.conversations[2].label).toBeNull();
  });
  it("reports an empty database without inventing saved data", async () => {
    expect(await createStore().load()).toBeNull();
  });

  it("restores messages, selection, and settings from a new connection", async () => {
    const name = `solvemate-test-${crypto.randomUUID()}`;
    const first = createStore(name);
    const saved = createInitialData();
    saved.settings.fontSize = 21;
    saved.settings.appearance = "dark";
    saved.settings.readingPaneRatio = 0.63;
    saved.conversations[0].title = "手动命名的对话";
    saved.conversations[0].titleSource = "manual";
    saved.selection = {
      courseId: "c-language",
      kind: "questions",
      itemId: "C012",
      chapterIndex: 0,
    };
    saved.conversations[0]!.messages.push({
      id: "local-message",
      role: "user",
      content: "保存我的问题。",
    });
    await first.save(saved);
    first.close();

    const restored = await createStore(name).load();
    expect(restored).toEqual(saved);
  });

  it("preserves an intentionally empty robot list after reopening", async () => {
    const name = `solvemate-test-${crypto.randomUUID()}`;
    const first = createStore(name);
    const saved = createInitialData();
    saved.robots = [];
    saved.defaultRobotId = null;
    await first.save(saved);
    first.close();
    expect((await createStore(name).load())?.robots).toEqual([]);
  });

  it("keeps the last successful value when a database write fails", async () => {
    const name = `solvemate-test-${crypto.randomUUID()}`;
    const store = createStore(name);
    const previous = createInitialData();
    await store.save(previous);
    const next = structuredClone(previous);
    next.settings.fontSize = 21;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const transaction = vi.spyOn(Dexie.prototype, "transaction");
    transaction.mockRejectedValueOnce(
      new DOMException("Storage quota exceeded.", "QuotaExceededError"),
    );

    await expect(store.save(next)).rejects.toThrow("Storage quota exceeded.");
    transaction.mockRestore();
    store.close();
    expect(await createStore(name).load()).toEqual(previous);
  });

  it("saves successive changes in order and copies each submitted value", async () => {
    const store = createStore();
    const first = createInitialData();
    first.settings.fontSize = 12;
    const saveFirst = store.save(first);
    first.settings.fontSize = 20;
    await saveFirst;
    expect((await store.load())?.settings.fontSize).toBe(12);
    const second = createInitialData();
    second.settings.fontSize = 18;
    const third = createInitialData();
    third.settings.fontSize = 19;
    await Promise.all([store.save(third), store.save(second)]);
    expect((await store.load())?.settings.fontSize).toBe(18);
  });

  it("leaves unsupported saved data untouched and reports the version error", async () => {
    const name = `solvemate-test-${crypto.randomUUID()}`;
    const raw = new Dexie(name);
    raw.version(1).stores({ state: "id" });
    const futureData = { ...createInitialData(), schemaVersion: 99 };
    await raw.table("state").put({ id: "main", value: futureData });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(createStore(name).load()).rejects.toThrow(
      "unsupported schema version",
    );
    expect((await raw.table("state").get("main")).value.schemaVersion).toBe(99);
    raw.close();
  });

  it("rejects a stale page instead of overwriting a newly saved conversation", async () => {
    const name = `solvemate-test-${crypto.randomUUID()}`;
    const first = createStore(name);
    await first.save(createInitialData());
    const second = createStore(name);
    const secondData = (await second.load())!;
    const firstData = (await first.load())!;
    firstData.conversations[0]!.messages.push({
      id: "new-message",
      role: "user",
      content: "另一个页面的新问题。",
    });
    await first.save(firstData);
    secondData.settings.fontSize = 21;
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(second.save(secondData)).rejects.toBeInstanceOf(
      LocalDataConflictError,
    );
    const saved = await createStore(name).load();
    expect(saved?.conversations[0]?.messages.at(-1)?.id).toBe("new-message");
    expect(saved?.settings.fontSize).toBe(14);

    const reloaded = (await second.load())!;
    reloaded.settings.fontSize = 20;
    await second.save(reloaded);
    const updated = await createStore(name).load();
    expect(updated?.settings.fontSize).toBe(20);
    expect(updated?.conversations[0]?.messages.at(-1)?.id).toBe("new-message");
  });

  it("upgrades a legacy record without changing the saved learning data", async () => {
    const name = `solvemate-test-${crypto.randomUUID()}`;
    const raw = new Dexie(name);
    raw.version(1).stores({ state: "id" });
    const value = createInitialData();
    value.settings.fontSize = 17;
    await raw.table("state").put({ id: "main", value });
    const store = createStore(name);
    const loaded = (await store.load())!;
    expect(loaded).toEqual(value);
    await store.save(loaded);

    const saved = await raw.table("state").get("main");
    expect(saved.revision).toBe(1);
    expect(saved.value).toEqual(value);
    raw.close();
  });

  it("requires reading an existing database before overwriting it", async () => {
    const name = `solvemate-test-${crypto.randomUUID()}`;
    const first = createStore(name);
    const original = createInitialData();
    original.settings.fontSize = 19;
    await first.save(original);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      createStore(name).save(createInitialData()),
    ).rejects.toBeInstanceOf(LocalDataConflictError);
    expect(await createStore(name).load()).toEqual(original);
  });
});
