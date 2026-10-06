import { expect, test } from "bun:test";
import { join } from "node:path";
import type { Connection, ToolSession } from "@mcp-cli/core";
import {
  MissingCapabilityError,
  MissingPromptsCapabilityError,
  MissingResourcesCapabilityError,
  connect,
} from "../src";

const fixture = join(import.meta.dir, "fixtures", "server.ts");
const stdio = (mode = "tools"): Connection => ({
  type: "stdio",
  command: "bun",
  args: [fixture, mode],
});
const withSession = async (mode: string, run: (session: ToolSession) => Promise<void>) => {
  const session = await connect(stdio(mode));
  try {
    await run(session);
  } finally {
    await session.close();
  }
};

test("listResources follows every page and converts to core types", () =>
  withSession("tools", async (session) => {
    expect(await session.listResources()).toEqual([
      { uri: "fixture://text", name: "text", mimeType: "text/plain", description: "Plain text" },
      { uri: "fixture://blob", name: "blob", mimeType: "application/octet-stream", size: 3 },
    ]);
    expect(await session.listResourceTemplates()).toEqual([
      { uriTemplate: "fixture://item/{id}", name: "item" },
    ]);
  }));

test("readResource returns text and base64 blob contents", () =>
  withSession("tools", async (session) => {
    expect(await session.readResource("fixture://text")).toEqual([
      { uri: "fixture://text", mimeType: "text/plain", text: "hello resource" },
    ]);
    expect(await session.readResource("fixture://blob")).toEqual([
      { uri: "fixture://blob", blob: btoa("abc") },
    ]);
    await expect(session.readResource("fixture://missing")).rejects.toThrow();
  }));

test("listPrompts follows every page and getPrompt passes arguments", () =>
  withSession("tools", async (session) => {
    expect(await session.listPrompts()).toEqual([
      {
        name: "greet",
        description: "Greet someone",
        arguments: [{ name: "who", required: true }],
      },
      { name: "plain", arguments: [] },
    ]);
    expect(await session.getPrompt("greet", { who: "Ada" })).toEqual({
      messages: [{ role: "user", content: { type: "text", text: "Hello, Ada" } }],
    });
  }));

test("resources and prompts fail explicitly when the capability is missing", () =>
  withSession("no-tools", async (session) => {
    for (const [task, type, capability] of [
      [session.listResources(), MissingResourcesCapabilityError, "resources"],
      [session.listResourceTemplates(), MissingResourcesCapabilityError, "resources"],
      [session.readResource("fixture://text"), MissingResourcesCapabilityError, "resources"],
      [session.listPrompts(), MissingPromptsCapabilityError, "prompts"],
      [session.getPrompt("greet", {}), MissingPromptsCapabilityError, "prompts"],
    ] as const) {
      const error = await task.catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(type);
      expect(error).toBeInstanceOf(MissingCapabilityError);
      expect(error).toHaveProperty("capability", capability);
    }
  }));
