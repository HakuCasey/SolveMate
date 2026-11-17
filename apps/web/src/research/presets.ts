import type { QuestionResearchWorkspace } from "@solvemate/contracts";
import questionTool from "../../../../data/tools/question-development.json";

export function initialResearchWorkspace(): QuestionResearchWorkspace {
  return {
    source: null,
    conversationId: null,
    // 保留已有工作区的必填结构；未选择已安装工具前不能发送任务。
    context: {
      kind: "question-research",
      template: structuredClone(questionTool.template),
      skill: structuredClone(questionTool.skill),
    },
    templates: [],
    tools: [],
    selectedToolId: null,
  };
}
