import { expect, test } from "bun:test";
import notion from "../src";

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
