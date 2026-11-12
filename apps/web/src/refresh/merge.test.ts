import type { AiTurn } from "@solvemate/contracts";
import { describe, expect, it } from "vitest";
import { createInitialData } from "../data/catalog";
import {
  dataEqual,
  mergeData,
  pendingConflicts,
  resolveDataConflict,
} from "./merge";
const copies = () => {
  const base = createInitialData();
  return { base, local: structuredClone(base), remote: structuredClone(base) };
};
describe("three-way record refresh", () => {
  it("keeps independent edits, newly created records and this window's reading selection", () => {
    const { base, local, remote } = copies();
    local.settings.fontSize = 21;
    remote.settings.appearance = "dark";
    local.robots[0].name = "本页名称";
    local.robots[0].revision++;
    remote.robots[0].prompt = "另一处指令";
    remote.robots[0].revision++;
    local.robots.push({ ...base.robots[0], id: "local" });
    remote.robots.push({ ...base.robots[0], id: "remote" });
    local.selection.itemId = "M002";
    remote.selection.itemId = "M003";
    const { data, conflicts } = mergeData(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(data.settings).toMatchObject({ fontSize: 21, appearance: "dark" });
    expect(data.robots[0]).toMatchObject({
      name: "本页名称",
      prompt: "另一处指令",
      revision: 3,
    });
    expect(data.robots.map((x) => x.id)).toContain("local");
    expect(data.robots.map((x) => x.id)).toContain("remote");
    expect(data.selection.itemId).toBe("M002");
    expect(base.robots[0].name).not.toBe("本页名称");
  });
  it("keeps same-field changes for explicit choice and updates the comparison on later refreshes", () => {
    const { base, local, remote } = copies();
    local.robots[0].name = "本地";
    remote.robots[0].name = "远端";
    const first = mergeData(base, local, remote);
    expect(first.conflicts).toHaveLength(1);
    const newer = structuredClone(remote);
    newer.robots[0].name = "远端第二次";
    const second = mergeData(remote, first.data, newer);
    const conflicts = pendingConflicts(
      first.conflicts,
      second.conflicts,
      second.data,
      newer,
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ local: "本地", remote: "远端第二次" });
    expect(
      resolveDataConflict(second.data, conflicts[0], "remote").robots[0].name,
    ).toBe("远端第二次");
  });
  it("does not silently confirm an unresolved conflict on an unchanged refresh", () => {
    const { base, local, remote } = copies();
    local.settings.fontSize = 21;
    remote.settings.fontSize = 18;
    const first = mergeData(base, local, remote),
      second = mergeData(remote, first.data, remote);
    expect(
      pendingConflicts(first.conflicts, second.conflicts, second.data, remote),
    ).toHaveLength(1);
  });
  it("preserves an edited deleted record as a conflict without resurrecting it after removal", () => {
    const { base, local, remote } = copies();
    local.robots[0].prompt = "未保存指令";
    const id = local.robots[0].id;
    remote.robots.shift();
    const { data, conflicts } = mergeData(base, local, remote);
    expect(conflicts[0].deleted).toBe(true);
    expect(data.robots.find((x) => x.id === id)?.prompt).toBe("未保存指令");
    expect(
      resolveDataConflict(data, conflicts[0], "remote").robots.some(
        (x) => x.id === id,
      ),
    ).toBe(false);
  });
  it("keeps one complete AI configuration instead of mixing providers and model fields", () => {
    const { base, local, remote } = copies();
    base.robots[0].aiDefaults = {
      connectionId: "one",
      modelId: "base",
    };
    local.robots[0].aiDefaults = {
      ...base.robots[0].aiDefaults,
      connectionId: "two",
    };
    remote.robots[0].aiDefaults = {
      ...base.robots[0].aiDefaults,
      modelId: "new-model",
    };
    const result = mergeData(base, local, remote);
    expect(result.conflicts).toHaveLength(1);
    expect(result.data.robots[0].aiDefaults).toEqual(
      local.robots[0].aiDefaults,
    );
  });
  it("keeps remote deletion of a conversation despite a late local assistant reply", () => {
    const { base, local, remote } = copies();
    local.conversations[0].messages.push({
      id: "late",
      role: "assistant",
      content: "迟到的回复",
    });
    remote.conversations[0].status = "deleted";
    const result = mergeData(base, local, remote);
    expect(result.data.conversations[0]).toEqual(remote.conversations[0]);
    expect(result.conflicts).toEqual([]);
  });
  it("uses the highest AI result revision and its matching assistant text", () => {
    const { base, local, remote } = copies();
    const turn = {
      id: "turn",
      conversationId: base.conversations[0].id,
      revision: 1,
      status: "running",
      userMessageId: "user",
      assistantMessageId: "assistant",
      startedAt: 1,
    } as AiTurn;
    for (const data of [base, local, remote]) {
      data.conversations[0].turns = [structuredClone(turn)];
      data.conversations[0].messages = [
        {
          id: "assistant",
          role: "assistant",
          content: "旧片段",
          turnId: "turn",
        },
      ];
    }
    local.conversations[0].turns[0] = {
      ...turn,
      revision: 3,
      status: "completed",
    };
    local.conversations[0].messages[0].content = "完整回复";
    remote.conversations[0].turns[0] = { ...turn, revision: 2 };
    remote.conversations[0].messages[0].content = "中间片段";
    const result = mergeData(base, local, remote);
    expect(result.data.conversations[0].messages[0].content).toBe("完整回复");
    expect(result.data.conversations[0].turns[0].revision).toBe(3);
    expect(result.conflicts).toEqual([]);
  });
});

it("compares JSON values independently of object key order", () => {
  expect(
    dataEqual(
      { b: { second: 2, first: 1 }, a: 1 },
      { a: 1, b: { first: 1, second: 2 } },
    ),
  ).toBe(true);
  expect(dataEqual({ a: 1, missing: undefined }, { a: 1 })).toBe(true);
  expect(dataEqual([1, 2], [2, 1])).toBe(false);
});
