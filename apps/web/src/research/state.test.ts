import { describe, expect, it } from "vitest";
import { assertUserData } from "@solvemate/contracts";
import { createInitialData } from "../data/catalog";
import {
  createConversation,
  conversationForReading,
} from "../state/conversations";
import { recordQuestion } from "../state/questions";
import {
  renameTool,
  toolTitle,
  changeResearch,
  researchWorkspace,
  saveTool,
  installTool,
  removeTool,
  selectTool,
  restoreResearch,
  customTool,
  toolContext,
} from "./state";
import { toolFixture } from "./tools.test-support";

describe("teaching tools", () => {
  it("starts empty, downloads once, and shares selection and removal", () => {
    const original = createInitialData();
    expect(researchWorkspace(original).tools).toEqual([]);
    const tool = {
      ...toolFixture(),
      source: "official" as const,
      version: "a".repeat(64),
    };
    let data = installTool(original, tool);
    data = selectTool(data, tool.id);
    data = changeResearch(data, {
      source: { ...original.selection, pageNumber: 1 },
    });
    const next = installTool(data, {
      ...tool,
      version: "b".repeat(64),
      template: { ...tool.template, content: "新版输出" },
    });
    expect(researchWorkspace(next).context.template.content).toBe("新版输出");
    expect(researchWorkspace(next).tools).toHaveLength(1);
    expect(researchWorkspace(next).source).toEqual(
      researchWorkspace(data).source,
    );
    expect(() => saveTool(next, tool)).toThrow("自定义");
    const removed = removeTool(next, tool.id);
    expect(researchWorkspace(removed).selectedToolId).toBeNull();
    expect(researchWorkspace(removed).tools).toEqual([]);
    assertUserData(removed);
  });
  it("saves a separate custom tool and safely retries without overwriting saved content", () => {
    const official = {
      ...toolFixture(),
      source: "official" as const,
      version: "a".repeat(64),
    };
    const original = installTool(createInitialData(), official);
    const custom = customTool(official);
    const first = saveTool(original, custom);
    const saved = researchWorkspace(first).tools.find(
      (t) => t.id === custom.id,
    )!;
    const next = saveTool(first, custom);
    expect(researchWorkspace(next).tools).toHaveLength(2);
    expect(
      researchWorkspace(next).tools.find((t) => t.id === custom.id),
    ).toEqual(saved);
    expect(
      researchWorkspace(next).tools.find((t) => t.id === official.id),
    ).toEqual(official);
    expect(() =>
      saveTool(next, {
        ...saved,
        skill: { ...saved.skill, content: "新的技能要求" },
      }),
    ).toThrow("另存为新工具");
    assertUserData(next);
  });
  it("saves changed user tools as a new selection without changing the original or conversation snapshot", () => {
    const original = toolFixture();
    const data = saveTool(createInitialData(), original);
    const snapshot = toolContext(original);
    const copy = customTool(original);
    copy.title = "新的工具";
    copy.template.content = "新的输出模板";
    const next = saveTool(data, copy);
    const workspace = researchWorkspace(next);
    expect(workspace.tools).toHaveLength(2);
    expect(workspace.selectedToolId).toBe(copy.id);
    expect(workspace.tools.find((t) => t.id === original.id)?.template).toEqual(
      original.template,
    );
    expect(snapshot.template).toEqual(original.template);
    expect(copy.skill.id).not.toBe(original.skill.id);
    expect(copy.template.id).not.toBe(original.template.id);
    expect(researchWorkspace(data).selectedToolId).toBe(original.id);
    assertUserData(next);
  });
  it("checks that confirmed tool content is still current", () => {
    const original = {
      ...toolFixture(),
      source: "official" as const,
      version: "a".repeat(64),
    };
    const data = installTool(createInitialData(), original);
    expect(
      researchWorkspace(
        selectTool(data, original.id, structuredClone(original)),
      ).selectedToolId,
    ).toBe(original.id);
    const updated = installTool(data, {
      ...original,
      version: "b".repeat(64),
      template: { ...original.template, content: "更新后的模板" },
    });
    expect(() => selectTool(updated, original.id, original)).toThrow(
      "内容已更新",
    );
    expect(() =>
      selectTool(removeTool(data, original.id), original.id, original),
    ).toThrow("已删除");
  });
  it("preserves legacy custom templates as tools without multiplying them on later saves", () => {
    const data = createInitialData(),
      context = toolContext(toolFixture());
    data.questionResearch = {
      source: null,
      conversationId: null,
      context,
      templates: [
        { id: "my-template", title: "我的模板", content: "我的内容" },
      ],
    };
    const first = changeResearch(data, {}),
      second = changeResearch(first, {});
    expect(researchWorkspace(first).tools).toHaveLength(2);
    expect(researchWorkspace(second).tools).toEqual(
      researchWorkspace(first).tools,
    );
    expect(
      researchWorkspace(first).tools.some(
        (t) => t.template.content === "我的内容",
      ),
    ).toBe(true);
    assertUserData(second);
  });
  it("snapshots sent instructions and keeps them for retry after edits", () => {
    const data = saveTool(createInitialData(), toolFixture());
    const conversation = createConversation(data, data.selection);
    const research = researchWorkspace(data).context;
    const input = {
      conversation,
      research,
      robotId: data.defaultRobotId!,
      messageId: "question",
      turnId: "turn-one",
      text: "出题",
      references: [],
      createdAt: 1,
      create: true,
    };
    const saved = recordQuestion(data, input, null);
    research.template.content = "已修改";
    const previous = saved.conversations.find((c) => c.id === conversation.id)!;
    const next = recordQuestion(
      saved,
      { ...input, conversation: previous, retry: true, turnId: "turn-two" },
      null,
    );
    const current = next.conversations.find((c) => c.id === conversation.id)!;
    expect(current.research).toEqual(previous.messages[0].research);
    expect(current.research!.template.content).not.toBe("已修改");
    expect(conversationForReading([current], data.selection)).toBeUndefined();
    assertUserData(next);
  });
  it("restores a conversation without recreating deleted tools", () => {
    let data = saveTool(createInitialData(), toolFixture());
    const conversation = {
      ...createConversation(data),
      research: researchWorkspace(data).context,
    };
    data = removeTool(data, toolFixture().id);
    const restored = restoreResearch(data, conversation, null);
    expect(researchWorkspace(restored).selectedToolId).toBeNull();
    expect(researchWorkspace(restored).tools).toEqual([]);
  });
});

