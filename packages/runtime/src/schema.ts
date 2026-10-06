import type { JsonSchema } from "@mcp-to-cli/core";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

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
