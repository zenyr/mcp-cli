import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDraftSettings, loadSettings, memSettingsStore } from "@mcp-cli/mem/settings";
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

test("draft configuration test uses loadOptions precedence and saves nothing", async () => {
  const root = await mkdtemp(join(tmpdir(), "mem-test-config-"));
  const env: Record<string, string> = { HOME: root, XDG_CONFIG_HOME: join(root, "config") };
  const context: AuthSupportContext = {
    env,
    settings: memSettingsStore(env),
    store: fileTokenStore({ env }),
  };
  const configPath = join(root, "config/mem/config.json");
  await mkdir(join(root, "config/mem"), { recursive: true });
  const fileConfiguration = { timeoutMs: 120000, maxOutputTokens: 123, inputBytes: 8192 };
  await writeFile(configPath, JSON.stringify(fileConfiguration));
  expect(await loadDraftSettings({}, env)).toMatchObject(fileConfiguration);
  let expected = { key: "draft-key", model: "draft-model" };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      expect(request.headers.get("authorization")).toBe(`Bearer ${expected.key}`);
      expect(request.headers.get("x-project")).toBe("test-project");
      const body = await request.json();
      expect(body.model).toBe(expected.model);
      expect(body.max_tokens).toBe(123);
      expect(body.thinking).toEqual({ type: "enabled" });
      if (expected.model === "reject") return new Response("no", { status: 403 });
      return Response.json({
        choices: [{ message: { content: "summary" } }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      });
    },
  });
  const draft = {
    model: "draft-model",
    baseUrl: `${server.url}v1`,
    apiKey: "draft-key",
    thinking: "enabled",
    headers: '{"X-Project":"test-project"}',
  };
  const run = memAuthSupport.testConfiguration;
  if (!run) throw new Error("Missing configuration test");
  try {
    const result = await run(context, draft);
    expect(result.message).toBe("summary");
    expect(result.details).toContainEqual({ label: "Model", value: "draft-model" });
    expect(result.details).toContainEqual({ label: "Reasoning", value: "enabled" });
    expect(JSON.stringify(result)).not.toContain("draft-key");
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual(fileConfiguration);
    expect(await context.store.read("mem")).toBeUndefined();
    expect(await context.settings.read("mem")).toBeUndefined();
    await context.store.write("mem", { accessToken: "saved-key" });
    expected = { key: "saved-key", model: "draft-model" };
    await run(context, { ...draft, apiKey: "" });
    env.MEM_MODEL = "env-model";
    env.MEM_API_KEY = "env-key";
    expected = { key: "env-key", model: "env-model" };
    await run(context, draft);
    env.MEM_MODEL = "reject";
    expected = { key: "env-key", model: "reject" };
    await expect(run(context, draft)).rejects.toThrow(
      "Summarizer rejected the request. (HTTP 403)",
    );
    delete env.MEM_MODEL;
    await expect(run(context, { ...draft, model: "" })).rejects.toThrow(
      "Enter the API base URL and summary model first.",
    );
    await expect(run(context, { ...draft, headers: "{" })).rejects.toThrow("Check the API address");
    await expect(run(context, { ...draft, baseUrl: "not a URL" })).rejects.toThrow(
      "Check the API address",
    );
    expect((await context.store.read("mem"))?.accessToken).toBe("saved-key");
  } finally {
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});

test("model discovery failures keep a nonempty message through Effect", async () => {
  const load = memAuthSupport.loadOptions;
  if (!load) throw new Error("Missing model discovery");
  const root = await mkdtemp(join(tmpdir(), "mem-load-fail-"));
  const env = { HOME: root, XDG_CONFIG_HOME: join(root, "config") };
  const context: AuthSupportContext = {
    env,
    settings: memSettingsStore(env),
    store: fileTokenStore({ env }),
  };
  try {
    const error = await load(context, { path: ["model"], configuration: {} }).catch(
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error instanceof Error && error.message).toBe("Enter the API base URL first.");
    await expect(
      load(context, { path: ["model"], configuration: { baseUrl: "not a URL" } }),
    ).rejects.toThrow("Check the API address");
    await expect(
      load(context, { path: ["model"], configuration: { baseUrl: "http://127.0.0.1:1/v1" } }),
    ).rejects.toThrow("Could not load models. Check the address and authentication.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
