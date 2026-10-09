import { isRecord, type ToolResult } from "@mcp-cli/core";

export const object = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;
export const resultData = (result: ToolResult): Record<string, unknown> => {
  const structured = object(result.structuredContent);
  if (structured) return object(structured.data) ?? structured;
  for (const item of result.content) {
    if (item.type !== "text" || typeof item.text !== "string") continue;
    try {
      const parsed = object(JSON.parse(item.text));
      if (parsed) return object(parsed.data) ?? parsed;
    } catch {
      /* Plain text is not a structured envelope. */
    }
  }
  return {};
};
export const resultOf = (data: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
  structuredContent: data,
});
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  const record = object(value);
  return record
    ? Object.fromEntries(
        Object.keys(record)
          .sort()
          .filter((key) => record[key] !== undefined)
          .map((key) => [key, canonical(record[key])]),
      )
    : value;
};
export const requestKey = (input: Record<string, unknown>): string =>
  JSON.stringify({ v: 2, input: canonical(input) });
export const creditCharge = (result: ToolResult, fallback: number): number => {
  const value = resultData(result).credits_charged;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
};
