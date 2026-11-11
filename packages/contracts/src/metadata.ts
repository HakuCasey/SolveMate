import Ajv2020 from "ajv/dist/2020";
import schema from "../ai-metadata.schema.json";
import legacySchema from "../legacy/ai-metadata-v2.schema.json";

const validator = new Ajv2020({ allErrors: true });
validator.addSchema(schema);
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
