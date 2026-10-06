import { isRecord, type JsonSchema } from "@mcp-cli/core";

const members = (schema: JsonSchema): JsonSchema[] =>
  [schema.anyOf, schema.oneOf]
    .flatMap((list) => (Array.isArray(list) ? list : []))
    .filter((member) => isRecord(member));

const declaredTypes = (schema: JsonSchema): string[] => {
  const { type } = schema;
  if (typeof type === "string") return [type];
  if (Array.isArray(type)) return type.filter((item) => typeof item === "string");
  return members(schema).flatMap(declaredTypes);
};

const isNullOnly = (schema: JsonSchema): boolean => {
  const types = declaredTypes(schema);
  return types.length > 0 && types.every((type) => type === "null");
};

// Descends through a nullable union to the single non-null member that declares properties.
const objectSchema = (schema: JsonSchema): JsonSchema => {
  if (isRecord(schema.properties)) return schema;
  const [only, ...rest] = members(schema).filter((member) => !isNullOnly(member));
  return only && !rest.length ? objectSchema(only) : schema;
};

export const fieldName = (schema: JsonSchema, key: string): string => {
  const properties = objectSchema(schema).properties;
  return isRecord(properties) && Object.hasOwn(properties, key) ? key : key.replaceAll("-", "_");
};

export const property = (schema: JsonSchema, key: string): JsonSchema => {
  const properties = objectSchema(schema).properties;
  const name = fieldName(schema, key);
  if (!isRecord(properties) || !Object.hasOwn(properties, name)) return {};
  const field = properties[name];
  return isRecord(field) ? field : {};
};

export type FieldType = { type: string | undefined; nullable: boolean };

// Resolves type arrays and anyOf/oneOf to the single non-null type a flag value converts to.
export const fieldType = (schema: JsonSchema): FieldType => {
  const types = new Set(declaredTypes(schema));
  const nullable = types.delete("null");
  const [only] = types;
  return { type: types.size === 1 ? only : undefined, nullable };
};

export const typeLabel = (schema: JsonSchema): string => {
  if (Array.isArray(schema.enum)) return schema.enum.map(String).join("|");
  const types = new Set(declaredTypes(schema));
  const nullable = types.delete("null");
  const label = types.size ? [...types].join("|") : "JSON";
  return nullable ? `${label}|null` : label;
};
