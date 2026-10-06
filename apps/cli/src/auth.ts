import { fileTokenStore } from "@mcp-cli/auth";
import {
  AuthRequiredError,
  UsageError,
  type ApiKeySpec,
  type Connection,
  type ServicePlugin,
  type TokenStore,
} from "@mcp-cli/core";
import { login, oauthAuthorize } from "@mcp-cli/mcp";

type Env = Record<string, string | undefined>;
export type AuthContext = {
  env: Env;
  store: TokenStore;
  plugin: (name: string) => Promise<ServicePlugin>;
  writeError: (text: string) => void;
  /** Shows the authorization URL; the CLI prints it and tries to open a browser. */
  open: (url: string) => void | Promise<void>;
};

export const defaultStore = (env: Env = process.env): TokenStore => fileTokenStore({ env });

const apiKey = (spec: ApiKeySpec, env: Env, service: string): string => {
  const key = env[spec.env];
  if (!key) throw new AuthRequiredError(`Set ${spec.env} to use ${service}`);
  return key;
};

/** Without an explicit header, the key is sent as `Authorization: Bearer <key>`. */
export const apiKeyHeaders = (spec: ApiKeySpec, key: string): Record<string, string> => {
  const scheme = spec.scheme ?? (spec.header === undefined ? "Bearer" : undefined);
  return { [spec.header ?? "Authorization"]: scheme ? `${scheme} ${key}` : key };
};

/** Applies the plugin's declared auth unless its connection already supplies `authorize`. */
export const resolveConnection = async (
  plugin: ServicePlugin,
  env: Env,
  store: TokenStore,
): Promise<Connection> => {
  const connection = await plugin.connection(env);
  const auth = plugin.auth;
  if (!auth || auth.type === "none") return connection;
  if (connection.type === "stdio") {
    if (auth.type !== "apiKey") return connection;
    return {
      ...connection,
      env: { ...connection.env, [auth.env]: apiKey(auth, env, plugin.name) },
    };
  }
  if (connection.authorize) return connection;
  if (auth.type === "apiKey")
    return {
      ...connection,
      headers: { ...connection.headers, ...apiKeyHeaders(auth, apiKey(auth, env, plugin.name)) },
    };
  return {
    ...connection,
    authorize: oauthAuthorize({ service: plugin.name, url: connection.url, store }),
  };
};

const serviceArgument = (command: string, args: string[]): string => {
  const [name, ...rest] = args;
  if (!name || name.startsWith("-") || rest.length)
    throw new UsageError(`Usage: mcp-cli ${command} <service>`);
  return name;
};

export const loginCommand = async (args: string[], context: AuthContext): Promise<void> => {
  const plugin = await context.plugin(serviceArgument("login", args));
  const auth = plugin.auth;
  if (auth?.type === "apiKey")
    throw new UsageError(`${plugin.name} uses an API key. Set ${auth.env} instead of logging in`);
  if (auth?.type !== "oauth") throw new UsageError(`${plugin.name} does not use OAuth login`);
  const connection = await plugin.connection(context.env);
  if (connection.type !== "http")
    throw new UsageError(`${plugin.name} does not use an HTTP connection`);
  await login({
    service: plugin.name,
    url: connection.url,
    spec: auth,
    store: context.store,
    ui: { open: context.open },
  });
  context.writeError(`Logged in to ${plugin.name}`);
};

export const logoutCommand = async (args: string[], context: AuthContext): Promise<void> => {
  const plugin = await context.plugin(serviceArgument("logout", args));
  const { store } = context;
  const removed = await store.withLock(plugin.name, async () => {
    const existing = await store.read(plugin.name).catch(() => true);
    await store.delete(plugin.name);
    return existing !== undefined;
  });
  context.writeError(
    removed ? `Logged out of ${plugin.name}` : `No stored credentials for ${plugin.name}`,
  );
};

const openers: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: ["open"],
  linux: ["xdg-open"],
  win32: ["cmd", "/c", "start", ""],
};

export const openInBrowser = (writeError: (text: string) => void) => (url: string) => {
  writeError(`Open this URL to log in:\n${url}`);
  const opener = openers[process.platform];
  if (!opener || !process.stderr.isTTY) return;
  try {
    Bun.spawn([...opener, url], { stdio: ["ignore", "ignore", "ignore"] });
  } catch {
    // Printing the URL is enough when no browser opener is available.
  }
};
