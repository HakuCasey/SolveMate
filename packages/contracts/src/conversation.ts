import type { ConversationMetadata } from "./ai-metadata.generated";
import { assertMetadata, aiMetadataSchema } from "./metadata";

/** 请求只携带会话元数据，不把消息正文、缓存或组件状态混进配置。 */
export function conversationMetadata(
  value: ConversationMetadata,
): ConversationMetadata {
  const fields = aiMetadataSchema.$defs.ConversationMetadata.properties;
  const metadata = Object.fromEntries(
    Object.keys(fields).map((key) => [
      key,
      value[key as keyof ConversationMetadata],
    ]),
  );
  assertMetadata("ConversationMetadata", metadata);
  return metadata as unknown as ConversationMetadata;
}
