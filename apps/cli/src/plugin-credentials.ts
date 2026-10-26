import type { ServicePlugin, SettingsStore, TokenStore } from "@mcp-cli/core";

export const pluginEnvironment = (
  plugin: ServicePlugin,
  env: Record<string, string | undefined>,
) => (plugin.credentialNamespace ? {} : env);

export const pluginStore = (plugin: ServicePlugin, store: TokenStore): TokenStore => {
  const prefix = plugin.credentialNamespace;
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
  const prefix = plugin.credentialNamespace;
  if (!prefix) return store;
  const name = (value: string) => `${prefix}-${value}`;
  return {
    read: (key) => store.read(name(key)),
    write: (key, value) => store.write(name(key), value),
    withLock: (key, run) => store.withLock(name(key), run),
  };
};
