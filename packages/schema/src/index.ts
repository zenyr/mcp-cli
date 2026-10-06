import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import type { JsonSchema } from "@mcp-cli/core";

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

const validator = new Ajv({ allErrors: true, strict: false, ownProperties: true });
addFormats(validator);
const compiled = new WeakMap<JsonSchema, ValidateFunction>();

const compile = (schema: JsonSchema): ValidateFunction => {
  const cached = compiled.get(schema);
  if (cached) return cached;
  try {
    const validate = validator.compile(schema);
    compiled.set(schema, validate);
    return validate;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new SchemaCompileError(`Invalid input schema: ${reason}`, { cause: error });
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
