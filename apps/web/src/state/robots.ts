import { maxRobots, type AppData, type Robot } from "@solvemate/contracts";
import { createInitialData, defaultTeacherPrompt } from "../data/catalog";
import { upgradeRobot } from "../data/migrate-ai-metadata";
import legacyRobots from "../data/legacy-robots.json";
import legacyTeacherPrompts from "../data/legacy-teacher-prompts.json";

export function createRobot(id: string = crypto.randomUUID()): Robot {
  return {
    id,
    name: "新机器人",
    specialty: "",
    description: "自定义角色与回答要求",
    icon: "bot",
    prompt: defaultTeacherPrompt,
    schemaVersion: 3,
    revision: 1,
    aiDefaults: null,
    temperature: 0.4,
    memoryEnabled: true,
    courseMemory: true,
    skills: ["questions", "textbooks", "notes"],
  };
}

export const robotLimitMessage = `最多支持 ${maxRobots} 个机器人。`;

export const duplicateRobotNameMessage = "命名重复，请重新命名。";

/** 名称按去除首尾空白后的完整文字比较，修改时排除机器人自身。 */
export function robotNameError(
  robots: Robot[],
  robot: Pick<Robot, "id" | "name">,
) {
  const name = robot.name.trim();
  if (!name) return "请填写机器人名称。";
  return robots.some(
    (item) => item.id !== robot.id && item.name.trim() === name,
  )
    ? duplicateRobotNameMessage
    : "";
}

export function newRobotName(robots: Robot[]) {
  let name = "新机器人",
    number = 2;
  while (robotNameError(robots, { id: "", name }))
    name = `新机器人（${number++}）`;
  return name;
}

export function restoreRobotDefaults(robot: Robot): Robot {
  const preset = createInitialData().robots.find(
    (item) => item.id === robot.id,
  );
  // 预置角色恢复原始配置；自建或复制的角色保留已保存的名称，恢复通用配置。
  return preset
    ? { ...preset, revision: robot.revision }
    : { ...createRobot(robot.id), name: robot.name, revision: robot.revision };
}

export function isRobotModified(saved: Robot, draft?: Robot): boolean {
  if (!draft) return false;
  const fields = [
    "name",
    "description",
    "icon",
    "prompt",
    "temperature",
    "memoryEnabled",
    "courseMemory",
  ] as const;
  return (
    fields.some((key) => saved[key] !== draft[key]) ||
    JSON.stringify(saved.aiDefaults) !== JSON.stringify(draft.aiDefaults) ||
    saved.skills.length !== draft.skills.length ||
    saved.skills.some((skill) => !draft.skills.includes(skill)) ||
    (saved.specialty ?? "") !== (draft.specialty ?? "")
  );
}

/** 仅升级未经用户修改的旧预置，保留自定义配置、空列表及历史消息。 */
export function upgradeRobotCatalog(data: AppData): AppData {
  if (data.robotCatalogVersion === 1) return upgradeTeacherPrompts(data);
  const presets = createInitialData().robots;
  const unchanged = new Set(
    data.robots
      .filter((robot) => {
        const source = legacyRobots.find((item) => item.id === robot.id);
        const old = source ? upgradeRobot(source) : undefined;
        // 与旧版初始配置逐字段比较，用户改过的配置不会被预置升级覆盖。
        return (
          old &&
          Object.entries(old).every(([key, value]) => {
            const actual = robot[key as keyof Robot];
            return Array.isArray(value)
              ? Array.isArray(actual) &&
                  value.length === actual.length &&
                  value.every((entry) => actual.some((item) => item === entry))
              : typeof value === "object" && value !== null
                ? JSON.stringify(actual) === JSON.stringify(value)
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
  return upgradeTeacherPrompts({
    ...data,
    robotCatalogVersion: 1,
    robots,
    defaultRobotId,
    conversations: retireHero
      ? data.conversations.map((session) =>
          session.robotId === "hero"
            ? {
                ...session,
                // 旧预置身份保留；目录升级不能切换已建立对话的机器人。
                robotId: session.robotId,
              }
            : session,
        )
      : data.conversations,
  });
}

/** 仅替换仍与旧预置完全相同的指令，不覆盖用户编写的要求或其他配置。 */
function upgradeTeacherPrompts(data: AppData): AppData {
  const presets = createInitialData().robots;
  let changed = false;
  const robots = data.robots.map((robot) => {
    const previous = (legacyTeacherPrompts as Record<string, string>)[robot.id];
    const preset = presets.find((item) => item.id === robot.id);
    if (!previous || !preset || robot.prompt !== previous) return robot;
    changed = true;
    return { ...robot, prompt: preset.prompt, revision: robot.revision + 1 };
  });
  return changed ? { ...data, robots } : data;
}
