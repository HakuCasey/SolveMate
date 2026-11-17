import type { TeachingTool } from "@solvemate/contracts";
export const toolFixture = (id = "example-tool"): TeachingTool => ({
  id,
  title: "试题研发",
  description: "根据资料出题",
  source: "user",
  updatedAt: 1,
  skill: { id: "skill", title: "技能要求", content: "核对答案与解析。" },
  template: { id: "template", title: "输出模板", content: "# 题目\n# 答案" },
});
