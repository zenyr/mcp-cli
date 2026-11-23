import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings, memSettingsStore } from "@mcp-cli/mem/settings";
import type { AuthSupportContext } from "@mcp-cli/core";
import { fileTokenStore } from "@mcp-cli/auth";
import { memAuthSupport } from "../src/settings";

test("plugin settings are empty by default and shared with the standalone CLI", async () => {
  const root = await mkdtemp(join(tmpdir(), "mem-settings-"));
  const env = { HOME: root, XDG_CONFIG_HOME: join(root, "config") };
  const context: AuthSupportContext = {
    env,
    settings: memSettingsStore(env),
    store: {
      read: async () => undefined,
      write: async () => undefined,
      delete: async () => undefined,
      withLock: async (_name, run) => run(),
    },
  };
  const path = join(root, "legacy.json");
  try {
    expect(await memAuthSupport.configuration(context)).toEqual({
      model: "",
      baseUrl: "",
      thinking: "default",
      apiKey: "",
      hasApiKey: false,
      clearApiKey: false,
      headers: "{}",
    });
    await writeFile(path, JSON.stringify({ model: "legacy", nodeBytes: 1024 }));
    await memAuthSupport.configure(context, {
      model: "configured-model",
      baseUrl: "https://summary.invalid/v1",
      thinking: "disabled",
    });
    expect(await loadSettings(path, env)).toMatchObject({
      model: "configured-model",
      baseUrl: "https://summary.invalid/v1",
      thinking: "disabled",
      nodeBytes: 1024,
    });
    expect(await loadSettings(path, { ...env, MEM_MODEL: "environment-model" })).toMatchObject({
      model: "environment-model",
    });
    await expect(
      memAuthSupport.configure(context, { baseUrl: "file:///tmp/private", model: "bad" }),
    ).rejects.toThrow("Check the API address and headers");
    expect((await memAuthSupport.configuration(context)).model).toBe("configured-model");
    await memAuthSupport.configure(context, { model: "", baseUrl: "", thinking: "default" });
    expect(await loadSettings(path, env)).toMatchObject({ model: "", baseUrl: "" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("draft connection discovers models and saved credentials stay out of configuration output", async () => {
  const root = await mkdtemp(join(tmpdir(), "mem-models-"));
  const env = { HOME: root, XDG_CONFIG_HOME: join(root, "config") };
  const context: AuthSupportContext = {
    env,
    settings: memSettingsStore(env),
    store: fileTokenStore({ env }),
  };
  let expectedKey = "draft-key";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      expect(new URL(request.url).pathname).toBe("/v1/models");
      expect(request.headers.get("authorization")).toBe(`Bearer ${expectedKey}`);
      expect(request.headers.get("x-project")).toBe("test-project");
      return Response.json({ data: [{ id: "model-b" }, { id: "model-a" }] });
    },
  });
  const draft = {
    model: "manual-model",
    baseUrl: `${server.url}v1`,
    apiKey: expectedKey,
    headers: '{"X-Project":"test-project"}',
  };
  const load = memAuthSupport.loadOptions;
  if (!load) throw new Error("Missing model discovery");
  try {
    expect(await load(context, { path: ["model"], configuration: draft })).toEqual([
      { value: "model-a", label: "model-a" },
      { value: "model-b", label: "model-b" },
    ]);
    expect(await context.store.read("mem")).toBeUndefined();
    expect(await context.settings.read("mem")).toBeUndefined();
    await memAuthSupport.configure(context, draft);
    const displayed = await memAuthSupport.configuration(context);
    expect(displayed.apiKey).toBe("");
    expect(displayed.hasApiKey).toBe(true);
    expect(JSON.stringify(displayed)).not.toContain("draft-key");
    const settingsFile = await readFile(join(root, "config/mcp-cli/settings/mem.json"), "utf8");
    expect(settingsFile).not.toContain("draft-key");
    expect(await loadSettings(join(root, "unused.json"), env)).toMatchObject({
      model: "manual-model",
      apiKey: "draft-key",
      headers: { "X-Project": "test-project" },
    });
    await memAuthSupport.configure(context, { ...displayed, model: "another-manual-model" });
    expect((await context.store.read("mem"))?.accessToken).toBe("draft-key");
    await load(context, { path: ["model"], configuration: displayed });
    expectedKey = "unsaved-new-key";
    await load(context, { path: ["model"], configuration: { ...displayed, apiKey: expectedKey } });
    expect((await context.store.read("mem"))?.accessToken).toBe("draft-key");
    await memAuthSupport.configure(context, { ...displayed, clearApiKey: true });
    expect(await context.store.read("mem")).toBeUndefined();
    expect((await memAuthSupport.configuration(context)).hasApiKey).toBe(false);
    for (const headers of ["[]", '{"X-Secret":12}', "{"]) {
      await expect(memAuthSupport.configure(context, { ...draft, headers })).rejects.toThrow();
    }
  } finally {
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});
