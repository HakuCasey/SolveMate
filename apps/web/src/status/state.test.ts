import { describe, expect, it } from "vitest";
import type { AiTurn } from "@solvemate/contracts";
import { createStudyFixture } from "../data/__fixtures__/study";
import { conversationTasks } from "./state";
describe("status bar derives current business state", () => {
  it("includes all running conversations and their permission requests", () => {
    const data = createStudyFixture();
    for (const [index, conversation] of data.conversations.entries())
      conversation.turns = [
        {
          id: `turn-${index}`,
          revision: 1,
          status: "running",
          startedAt: index,
          connectionId: "test",
          userMessageId: "user",
          snapshot: null,
          dispatch: null,
          reportedModelId: null,
          submissionStatus: "accepted",
        },
      ];
    const turn = {
      ...data.conversations[1].turns[0],
      permissions: [{ id: "permission", title: "测试确认", options: [] }],
      revision: 2,
    } as unknown as AiTurn;
    const tasks = conversationTasks(
      data.conversations,
      { [turn.id]: turn },
      data.conversations[0].id,
    );
    expect(tasks).toHaveLength(4);
    expect(tasks[0].label).toBe("等待确认");
    expect(tasks[0].conversation.id).toBe(data.conversations[1].id);
    data.conversations[1].turns[0].revision = 3;
    expect(
      conversationTasks(data.conversations, { [turn.id]: turn }, null).find(
        (item) => item.id === turn.id,
      ),
    ).toMatchObject({ label: "正在回复…", error: "", attention: false });
    expect(
      conversationTasks(data.conversations, {}, null, {
        "turn-0": "重连失败",
      }).find((x) => x.id === "turn-0"),
    ).toMatchObject({ label: "正在回复…", error: "重连失败", attention: true });
  });
  it("does not show old failures from unrelated history or revive deleted sessions", () => {
    const data = createStudyFixture();
    data.conversations[0].turns = [
      {
        id: "failed",
        revision: 1,
        status: "failed",
        startedAt: 1,
        connectionId: "test",
        userMessageId: "user",
        snapshot: null,
        dispatch: null,
        reportedModelId: null,
        submissionStatus: "accepted",
        error: "服务失败",
      },
    ];
    expect(conversationTasks(data.conversations, {}, null)).toEqual([]);
    expect(
      conversationTasks(data.conversations, {}, data.conversations[0].id)[0]
        .label,
    ).toBe("回复失败");
    data.conversations[0].status = "deleted";
    expect(
      conversationTasks(data.conversations, {}, data.conversations[0].id),
    ).toEqual([]);
  });
});
