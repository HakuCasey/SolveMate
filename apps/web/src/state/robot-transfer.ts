import {
  maxRobots,
  assertMetadata,
  type AppData,
  type Robot,
} from "@solvemate/contracts";

import { robotLimitMessage } from "./robots";

export const maxRobotImportBytes = 1024 * 1024;
const format = "solvemate.robot";
interface RobotConfigurationFile {
  format: typeof format;
  version: 1;
  robot: Robot;
}

/** 配置字段复用 Robot 校验；导出不包含连接路径、凭据或会话。 */
export function robotConfigurationBlob(robot: Robot) {
  assertMetadata("Robot", robot);
  const file: RobotConfigurationFile = {
    format,
    version: 1,
    robot: structuredClone(robot),
  };
  return new Blob([`${JSON.stringify(file, null, 2)}\n`], {
    type: "application/json",
  });
}
export function parseRobotConfiguration(text: string): Robot {
  if (new TextEncoder().encode(text).length > maxRobotImportBytes)
    throw new Error("配置文件不能超过 1 MB。");
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("文件不是有效的 JSON，请重新选择导出的配置文件。");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("请选择通过“导出配置”生成的 JSON 文件。");
  const file = value as Record<string, unknown>;
  if (file.format !== format)
    throw new Error("请选择通过“导出配置”生成的 JSON 文件。");
  if (file.version !== 1)
    throw new Error("此配置文件的版本暂不支持，请更新应用后重试。");
  try {
    if (
      Object.keys(file).some(
        (key) => !["format", "version", "robot"].includes(key),
      )
    )
      throw new Error("Unexpected configuration field.");
    assertMetadata("Robot", file.robot);
    const robot = file.robot as Robot;
    if (!robot.name.trim() || !robot.prompt.trim())
      throw new Error("Required configuration is empty.");
  } catch {
    throw new Error("配置不完整或字段无效，原有配置未更改。");
  }
  return structuredClone(file.robot as Robot);
}

/** 在当前完整记录上分配新身份、处理重名，已有机器人及对话保持不变。 */
export function addImportedRobot(
  data: AppData,
  imported: Robot,
  id: string = crypto.randomUUID(),
) {
  if (data.robots.length >= maxRobots) throw new Error(robotLimitMessage);
  assertMetadata("Robot", imported);
  let name = imported.name.trim();
  let number = 1;
  while (data.robots.some((robot) => robot.name.trim() === name)) {
    const suffix = number === 1 ? "（导入）" : `（导入 ${number}）`;
    name =
      Array.from(imported.name.trim())
        .slice(0, 24 - Array.from(suffix).length)
        .join("") + suffix;
    number++;
  }
  const robot = { ...structuredClone(imported), id, name, revision: 1 };
  return {
    robot,
    data: {
      ...data,
      robots: [...data.robots, robot],
      defaultRobotId: data.defaultRobotId ?? robot.id,
    },
  };
}
