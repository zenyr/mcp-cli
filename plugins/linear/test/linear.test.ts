import { expect, test } from "bun:test";
import linear from "../src";

test("Linear declares OAuth and connects without authorize by default", async () => {
  expect(linear.auth).toEqual({ type: "oauth" });
  expect(await linear.connection({})).toEqual({ type: "http", url: "https://mcp.linear.app/mcp" });
});

test("LINEAR_MCP_TOKEN supplies authorize so it wins over stored credentials", async () => {
  const connection = await linear.connection({ LINEAR_MCP_TOKEN: "env" });
  if (connection.type !== "http" || !connection.authorize) throw new Error("expected authorize");
  expect(await connection.authorize({ refresh: true })).toEqual({ Authorization: "Bearer env" });
});
