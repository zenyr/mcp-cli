import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings, memSettingsStore } from "@mcp-cli/mem/settings";
import type { AuthSupportContext } from "@mcp-cli/core";
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
    ).rejects.toMatchObject({ code: "INVALID_CONFIG" });
    expect((await memAuthSupport.configuration(context)).model).toBe("configured-model");
    await memAuthSupport.configure(context, { model: "", baseUrl: "", thinking: "default" });
    expect(await loadSettings(path, env)).toMatchObject({ model: "", baseUrl: "" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
