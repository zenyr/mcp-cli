import type { JsonSchema } from "@mcp-cli/core";
import { fieldName, isRecord, property } from "./schema";

type InputFiles = { readFile(path: string): Promise<string>; readStdin(): Promise<string> };
const unsafe = new Set(["__proto__", "prototype", "constructor"]);
const value = (raw: string, schema: JsonSchema): unknown => {
  if (schema.type === "string") return raw;
  if (schema.type === "boolean") {
    if (raw !== "true" && raw !== "false") throw new Error(`Expected boolean, received ${raw}`);
    return raw === "true";
  }
  if (schema.type === "number" || schema.type === "integer") {
    const number = Number(raw);
    if (!raw.trim() || !Number.isFinite(number))
      throw new Error(`Expected number, received ${raw}`);
    return number;
  }
  if (schema.type === "array" || schema.type === "object") return JSON.parse(raw);
  return raw;
};
const setField = (
  input: Record<string, unknown>,
  schema: JsonSchema,
  path: string[],
  raw: string,
): void => {
  let cursor = input;
  for (const [index, segment] of path.entries()) {
    const key = fieldName(schema, segment);
    if (!key || unsafe.has(key)) throw new Error(`Invalid field: ${segment}`);
    const nextSchema = property(schema, segment);
    if (index === path.length - 1) {
      if (Object.hasOwn(cursor, key))
        throw new Error(`Repeated field: ${path.join(".")}; use a JSON array`);
      cursor[key] = value(raw, nextSchema);
    } else {
      if (!Object.hasOwn(cursor, key)) cursor[key] = {};
      const nested = cursor[key];
      if (!isRecord(nested)) throw new Error(`Conflicting field: ${key}`);
      cursor = nested;
      schema = nextSchema;
    }
  }
};
export const parseInput = async (
  args: string[],
  schema: JsonSchema,
  files: InputFiles,
): Promise<Record<string, unknown>> => {
  const input: Record<string, unknown> = {};
  let source: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === undefined) continue;
    if (!flag.startsWith("--")) throw new Error(`Unexpected argument: ${flag}`);
    if (flag === "--input" || flag === "--input-file") {
      if (source !== undefined || Object.keys(input).length)
        throw new Error("Use one input source; do not mix JSON and flags");
      const next = args[++i];
      if (!next || (next.startsWith("--") && !["--help", "--json"].includes(next)))
        throw new Error(`Missing value for ${flag}`);
      source =
        flag === "--input-file"
          ? await files.readFile(next)
          : next === "-"
            ? await files.readStdin()
            : next;
      continue;
    }
    if (source !== undefined) throw new Error("Use one input source; do not mix JSON and flags");
    const negative = flag.startsWith("--no-");
    const path = flag.slice(negative ? 5 : 2).split(".");
    let field = schema;
    for (const key of path) field = property(field, key);
    let raw: string;
    if (negative) {
      if (field.type !== "boolean") throw new Error(`Negation requires a boolean field: ${flag}`);
      raw = "false";
    } else if (
      field.type === "boolean" &&
      (args[i + 1] === undefined || args[i + 1]?.startsWith("--"))
    ) {
      raw = "true";
    } else {
      const next = args[++i];
      if (next === undefined || (next.startsWith("--") && !["--help", "--json"].includes(next)))
        throw new Error(`Missing value for ${flag}`);
      raw = next;
    }
    setField(input, schema, path, raw);
  }
  if (source === undefined) return input;
  const parsed: unknown = JSON.parse(source);
  if (!isRecord(parsed)) throw new Error("Input must be a JSON object");
  return parsed;
};
