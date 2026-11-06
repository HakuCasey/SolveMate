import { describe, expect, it } from "vitest";
import { createInitialData } from "../data/catalog";
import { AiNotConnectedError, unavailableAiConnection } from "./index";

describe("unconnected AI service", () => {
  it("reports no connection and produces no placeholder answer", async () => {
    const data = createInitialData();
    expect(unavailableAiConnection.available).toBe(false);
    const replies = unavailableAiConnection.send({
      selection: data.selection,
      robot: data.robots[0]!,
      messages: [],
    });
    await expect(replies[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(
      AiNotConnectedError,
    );
  });
});
