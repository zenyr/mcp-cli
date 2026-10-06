import { isRecord, type JsonSchema } from "@mcp-cli/core";

export const fieldName = (schema: JsonSchema, key: string): string => {
  const properties = schema.properties;
  return isRecord(properties) && Object.hasOwn(properties, key) ? key : key.replaceAll("-", "_");
};

export const property = (schema: JsonSchema, key: string): JsonSchema => {
  const properties = schema.properties;
  const name = fieldName(schema, key);
  if (!isRecord(properties) || !Object.hasOwn(properties, name)) return {};
  const field = properties[name];
  return isRecord(field) ? field : {};
};

const declaredTypes = (schema: JsonSchema): string[] => {
  const { type } = schema;
  if (typeof type === "string") return [type];
  if (Array.isArray(type)) return type.filter((item) => typeof item === "string");
  const members = [schema.anyOf, schema.oneOf].flatMap((list) => (Array.isArray(list) ? list : []));
  return members.flatMap((member) => (isRecord(member) ? declaredTypes(member) : []));
};

export type FieldType = { type: string | undefined; nullable: boolean };

// Resolves type arrays and anyOf/oneOf to the single non-null type a flag value converts to.
export const fieldType = (schema: JsonSchema): FieldType => {
  const types = new Set(declaredTypes(schema));
  const nullable = types.delete("null");
  const [only] = types;
  return { type: types.size === 1 ? only : undefined, nullable };
};
