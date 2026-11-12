/** 教研活动的编号和名称由菜单与页面共用，具体工作流程另行设计。 */
export const teachingActivities = [
  { id: "handout-development", title: "讲义研发" },
  { id: "exam-explanation", title: "试卷精讲" },
  { id: "exam-development", title: "试卷研发" },
] as const;

export type TeachingActivityId = (typeof teachingActivities)[number]["id"];
