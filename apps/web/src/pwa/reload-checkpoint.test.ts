import { describe, expect, it, vi } from "vitest";
import { createInitialData, getCurrentContent } from "../data/catalog";
import { readingDocumentKey, type ReadingState } from "../reading/state";
import { makeReadingReference } from "../reading/reference";
import {
  loadReloadCheckpoint,
  saveReloadCheckpoint,
  clearReloadCheckpoint,
  type ReloadCheckpoint,
} from "./reload-checkpoint";

function setup() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const selection = createInitialData().selection;
  const key = readingDocumentKey(selection);
  const reading: ReadingState = {
    positions: {
      [key]: { scroll: { top: 230, left: 17 }, answerVisible: true },
    },
    documents: { [key]: { zoom: 1.5, location: selection } },
    references: {
      [key]: [
        {
          id: "quote",
          reference: makeReadingReference(
            selection,
            getCurrentContent(selection),
            "原文片段",
            true,
          ),
        },
      ],
    },
  };
  const value: ReloadCheckpoint = {
    schemaVersion: 1,
    conversationId: "chat",
    drafts: { chat: "尚未发送的问题" },
    reading,
  };
  return { values, storage, value, key };
}
describe("application reload checkpoint", () => {
  it("restores drafts, independent references, zoom, answer and scroll without consuming them during initialization", () => {
    const { storage, value } = setup();
    saveReloadCheckpoint(value, storage);
    expect(loadReloadCheckpoint(storage)).toEqual({ value, error: "" });
    expect(loadReloadCheckpoint(storage).value).toEqual(value);
    clearReloadCheckpoint(storage);
    expect(loadReloadCheckpoint(storage).value).toBeNull();
  });
  it("retains invalid snapshots for diagnosis while reporting a visible error", () => {
    const { storage, values, value, key } = setup();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    saveReloadCheckpoint(value, storage);
    value.reading.documents[key].zoom = 4;
    const [savedKey] = values.keys();
    values.set(savedKey, JSON.stringify(value));
    expect(loadReloadCheckpoint(storage).error).toContain("未能恢复");
    expect(values.get(savedKey)).toBe(JSON.stringify(value));
    values.set(savedKey, "broken JSON");
    expect(loadReloadCheckpoint(storage).value).toBeNull();
    expect(values.get(savedKey)).toBe("broken JSON");
    log.mockRestore();
  });
  it("stops reload when browser storage is full or silently fails to write", () => {
    const { storage, value } = setup();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() =>
      saveReloadCheckpoint(value, {
        ...storage,
        setItem: () => {
          throw new Error("quota");
        },
      }),
    ).toThrow("无法保存");
    expect(() =>
      saveReloadCheckpoint(value, { ...storage, setItem: () => undefined }),
    ).toThrow("无法保存");
    log.mockRestore();
  });
  it("rejects invalid source references and input lengths before saving", () => {
    const { storage, value, key, values } = setup();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    value.drafts.chat = "x".repeat(10001);
    expect(() => saveReloadCheckpoint(value, storage)).toThrow("无法保存");
    value.drafts.chat = "问题";
    value.reading.references[key][0].reference.selection!.kind =
      "invalid" as "questions";
    expect(() => saveReloadCheckpoint(value, storage)).toThrow("无法保存");
    expect(values.size).toBe(0);
    log.mockRestore();
  });
});
