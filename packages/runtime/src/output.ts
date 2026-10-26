import type { ToolResult } from "@mcp-cli/core";
import { stringify } from "yaml";

export const formatOutput = (value: unknown, json = false): string => {
  if (json) return JSON.stringify(value, null, 2);
  const output = stringify(value, {
    lineWidth: 0,
    defaultStringType: "PLAIN",
    blockQuote: "literal",
  });
  return output.endsWith("\n\n") ? `${output}...` : output.replace(/\n$/, "");
};

export const formatText = (text: string): string => {
  try {
    const value: unknown = JSON.parse(text);
    return formatOutput(value);
  } catch {
    return text;
  }
};

export const formatResult = (result: ToolResult, json: boolean): string =>
  json
    ? formatOutput(result, true)
    : result.content.length
      ? result.content
          .map((block) =>
            block.type === "text" && typeof block.text === "string"
              ? formatText(block.text)
              : formatOutput(block),
          )
          .join("\n")
      : result.structuredContent !== undefined
        ? formatOutput(result.structuredContent)
        : "";
