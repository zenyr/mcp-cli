import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { definePlugin, type WorkspaceRegistry } from "@mcp-cli/core";
import { fileSettingsStore, fileTokenStore } from "@mcp-cli/auth";
import { readWorkspaces, selectWorkspace, updateWorkspace } from "../src/workspaces";
import { pluginEnvironment, pluginSettings, pluginStore } from "../src/plugin-credentials";
import { extensionCacheScope } from "../src/cache-scope";
import { resolveConnection } from "../src/auth";
import { extractWorkspace, leadingArguments } from "../src/workspace-arguments";

const plugin = definePlugin({
  name: "test",
  summary: "Test",
  workspaces: { credentialEnv: ["TEST_TOKEN"] },
  auth: { type: "apiKey", env: "TEST_TOKEN" },
  connection: () => ({ type: "http", url: "https://example.test/mcp" }),
});
const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), "workspace-test-"));
  return {
    directory,
    settings: fileSettingsStore(join(directory, "settings")),
    store: fileTokenStore({ dir: join(directory, "tokens") }),
  };
};

test("legacy credentials remain accessible and workspace rename preserves its namespace", async () => {
  const f = await fixture();
  try {
    await f.store.write("test", { accessToken: "legacy" });
    const legacy = await selectWorkspace(plugin, undefined, f.settings);
    expect(await pluginStore(legacy, f.store).read("test")).toHaveProperty("accessToken", "legacy");
    const added = await updateWorkspace(
      plugin,
      { type: "add", service: "test", name: "company" },
      f.settings,
    );
    const selected = await selectWorkspace(plugin, "company", f.settings);
    const id = selected.workspace?.id;
    expect(id).toBe(added.workspaces[1]?.id);
    await pluginStore(selected, f.store).write("test", { accessToken: "company" });
    await pluginSettings(selected, f.settings).write("test", { teamId: "T1" });
    await updateWorkspace(
      plugin,
      { type: "rename", service: "test", workspace: "company", name: "work" },
      f.settings,
    );
    const renamed = await selectWorkspace(plugin, "work", f.settings);
    await updateWorkspace(
      plugin,
      { type: "rename", service: "test", workspace: "default", name: "legacy" },
      f.settings,
    );
    await expect(
      updateWorkspace(plugin, { type: "add", service: "test", name: "default" }, f.settings),
    ).rejects.toThrow("already exists");
    expect(renamed.workspace?.id).toBe(id);
    expect(await pluginStore(renamed, f.store).read("test")).toHaveProperty(
      "accessToken",
      "company",
    );
    expect(await pluginSettings(renamed, f.settings).read("test")).toEqual({ teamId: "T1" });
    expect(await pluginSettings(legacy, f.settings).read("test")).toBeUndefined();
    expect(await pluginStore(legacy, f.store).read("test")).toHaveProperty("accessToken", "legacy");
    await updateWorkspace(
      plugin,
      { type: "default", service: "test", workspace: "work" },
      f.settings,
    );
    expect((await selectWorkspace(plugin, undefined, f.settings)).workspace?.id).toBe(id);
    expect((await selectWorkspace(plugin, "default", f.settings)).workspace?.legacy).toBe(true);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("workspace credentials, environment, workflow cache and plugin namespaces stay isolated", async () => {
  const f = await fixture();
  try {
    for (const name of ["one", "two"])
      await updateWorkspace(plugin, { type: "add", service: "test", name }, f.settings);
    const one = await selectWorkspace(plugin, "one", f.settings);
    const two = await selectWorkspace(plugin, "two", f.settings);
    await pluginStore(one, f.store).write("test", { accessToken: "same-token" });
    await pluginStore(two, f.store).write("test", { accessToken: "same-token" });
    const env = { TEST_TOKEN: "legacy-token", TEST_URL: "endpoint" };
    expect(pluginEnvironment(one, env)).toEqual({ TEST_URL: "endpoint" });
    expect(pluginEnvironment(await selectWorkspace(plugin, "default", f.settings), env)).toEqual(
      env,
    );
    const connection = await resolveConnection(one, env, f.store, undefined, f.settings);
    expect(connection.type === "http" && connection.headers?.Authorization).toBe(
      "Bearer same-token",
    );
    expect(await extensionCacheScope(one, env, f.store)).not.toBe(
      await extensionCacheScope(two, env, f.store),
    );
    expect(
      await pluginStore({ ...one, credentialNamespace: "plugin-other" }, f.store).read("test"),
    ).toBeUndefined();
    const named = await selectWorkspace(plugin, "two", f.settings);
    await pluginStore(named, f.store).delete("test");
    await expect(resolveConnection(named, env, f.store, undefined, f.settings)).rejects.toThrow(
      "Set TEST_TOKEN",
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("concurrent registry changes retain all workspaces and invalid selection fails closed", async () => {
  const f = await fixture();
  try {
    await Promise.all(
      ["one", "two"].map((name) =>
        updateWorkspace(plugin, { type: "add", service: "test", name }, f.settings),
      ),
    );
    expect((await readWorkspaces(plugin, f.settings)).workspaces).toHaveLength(3);
    await expect(
      updateWorkspace(plugin, { type: "add", service: "test", name: "one" }, f.settings),
    ).rejects.toThrow("already exists");
    await expect(
      updateWorkspace(plugin, { type: "add", service: "test", name: "../bad" }, f.settings),
    ).rejects.toThrow("Workspace names");
    await expect(selectWorkspace(plugin, "absent", f.settings)).rejects.toThrow("Unknown");
    const value: WorkspaceRegistry = await readWorkspaces(plugin, f.settings);
    delete value.defaultId;
    await f.settings.write("test-workspaces", value);
    await expect(selectWorkspace(plugin, undefined, f.settings)).rejects.toThrow("Select");
    await f.settings.write("test-workspaces", {
      workspaces: [{ id: "../../escape", name: "bad" }],
    });
    await expect(readWorkspaces(plugin, f.settings)).rejects.toThrow("Invalid workspace registry");
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("workspace management flags support short, long, inline and leading forms", () => {
  for (const flags of [["-w", "company"], ["--workspace", "company"], ["--workspace=company"]]) {
    expect(extractWorkspace(["slack", ...flags, "--xoxb"])).toEqual({
      args: ["slack", "--xoxb"],
      workspace: "company",
    });
    expect(leadingArguments([...flags, "--json", "slack", "search"])).toEqual({
      command: "slack",
      args: ["search", ...flags, "--json"],
    });
  }
  expect(() => extractWorkspace(["-w"])).toThrow("Missing value");
  expect(() => extractWorkspace(["-w", "one", "--workspace=two"])).toThrow("only once");
});
