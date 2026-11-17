import { UsageError, type AuthStatus, type AuthSupport, type Tokens } from "@mcp-cli/core";
import { login, oauthAuthorize } from "@mcp-cli/mcp";

export const SERVICE = "pplx";
export const KEY_ENV = "PERPLEXITY_API_KEY";
const TARGET = "oauth";
const SCOPES = ["perplexity_api", "offline_access"];

type Env = Record<string, string | undefined>;
export const serverUrl = (env: Env): string =>
  env.PERPLEXITY_MCP_URL ?? "https://api.perplexity.ai/mcp";

// Browser logins persist a client record for refresh, while pasted API keys store only the key.
const isOAuth = (tokens: Tokens | undefined): boolean => tokens?.client !== undefined;

const state = (env: Env, tokens: Tokens | undefined): AuthStatus => {
  if (env[KEY_ENV])
    return { target: TARGET, state: "configured", detail: `${KEY_ENV} takes precedence.` };
  if (isOAuth(tokens)) return { target: TARGET, state: "stored", detail: "Browser login saved." };
  if (tokens)
    return { target: TARGET, state: "stored", detail: "API key saved. Browser login replaces it." };
  return { target: TARGET, state: "missing", detail: "Log in with a browser or save an API key." };
};

/** Adds browser OAuth next to the host's API key login; both share one slot, so the latest login wins. */
export const perplexityAuth: AuthSupport = {
  configuration: async () => ({}),
  configure: async () => {
    throw new UsageError(`${SERVICE} has no authentication settings.`);
  },
  status: async (context) => [state(context.env, await context.store.read(SERVICE))],
  login: async (context, options) => {
    await login({
      service: SERVICE,
      url: serverUrl(context.env),
      spec: { type: "oauth", scopes: SCOPES, clientName: "mcp-cli" },
      store: context.store,
      ui: options.ui,
      ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
    });
  },
  logout: async ({ store }) =>
    store.withLock(SERVICE, async () => {
      if (isOAuth(await store.read(SERVICE))) await store.delete(SERVICE);
    }),
  resolve: async (context, connection) => {
    if (connection.type !== "http" || context.env[KEY_ENV]) return undefined;
    if (!isOAuth(await context.store.read(SERVICE))) return undefined;
    const authorize = oauthAuthorize({
      service: SERVICE,
      url: connection.url,
      store: context.store,
    });
    return { ...connection, authorize };
  },
  identity: async (context) =>
    context.env[KEY_ENV] ?? (await context.store.read(SERVICE))?.accessToken,
};
