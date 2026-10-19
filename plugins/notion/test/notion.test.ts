import { expect, test } from "bun:test";
import { applyCustomizations } from "@mcp-cli/core";
import notion from "../src";
import { manifest } from "../src/generated";

test("Notion AI search is mapped only when the server exposes it", () => {
  const tools = manifest.tools.filter((tool) => tool.name !== "notion-ai-search");
  const withoutAi = applyCustomizations(notion, { ...manifest, tools });
  expect(withoutAi.commands.some((command) => command.path.join(" ") === "search ai")).toBe(false);

  const withAi = applyCustomizations(notion, {
    ...manifest,
    tools: [...tools, { name: "notion-ai-search", inputSchema: { type: "object" } }],
  });
  expect(withAi.commands.find((command) => command.name === "notion-ai-search")?.path).toEqual([
    "search",
    "ai",
  ]);
});

test("Notion declares OAuth and connects without authorize by default", async () => {
  expect(notion.auth).toEqual({ type: "oauth" });
  expect(await notion.connection({})).toEqual({ type: "http", url: "https://mcp.notion.com/mcp" });
});

test("NOTION_MCP_TOKEN supplies authorize so it wins over stored credentials", async () => {
  const connection = await notion.connection({
    NOTION_MCP_TOKEN: "env",
    NOTION_MCP_URL: "http://x/mcp",
  });
  if (connection.type !== "http" || !connection.authorize) throw new Error("expected authorize");
  expect(connection.url).toBe("http://x/mcp");
  expect(await connection.authorize({ refresh: true })).toEqual({ Authorization: "Bearer env" });
});
