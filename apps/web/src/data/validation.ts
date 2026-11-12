import {
  aiMetadataSchema,
  assertMetadata,
  conversationMetadata,
  type AppData,
} from "@solvemate/contracts";
import { isSelection, isMessage } from "./legacy-validation";
import { assertNoteLibrary } from "../state/notes";

/** 新格式只校验一套共享对象；旧字段由迁移入口处理，不参与运行时解析。 */
export function assertAppData(value: unknown): asserts value is AppData {
  if (
    !value ||
    typeof value !== "object" ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 3
  )
    throw new Error("Local data has an unsupported schema version.");
  const data = value as AppData;
  if (data.noteLibrary !== undefined) assertNoteLibrary(data.noteLibrary);
  if (data.subjects !== undefined) {
    if (
      !Array.isArray(data.subjects) ||
      data.subjects.some(
        (item) =>
          !item ||
          typeof item.id !== "string" ||
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id) ||
          typeof item.title !== "string" ||
          !item.title.trim() ||
          [...item.title].length > 40 ||
          typeof item.deleted !== "boolean" ||
          (item.materialsDeleted !== undefined &&
            typeof item.materialsDeleted !== "boolean") ||
          (item.materialsDeleted === true && !item.deleted),
      ) ||
      new Set(data.subjects.map((item) => item.id)).size !==
        data.subjects.length
    )
      throw new Error("Local subject metadata is invalid.");
  }
  if (
    !Array.isArray(data.robots) ||
    !Array.isArray(data.conversations) ||
    !isSelection(data.selection)
  )
    throw new Error("Local data is incomplete.");
  if (data.materialSelection)
    assertMetadata("MaterialLocation", data.materialSelection);
  for (const robot of data.robots) assertMetadata("Robot", robot);
  for (const conversation of data.conversations) {
    conversationMetadata(conversation);
    const allowed = new Set([
      ...Object.keys(aiMetadataSchema.$defs.ConversationMetadata.properties),
      "binding",
      "turns",
      "messages",
      "example",
    ]);
    if (Object.keys(conversation).some((key) => !allowed.has(key)))
      throw new Error("Conversation contains unsupported metadata fields.");
    if (
      !Array.isArray(conversation.messages) ||
      !conversation.messages.every(isMessage) ||
      !Array.isArray(conversation.turns)
    )
      throw new Error("Conversation records are invalid.");
    for (const turn of conversation.turns) assertMetadata("SessionTurn", turn);
    if (conversation.binding) {
      assertMetadata("SessionBinding", conversation.binding);
      if (
        conversation.binding.conversationId !== conversation.id ||
        conversation.binding.connectionId !== conversation.aiConfig.connectionId
      )
        throw new Error("Conversation binding does not match its metadata.");
    }
  }
  const robotIds = data.robots.map((item) => item.id),
    ids = data.conversations.map((item) => item.id);
  const settings = data.settings;
  if (
    new Set(robotIds).size !== robotIds.length ||
    new Set(ids).size !== ids.length ||
    (data.defaultRobotId !== null && !robotIds.includes(data.defaultRobotId)) ||
    !settings ||
    !Number.isInteger(settings.fontSize) ||
    settings.fontSize < 12 ||
    settings.fontSize > 21 ||
    !["light", "dark"].includes(settings.appearance) ||
    typeof settings.globalModel !== "string" ||
    (settings.readingPaneRatio !== undefined &&
      (!Number.isFinite(settings.readingPaneRatio) ||
        settings.readingPaneRatio <= 0 ||
        settings.readingPaneRatio >= 1))
  )
    throw new Error("Local data has invalid settings or duplicate IDs.");
}
