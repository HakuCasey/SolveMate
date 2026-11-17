import {
  assertMetadata,
  type AppData,
  type QuestionResearchWorkspace,
  type QuestionResearchContext,
  type TeachingTool,
  type Conversation,
  type LearningLocation,
} from "@solvemate/contracts";
import { dataEqual } from "../refresh/merge";
import { requireReadingLocation } from "../reading/reference";
import { initialResearchWorkspace } from "./presets";

export type TeachingWorkspace = QuestionResearchWorkspace & {
  tools: TeachingTool[];
  selectedToolId: string | null;
};
export function toolTitle(tool: TeachingTool): string {
  return tool.customTitle ?? tool.title;
}

export function renameTool(
  data: AppData,
  id: string,
  title: string,
  expectedTitle: string,
): AppData {
  const workspace = researchWorkspace(data);
  const tool = workspace.tools.find((item) => item.id === id);
  if (!tool) throw new Error("工具已删除，请重新选择。");
  const name = title.trim();
  if (!name || name.length > 80) throw new Error("名称应为 1 至 80 个字符。");
  if (toolTitle(tool) !== expectedTitle && toolTitle(tool) !== name)
    throw new Error("名称已被修改，请刷新后重新命名。");
  return changeResearch(data, {
    tools: workspace.tools.map((item) =>
      item.id === id ? { ...item, customTitle: name } : item,
    ),
  });
}

export function toolContext(tool: TeachingTool): QuestionResearchContext {
  return {
    kind: "question-research",
    toolId: tool.id,
    toolTitle: toolTitle(tool),
    skill: structuredClone(tool.skill),
    template: structuredClone(tool.template),
  };
}

/** 工具目录是唯一可编辑内容；对话中的配置是发送时的快照。 */
export function researchWorkspace(data: AppData | null): TeachingWorkspace {
  const stored = data?.questionResearch;
  if (!stored)
    return { ...initialResearchWorkspace(), tools: [], selectedToolId: null };
  if (stored.tools) {
    const selected = stored.tools.find((t) => t.id === stored.selectedToolId);
    return {
      ...stored,
      tools: stored.tools,
      selectedToolId: selected?.id ?? null,
      context: selected ? toolContext(selected) : stored.context,
    };
  }
  // 早期保存的模板与当前技能组合为用户工具，保留原来的编辑内容和选择。
  const templates = [...stored.templates];
  if (!templates.some((t) => t.id === stored.context.template.id))
    templates.push(stored.context.template);
  const tools: TeachingTool[] = templates.map((template, index) => ({
    id: `legacy-${index}-${template.id.slice(0, 80)}`,
    title: template.title,
    description: "",
    skill: structuredClone(stored.context.skill),
    template: structuredClone(template),
    source: "user",
    updatedAt: 0,
  }));
  const selected = tools.find(
    (t) => t.template.id === stored.context.template.id,
  )!;
  return {
    ...stored,
    templates: [],
    tools,
    selectedToolId: selected.id,
    context: toolContext(selected),
  };
}

