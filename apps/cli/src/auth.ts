import { fileTokenStore } from "@mcp-cli/auth";
import {
  AuthRequiredError,
  UsageError,
  credentialName,
  credentialSwitches,
  type ApiKeySpec,
  type Connection,
  type ServicePlugin,
  type TokenStore,
} from "@mcp-cli/core";
import { createInterface } from "node:readline";
import { login, oauthAuthorize } from "@mcp-cli/mcp";

type Env = Record<string, string | undefined>;
export type AuthContext = {
  env: Env;
  store: TokenStore;
  plugin: (name: string) => Promise<ServicePlugin>;
  writeError: (text: string) => void;
  /** Shows the authorization URL; `browser` says whether a local browser may be launched. */
  open: (url: string, browser: boolean) => void | Promise<void>;
  /** Reads hand-copied redirect URLs, for logins finished in a browser on another machine. */
  manual?: (submit: (input: string) => void) => () => void;
  /** Reads an API key without echoing it. */
  readSecret: (prompt: string) => Promise<string>;
};

export const defaultStore = (env: Env = process.env): TokenStore => fileTokenStore({ env });

type KeyChoice = { env: string; credential?: string };
// Picks the base key or the alternate named by a credential switch such as `xoxb`.
const keyChoice = (spec: ApiKeySpec, service: string, credential?: string): KeyChoice => {
  if (!credential) return { env: spec.env };
  const alternate = spec.alternates?.find((item) => item.flag === credential);
  if (!alternate) throw new UsageError(`${service} has no --${credential} credential`);
  return { env: alternate.env, credential: alternate.base ? undefined : credential };
};

export const authCredentialName = (plugin: ServicePlugin, credential?: string): string =>
  credentialName(
    plugin.name,
    plugin.auth?.type === "apiKey"
      ? keyChoice(plugin.auth, plugin.name, credential).credential
      : credential,
  );

// An explicit environment variable wins over the key stored by `mcp-cli login`.
const apiKey = async (
  spec: ApiKeySpec,
  env: Env,
  store: TokenStore,
  service: string,
  credential?: string,
): Promise<string> => {
  const choice = keyChoice(spec, service, credential);
  const key =
    env[choice.env] || (await store.read(credentialName(service, choice.credential)))?.accessToken;
  const login = `mcp-cli login ${service}${credential ? ` --${credential}` : ""}`;
  if (!key) throw new AuthRequiredError(`Set ${choice.env} or run ${login} to use ${service}`);
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
  credential?: string,
): Promise<Connection> => {
  const connection = await plugin.connection(env);
  const auth = plugin.auth;
  if (credential && auth?.type !== "apiKey")
    throw new UsageError(`${plugin.name} has no --${credential} credential`);
  if (!auth || auth.type === "none") return connection;
  if (connection.type === "stdio") {
    if (auth.type !== "apiKey") return connection;
    return {
      ...connection,
      env: {
        ...connection.env,
        [auth.env]: await apiKey(auth, env, store, plugin.name, credential),
      },
    };
  }
  if (connection.authorize) return connection;
  if (auth.type === "apiKey")
    return {
      ...connection,
      headers: {
        ...connection.headers,
        ...apiKeyHeaders(auth, await apiKey(auth, env, store, plugin.name, credential)),
      },
    };
  return {
    ...connection,
    authorize: oauthAuthorize({ service: plugin.name, url: connection.url, store }),
  };
};

type ServiceArguments = { service: string; flags: string[] };
const serviceArguments = (command: string, args: string[]): ServiceArguments => {
  const flags = args.filter((arg) => arg.startsWith("--")).map((arg) => arg.slice(2));
  const [name, ...rest] = args.filter((arg) => !arg.startsWith("--"));
  if (!name || rest.length) throw new UsageError(`Usage: mcp-cli ${command} <service>`);
  return { service: name, flags };
};

