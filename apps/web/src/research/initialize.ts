import type { AppData, TeachingTool } from "@solvemate/contracts";
import lecture from "../../../../data/tools/lecture-development.json";
import question from "../../../../data/tools/question-development.json";
import explanation from "../../../../data/tools/question-explanation.json";
import { sha256 } from "../content/package";
import { changeResearch, researchWorkspace } from "./state";

const official = [lecture, question, explanation];
const comprehensive = {
  id: "template-comprehensive",
  title: "综合题模板",
  content:
    "# 试题\n\n## 第 1 题\n### 题干\n给出完整条件和具体问题。\n\n### 小问\n1. 第一问\n2. 第二问\n\n---\n\n# 参考答案与解析\n\n## 第 1 题\n### 参考答案\n逐项给出答案。\n\n### 推理过程\n保留影响结论的关键步骤。\n\n### 评分要点\n说明各小问的得分依据。",
};

/** 与内容发布服务使用相同的字段排序和 JSON 编码，预置版本可直接参与更新比较。 */
function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${sortedJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

// 只替换完整匹配的旧预置项；用户改过正文、名称或技能的记录继续保留。
function isOldPreset(tool: TeachingTool): boolean {
  return (
    tool.id.startsWith("legacy-") &&
    tool.updatedAt === 0 &&
    sortedJson(tool.skill) === sortedJson(question.skill) &&
    [question.template, comprehensive].some(
      (template) =>
        tool.title === template.title &&
        sortedJson(tool.template) === sortedJson(template),
    )
  );
}

export async function initializeTeachingTools(data: AppData): Promise<AppData> {
  const workspace = researchWorkspace(data);
  const replaced = workspace.tools.filter(isOldPreset);
  // 已有目录（包括用户删空的目录）不重复补回工具，也不覆盖下载的更新版本。
  if (data.questionResearch?.tools && !replaced.length) return data;
  const kept = workspace.tools.filter((tool) => !isOldPreset(tool));
  const bundled = await Promise.all(
    official.map(async (tool) => ({
      ...structuredClone(tool),
      source: "official" as const,
      version: await sha256(new TextEncoder().encode(sortedJson(tool))),
    })),
  );
  const tools = [
    ...bundled.map((tool) => kept.find((item) => item.id === tool.id) ?? tool),
    ...kept.filter((tool) => !bundled.some((item) => item.id === tool.id)),
  ];
  const selectedToolId = tools.some(
    (tool) => tool.id === workspace.selectedToolId,
  )
    ? workspace.selectedToolId
    : question.id;
  return changeResearch(data, { tools, selectedToolId });
}
