import { expect, test } from "bun:test";
import type { Connection } from "@mcp-cli/core";
import type { SessionRequest } from "../src/daemon/protocol";
import { connectionKey } from "../src/daemon/connection-key";

const request: SessionRequest = {
  operation: "ensure",
  service: "slack",
  cwd: "/first",
  env: { TERM: "first" },
  name: "",
  input: {},
};
const plugin = {
  service: "slack",
  packageName: "slack",
  dir: "/plugin",
  entry: "/plugin/index.ts",
  source: "bundled" as const,
  origin: "bundled",
};
const http: Connection = {
  type: "http",
  url: "https://example.com/mcp",
  headers: { Authorization: "Bearer user" },
};

test("HTTP sessions share resolved credentials across aliases and shell contexts", () => {
  expect(connectionKey(request, http, "user-identity", plugin)).toBe(
    connectionKey(
      {
        ...request,
        credential: "xoxp",
        cwd: "/second",
        env: { TERM: "second" },
      },
      http,
      "user-identity",
      plugin,
    ),
  );
});

test("HTTP sessions isolate bot credentials, endpoints, and plugin implementations", () => {
  const key = connectionKey(request, http, "user-identity", plugin);
  expect(connectionKey(request, http, "bot-identity", plugin)).not.toBe(key);
  expect(
    connectionKey(request, { ...http, url: "https://other.example/mcp" }, "user-identity", plugin),
  ).not.toBe(key);
  expect(connectionKey(request, http, "user-identity", { ...plugin, entry: "/other.ts" })).not.toBe(
    key,
  );
  expect(
    connectionKey(
      request,
      { ...http, headers: { Authorization: "Bearer bot" } },
      "user-identity",
      plugin,
    ),
  ).not.toBe(key);
});

test("stdio sessions keep working directory and environment isolation", () => {
  const config: Connection = { type: "stdio", command: "fixture", args: [] };
  const key = connectionKey(request, config, "identity", plugin);
  expect(connectionKey({ ...request, cwd: "/other" }, config, "identity", plugin)).not.toBe(key);
  expect(
    connectionKey({ ...request, env: { TERM: "other" } }, config, "identity", plugin),
  ).not.toBe(key);
});

test("session catalogs isolate workspaces and upgraded package directories", () => {
  const key = connectionKey({ ...request, workspace: "one" }, http, "identity", plugin);
  expect(connectionKey({ ...request, workspace: "two" }, http, "identity", plugin)).not.toBe(key);
  expect(
    connectionKey({ ...request, workspace: "one" }, http, "identity", {
      ...plugin,
      dir: "/new-artifact",
    }),
  ).not.toBe(key);
});
