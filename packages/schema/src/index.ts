import Ajv from "ajv";
import addFormats from "ajv-formats";
import type { JsonSchema } from "@mcp-cli/core";

const validator = new Ajv({ allErrors: true, strict: false, ownProperties: true });
addFormats(validator);
export const validateInput = (schema: JsonSchema, input: Record<string, unknown>): void => {
  const validate = validator.compile(schema);
  if (!validate(input)) throw new Error(`Invalid input: ${validator.errorsText(validate.errors)}`);
};
