import { describe, expect, it } from "vitest";
import { createInitialData } from "../data/catalog";
import { initializeTeachingTools } from "./initialize";
import { changeResearch, removeTool, researchWorkspace } from "./state";
import { toolFixture } from "./tools.test-support";
import question from "../../../../data/tools/question-development.json";

describe("teaching tool initialization", () => {
  it("preinstalls three official tools once and does not restore deleted tools", async () => {
    const data = await initializeTeachingTools(createInitialData());
    expect(researchWorkspace(data).tools.map((t) => t.title)).toEqual([
      "讲义研发",
      "试题研发",
      "试题精讲",
    ]);
    expect(researchWorkspace(data).selectedToolId).toBe("question-development");
    expect(await initializeTeachingTools(data)).toBe(data);
    const removed = researchWorkspace(data).tools.reduce(
      (d, t) => removeTool(d, t.id),
      data,
    );
    expect(await initializeTeachingTools(removed)).toBe(removed);
    expect(researchWorkspace(removed).tools).toEqual([]);
  });
  it("replaces unchanged legacy presets while preserving custom work and reading context", async () => {
    const source = createInitialData();
    const old = {
      ...toolFixture("legacy-0-template-choice"),
      title: question.template.title,
      skill: question.skill,
      template: question.template,
      updatedAt: 0,
    };
    const data = changeResearch(source, {
      tools: [old, toolFixture()],
      selectedToolId: old.id,
      source: { ...source.selection, pageNumber: 3 },
    });
    const result = await initializeTeachingTools(data);
    expect(researchWorkspace(result).tools.map((t) => t.id)).toEqual([
      "lecture-development",
      "question-development",
      "question-explanation",
      "example-tool",
    ]);
    expect(researchWorkspace(result).source).toEqual(
      researchWorkspace(data).source,
    );
    expect(result.conversations).toBe(data.conversations);
    expect(await initializeTeachingTools(result)).toBe(result);
    const edited = changeResearch(source, {
      tools: [
        { ...old, template: { ...old.template, content: "用户修改的模板" } },
      ],
      selectedToolId: old.id,
    });
    expect(await initializeTeachingTools(edited)).toBe(edited);
  });
  it("uses the same version as the official publisher", async () => {
    const data = await initializeTeachingTools(createInitialData());
    expect(
      researchWorkspace(data).tools.find((t) => t.id === question.id)?.version,
    ).toBe("bdc5430d8a4f201919c263712b2ae3f9542904aac00f91d8785b82fe335af2f5");
  });
});