// Returns the credential switch among the flags and rejects every flag the command does not know.
const credentialFlag = (
  plugin: ServicePlugin,
  flags: string[],
  allowed: string[],
): string | undefined => {
  const switches = credentialSwitches(plugin.auth).map((alternate) => alternate.flag);
  for (const flag of flags)
    if (!allowed.includes(flag) && !switches.includes(flag))
      throw new UsageError(`Unknown option --${flag} for ${plugin.name}`);
  const chosen = [...new Set(flags.filter((flag) => switches.includes(flag)))];
  if (chosen.length > 1) throw new UsageError("Use only one credential flag");
  return chosen[0];
};

/** Headless sessions skip the browser launch and rely on the printed URL plus a pasted redirect. */
export const canOpenBrowser = (env: Env, platform: NodeJS.Platform = process.platform): boolean => {
  if (env.MCP_CLI_NO_BROWSER === "1" || env.SSH_CONNECTION || env.SSH_TTY) return false;
  if (platform === "linux") return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
  return true;
};

const saveApiKey = async (
  plugin: ServicePlugin,
  spec: ApiKeySpec,
  credential: string | undefined,
  context: AuthContext,
): Promise<void> => {
  const choice = keyChoice(spec, plugin.name, credential);
  const key = (await context.readSecret(`Paste the ${choice.env} value (input hidden): `)).trim();
  if (!key) throw new UsageError("No key was entered");
  const name = credentialName(plugin.name, choice.credential);
  await context.store.withLock(name, () => context.store.write(name, { accessToken: key }));
  context.writeError(`Saved ${choice.env} for ${plugin.name}; a set ${choice.env} still wins`);
};

export const loginCommand = async (args: string[], context: AuthContext): Promise<void> => {
  const parsed = serviceArguments("login [--no-browser]", args);
  const plugin = await context.plugin(parsed.service);
  const credential = credentialFlag(plugin, parsed.flags, ["no-browser"]);
  const browser = !parsed.flags.includes("no-browser") && canOpenBrowser(context.env);
  const auth = plugin.auth;
  if (auth?.type === "apiKey") return saveApiKey(plugin, auth, credential, context);
  if (auth?.type !== "oauth") throw new UsageError(`${plugin.name} does not use login`);
  const connection = await plugin.connection(context.env);
  if (connection.type !== "http")
    throw new UsageError(`${plugin.name} does not use an HTTP connection`);
  await login({
    service: plugin.name,
    url: connection.url,
    spec: auth,
    store: context.store,
    ui: {
      open: (url) => context.open(url, browser),
      ...(context.manual && { manual: context.manual }),
    },
  });
  context.writeError(`Logged in to ${plugin.name}`);
};

export const logoutCommand = async (args: string[], context: AuthContext): Promise<void> => {
  const parsed = serviceArguments("logout", args);
  const plugin = await context.plugin(parsed.service);
  const name = authCredentialName(plugin, credentialFlag(plugin, parsed.flags, []));
  const { store } = context;
  const removed = await store.withLock(name, async () => {
    const existing = await store.read(name).catch(() => true);
    await store.delete(name);
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

export const openInBrowser =
  (writeError: (text: string) => void) => (url: string, browser: boolean) => {
    writeError(
      `Open this URL in any browser to log in:\n${url}\n\nAfter approval the browser goes to http://127.0.0.1:.../callback.\nIf that page does not load (for example on another device), copy its full address and paste it here.`,
    );
    const opener = openers[process.platform];
    if (!browser || !opener || !process.stderr.isTTY) return;
    try {
      Bun.spawn([...opener, url], { stdio: ["ignore", "ignore", "ignore"] });
    } catch {
      // Printing the URL is enough when no browser opener is available.
    }
  };

/** Feeds each stdin line to the login as a pasted redirect URL until the login ends. */
export const stdinRedirects = (submit: (input: string) => void): (() => void) => {
  const lines = createInterface({ input: process.stdin, terminal: false });
  lines.on("line", submit);
  return () => {
    lines.close();
    process.stdin.pause();
  };
};
