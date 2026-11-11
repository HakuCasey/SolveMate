import { describe, expect, it } from "vitest";
import {
  courses,
  createInitialData,
  getCurrentContent,
  sampleNotes,
  validateContentReferences,
} from "./catalog";
import { parseTextbook } from "./textbooks";
import { assertAppData } from "./validation";

describe("built-in study content", () => {
  it("accepts older display settings and rejects invalid pane proportions", () => {
    const data = createInitialData();
    expect(() => assertAppData(data)).not.toThrow();
    for (const ratio of [0, 1, -0.1, 1.1, NaN, Infinity, "0.5"]) {
      const invalid = {
        ...data,
        settings: { ...data.settings, readingPaneRatio: ratio },
      };
      expect(() => assertAppData(invalid)).toThrow();
    }
    data.settings.readingPaneRatio = 0.65;
    expect(() => assertAppData(data)).not.toThrow();
  });
  it("rejects malformed external session metadata rather than coercing it", () => {
    const data = createInitialData();
    const malformed = {
      ...data,
      conversations: [
        {
          ...data.conversations[0],
          bindings: [
            {
              connectionId: "local",
              protocol: ["api"],
              externalSessionId: "s1",
            },
          ],
        },
      ],
    };
    expect(() => assertAppData(malformed)).toThrow();
    const invalidTurn = {
      ...data,
      conversations: [
        {
          ...data.conversations[0],
          turns: [
            {
              id: "t1",
              connectionId: "local",
              status: ["completed"],
              startedAt: 1,
            },
          ],
        },
      ],
    };
    expect(() => assertAppData(invalidTurn)).toThrow();
  });
  it("loads all questions, textbook chapters, and memory references", () => {
    expect(courses.map((course) => course.questions.length)).toEqual([24, 12]);
    for (const course of courses) {
      expect(course.textbooks[0]?.chapters).toHaveLength(6);
      expect(course.memory.learningPoints).toHaveLength(12);
      expect(course.memory.discussionPoints).toHaveLength(6);
      const questionIds = new Set(
        course.questions.map((question) => question.id),
      );
      expect(questionIds.size).toBe(course.questions.length);
      for (const point of [
        ...course.memory.learningPoints,
        ...course.memory.discussionPoints,
      ]) {
        expect(
          point.source.question_ids.every((id) => questionIds.has(id)),
        ).toBe(true);
      }
    }
    expect(sampleNotes).toHaveLength(4);
  });

  it("keeps formulas and code unchanged when splitting textbook chapters", () => {
    const formula = "\\[\\frac{1}{2}\\]";
    const code = "```c\nint value = 2;\n```";
    const book = parseTextbook(
      "sample",
      `# 教材\n\n<a id="first"></a>\n## 第一章\n\n${formula}\n\n${code}\n\n<a id="second"></a>\n## 第二章\n\n下一章`,
    );
    expect(book.chapters.map((chapter) => chapter.id)).toEqual([
      "first",
      "second",
    ]);
    expect(book.chapters[0]?.content).toBe(`${formula}\n\n${code}`);
    expect(book.chapters[1]?.content).toBe("下一章");
  });

  it("keeps initial state and its examples independent between loads", () => {
    const first = createInitialData();
    first.robots.length = 0;
    first.conversations[0]!.messages.length = 0;
    const second = createInitialData();
    expect(second.robots).toHaveLength(3);
    expect(second.conversations).toHaveLength(4);
    expect(second.conversations[0]?.messages).toHaveLength(4);
    expect(second.settings.fontSize).toBe(14);
    expect(
      second.conversations.every((conversation) => conversation.example),
    ).toBe(true);
  });

  it("reads a selected question or chapter from its own course", () => {
    const question = getCurrentContent({
      courseId: "c-language",
      kind: "questions",
      itemId: "C008",
      chapterIndex: 0,
    });
    expect(question.content).toContain("sizeof");
    const chapter = getCurrentContent({
      courseId: "calculus",
      kind: "textbooks",
      itemId: "B001",
      chapterIndex: 0,
    });
    expect(chapter.id).toBe("B001:limits");
    expect(chapter.content).toContain("\\frac");
    expect(() =>
      getCurrentContent({
        courseId: "calculus",
        kind: "questions",
        itemId: "C008",
        chapterIndex: 0,
      }),
    ).toThrow("Question was not found");
  });

  it("rejects an unknown saved question before restoring the page", () => {
    const data = createInitialData();
    data.selection.itemId = "M999";
    expect(() => validateContentReferences(data)).toThrow(
      "Question was not found",
    );
    expect(data.selection.itemId).toBe("M999");
  });

  it("accepts explicit ordinary sessions but rejects missing or malformed reading associations", () => {
    const data = createInitialData();
    data.conversations[0].selection = null;
    expect(() => assertAppData(data)).not.toThrow();
    expect(() => validateContentReferences(data)).not.toThrow();
    for (const selection of [
      undefined,
      {},
      { kind: "questions", itemId: "M001" },
    ]) {
      const malformed = {
        ...data,
        conversations: [{ ...data.conversations[0], selection }],
      };
      expect(() => assertAppData(malformed)).toThrow();
    }
  });

  it("rejects an out-of-range chapter in a saved conversation", () => {
    const data = createInitialData();
    data.conversations[0]!.selection = {
      courseId: "calculus",
      kind: "textbooks",
      itemId: "B001",
      chapterIndex: 99,
    };
    expect(() => validateContentReferences(data)).toThrow(
      "Textbook chapter was not found",
    );
    expect(data.conversations[0]!.selection?.chapterIndex).toBe(99);
  });
});
