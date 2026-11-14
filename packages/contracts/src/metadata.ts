import Ajv2020 from "ajv/dist/2020";
import schema from "../ai-metadata.schema.json";
import legacySchema from "../legacy/ai-metadata-v2.schema.json";
import appSchema from "../app-data.schema.json";

export const maxNoteTitleLength =
  appSchema.$defs.Note.properties.title.maxLength;

/** 按 Unicode 字符截断，避免切断一个字符。 */
export function truncateNoteTitle(value: string): string {
  return Array.from(value).slice(0, maxNoteTitleLength).join("");
}

const validator = new Ajv2020({ allErrors: true });
validator.addSchema(schema);
const checkApp = validator.compile(appSchema);
export function assertUserData(value: unknown): void {
  if (!checkApp(value)) {
    const error = checkApp.errors?.[0];
    throw new Error(
      `Invalid app data: ${error?.instancePath || "/"} ${error?.keyword || "validation"}`,
    );
  }
  const fields = Object.keys(schema.$defs.ConversationMetadata.properties);
  const allowed = new Set([
    ...fields,
    "binding",
    "bindings",
    "turns",
    "messages",
    "example",
  ]);
  // 应用附加记录不复制 AI 会话字段，避免两份 Schema 在扩展时发生差异。
  for (const conversation of (
    value as { conversations: Record<string, unknown>[] }
  ).conversations) {
    if (Object.keys(conversation).some((key) => !allowed.has(key)))
      throw new Error("Conversation contains unsupported metadata fields.");
    const legacy = conversation.binding as Record<string, unknown> | null;
    const current = conversation.bindings as
      Record<string, unknown>[] | undefined;
    if (current && legacy)
      throw new Error("Conversation contains two sources of session bindings.");
    const bindings = current ?? (legacy ? [legacy] : []);
    if (
      new Set(bindings.map((item) => item.connectionId)).size !==
        bindings.length ||
      bindings.some((binding) => binding.conversationId !== conversation.id)
    )
      throw new Error("Conversation session bindings are inconsistent.");
    if (
      !current &&
      legacy &&
      legacy.connectionId !==
        (conversation.aiConfig as Record<string, unknown>).connectionId
    )
      throw new Error("Conversation binding does not match its metadata.");
    assertMetadata(
      "ConversationMetadata",
      Object.fromEntries(
        fields
          .filter((key) => key in conversation)
          .map((key) => [key, conversation[key]]),
      ),
    );
  }
}
/** 笔记结构与本机服务共用应用 Schema，不在页面维护第二套字段检查。 */
export function assertNoteMetadata(value: unknown): void {
  const check = validator.getSchema(`${appSchema.$id}#/$defs/Note`)!;
  if (!check(value)) throw new Error("Invalid note metadata.");
  const note = value as { createdAt: number | null; updatedAt: number | null };
  if (
    note.createdAt !== null &&
    note.updatedAt !== null &&
    note.updatedAt < note.createdAt
  )
    throw new Error("Note update time precedes creation time.");
}

export type MetadataName = keyof typeof schema.$defs;

/** 同一份 Schema 用于网页边界、保存校验和本机服务，错误不包含材料正文。 */
export function assertMetadata(name: MetadataName, value: unknown): void {
  const check = validator.getSchema(`${schema.$id}#/$defs/${name}`);
  if (!check) throw new Error(`Unknown metadata schema: ${name}`);
  if (!check(value)) {
    const error = check.errors?.[0];
    throw new Error(
      `Invalid ${name} metadata: ${error?.instancePath || "/"} ${error?.keyword || "validation"}`,
    );
  }
}
export { schema as aiMetadataSchema };

const legacyValidator = new Ajv2020();
legacyValidator.addSchema(legacySchema);
export function assertLegacyMetadataV2(
  name: keyof typeof legacySchema.$defs,
  value: unknown,
) {
  const check = legacyValidator.getSchema(
    `${legacySchema.$id}#/$defs/${name}`,
  )!;
  if (!check(value)) throw new Error(`Invalid legacy ${name} metadata.`);
}
