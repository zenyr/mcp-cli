import { UsageError, isRecord, type JsonSchema } from "@mcp-cli/core";
import type { InputToken } from "./arguments";
import { fieldName, property } from "./schema";
import { convertValue, parseJson } from "./values";

type InputFiles = { readFile(path: string): Promise<string>; readStdin(): Promise<string> };
const unsafe = new Set(["__proto__", "prototype", "constructor"]);
const mixedSources = "Use one input source; do not mix JSON and flags";

const setField = (
  input: Record<string, unknown>,
  schema: JsonSchema,
  token: { flag: string; path: string[]; raw: string },
): void => {
  let cursor = input;
  for (const [index, segment] of token.path.entries()) {
    const key = fieldName(schema, segment);
    if (!key || unsafe.has(key)) throw new UsageError(`Invalid field: ${segment}`);
    const nextSchema = property(schema, segment);
    if (index === token.path.length - 1) {
      if (Object.hasOwn(cursor, key))
        throw new UsageError(`Repeated field: ${token.path.join(".")}; use a JSON array`);
      cursor[key] = convertValue(token.raw, nextSchema, token.flag);
    } else {
      if (!Object.hasOwn(cursor, key)) cursor[key] = {};
      const nested = cursor[key];
      if (!isRecord(nested)) throw new UsageError(`Conflicting field: ${key}`);
      cursor = nested;
      schema = nextSchema;
    }
  }
};

export const parseInput = async (
  tokens: InputToken[],
  schema: JsonSchema,
  files: InputFiles,
): Promise<Record<string, unknown>> => {
  const input: Record<string, unknown> = {};
  let source: { flag: string; text: string } | undefined;
  for (const token of tokens) {
    if (token.kind === "invalid") throw new UsageError(token.message);
    if (source !== undefined) throw new UsageError(mixedSources);
    if (token.kind === "field") {
      setField(input, schema, token);
      continue;
    }
    if (Object.keys(input).length) throw new UsageError(mixedSources);
    const text =
      token.from === "file"
        ? await files.readFile(token.value)
        : token.from === "stdin"
          ? await files.readStdin()
          : token.value;
    source = { flag: token.flag, text };
  }
  if (source === undefined) return input;
  const parsed = parseJson(source.text, source.flag);
  if (!isRecord(parsed)) throw new UsageError("Input must be a JSON object");
  return parsed;
};
