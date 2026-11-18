import { isRecord, type JsonSchema, type ToolDefinition } from "@mcp-cli/core";

// Film, style, document and guide ids grow with each release, so the snapshot keeps them as hints instead of a closed enum.
const OPEN_KEYS = new Set(["film", "style", "doc", "topic"]);

const openEnum = (schema: Record<string, unknown>): Record<string, unknown> => {
  const { enum: values, ...rest } = schema;
  if (!Array.isArray(values)) return schema;
  const known = `Known values: ${values.filter((value) => value !== rest.default).join(", ")}.`;
  const description = typeof rest.description === "string" ? `${rest.description} ${known}` : known;
  return { ...rest, description };
};

const openInput = (schema: JsonSchema): JsonSchema => {
  const properties = schema.properties;
  if (!isRecord(properties)) return schema;
  const opened = Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [
      key,
      OPEN_KEYS.has(key) && isRecord(value) ? openEnum(value) : value,
    ]),
  );
  return { ...schema, properties: opened };
};

export const sanitizeTools = (tools: ToolDefinition[]): ToolDefinition[] =>
  tools.map((tool) => ({ ...tool, inputSchema: openInput(tool.inputSchema) }));
