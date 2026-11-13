import { describe, expect, it } from "vitest";
import {
  aiStudyEvent,
  studyActivities,
  generatingReplyId,
  type StudyContext,
} from "./policy";
import { createInitialData } from "../data/catalog";
import { aiTurn } from "../ai/fixtures.test-support";
import { mergeAiTurn } from "../ai/state";
const base: StudyContext = {
  view: "library",
  readingAvailable: true,
  readingKind: "textbooks",
  materialAvailable: true,
  conversationAvailable: true,
  questionDraft: true,
  noteAvailable: true,
  noteEditing: false,
  generating: false,
};
describe("study whitelist", () => {
  it.each(["library", "robots", "content", "teaching"])(
    "excludes the %s management screen",
    (view) => {
      expect(studyActivities({ ...base, view })).toEqual([]);
    },
  );
  it("includes materials, questions, conversation, draft and note work", () => {
    expect(studyActivities({ ...base, view: "reading" })).toEqual([
      "material-reading",
      "conversation-reading",
      "question-writing",
    ]);
    expect(
      studyActivities({ ...base, view: "reading", readingKind: "questions" }),
    ).toContain("question-reading");
    expect(studyActivities({ ...base, view: "materials" })).toContain(
      "material-reading",
    );
    expect(studyActivities({ ...base, view: "conversations" })).toEqual([
      "conversation-reading",
      "question-writing",
    ]);
    expect(studyActivities({ ...base, view: "notes" })).toEqual([
      "note-reading",
    ]);
    expect(studyActivities({ ...base, noteEditing: true })).toEqual([
      "note-editing",
    ]);
    expect(studyActivities({ ...base, generating: true })).toEqual([
      "ai-generating",
    ]);
  });
  it("does not count empty conversation screens or missing content", () => {
    expect(
      studyActivities({
        ...base,
        view: "conversations",
        conversationAvailable: false,
        questionDraft: false,
      }),
    ).toEqual([]);
    expect(
      studyActivities({
        ...base,
        view: "reading",
        readingAvailable: false,
        conversationAvailable: false,
        questionDraft: false,
      }),
    ).toEqual([]);
  });
  it("excludes uncertain submissions, permissions and failed connections from generation", () => {
    const data = createInitialData(),
      conversation = data.conversations[0];
    const result = aiTurn({
      conversationId: conversation.id,
      teacher: {
        id: conversation.robotId!,
        name: "测试",
        prompt: "",
        icon: "bot",
      },
    });
    const saved = mergeAiTurn(data, result);
    expect(
      generatingReplyId(saved.conversations, { [result.id]: result }, {}),
    ).toBe(result.id);
    expect(
      generatingReplyId(
        saved.conversations,
        { [result.id]: result },
        { [result.id]: "断开" },
      ),
    ).toBe("");
    expect(
      generatingReplyId(
        saved.conversations,
        { [result.id]: { ...result, submissionStatus: "uncertain" } },
        {},
      ),
    ).toBe("");
    expect(
      generatingReplyId(
        saved.conversations,
        {
          [result.id]: {
            ...result,
            permissions: [{ id: "permission" } as never],
          },
        },
        {},
      ),
    ).toBe("");
  });
});

it("only renews AI activity for actual reply changes, not heartbeats or repeated reads", () => {
  const turn = aiTurn();
  const key = aiStudyEvent({ [turn.id]: turn }, turn.lastActivityAt);
  expect(key).not.toBe("");
  expect(
    aiStudyEvent(
      {
        [turn.id]: {
          ...turn,
          revision: 99,
          lastActivityAt: turn.lastActivityAt + 1000,
        },
      },
      turn.lastActivityAt + 1000,
    ),
  ).toBe(key);
  expect(
    aiStudyEvent(
      { [turn.id]: { ...turn, content: turn.content + "新增正文" } },
      turn.lastActivityAt,
    ),
  ).not.toBe(key);
  expect(
    aiStudyEvent(
      { [turn.id]: { ...turn, status: "completed" } },
      turn.lastActivityAt,
    ),
  ).not.toBe(key);
  expect(aiStudyEvent({ [turn.id]: turn }, turn.lastActivityAt + 300001)).toBe(
    "",
  );
});
