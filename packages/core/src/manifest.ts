import { isRecord, isStringArray } from "./values";
import type { CommandSpec, Manifest } from "./index";

const optionalString = (value: unknown, label: string): string | undefined => {
  if (value === undefined || typeof value === "string") return value;
  throw new Error(`Invalid manifest: ${label} must be a string`);
};

const optionalStrings = (value: unknown, label: string): string[] | undefined => {
  if (value === undefined || isStringArray(value)) return value;
  throw new Error(`Invalid manifest: ${label} must be a string array`);
};

const decodeCommand = (value: unknown, index: number): CommandSpec => {
  const label = `commands[${index}]`;
  if (!isRecord(value)) throw new Error(`Invalid manifest: ${label} must be an object`);
  const { name, path, inputSchema, outputSchema } = value;
  if (typeof name !== "string" || !name)
    throw new Error(`Invalid manifest: ${label}.name is required`);
  if (!isStringArray(path) || !path.length)
    throw new Error(`Invalid manifest: ${label}.path must be a non-empty string array`);
  if (!isRecord(inputSchema))
    throw new Error(`Invalid manifest: ${label}.inputSchema must be an object`);
  if (outputSchema !== undefined && !isRecord(outputSchema))
    throw new Error(`Invalid manifest: ${label}.outputSchema must be an object`);
  const summary = optionalString(value.summary, `${label}.summary`);
  const description = optionalString(value.description, `${label}.description`);
  const details = optionalString(value.details, `${label}.details`);
  const examples = optionalStrings(value.examples, `${label}.examples`);
  const rules = optionalStrings(value.rules, `${label}.rules`);
  return {
    name,
    path,
    inputSchema,
    ...(outputSchema !== undefined && { outputSchema }),
    ...(summary !== undefined && { summary }),
    ...(description !== undefined && { description }),
    ...(details !== undefined && { details }),
    ...(examples !== undefined && { examples }),
    ...(rules !== undefined && { rules }),
  };
};

export const decodeManifest = (value: unknown): Manifest => {
  if (!isRecord(value)) throw new Error("Invalid manifest: expected an object");
  const { version, service, summary, commands } = value;
  if (version !== 1) throw new Error("Invalid manifest: unsupported version");
  if (typeof service !== "string" || !service)
    throw new Error("Invalid manifest: service is required");
  if (typeof summary !== "string") throw new Error("Invalid manifest: summary must be a string");
  if (!Array.isArray(commands)) throw new Error("Invalid manifest: commands must be an array");
  return { version, service, summary, commands: commands.map(decodeCommand) };
};
