import { describe, expect, it } from "vitest";
import { OperationStore, operationStatus } from "./store";
import { DataRequestError } from "../refresh/errors";
import { recordOperation } from "./records";
import { createStudyFixture } from "../data/__fixtures__/study";

describe("operation results", () => {
  it("tracks actual completion and does not hide an unrelated failure", () => {
    const store = new OperationStore();
    expect(operationStatus(store.snapshot()).label).toBe("就绪");
    const failed = store.start({
      key: "note:1",
      label: "重命名笔记",
      targetId: "1",
    });
    expect(operationStatus(store.snapshot()).label).toBe("操作中…");
    store.finish(
      failed,
      new DataRequestError("无法连接本机服务", "unavailable", 502),
    );
    const other = store.start({ key: "ai:1", label: "保存 AI 配置" });
    store.finish(other);
    expect(operationStatus(store.snapshot()).label).toBe("操作失败");
    const retry = store.start({ key: "note:1", label: "重命名笔记" });
    expect(operationStatus(store.snapshot()).label).toBe("操作中…");
    expect(store.snapshot().failures).toHaveLength(1);
    store.finish(retry);
    expect(store.snapshot().failures).toHaveLength(0);
    expect(operationStatus(store.snapshot()).label).toBe("操作成功");
    expect(store.diagnosticData()[0]).toMatchObject({
      targetId: "1",
      errorCode: "unavailable",
      httpStatus: 502,
      stage: "failed",
    });
  });
  it("does not overwrite a newer result with an older request or export error payloads", () => {
    const store = new OperationStore();
    const older = store.start({ key: "test", label: "检测 AI 连接" });
    const newer = store.start({ key: "test", label: "检测 AI 连接" });
    store.finish(newer);
    store.finish(older, new Error("secret input and password"));
    expect(operationStatus(store.snapshot()).label).toBe("操作成功");
    expect(JSON.stringify(store.diagnosticData())).not.toContain("secret");
  });
  it("keeps failure semantics when business response validation throws", async () => {
    const store = new OperationStore();
    await expect(
      store.run({ key: "save", label: "保存 AI 配置" }, async () => {
        throw new DataRequestError("数据格式不正确", "invalid_response", 422);
      }),
    ).rejects.toThrow("数据格式");
    expect(operationStatus(store.snapshot()).label).toBe("操作失败");
  });
  it("does not report typing or reading progress as a submitted operation", () => {
    const before = createStudyFixture();
    expect(
      recordOperation(before, {
        ...before,
        drafts: { conversation: "还没发送" },
        readingProgress: { positions: {}, documents: {} },
      }),
    ).toBeNull();
    const after = structuredClone(before);
    after.conversations[0].title = "重新命名";
    expect(recordOperation(before, after)).toMatchObject({
      label: "重命名对话",
      targetId: before.conversations[0].id,
    });
  });
});

it("identifies the item and distinguishes archiving, renaming and deleting", () => {
  const before = createStudyFixture(),
    after = structuredClone(before);
  const conversation = after.conversations[0];
  conversation.status = "archived";
  expect(recordOperation(before, after)).toMatchObject({
    label: "归档对话",
    targetName: conversation.title,
  });
  conversation.status = before.conversations[0].status;
  conversation.title = "修改后的对话名";
  expect(recordOperation(before, after)).toMatchObject({
    label: "重命名对话",
    targetName: conversation.title,
  });
  conversation.title = before.conversations[0].title;
  conversation.status = "deleted";
  expect(recordOperation(before, after)?.label).toBe("删除对话");
});

it("keeps unresolved failures during retries and logs every failed attempt without restoring them as current failures", () => {
  const store = new OperationStore();
  const first = store.start({ key: "ai:save:1", label: "保存 AI 配置" });
  store.finish(first, new Error("连接中断"));
  const retry = store.start({ key: first.key, label: first.label });
  expect(store.snapshot().failures.map((item) => item.id)).toEqual([first.id]);
  store.finish(retry, new Error("仍无法连接"));
  expect(store.snapshot().failures.map((item) => item.id)).toEqual([retry.id]);
  expect(store.snapshot().diagnostics).toHaveLength(2);
  const success = store.start({ key: first.key, label: first.label });
  store.finish(success);
  expect(store.snapshot().failures).toHaveLength(0);
  expect(store.snapshot().diagnostics).toHaveLength(2);
  const reopened = new OperationStore();
  reopened.restoreDiagnostics(store.snapshot().diagnostics);
  expect(reopened.snapshot().failures).toHaveLength(0);
  expect(operationStatus(reopened.snapshot()).label).toBe("就绪");
  expect(reopened.diagnosticData()).toHaveLength(2);
});
