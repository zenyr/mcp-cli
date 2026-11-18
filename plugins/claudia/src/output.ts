import type { ToolResult } from "@mcp-cli/core";

const kilobytes = (base64: string): string =>
  `${(Math.floor((base64.length * 3) / 4) / 1024).toFixed(1)} KB`;

const placeholder = (block: Record<string, unknown>): Record<string, unknown> => {
  if (block.type !== "image" || typeof block.data !== "string") return block;
  const mime = typeof block.mimeType === "string" ? block.mimeType : "image";
  return {
    type: "text",
    text: `[${mime}, ${kilobytes(block.data)} omitted; use --json for the data]`,
  };
};

// Plain-text output replaces base64 image blocks with one line, and --json keeps the original data.
export const formatResult = (
  result: ToolResult,
  hostFormat: (result: ToolResult) => string,
): string | undefined =>
  result.content.some((block) => block.type === "image")
    ? hostFormat({ ...result, content: result.content.map(placeholder) })
    : undefined;
