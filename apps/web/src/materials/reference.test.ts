import { describe, expect, it } from "vitest";
import { assertMetadata, type Material } from "@solvemate/contracts";
import { makeMaterialReference } from "./reference";
import {
  conversationForMaterial,
  createConversation,
} from "../state/conversations";
import { createInitialData } from "../data/catalog";
import { assertAppData } from "../data/validation";
const location = {
  materialId: "e91fbe39-75b8-48a8-9847-9845a04f95be",
  contentVersion: "a".repeat(64),
  pageNumber: 11,
};
const material = {
  id: location.materialId,
  currentVersion: location.contentVersion,
  title: "C 语言课本",
} as Material;

describe("personal material references", () => {
  it("pins selected code and page while later reading moves elsewhere", () => {
    const code = 'int main() {\n  printf("hello");\n}';
    const reference = makeMaterialReference(
      material,
      location,
      code,
      "selection",
    );
    assertMetadata("ReadingReference", reference);
    location.pageNumber = 12;
    expect(reference.material?.pageNumber).toBe(11);
    expect(reference.content).toBe(code);
    expect(reference.title).toContain("第 11 页");
    location.pageNumber = 11;
    expect(() =>
      makeMaterialReference(material, location, " ", "page"),
    ).toThrow("没有可提取");
    expect(() =>
      makeMaterialReference(
        material,
        location,
        "a".repeat(100001),
        "selection",
      ),
    ).toThrow("过长");
  });
  it("continues the same conversation across pages and persists alongside existing data", () => {
    const data = createInitialData();
    const original = createConversation(
      data,
      null,
      data.defaultRobotId,
      null,
      "new",
      null,
      location,
    );
    data.conversations.unshift(original);
    data.materialSelection = { ...location };
    original.messages.push({
      id: "question",
      role: "user",
      content: "为什么？",
      reference: makeMaterialReference(
        material,
        location,
        "return 0;",
        "selection",
      ),
    });
    assertAppData(data);
    expect(
      conversationForMaterial(data.conversations, {
        ...location,
        pageNumber: 12,
      })?.id,
    ).toBe(original.id);
    expect(
      conversationForMaterial(data.conversations, {
        ...location,
        contentVersion: "b".repeat(64),
      }),
    ).toBeUndefined();
    original.status = "archived";
    expect(
      conversationForMaterial(data.conversations, location),
    ).toBeUndefined();
  });
  it("requires a material location when an official selection is absent", () => {
    expect(() =>
      assertMetadata("ReadingReference", {
        title: "unknown",
        content: "text",
        selection: null,
      }),
    ).toThrow();
    expect(() =>
      assertMetadata("MaterialLocation", { ...location, pageNumber: 0 }),
    ).toThrow();
  });
});
