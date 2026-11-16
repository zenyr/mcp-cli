import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import type { JsonSchema, ToolDefinition } from "@mcp-cli/core";

export type ValidationIssue = { path: string; message: string };

export class InputValidationError extends Error {
  override name = "InputValidationError";
  readonly issues: readonly ValidationIssue[] = [];
}

const invalidInput = (issues: readonly ValidationIssue[]): InputValidationError => {
  const details = issues.map((issue) => `${issue.path || "input"} ${issue.message}`);
  return Object.assign(new InputValidationError(`Invalid input: ${details.join(", ")}`), {
    issues,
  });
};

export class SchemaCompileError extends Error {
  override name = "SchemaCompileError";
}

const options = { allErrors: true, strict: false, ownProperties: true };
const draft07 = new Ajv(options);
const draft2020 = new Ajv2020(options);
addFormats(draft07);
addFormats(draft2020);
const DRAFT_2020 = "https://json-schema.org/draft/2020-12/schema";
const compiled = new WeakMap<JsonSchema, ValidateFunction>();

// Undeclared schemas use 2020-12 like current MCP and fall back to draft-07 for legacy servers.
const compileWithDialect = (schema: JsonSchema): ValidateFunction => {
  const declared =
    typeof schema.$schema === "string" ? schema.$schema.replace(/#$/, "") : undefined;
  if (declared === DRAFT_2020) return draft2020.compile(schema);
  if (declared !== undefined) return draft07.compile(schema);
  try {
    return draft2020.compile(schema);
  } catch {
    return draft07.compile(schema);
  }
};

const compile = (schema: JsonSchema): ValidateFunction => {
  const cached = compiled.get(schema);
  if (cached) return cached;
  try {
    const validate = compileWithDialect(schema);
    compiled.set(schema, validate);
    return validate;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new SchemaCompileError(`Invalid input schema: ${reason}`, { cause: error });
  } finally {
    draft07.removeSchema(schema);
    draft2020.removeSchema(schema);
  }
};

const toIssue = (error: ErrorObject): ValidationIssue => ({
  path: error.instancePath,
  message: error.message ?? error.keyword,
});

export const validateInput = (schema: JsonSchema, input: Record<string, unknown>): void => {
  const validate = compile(schema);
  if (!validate(input)) throw invalidInput((validate.errors ?? []).map(toIssue));
};

export const validateTools = (tools: readonly ToolDefinition[]): void => {
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name)) throw new SchemaCompileError(`Duplicate tool: ${tool.name}`);
    names.add(tool.name);
    compile(tool.inputSchema);
    if (tool.outputSchema) compile(tool.outputSchema);
  }
};
