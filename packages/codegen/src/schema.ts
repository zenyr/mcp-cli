import type { JSONSchema } from "json-schema-to-typescript";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const types = new Set(["null", "boolean", "object", "array", "number", "integer", "string", "any"]);
const maps = new Set(["properties", "patternProperties", "definitions", "$defs"]);
const singles = new Set([
  "additionalProperties",
  "additionalItems",
  "contains",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
]);
const arrays = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const strings = new Set([
  "title",
  "description",
  "$id",
  "$schema",
  "$ref",
  "format",
  "pattern",
  "tsType",
]);
const booleans = new Set(["uniqueItems", "readOnly", "writeOnly", "deprecated"]);
const numbers = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "minProperties",
  "maxProperties",
]);

export const validateSchema = (value: unknown, seen = new Set<object>()): void => {
  if (typeof value === "boolean") return;
  if (!isRecord(value) || seen.has(value)) throw new Error("Invalid or cyclic JSON schema");
  seen.add(value);
  for (const [key, entry] of Object.entries(value)) {
    if (key === "type") {
      const entries = Array.isArray(entry) ? entry : [entry];
      if (!entries.length || entries.some((type) => typeof type !== "string" || !types.has(type)))
        throw new Error("Invalid schema type");
    } else if (maps.has(key)) {
      if (!isRecord(entry)) throw new Error(`Invalid schema ${key}`);
      for (const child of Object.values(entry)) validateSchema(child, seen);
    } else if (singles.has(key)) {
      validateSchema(entry, seen);
    } else if (arrays.has(key) || key === "items") {
      if (key !== "items" && !Array.isArray(entry)) throw new Error(`Invalid schema ${key}`);
      for (const child of Array.isArray(entry) ? entry : [entry]) validateSchema(child, seen);
    } else if (key === "required" || key === "tsEnumNames") {
      if (!Array.isArray(entry) || entry.some((item) => typeof item !== "string"))
        throw new Error(`Invalid schema ${key}`);
    } else if (strings.has(key)) {
      if (typeof entry !== "string") throw new Error(`Invalid schema ${key}`);
      if (key === "$ref" && !entry.startsWith("#"))
        throw new Error("Only local schema references are supported");
    } else if (booleans.has(key)) {
      if (typeof entry !== "boolean") throw new Error(`Invalid schema ${key}`);
    } else if (
      key === "dependencies" ||
      key === "dependentSchemas" ||
      key === "dependentRequired"
    ) {
      if (!isRecord(entry)) throw new Error(`Invalid schema ${key}`);
      for (const dependency of Object.values(entry)) {
        if (Array.isArray(dependency) && key !== "dependentSchemas") {
          if (dependency.some((item) => typeof item !== "string"))
            throw new Error("Invalid schema dependency");
        } else if (key !== "dependentRequired") {
          validateSchema(dependency, seen);
        } else throw new Error("Invalid schema dependency");
      }
    } else if (numbers.has(key)) {
      if (typeof entry !== "number" || !Number.isFinite(entry))
        throw new Error(`Invalid schema ${key}`);
    } else if (key === "enum" && (!Array.isArray(entry) || !entry.length)) {
      throw new Error("Invalid schema enum");
    }
  }
  seen.delete(value);
};

export const isCompilerSchema = (value: unknown): value is JSONSchema => {
  if (!isRecord(value)) return false;
  validateSchema(value);
  return true;
};

export const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
};
