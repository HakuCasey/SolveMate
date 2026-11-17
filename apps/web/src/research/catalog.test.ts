import { expect, it } from "vitest";
import { createInitialData } from "../data/catalog";
import { toolFixture } from "./tools.test-support";
import { parseTools, decodeTool } from "./catalog";
import { installTool, researchWorkspace } from "./state";

it("checks downloaded identity and checksum before replacing an installed tool", async () => {
  const tool = { ...toolFixture(), source: "official" as const };
  const bytes = new TextEncoder().encode(JSON.stringify(tool));
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const entry = {
    id: tool.id,
    title: tool.title,
    description: tool.description,
    latest_version: hash,
    updatedAt: 1,
  };
  const downloaded = await decodeTool(bytes, entry);
  const data = installTool(createInitialData(), downloaded);
  await expect(decodeTool(new Uint8Array([1, 2, 3]), entry)).rejects.toThrow(
    "校验失败",
  );
  expect(researchWorkspace(data).tools).toEqual([downloaded]);
  await expect(decodeTool(bytes, { ...entry, id: "other" })).rejects.toThrow(
    "目录不一致",
  );
  expect(() => parseTools({ tools: [entry, entry] })).toThrow("重复编号");
});
