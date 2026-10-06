import { isRecord } from "@mcp-cli/core";
import type { JSONSchema } from "json-schema-to-typescript";

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
const strings = new Set(["title", "description", "$id", "$schema", "$ref", "format", "pattern"]);
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
    if (/^ts[A-Z]/.test(key)) throw new Error(`Unsupported schema extension ${key}`);
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
    } else if (key === "required") {
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

const literals = new Set(["type", "required", "enum", "const", "dependentRequired"]);
const kept = (key: string): boolean =>
  key !== "title" &&
  key !== "$id" &&
  [literals, strings, booleans, numbers].some((keys) => keys.has(key));

// Keeps only allowlisted keywords and drops names so the compiler never sees schema-chosen identifiers.
export const compilerSchema = (value: unknown): unknown => {
  if (!isRecord(value)) return value;
  const schema: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (maps.has(key) || key === "dependencies" || key === "dependentSchemas") {
      schema[key] = isRecord(entry)
        ? Object.fromEntries(
            Object.entries(entry).map(([name, child]) => [name, compilerSchema(child)]),
          )
        : entry;
    } else if (singles.has(key)) schema[key] = compilerSchema(entry);
    else if (arrays.has(key) || key === "items")
      schema[key] = Array.isArray(entry) ? entry.map(compilerSchema) : compilerSchema(entry);
    else if (kept(key)) schema[key] = entry;
  }
  return schema;
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