it("renames both tool sources by id and retains the local name during community updates", () => {
  const official = {
    ...toolFixture(),
    source: "official" as const,
    version: "a".repeat(64),
  };
  let data = installTool(createInitialData(), official);
  data = selectTool(data, official.id);
  data = renameTool(data, official.id, "我的试题工具", official.title);
  expect(researchWorkspace(data).context.toolTitle).toBe("我的试题工具");
  const next = installTool(data, {
    ...official,
    title: "发布者修改的名称",
    version: "b".repeat(64),
  });
  const updated = researchWorkspace(next).tools[0];
  expect(toolTitle(updated)).toBe("我的试题工具");
  expect(updated.version).toBe("b".repeat(64));
  expect(updated.title).toBe("发布者修改的名称");
  expect(updated.skill).toEqual(official.skill);
  expect(() =>
    renameTool(next, official.id, "陈旧修改", official.title),
  ).toThrow("名称已被修改");
  const copy = customTool(updated);
  const user = saveTool(next, copy);
  const renamed = renameTool(user, copy.id, "自定义工具名称", copy.title);
  expect(
    toolTitle(researchWorkspace(renamed).tools.find((t) => t.id === copy.id)!),
  ).toBe("自定义工具名称");
  expect(() => renameTool(renamed, "missing", "名称", "旧名称")).toThrow(
    "工具已删除",
  );
  assertUserData(renamed);
});
