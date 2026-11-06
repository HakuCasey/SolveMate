import type { AppData, Robot } from "@solvemate/contracts";
import { createInitialData } from "../data/catalog";
import legacyRobots from "../data/legacy-robots.json";

export function createRobot(id: string = crypto.randomUUID()): Robot {
  return {
    id,
    name: "新机器人",
    specialty: "",
    description: "定制你的学习伙伴",
    icon: "bot",
    prompt:
      "你是一位耐心的学习伙伴。请用清晰、准确的语言回答问题，说明必要的步骤。遇到不确定的内容时明确说明。",
    modelSource: "global",
    modelName: "",
    temperature: 0.4,
    memoryEnabled: true,
    courseMemory: true,
    skills: ["questions", "textbooks", "notes"],
  };
}

export function restoreRobotDefaults(robot: Robot): Robot {
  const preset = createInitialData().robots.find(
    (item) => item.id === robot.id,
  );
  // 预置角色恢复原始配置；自建或复制的角色保留已保存的名称，恢复通用配置。
  return preset ?? { ...createRobot(robot.id), name: robot.name };
}

export function isRobotModified(saved: Robot, draft?: Robot): boolean {
  if (!draft) return false;
  const fields = [
    "name",
    "description",
    "icon",
    "prompt",
    "modelSource",
    "modelName",
    "temperature",
    "memoryEnabled",
    "courseMemory",
  ] as const;
  return (
    fields.some((key) => saved[key] !== draft[key]) ||
    saved.skills.length !== draft.skills.length ||
    saved.skills.some((skill) => !draft.skills.includes(skill)) ||
    (saved.specialty ?? "") !== (draft.specialty ?? "")
  );
}

/** 仅升级未经用户修改的旧预置，保留自定义配置、空列表及历史消息。 */
export function upgradeRobotCatalog(data: AppData): AppData {
  if (data.robotCatalogVersion === 1) return data;
  const presets = createInitialData().robots;
  const unchanged = new Set(
    data.robots
      .filter((robot) => {
        const old = legacyRobots.find((item) => item.id === robot.id);
        // 与旧版初始配置逐字段比较，用户改过的配置不会被预置升级覆盖。
        return (
          old &&
          Object.entries(old).every(([key, value]) => {
            const actual = robot[key as keyof Robot];
            return Array.isArray(value)
              ? Array.isArray(actual) &&
                  value.length === actual.length &&
                  value.every((entry) => actual.some((item) => item === entry))
              : actual === value;
          }) &&
          !robot.specialty
        );
      })
      .map((robot) => robot.id),
  );
  const retireHero = unchanged.has("hero");
  const robots = data.robots
    .filter((robot) => !(retireHero && robot.id === "hero"))
    .map((robot) =>
      unchanged.has(robot.id)
        ? (presets.find((preset) => preset.id === robot.id) ?? robot)
        : robot,
    );
  // 不重新添加被删除的旧预置；有旧预置可升级时，只补充新发布的学科教师。
  if (unchanged.size) {
    for (const preset of presets.filter((robot) => robot.id !== "scholar")) {
      if (!robots.some((robot) => robot.id === preset.id)) robots.push(preset);
    }
  }
  const defaultRobotId = robots.some(
    (robot) => robot.id === data.defaultRobotId,
  )
    ? data.defaultRobotId
    : (robots[0]?.id ?? null);
  return {
    ...data,
    robotCatalogVersion: 1,
    robots,
    defaultRobotId,
    conversations: retireHero
      ? data.conversations.map((session) =>
          session.robotId === "hero"
            ? {
                ...session,
                robotId:
                  session.selection === null
                    ? defaultRobotId
                    : session.selection.courseId === "calculus"
                      ? "calculus-teacher"
                      : "c-language-teacher",
              }
            : session,
        )
      : data.conversations,
  };
}
