import { randomUUID } from "node:crypto";
import {
  AuthRequiredError,
  UsageError,
  isRecord,
  loginCommandText,
  type AuthStatus,
  type AuthSupport,
  type AuthSupportContext,
} from "@mcp-cli/core";
import { connect } from "@mcp-cli/mcp";
import {
  decodeSlackConfiguration,
  readSlackSettings,
  readiness,
  slackSlot,
  slackTarget,
  type SlackTarget,
} from "./auth-config";
import {
  currentProfile,
  loginSlack,
  requireMatching,
  slackOAuthHeaders,
  withLoginHint,
} from "./auth-oauth";

export const createSlackAuth = (request: typeof fetch = fetch): AuthSupport => {
  const headers = async (
    context: AuthSupportContext,
    target: SlackTarget,
    credential?: string,
    refresh = false,
  ) => {
    const bot = credential === "xoxb";
    const variable = bot ? "SLACK_MCP_BOT_TOKEN" : "SLACK_MCP_TOKEN";
    const environment = context.env[variable];
    if (environment) return { Authorization: `Bearer ${environment}` };
    if (!bot && (await currentProfile(context, target)).config.method === "pkce")
      return slackOAuthHeaders(context, target, refresh, request).catch((error: unknown) => {
        throw withLoginHint(error, context, target);
      });
    const token = await context.store.read(bot ? "slack--xoxb" : "slack");
    // A selected workspace gets its own login hint because named workspaces drop the host variable.
    const login = loginCommandText("slack", {
      workspace: context.workspace,
      credential: bot ? "xoxb" : undefined,
    });
    if (!token)
      throw new AuthRequiredError(
        context.workspace
          ? `Run ${login} to paste a Slack ${bot ? "bot" : "user"} token.`
          : `Set ${variable} or run ${login} to paste a Slack ${bot ? "bot" : "user"} token.`,
      );
    return { Authorization: `Bearer ${token.accessToken}` };
  };
  return {
    configuration: async (context) => ({ ...(await readSlackSettings(context)).configuration }),
    configure: async (context, value) => {
      const configuration = decodeSlackConfiguration(value);
      await context.settings.withLock("slack", () =>
        context.settings.write("slack", { configuration, revision: randomUUID() }),
      );
    },
    login: (context, options) => loginSlack(context, slackTarget(options.target), options, request),
    logout: async (context, selection) => {
      const slot = slackSlot(slackTarget(selection.target));
      await context.store.withLock(slot, async () => {
        await context.store.write(`${slot}-attempt`, { accessToken: randomUUID() });
        await context.store.delete(slot);
      });
    },
    resolve: async (context, connection, credential) => {
      if (credential && !["xoxp", "xoxb"].includes(credential))
        throw new UsageError("Unknown Slack credential selection.");
      if (connection.type !== "http" || !(await context.settings.read("slack"))) return undefined;
      if (connection.url !== "https://mcp.slack.com/mcp")
        throw new AuthRequiredError(
          "Configured Slack authentication requires the official Slack MCP endpoint. Remove the custom endpoint or use legacy token settings.",
        );
      const web = (await readSlackSettings(context)).configuration.web;
      return {
        ...connection,
        authorize: ({ refresh }) => headers(context, "mcp", credential, refresh),
        ...(connection.webApi && {
          webApi: {
            ...connection.webApi,
            authorize: ({ refresh }) => headers(context, "web", credential, refresh),
            ...(credential !== "xoxb" &&
              !context.env.SLACK_MCP_TOKEN &&
              web.method === "pkce" && { tokenKind: "user" as const }),
          },
        }),
      };
    },
    identity: async (context, credential) => {
      const bot = credential === "xoxb";
      const environment = context.env[bot ? "SLACK_MCP_BOT_TOKEN" : "SLACK_MCP_TOKEN"];
      if (environment) return { credential: bot ? "xoxb" : "xoxp", environment };
      const settings = await readSlackSettings(context);
      const names = bot
        ? ["slack--xoxb"]
        : [
            ...new Set(
              (["mcp", "web"] as const).map((target) =>
                settings.configuration[target].method === "pkce" ? slackSlot(target) : "slack",
              ),
            ),
          ];
      const identities = await Promise.all(
        names.map(async (name) => {
          const tokens = await context.store.read(name);
          return tokens?.cacheIdentity ?? tokens?.accessToken;
        }),
      );
      return {
        settings,
        credential: bot ? "xoxb" : "xoxp",
        identities,
      };
    },
    status: async (context, check) =>
      Promise.all(
        (["mcp", "web"] as const).map(async (target): Promise<AuthStatus> => {
          try {
            const environment = Boolean(context.env.SLACK_MCP_TOKEN);
            const { config, fingerprint } = environment
              ? {
                  config: (await readSlackSettings(context)).configuration[target],
                  fingerprint: "",
                }
              : await currentProfile(context, target);
            let status: AuthStatus;
            if (environment)
              status = {
                target,
                state: "stored",
                detail: "Environment token takes precedence; connection is not yet verified.",
              };
            else if (config.method === "pkce") {
              const reason = readiness(config, target);
              if (reason) return { target, state: "configured", detail: reason };
              const tokens = await context.store.read(slackSlot(target));
              if (!tokens)
                return {
                  target,
                  state: "configured",
                  detail: "Settings registered. Sign in to verify access.",
                };
              requireMatching(tokens, fingerprint);
              if (
                tokens.expiresAt !== undefined &&
                tokens.expiresAt <= Date.now() &&
                !tokens.refreshToken
              )
                return { target, state: "expired", detail: "Access expired. Sign in again." };
              status = {
                target,
                state: "stored",
                detail: "User credential saved; connection is not yet verified.",
              };
            } else {
              if (!(await context.store.read("slack")))
                return {
                  target,
                  state: "missing",
                  detail: "Paste a user token or configure browser login.",
                };
              status = {
                target,
                state: "stored",
                detail: "User token saved; connection is not yet verified.",
              };
            }
            if (!check) return status;
            const authorization = await headers(context, target);
            if (target === "mcp") {
              const session = await connect(
                {
                  type: "http",
                  url: "https://mcp.slack.com/mcp",
                  authorize: ({ refresh }) => headers(context, target, undefined, refresh),
                },
                { timeoutMs: 10000 },
              );
              try {
                await session.listTools();
              } finally {
                await session.close();
              }
            } else {
              const response = await request("https://slack.com/api/auth.test", {
                method: "POST",
                headers: authorization,
                signal: AbortSignal.timeout(10000),
                redirect: "error",
              });
              const data: unknown = await response.json();
              if (!response.ok || !isRecord(data) || data.ok !== true)
                throw new AuthRequiredError(
                  "Slack rejected this token. Check its validity and workspace permissions.",
                );
              if (config.method === "pkce" && !environment && data.team_id !== config.teamId)
                throw new AuthRequiredError("Slack returned another workspace. Sign in again.");
            }
            return {
              target,
              state: "connected",
              detail:
                "Read-only connection check succeeded just now; individual operations still require their scopes.",
            };
          } catch (error) {
            return {
              target,
              state: error instanceof AuthRequiredError ? "reauth" : "failed",
              detail:
                error instanceof AuthRequiredError
                  ? error.message
                  : "Connection check failed. Check network, app approval, scopes, and MCP access.",
            };
          }
        }),
      ),
  };
};
