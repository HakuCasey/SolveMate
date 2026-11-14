import { describe, expect, it } from "vitest";
import { assertMetadata } from "@solvemate/contracts";
import { createInitialData } from "../data/catalog";
import {
  addImportedRobot,
  parseRobotConfiguration,
  robotConfigurationBlob,
} from "./robot-transfer";

describe("portable robot configuration", () => {
  it("round trips all saved robot settings without external credentials or sessions", async () => {
    const robot = createInitialData().robots[0];
    robot.aiDefaults = {
      connectionId: "deepseek-local",
      modelId: "model",
      reasoningEffort: "high",
    };
    const text = await robotConfigurationBlob(robot).text();
    expect(parseRobotConfiguration(text)).toEqual(robot);
    expect(text).not.toContain("executablePath");
    expect(text).not.toContain("messages");
    expect(text).not.toContain("apiKey");
  });
  it("creates a new identity, keeps defaults and history, and resolves repeated names", async () => {
    const data = createInitialData(),
      original = structuredClone(data);
    const robot = parseRobotConfiguration(
      await robotConfigurationBlob(data.robots[0]).text(),
    );
    const first = addImportedRobot(data, robot, "import-1");
    const second = addImportedRobot(first.data, robot, "import-2");
    expect(first.robot.name).toBe(`${robot.name}（导入）`);
    expect(second.robot.name).toBe(`${robot.name}（导入 2）`);
    expect(second.data.defaultRobotId).toBe(data.defaultRobotId);
    expect(second.data.conversations).toBe(data.conversations);
    expect(data).toEqual(original);
    expect(first.robot.id).not.toBe(robot.id);
    expect(first.robot.revision).toBe(1);
    assertMetadata("Robot", first.robot);
  });
  it("rejects malformed, oversized, foreign, unsupported and incomplete files", () => {
    const robot = createInitialData().robots[0];
    const json = (override: object) =>
      JSON.stringify({
        format: "solvemate.robot",
        version: 1,
        robot,
        ...override,
      });
    expect(() => parseRobotConfiguration("{")).toThrow("JSON");
    expect(() => parseRobotConfiguration("x".repeat(1024 * 1024 + 1))).toThrow(
      "1 MB",
    );
    expect(() => parseRobotConfiguration(json({ format: "other" }))).toThrow(
      "导出配置",
    );
    expect(() => parseRobotConfiguration(json({ version: 2 }))).toThrow("版本");
    expect(() =>
      parseRobotConfiguration(
        json({ robot: { ...robot, apiKey: "must-not-import" } }),
      ),
    ).toThrow("字段无效");
    expect(() =>
      parseRobotConfiguration(json({ robot: { ...robot, prompt: " " } })),
    ).toThrow("字段无效");
  });
  it("retains unavailable AI references without connecting or remapping to another service", async () => {
    const data = createInitialData(),
      robot = {
        ...data.robots[0],
        aiDefaults: {
          connectionId: "hermes-local",
          modelId: "private-model",
          reasoningEffort: "high",
        },
      };
    const imported = addImportedRobot(
      data,
      parseRobotConfiguration(await robotConfigurationBlob(robot).text()),
    );
    expect(imported.robot.aiDefaults).toEqual(robot.aiDefaults);
  });
});
