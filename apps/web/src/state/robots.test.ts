import { addImportedRobot } from "./robot-transfer";
import { describe, expect, it } from "vitest";
import { maxRobots, type AppData } from "@solvemate/contracts";
import { createInitialData } from "../data/catalog";
import { assertAppData } from "../data/validation";
import { upgradeRobot } from "../data/migrate-ai-metadata";
import legacyRobots from "../data/legacy-robots.json";
import legacyTeacherPrompts from "../data/legacy-teacher-prompts.json";
import { createConversation, replaceRobots } from "./conversations";
import {
  createRobot,
  robotNameError,
  newRobotName,
  isRobotModified,
  restoreRobotDefaults,
  upgradeRobotCatalog,
} from "./robots";

function legacyData(): AppData {
  const initial = createInitialData();
  const data = {
    ...initial,
    robotCatalogVersion: undefined,
    robots: structuredClone(legacyRobots).map(upgradeRobot),
    conversations: initial.conversations.map((session) => ({
      ...session,
      robotId: session.selection?.courseId === "calculus" ? "scholar" : "hero",
    })),
  };
  assertAppData(data);
  return data;
}

describe("robot configuration drafts", () => {
  it("publishes three subject-oriented teachers and permits custom specialties", () => {
    expect(createInitialData().robots.map((robot) => robot.name)).toEqual([
      "全科教师",
      "高数教师",
      "C 语言教师",
    ]);
    expect(createRobot().prompt).toBe(createInitialData().robots[0].prompt);
    const english = {
      ...createRobot(),
      name: "我的英语教师",
      specialty: "英语",
    };
    const data = createInitialData();
    data.robots.push(english);
    assertAppData(data);
    // 专业范围不影响创建数学会话时选用英语教师。
    data.defaultRobotId = english.id;
    expect(createConversation(data, data.selection).robotId).toBe(english.id);
    expect(
      isRobotModified(english, { ...english, specialty: "英语与数学" }),
    ).toBe(true);
  });

  it("upgrades untouched legacy presets once without changing history", () => {
    const old = legacyData();
    const next = upgradeRobotCatalog(old);
    expect(next.robots.map((robot) => robot.name)).toEqual([
      "全科教师",
      "高数教师",
      "C 语言教师",
    ]);
    expect(next.conversations[2].robotId).toBe(old.conversations[2].robotId);
    expect(next.conversations[2].messages).toBe(old.conversations[2].messages);
    expect(old.robots[0].name).toBe("金牌教师");
    expect(upgradeRobotCatalog(next)).toBe(next);
  });

  it("preserves modified presets, custom teachers and an intentionally empty list", () => {
    const old = legacyData();
    old.robots[0].name = "我的教师";
    old.robots[1].prompt = "用户自己的指令";
    const next = upgradeRobotCatalog(old);
    expect(next.robots).toEqual(old.robots);
    expect(next.conversations).toBe(old.conversations);
    const partlyModified = legacyData();
    partlyModified.robots[0].prompt = "自定义的教师要求";
    expect(upgradeRobotCatalog(partlyModified).robots[0]).toBe(
      partlyModified.robots[0],
    );
    const empty = { ...old, robots: [], defaultRobotId: null };
    expect(upgradeRobotCatalog(empty).robots).toEqual([]);
    const removed = legacyData();
    removed.robots = removed.robots.filter((robot) => robot.id === "hero");
    removed.defaultRobotId = "hero";
    expect(
      upgradeRobotCatalog(removed).robots.some(
        (robot) => robot.id === "scholar",
      ),
    ).toBe(false);
  });

  it("updates unchanged preset instructions while keeping settings and historical records", () => {
    const data = createInitialData();
    data.robots = data.robots.map((robot) => ({
      ...robot,
      prompt: (legacyTeacherPrompts as Record<string, string>)[robot.id],
      revision: 4,
    }));
    data.robots[0].name = "我的教师";
    data.robots[0].aiDefaults = {
      connectionId: "hermes-local",
      modelId: "custom:school:model",
    };
    const upgraded = upgradeRobotCatalog(data);
    const presets = createInitialData().robots;
    upgraded.robots.forEach((robot, index) => {
      expect(robot).toEqual({
        ...data.robots[index],
        prompt: presets[index].prompt,
        revision: 5,
      });
    });
    expect(upgraded.conversations).toBe(data.conversations);
    expect(upgraded.defaultRobotId).toBe(data.defaultRobotId);
    expect(data.robots[0].prompt).toBe(legacyTeacherPrompts.scholar);
    expect(upgradeRobotCatalog(upgraded)).toBe(upgraded);
    assertAppData(upgraded);
  });

  it("keeps custom instructions and removed presets when updating default instructions", () => {
    const data = createInitialData();
    data.robots = data.robots
      .filter((robot) => robot.id !== "c-language-teacher")
      .map((robot) => ({
        ...robot,
        prompt: (legacyTeacherPrompts as Record<string, string>)[robot.id],
      }));
    data.robots[0].prompt += "\n\n用户补充的讲解要求。";
    const custom = {
      ...createRobot("custom-teacher"),
      prompt: legacyTeacherPrompts.scholar,
    };
    data.robots.push(custom);
    const upgraded = upgradeRobotCatalog(data);
    expect(upgraded.robots.map((robot) => robot.id)).toEqual(
      data.robots.map((robot) => robot.id),
    );
    expect(upgraded.robots[0]).toBe(data.robots[0]);
    expect(upgraded.robots.at(-1)).toBe(custom);
    expect(upgraded.robots[1].prompt).toBe(
      createInitialData().robots[1].prompt,
    );
    const empty = { ...data, robots: [], defaultRobotId: null };
    expect(upgradeRobotCatalog(empty)).toBe(empty);
    assertAppData(upgraded);
  });
  it("clears the dirty state when fields return to saved values", () => {
    const robot = createRobot();
    expect(isRobotModified(robot)).toBe(false);
    expect(isRobotModified(robot, { ...robot, prompt: "修改的角色指令" })).toBe(
      true,
    );
    expect(isRobotModified(robot, { ...robot })).toBe(false);
    expect(
      isRobotModified(robot, { ...robot, skills: [...robot.skills].reverse() }),
    ).toBe(false);
    expect(isRobotModified(robot, { ...robot, skills: [] })).toBe(true);
  });

  it("restores each preset without modifying its saved configuration or another robot", () => {
    const data = createInitialData();
    for (const preset of data.robots) {
      const saved = {
        ...preset,
        name: "已改名",
        prompt: "用户保存的指令",
        temperature: 1.4,
      };
      const defaults = restoreRobotDefaults(saved);
      expect(defaults).toEqual(preset);
      expect(saved.prompt).toBe("用户保存的指令");
      defaults.skills.length = 0;
      expect(restoreRobotDefaults(saved).skills).toEqual(preset.skills);
    }
  });

  it("keeps custom robot identity and saved name when loading generic defaults", () => {
    const saved = {
      ...createRobot(),
      name: "我的机器人",
      modelSource: "custom" as const,
      modelName: "provider/model",
      temperature: 1.2,
    };
    const defaults = restoreRobotDefaults(saved);
    expect(defaults).toEqual({ ...createRobot(saved.id), name: saved.name });
    expect(saved.modelName).toBe("provider/model");
  });
});