export function changeResearch(
  data: AppData,
  patch: Partial<QuestionResearchWorkspace>,
): AppData {
  const workspace = { ...researchWorkspace(data), ...patch, templates: [] };
  const selected = workspace.tools.find(
    (t) => t.id === workspace.selectedToolId,
  );
  if (selected) workspace.context = toolContext(selected);
  assertMetadata("QuestionResearchContext", workspace.context);
  if (workspace.source) requireReadingLocation(workspace.source);
  return { ...data, questionResearch: workspace };
}
export function selectTool(
  data: AppData,
  id: string,
  expected?: TeachingTool,
): AppData {
  const current = researchWorkspace(data).tools.find((tool) => tool.id === id);
  if (!current) throw new Error("工具已删除，请重新选择。");
  if (expected && !dataEqual(current, expected))
    throw new Error("工具内容已更新，请重新选择并确认。");
  return changeResearch(data, { selectedToolId: id });
}
export function saveTool(data: AppData, tool: TeachingTool): AppData {
  const workspace = researchWorkspace(data);
  const existing = workspace.tools.find((t) => t.id === tool.id);
  if (existing?.source === "official" || tool.source !== "user")
    throw new Error("请将社区工具保存为自定义工具。");
  const normalized: TeachingTool = {
    ...tool,
    title: tool.title.trim(),
    skill: { ...tool.skill, content: tool.skill.content.trim() },
    template: { ...tool.template, content: tool.template.content.trim() },
    updatedAt: Date.now(),
  };
  if (
    !normalized.title ||
    !normalized.skill.content ||
    !normalized.template.content
  )
    throw new Error("请填写工具名称、Skill 和模板内容。");
  assertMetadata("TeachingTool", normalized);
  if (existing) {
    // 保存结果未返回时允许重复确认同一份内容，不覆盖另一份已保存的内容。
    if (!dataEqual(existing, { ...normalized, updatedAt: existing.updatedAt }))
      throw new Error("该工具已有其他内容，请另存为新工具。");
    return selectTool(data, existing.id);
  }
  return changeResearch(data, {
    tools: [...workspace.tools, normalized],
    selectedToolId: tool.id,
  });
}
export function installTool(data: AppData, tool: TeachingTool): AppData {
  assertMetadata("TeachingTool", tool);
  if (tool.source !== "official" || !tool.version)
    throw new Error("社区工具缺少版本信息。");
  const workspace = researchWorkspace(data);
  const existing = workspace.tools.find((t) => t.id === tool.id);
  if (existing && existing.source !== "official")
    throw new Error("工具编号冲突，原工具未被替换。");
  return changeResearch(data, {
    tools: [
      ...workspace.tools.filter((t) => t.id !== tool.id),
      {
        ...tool,
        // 名称归用户管理，下载更新只替换发布内容。
        ...(existing?.customTitle ? { customTitle: existing.customTitle } : {}),
      },
    ],
  });
}
export function removeTool(data: AppData, id: string): AppData {
  const workspace = researchWorkspace(data);
  return changeResearch(data, {
    tools: workspace.tools.filter((t) => t.id !== id),
    selectedToolId:
      workspace.selectedToolId === id ? null : workspace.selectedToolId,
  });
}
export function customTool(original?: TeachingTool): TeachingTool {
  const id = crypto.randomUUID();
  return {
    id,
    suggestions: original?.suggestions,
    title: original ? `${toolTitle(original)}（自定义）`.slice(0, 80) : "",
    description: original?.description ?? "",
    skill: {
      id: `${id}-skill`,
      title: "技能要求",
      content: original?.skill.content ?? "",
    },
    template: {
      id: `${id}-template`,
      title: "输出模板",
      content: original?.template.content ?? "",
    },
    source: "user",
    updatedAt: Date.now(),
  };
}
export function restoreResearch(
  data: AppData,
  conversation: Conversation,
  source: LearningLocation | null,
): AppData {
  if (!conversation.research) throw new Error("此对话不属于教研室。");
  if (data.questionResearch?.conversationId === conversation.id) return data;
  const workspace = researchWorkspace(data);
  const tool = workspace.tools.find(
    (t) =>
      t.id === conversation.research?.toolId ||
      (!conversation.research?.toolId &&
        t.template.id === conversation.research?.template.id),
  );
  return changeResearch(data, {
    source,
    conversationId: conversation.id,
    selectedToolId: tool?.id ?? null,
    context: structuredClone(conversation.research),
  });
}
export function researchConversation(data: AppData): Conversation | undefined {
  return data.conversations.find(
    (item) =>
      item.id === data.questionResearch?.conversationId &&
      item.status === "active" &&
      !!item.research,
  );
}

export async function readToolText(file: File): Promise<string> {
  if (!/\.(md|txt)$/i.test(file.name))
    throw new Error("请选择 Markdown（.md）或纯文本（.txt）文件。");
  if (file.size > 128 * 1024)
    throw new Error("文件超过 128 KB，请缩小后重新选择。");
  const content = await file.text();
  if (!content.trim()) throw new Error("文件内容为空。");
  if (content.length > 20000)
    throw new Error("内容最多 20000 个字符，请缩短后重新选择。");
  return content;
}
