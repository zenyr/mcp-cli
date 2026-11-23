import {
  AuthRequiredError,
  UsageError,
  credentialName,
  isRecord,
  type AuthStatus,
  type AuthSupport,
  type AuthSupportContext,
} from "@mcp-cli/core";

export const SERVICE = "demo-auth";
const targets = ["mcp", "web"] as const;
type Target = (typeof targets)[number];
type Method = { method: "token" | "pkce"; pkceEnabled?: boolean };
type Configuration = Record<Target, Method>;
const defaults: Configuration = { mcp: { method: "token" }, web: { method: "token" } };

const method = (value: unknown): Method => {
  if (!isRecord(value) || (value.method !== "token" && value.method !== "pkce"))
    throw new UsageError("Each target needs method token or pkce.");
  return {
    method: value.method,
    ...(typeof value.pkceEnabled === "boolean" && { pkceEnabled: value.pkceEnabled }),
  };
};
const decode = (value: unknown): Configuration => {
  if (!isRecord(value)) throw new UsageError("Configuration must be an object.");
  return { mcp: method(value.mcp ?? defaults.mcp), web: method(value.web ?? defaults.web) };
};
const configuration = async (context: AuthSupportContext): Promise<Configuration> => {
  const stored = await context.settings.read(SERVICE);
  return stored ? decode(stored.configuration) : defaults;
};
const slot = (target?: string): string => (target === "web" ? `${SERVICE}--web` : SERVICE);
const variable = (credential?: string): string =>
  credential === "bot" ? "DEMO_AUTH_BOT_TOKEN" : "DEMO_AUTH_TOKEN";

const headers = async (context: AuthSupportContext, credential?: string) => {
  const environment = context.env[variable(credential)];
  if (environment) return { Authorization: `Bearer ${environment}` };
  const name = credentialName(SERVICE, credential === "bot" ? "bot" : undefined);
  const token = await context.store.read(name);
  if (!token) throw new AuthRequiredError(`Set ${variable(credential)} or paste a token.`);
  return { Authorization: `Bearer ${token.accessToken}` };
};

/** A minimal AuthSupport that exercises every host contract method without a real provider. */
export const demoAuthSupport: AuthSupport = {
  fields: [
    {
      path: ["mcp", "method"],
      label: "MCP method",
      type: "select",
      optionsSource: { label: "Load methods", dependencies: [["mcp", "method"]] },
    },
  ],
  loadOptions: async (_context, input) => {
    const config = decode(input.configuration);
    return [{ value: config.mcp.method, label: config.mcp.method }];
  },
  configuration: async (context) => ({ ...(await configuration(context)) }),
  configure: async (context, value) => {
    const decoded = decode(value);
    await context.settings.withLock(SERVICE, () =>
      context.settings.write(SERVICE, { configuration: decoded }),
    );
  },
  status: async (context) =>
    Promise.all(
      targets.map(async (target): Promise<AuthStatus> => {
        if (context.env.DEMO_AUTH_TOKEN)
          return { target, state: "stored", detail: "Environment token takes precedence." };
        if (await context.store.read(slot(target)))
          return { target, state: "stored", detail: "Token saved." };
        return { target, state: "missing", detail: "Paste a token." };
      }),
    ),
  login: async (context, options) => {
    const config = (await configuration(context))[options.target === "web" ? "web" : "mcp"];
    if (config.method !== "pkce" || config.pkceEnabled !== true)
      throw new UsageError("Browser login requires PKCE settings with pkceEnabled.");
    throw new UsageError("demo-auth does not implement a browser provider.");
  },
  logout: async (context, selection) => {
    const name = slot(selection.target);
    await context.store.withLock(name, () => context.store.delete(name));
  },
  resolve: async (context, connection, credential) => {
    if (credential && !["user", "bot"].includes(credential))
      throw new UsageError("Unknown demo-auth credential selection.");
    if (connection.type !== "http" || !(await context.settings.read(SERVICE))) return undefined;
    const authorize = () => headers(context, credential);
    return {
      ...connection,
      authorize,
      ...(connection.webApi && { webApi: { ...connection.webApi, authorize } }),
    };
  },
  identity: async (context, credential) => {
    const environment = context.env[variable(credential)];
    if (environment) return { credential: credential ?? "user", environment };
    const name = credentialName(SERVICE, credential === "bot" ? "bot" : undefined);
    return {
      credential: credential ?? "user",
      identity: (await context.store.read(name))?.accessToken,
    };
  },
};
