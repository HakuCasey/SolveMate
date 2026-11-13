import { describe, expect, it } from "vitest";
import { assertMetadata } from "@solvemate/contracts";
import { createInitialData, getCurrentContent } from "../data/catalog";
import { assertAppData } from "../data/validation";
import { createConversation } from "./conversations";
import { recordQuestion, type QuestionInput } from "./questions";
import { aiSettings, aiTurn } from "../ai/fixtures.test-support";
import { mergeAiTurn } from "../ai/state";
import { makeReadingReference } from "../reading/reference";

function fixture() {
  const data = createInitialData();
  const conversation = createConversation(data, null, "c-language-teacher");
  data.conversations = [conversation];
  const reference = makeReadingReference(
    data.selection,
    getCurrentContent(data.selection),
  );
  const input: QuestionInput = {
    conversation,
    robotId: "c-language-teacher",
    messageId: "question-1",
    turnId: "attempt-1",
    text: "为什么这样？",
    references: [reference],
    createdAt: 100,
  };
  return { data, conversation, input };
}

describe("save questions before requesting AI", () => {
  it("saves a new question and its references even with no AI connection, without inventing a connection", () => {
    const { data, input } = fixture();
    data.conversations = [];
    const saved = recordQuestion(data, { ...input, create: true }, null);
    const conversation = saved.conversations[0];
    expect(conversation.messages[0]).toMatchObject({
      id: input.messageId,
      content: input.text,
      references: input.references,
    });
    expect(conversation.turns[0]).toMatchObject({
      status: "failed",
      submissionStatus: "rejected",
      connectionId: null,
      snapshot: null,
      dispatch: null,
    });
    expect(conversation.turns[0].error).toContain("配置 AI");
    assertAppData(saved);
    expect(() =>
      assertMetadata("SessionTurn", {
        ...conversation.turns[0],
        status: "running",
      }),
    ).toThrow();
  });
  it.each(["disconnected", "missing-model", "deleted-connection"])(
    "appends a saved message when AI is %s",
    (kind) => {
      const { data, input } = fixture(),
        settings = aiSettings();
      const connection = settings.connections[0];
      data.conversations[0].aiConfig = {
        connectionId: connection.id,
        modelId: "a",
      };
      if (kind === "disconnected") connection.state = "disconnected";
      if (kind === "missing-model") connection.detection.models = [];
      if (kind === "deleted-connection") {
        settings.connections = [];
        settings.deletedConnectionIds = [connection.id];
      }
      const saved = recordQuestion(data, input, settings);
      expect(saved.conversations[0].messages).toHaveLength(1);
      expect(saved.conversations[0].turns[0].status).toBe("failed");
      expect(saved.conversations[0].aiConfig).toEqual(
        data.conversations[0].aiConfig,
      );
      expect(data.conversations[0].messages).toHaveLength(0);
      assertAppData(saved);
    },
  );
  it("retries the original message after configuration recovers, preserving text, time and references", () => {
    const { data, input } = fixture();
    const first = recordQuestion(data, input, null);
    const second = recordQuestion(
      first,
      {
        ...input,
        retry: true,
        turnId: "retry-1",
        createdAt: 200,
        text: "不能替换原问题",
        references: [],
      },
      aiSettings(),
    );
    const conversation = second.conversations[0];
    expect(conversation.messages).toHaveLength(1);
    expect(conversation.messages[0]).toMatchObject({
      id: input.messageId,
      content: input.text,
      createdAt: 100,
      references: input.references,
      turnId: "retry-1",
    });
    expect(conversation.turns.at(-1)?.status).toBe("running");
    const result = mergeAiTurn(
      second,
      aiTurn({
        id: "retry-1",
        conversationId: conversation.id,
        userMessageId: input.messageId,
        text: input.text,
        references: input.references,
        status: "completed",
        content: "解释如下。",
      }),
    );
    expect(
      result.conversations[0].messages.filter((item) => item.role === "user"),
    ).toHaveLength(1);
    expect(
      result.conversations[0].messages.filter(
        (item) => item.role === "assistant",
      ),
    ).toHaveLength(1);
    assertAppData(result);
  });
  it("places a retry reply after the original question even when later questions were saved", () => {
    const { data, input } = fixture();
    const first = recordQuestion(data, input, null);
    const second = recordQuestion(
      first,
      {
        ...input,
        messageId: "question-2",
        turnId: "attempt-2",
        text: "另一个问题",
        createdAt: 200,
      },
      null,
    );
    const retry = recordQuestion(
      second,
      {
        ...input,
        retry: true,
        turnId: "retry-1",
        createdAt: 300,
      },
      aiSettings(),
    );
    const result = mergeAiTurn(
      retry,
      aiTurn({
        id: "retry-1",
        conversationId: input.conversation.id,
        userMessageId: input.messageId,
        startedAt: 300,
        completedAt: 400,
        lastActivityAt: 400,
        status: "completed",
        content: "原问题的回复",
      }),
    );
    expect(result.conversations[0].messages.map((item) => item.id)).toEqual([
      "question-1",
      "assistant-1",
      "question-2",
    ]);
    expect(() =>
      recordQuestion(
        result,
        { ...input, retry: true, turnId: "retry-2" },
        aiSettings(),
      ),
    ).toThrow("已有回复");
  });
  it("does not repeat an unknown submission or resurrect a missing conversation", () => {
    const { data, input } = fixture();
    const saved = recordQuestion(data, input, aiSettings());
    saved.conversations[0].turns[0].status = "interrupted";
    saved.conversations[0].turns[0].submissionStatus = "uncertain";
    expect(() =>
      recordQuestion(
        saved,
        { ...input, retry: true, turnId: "retry" },
        aiSettings(),
      ),
    ).toThrow("先重新查询");
    expect(() =>
      recordQuestion({ ...data, conversations: [] }, input, null),
    ).toThrow("原对话已删除");
    expect(() =>
      recordQuestion(
        { ...data, conversations: [] },
        { ...input, retry: true },
        null,
      ),
    ).toThrow();
  });
  it("keeps archived conversations read-only and makes the same saved intent idempotent", () => {
    const { data, input } = fixture();
    const first = recordQuestion(data, input, null);
    expect(recordQuestion(first, input, null)).toBe(first);
    first.conversations[0].status = "archived";
    expect(() => recordQuestion(first, input, null)).toThrow("归档");
  });
});

