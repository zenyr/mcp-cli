import { expect, test } from "bun:test";
import type { ToolResult } from "@mcp-cli/core";
import { formatResult } from "../src/output";
import { sanitizeTools } from "../src/schema";

const hostFormat = (result: ToolResult): string => JSON.stringify(result.content);

test("plain output replaces image data with its type and size", () => {
  const data = "A".repeat(4096);
  const result: ToolResult = {
    content: [
      { type: "text", text: "caption" },
      { type: "image", mimeType: "image/webp", data },
    ],
  };
  expect(formatResult(result, hostFormat)).toBe(
    JSON.stringify([
      { type: "text", text: "caption" },
      { type: "text", text: "[image/webp, 3.0 KB omitted; use --json for the data]" },
    ]),
  );
  expect(result.content[1]?.data).toBe(data);
});

test("text-only results keep the host format", () => {
  expect(formatResult({ content: [{ type: "text", text: "ok" }] }, hostFormat)).toBeUndefined();
});

test("film, style, doc and topic ids stay open while other enums stay closed", () => {
  const once = sanitizeTools([
    {
      name: "list_films",
      inputSchema: {
        type: "object",
        properties: {
          film: { type: "string", enum: ["any", "bliss"], default: "any", description: "Film." },
          doc: { type: "string", enum: ["readme"] },
          topic: { type: "string", enum: ["recipe"] },
          style: { type: "string", enum: ["bliss"] },
          size: { type: "string", enum: ["small", "medium"] },
        },
      },
    },
  ]);
  expect(sanitizeTools(once)).toEqual(once);
  expect(once[0]?.inputSchema.properties).toEqual({
    film: { type: "string", default: "any", description: "Film. Known values: bliss." },
    doc: { type: "string", description: "Known values: readme." },
    topic: { type: "string", description: "Known values: recipe." },
    style: { type: "string", description: "Known values: bliss." },
    size: { type: "string", enum: ["small", "medium"] },
  });
});
