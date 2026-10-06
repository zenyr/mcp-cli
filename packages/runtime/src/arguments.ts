import { RESERVED_FLAGS, type JsonSchema } from "@mcp-cli/core";
import { HELP_FLAG, INPUT_FILE_FLAG, JSON_FLAG, flagForm, isReservedField } from "./reserved";
import { fieldType, property } from "./schema";

export type InputToken =
  | { kind: "source"; flag: string; from: "file" | "stdin" | "text"; value: string }
  | { kind: "field"; flag: string; path: string[]; raw: string }
  | { kind: "invalid"; message: string };
export type ParsedArguments = {
  path: string[];
  tokens: InputToken[];
  json: boolean;
  wantsHelp: boolean;
};

const outputFlags = new Set([`--${JSON_FLAG}`, `--${HELP_FLAG}`]);
const invalid = (message: string): InputToken => ({ kind: "invalid", message });
const lookup = (schema: JsonSchema, path: string[]): JsonSchema =>
  path.reduce((field, segment) => property(field, segment), schema);
const inputOnly = (flag: string, path: string[]): InputToken | undefined =>
  isReservedField(path[0] ?? "")
    ? invalid(`${flag} names a global flag; set ${path[0]} via --input`)
    : undefined;

// Scans argv once; the command schema is resolved when the first option ends the command path.
export const parseArguments = (
  argv: string[],
  resolve: (path: string[]) => JsonSchema,
): ParsedArguments => {
  const path: string[] = [];
  const tokens: InputToken[] = [];
  let json = false;
  let wantsHelp = false;
  let schema: JsonSchema | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (arg === "-h") {
      wantsHelp = true;
      continue;
    }
    if (schema === undefined && !arg.startsWith("-")) {
      path.push(arg);
      continue;
    }
    const separator = arg.indexOf("=");
    const name = arg.slice(2, separator < 0 ? undefined : separator);
    const inline = separator < 0 ? undefined : arg.slice(separator + 1);
    const flag = `--${name}`;
    const global = flagForm(name);
    const reserved = arg.startsWith("--") && RESERVED_FLAGS.includes(global);
    if (reserved && (global === JSON_FLAG || global === HELP_FLAG)) {
      if (inline !== undefined) tokens.push(invalid(`${flag} does not take a value`));
      else if (global === JSON_FLAG) json = true;
      else wantsHelp = true;
      continue;
    }
    schema ??= resolve(path);
    if (!arg.startsWith("--") || !name) {
      tokens.push(invalid(`Unexpected argument: ${arg}`));
      continue;
    }
    const next = argv[index + 1];
    const takeValue = (): string | undefined => {
      if (inline !== undefined) return inline;
      if (next === undefined || (next.startsWith("--") && !outputFlags.has(next))) return undefined;
      index++;
      return next;
    };
    if (reserved) {
      const value = takeValue();
      if (value === undefined) tokens.push(invalid(`Missing value for ${flag}`));
      else {
        const from = value === "-" ? "stdin" : global === INPUT_FILE_FLAG ? "file" : "text";
        tokens.push({ kind: "source", flag: `--${global}`, from, value });
      }
      continue;
    }
    if (name.startsWith("no-")) {
      const fieldPath = name.slice(3).split(".");
      const blocked = inputOnly(flag, fieldPath);
      if (blocked) tokens.push(blocked);
      else if (inline !== undefined) tokens.push(invalid(`${flag} does not take a value`));
      else if (fieldType(lookup(schema, fieldPath)).type !== "boolean")
        tokens.push(invalid(`Negation requires a boolean field: ${flag}`));
      else tokens.push({ kind: "field", flag, path: fieldPath, raw: "false" });
      continue;
    }
    const fieldPath = name.split(".");
    const blocked = inputOnly(flag, fieldPath);
    if (blocked) {
      tokens.push(blocked);
      continue;
    }
    const field = fieldType(lookup(schema, fieldPath));
    if (field.type === "boolean" && inline === undefined) {
      const explicit = next === "true" || next === "false" || (field.nullable && next === "null");
      if (explicit) index++;
      tokens.push({ kind: "field", flag, path: fieldPath, raw: explicit ? next : "true" });
      continue;
    }
    const raw = takeValue();
    tokens.push(
      raw === undefined
        ? invalid(`Missing value for ${flag}`)
        : { kind: "field", flag, path: fieldPath, raw },
    );
  }
  return { path, tokens, json, wantsHelp };
};