describe("fixed linked-page snapshots", () => {
  it("saves the linked page separately from four optional fragments and retries the original snapshot", () => {
    const { data, input } = fixture();
    const context = { ...input.references[0], quoteKind: "page" as const };
    const saved = recordQuestion(
      data,
      { ...input, readingContext: context },
      null,
    );
    const changed = {
      ...context,
      content: "不能替换的其他页",
      selection: { ...context.selection!, pageNumber: 8 },
    };
    const retried = recordQuestion(
      saved,
      { ...input, retry: true, turnId: "retry-page", readingContext: changed },
      aiSettings(),
    );
    expect(retried.conversations[0].messages[0].readingContext).toEqual(
      context,
    );
    expect(retried.conversations[0].selection).toEqual(context.selection);
    expect(retried.conversations[0].messages[0].references).toEqual(
      input.references,
    );
    assertAppData(retried);
  });
  it("preserves a failed question and its page, then fills only its missing snapshot on retry", () => {
    const { data, input } = fixture();
    const context = {
      ...input.references[0],
      content: "",
      quoteKind: "page" as const,
    };
    const saved = recordQuestion(
      data,
      {
        ...input,
        readingContext: context,
        contextError: "本页文字读取失败，请重试。",
      },
      aiSettings(),
    );
    expect(saved.conversations[0].messages[0].content).toBe(input.text);
    expect(saved.conversations[0].messages[0].readingContext).toEqual(context);
    expect(saved.conversations[0].turns[0]).toMatchObject({
      status: "failed",
      submissionStatus: "rejected",
      error: "本页文字读取失败，请重试。",
    });
    const completed = { ...context, content: "读取到的原页文字" };
    const retried = recordQuestion(
      saved,
      {
        ...input,
        retry: true,
        turnId: "retry-context",
        readingContext: completed,
      },
      aiSettings(),
    );
    expect(retried.conversations[0].messages).toHaveLength(1);
    expect(retried.conversations[0].messages[0].readingContext).toEqual(
      completed,
    );
    expect(retried.conversations[0].turns.at(-1)?.status).toBe("running");
    assertAppData(retried);
  });
});

it("preserves a question with an unsupported reference and does not queue an AI request", () => {
  const { data, input } = fixture();
  const selection = {
    ...input.references[0].selection!,
    kind: "textbooks" as const,
  };
  delete selection.pageNumber;
  const readingContext = {
    ...input.references[0],
    selection,
    content: "旧章节正文",
  };
  const result = recordQuestion(
    data,
    { ...input, readingContext },
    aiSettings(),
  );
  expect(result.conversations[0].messages[0].content).toBe(input.text);
  expect(result.conversations[0].messages[0].readingContext).toEqual(
    readingContext,
  );
  expect(result.conversations[0].turns[0]).toMatchObject({
    status: "failed",
    submissionStatus: "rejected",
    error: "当前版本已不支持该引用方式",
  });
  assertAppData(result);
});
