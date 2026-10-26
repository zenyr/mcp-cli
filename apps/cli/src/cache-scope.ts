import { createHash, randomUUID } from "node:crypto";
import { credentialName, loginRequired, type ServicePlugin, type TokenStore } from "@mcp-cli/core";
import { defaultSettings } from "./auth";
import { pluginEnvironment, pluginSettings, pluginStore } from "./plugin-credentials";

export const extensionCacheScope = async (
  plugin: ServicePlugin,
  env: Record<string, string | undefined>,
  store: TokenStore,
  credential?: string,
): Promise<string> => {
  const settings = pluginSettings(plugin, defaultSettings(env));
  store = pluginStore(plugin, store);
  env = pluginEnvironment(plugin, env);
  const connection = await plugin.connection(env);
  const endpoint = connection.type === "http" ? connection.url : connection.command;
  const alternate =
    plugin.auth?.type === "apiKey"
      ? plugin.auth.alternates?.find((item) => item.flag === credential)
      : undefined;
  const name = credentialName(plugin.name, alternate?.base ? undefined : credential);
  const auth = plugin.auth;
  let identity: unknown = name;
  if (plugin.authSupport) {
    identity = await plugin.authSupport.identity({ env, store, settings }, credential);
  } else if (connection.type === "http" && connection.authorize) {
    identity = await connection.authorize({ refresh: false });
  } else if (auth?.type === "oauth") {
    identity = await store.withLock(name, async () => {
      const tokens = await store.read(name);
      if (!tokens) throw loginRequired(name, "No credentials for workflow cache");
      if (tokens.cacheIdentity) return tokens.cacheIdentity;
      const cacheIdentity = randomUUID();
      await store.write(name, { ...tokens, cacheIdentity });
      return cacheIdentity;
    });
  } else if (auth?.type === "apiKey") {
    const variable = credential
      ? auth.alternates?.find((item) => item.flag === credential)?.env
      : auth.env;
    identity = (variable ? env[variable] : undefined) ?? (await store.read(name))?.accessToken;
  }
  return createHash("sha256").update(JSON.stringify({ endpoint, name, identity })).digest("hex");
};
