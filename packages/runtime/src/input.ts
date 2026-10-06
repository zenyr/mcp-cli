import { UsageError, isRecord, type JsonSchema } from "@mcp-cli/core";
import { InputValidationError, validateInput } from "@mcp-cli/schema";
import type { InputToken } from "./arguments";
import { fieldName, property } from "./schema";
import { convertValue, parseJson } from "./values";

type InputFiles = { readFile(path: string): Promise<string>; readStdin(): Promise<string> };
const unsafe = new Set(["__proto__", "prototype", "constructor"]);
const mixedSources = "Use one input source; do not mix JSON and flags";

// File system failures carry a string code; anything else is not a usage problem.
const systemCode = (error: unknown): string | undefined =>
  isRecord(error) && typeof error.code === "string" ? error.code : undefined;

const readSource = async (
  token: { flag: string; from: "file" | "stdin" | "text"; value: string },
  files: InputFiles,
): Promise<string> => {
  if (token.from === "text") return token.value;
  if (token.from === "stdin") return files.readStdin();
  try {
    return await files.readFile(token.value);
  } catch (error) {
    const code = systemCode(error);
    if (code === undefined) throw error;
    throw new UsageError(`Cannot read ${token.flag} ${token.value}: ${code}`, { cause: error });
  }
};

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
    if (source !== undefined && token.kind === "source")
      throw new UsageError(
        source.flag === token.flag
          ? `Repeated flag: ${token.flag}; pass one JSON object`
          : `Use one input source: ${source.flag} or ${token.flag}`,
      );
    if (source !== undefined) throw new UsageError(mixedSources);
    if (token.kind === "field") {
      setField(input, schema, token);
      continue;
    }
    if (Object.keys(input).length) throw new UsageError(mixedSources);
    source = { flag: token.flag, text: await readSource(token, files) };
  }
  if (source === undefined) return input;
  const parsed = parseJson(source.text, source.flag);
  if (!isRecord(parsed)) throw new UsageError("Input must be a JSON object");
  return parsed;
};

// Only input that fails validation is a usage problem; a broken schema propagates unchanged.
export const validateUserInput = (schema: JsonSchema, input: Record<string, unknown>): void => {
  try {
    validateInput(schema, input);
  } catch (error) {
    if (error instanceof InputValidationError)
      throw new UsageError(error.message, { cause: error });
    throw error;
  }
};
