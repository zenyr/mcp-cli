import type { ServicePlugin, SettingsStore, TokenStore } from "@mcp-cli/core";

/** Drops the plugin's credential env vars outside the legacy workspace. */
export const workspaceEnvironment = (
  plugin: ServicePlugin,
  env: Record<string, string | undefined>,
) => {
  if (!plugin.workspace || plugin.workspace.legacy) return env;
  const secrets = new Set(plugin.workspaces?.credentialEnv ?? []);
  return Object.fromEntries(Object.entries(env).filter(([key]) => !secrets.has(key)));
};

export const pluginEnvironment = (
  plugin: ServicePlugin,
  env: Record<string, string | undefined>,
) => (plugin.credentialNamespace ? {} : workspaceEnvironment(plugin, env));

const namespace = (plugin: ServicePlugin): string | undefined =>
  [
    plugin.credentialNamespace,
    plugin.workspace && !plugin.workspace.legacy ? `workspace-${plugin.workspace.id}` : undefined,
  ]
    .filter(Boolean)
    .join("-") || undefined;

export const pluginStore = (plugin: ServicePlugin, store: TokenStore): TokenStore => {
  const prefix = namespace(plugin);
  if (!prefix) return store;
  const name = (value: string) => `${prefix}-${value}`;
  return {
    read: (key) => store.read(name(key)),
    write: (key, value) => store.write(name(key), value),
    delete: (key) => store.delete(name(key)),
    withLock: (key, run) => store.withLock(name(key), run),
  };
};

export const pluginSettings = (plugin: ServicePlugin, store: SettingsStore): SettingsStore => {
  const prefix = namespace(plugin);
  if (!prefix) return store;
  const name = (value: string) => `${prefix}-${value}`;
  return {
    read: (key) => store.read(name(key)),
    write: (key, value) => store.write(name(key), value),
    withLock: (key, run) => store.withLock(name(key), run),
  };
};
