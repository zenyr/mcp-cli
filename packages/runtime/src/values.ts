import type { JsonSchema } from "@mcp-cli/core";
import { fieldType } from "./schema";

const decimal = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const integer = /^-?\d+$/;

export const parseJson = (raw: string, flag: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON for ${flag}: ${reason}`);
  }
};

const parseNumber = (raw: string, flag: string, whole: boolean): number => {
  const number = Number(raw);
  const valid = (whole ? integer : decimal).test(raw) && Number.isFinite(number);
  if (!valid || (whole && !Number.isSafeInteger(number)))
    throw new Error(`Expected ${whole ? "integer" : "number"} for ${flag}, received ${raw}`);
  return number;
};

// Converts one flag value using the field's effective schema type.
export const convertValue = (raw: string, schema: JsonSchema, flag: string): unknown => {
  const { type, nullable } = fieldType(schema);
  if (nullable && type !== "string" && raw === "null") return null;
  switch (type) {
    case "boolean":
      if (raw !== "true" && raw !== "false")
        throw new Error(`Expected boolean for ${flag}, received ${raw}`);
      return raw === "true";
    case "integer":
    case "number":
      return parseNumber(raw, flag, type === "integer");
    case "array":
    case "object":
      return parseJson(raw, flag);
    default:
      return raw;
  }
};