describe("robot name uniqueness", () => {
  it("allows the original name, but rejects another robot name including surrounding spaces", () => {
    const data = createInitialData(),
      robot = data.robots[0];
    expect(robotNameError(data.robots, robot)).toBe("");
    expect(
      robotNameError(data.robots, {
        ...robot,
        name: ` ${data.robots[1].name} `,
      }),
    ).toBe("命名重复，请重新命名。");
    expect(robotNameError(data.robots, { ...robot, name: " " })).toBe(
      "请填写机器人名称。",
    );
  });
  it("creates distinct names for repeated new robot actions", () => {
    const data = createInitialData();
    data.robots.push({
      ...createRobot("new-1"),
      name: newRobotName(data.robots),
    });
    expect(newRobotName(data.robots)).toBe("新机器人（2）");
    data.robots.push({
      ...createRobot("new-2"),
      name: newRobotName(data.robots),
    });
    expect(newRobotName(data.robots)).toBe("新机器人（3）");
  });
  it("rejects duplicate names through the shared save operation", () => {
    const data = createInitialData(),
      robot = data.robots[0];
    const robots = data.robots.map((item) =>
      item.id === robot.id ? { ...item, name: data.robots[1].name } : item,
    );
    expect(() => replaceRobots(data, robots, data.defaultRobotId)).toThrow(
      "命名重复，请重新命名。",
    );
    expect(data.robots[0].name).toBe(robot.name);
  });
});

it("enforces the same nine-robot limit for creation, copying and import", () => {
  const data = createInitialData();
  data.robots = Array.from({ length: maxRobots }, (_, i) => ({
    ...createRobot(`robot-${i}`),
    name: `机器人${i}`,
  }));
  data.defaultRobotId = data.robots[0].id;
  const extra = { ...createRobot("extra"), name: "额外机器人" };
  expect(() =>
    replaceRobots(data, [...data.robots, extra], data.defaultRobotId),
  ).toThrow("最多支持 9 个机器人。");
  expect(() => addImportedRobot(data, extra)).toThrow("最多支持 9 个机器人。");
  const changed = data.robots.map((robot, i) =>
    i ? robot : { ...robot, name: "新名称" },
  );
  expect(replaceRobots(data, changed, data.defaultRobotId).robots).toHaveLength(
    maxRobots,
  );
});
