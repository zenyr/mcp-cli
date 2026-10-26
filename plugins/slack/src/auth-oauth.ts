import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  AuthRequiredError,
  isRecord,
  UsageError,
  type AuthLoginOptions,
  type AuthSupportContext,
  type Tokens,
} from "@mcp-cli/core";
import { startLoopback } from "@mcp-cli/mcp";
import {
  readSlackSettings,
  readiness,
  slackFingerprint,
  slackSlot,
  type SlackProfile,
  type SlackTarget,
} from "./auth-config";

const endpoints = {
  mcp: {
    authorize: "https://slack.com/oauth/v2_user/authorize",
    token: "https://slack.com/api/oauth.v2.user.access",
  },
  web: {
    authorize: "https://slack.com/oauth/v2/authorize",
    token: "https://slack.com/api/oauth.v2.access",
  },
};
const messages: Record<string, string> = {
  pkce_not_allowed: "Enable PKCE for this Slack app before using browser login.",
  bad_redirect_uri: "Register this exact redirect URL in Slack OAuth & Permissions.",
  invalid_scope: "Check the requested user scopes in Slack OAuth & Permissions.",
  invalid_client_id: "Check the Slack Client ID.",
  bad_client_secret:
    "This Slack app rejected public-client authentication. Check its PKCE setting.",
  invalid_grant: "Slack rejected the refresh credential. Sign in again.",
  invalid_refresh_token: "Slack rejected the refresh credential. Sign in again.",
  token_revoked: "Slack revoked this credential. Sign in again.",
  token_expired: "Slack expired this credential. Sign in again.",
};
export class SlackCredentialError extends AuthRequiredError {}
export const postSlackToken = async (
  target: SlackTarget,
  body: URLSearchParams,
  request: typeof fetch,
  signal?: AbortSignal,
) => {
  let response: Response;
  try {
    response = await request(endpoints[target].token, {
      method: "POST",
      body,
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
  } catch {
    throw new Error("Slack token request did not complete. Check the network or cancel and retry.");
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("Slack returned an invalid token response.");
  }
  if (!response.ok || !isRecord(data) || data.ok !== true) {
    const code = isRecord(data) && typeof data.error === "string" ? data.error : "";
    const message =
      messages[code] ?? "Slack rejected authentication. Check app settings and workspace approval.";
    if (["invalid_grant", "invalid_refresh_token", "token_revoked", "token_expired"].includes(code))
      throw new SlackCredentialError(message);
    throw new Error(message);
  }
  return data;
};
const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
export const issuedTokens = (
  data: Record<string, unknown>,
  config: SlackProfile,
  fingerprint: string,
  previous?: Tokens,
): Tokens => {
  const user = isRecord(data.authed_user) ? data.authed_user : undefined;
  const issued = user && text(user.access_token) ? user : data;
  const accessToken = text(issued.access_token);
  const userId = text(user?.id);
  if (previous?.client?.userId && userId && previous.client.userId !== userId)
    throw new Error("Slack returned another user. Existing credentials were retained.");
  const team = isRecord(data.team) ? text(data.team.id) : undefined;
  if ((!previous && team !== config.teamId) || (team && team !== config.teamId))
    throw new Error("Slack returned another workspace. No credentials were saved.");
  if (data.app_id !== undefined && data.app_id !== config.appId)
    throw new Error("Slack returned another app. No credentials were saved.");
  if (
    !accessToken ||
    accessToken.startsWith("xoxb-") ||
    (issued.token_type !== undefined && !["user", "bearer"].includes(String(issued.token_type)))
  )
    throw new Error("Slack did not return a user token. No credentials were saved.");
  const expires = issued.expires_in;
  if (
    expires !== undefined &&
    (typeof expires !== "number" || !Number.isFinite(expires) || expires <= 0)
  )
    throw new Error("Slack returned an invalid token lifetime.");
  const refreshToken = text(issued.refresh_token);
  if (refreshToken && expires === undefined)
    throw new Error("Slack omitted the rotating token lifetime.");
  if (previous?.refreshToken && !refreshToken)
    throw new Error("Slack omitted the rotated refresh token. Existing credentials were retained.");
  return {
    accessToken,
    tokenType: "user",
    cacheIdentity: previous?.cacheIdentity ?? randomUUID(),
    ...(refreshToken && { refreshToken }),
    ...(typeof expires === "number" && { expiresAt: Date.now() + expires * 1000 }),
    scope: text(issued.scope) ?? text(user?.scope) ?? previous?.scope,
    client: {
      fingerprint,
      teamId: config.teamId,
      appId: config.appId,
      userId: userId ?? previous?.client?.userId,
    },
  };
};
export const currentProfile = async (context: AuthSupportContext, target: SlackTarget) => {
  const { configuration, revision } = await readSlackSettings(context);
  const config = configuration[target];
  if (config.method === "choose")
    throw new AuthRequiredError(
      "Automatic detection was removed. Choose token input or PKCE browser login in Slack settings.",
    );
  return { config, fingerprint: slackFingerprint(config, revision, target) };
};
export const requireMatching = (tokens: Tokens | undefined, fingerprint: string): Tokens => {
  if (!tokens) throw new AuthRequiredError("Sign in to this Slack target first.");
  if (tokens.client?.fingerprint !== fingerprint)
    throw new AuthRequiredError(
      "Slack settings changed. Sign in again for this app and workspace.",
    );
  if (tokens.client.reauth === true)
    throw new AuthRequiredError("Slack rejected this credential. Sign in again.");
  return tokens;
};
const active = new Set<SlackTarget>();
export const loginSlack = async (
  context: AuthSupportContext,
  target: SlackTarget,
  options: AuthLoginOptions,
  request: typeof fetch = fetch,
) => {
  if (options.credential === "xoxb")
    throw new UsageError(
      "Slack desktop browser login supports user tokens only. Paste a bot token instead.",
    );
  if (active.has(target)) throw new UsageError("Finish or cancel the existing Slack login first.");
  active.add(target);
  try {
    await context.store.withLock(`slack-login-${target}`, async () => {
      const { config, fingerprint } = await currentProfile(context, target);
      const reason = readiness(config, target);
      if (reason) throw new UsageError(reason);
      const redirect = new URL(config.redirectUri ?? "");
      const state = randomBytes(32).toString("base64url");
      const verifier = randomBytes(32).toString("base64url");
      const loopback = startLoopback(
        state,
        options.timeoutMs ?? 300000,
        Number(redirect.port),
        redirect.href,
      );
      const abort = () => loopback.stop();
      const slot = slackSlot(target);
      const epoch = randomUUID();
      try {
        options.signal?.throwIfAborted();
        options.signal?.addEventListener("abort", abort, { once: true });
        await context.store.withLock(slot, () =>
          context.store.write(`${slot}-attempt`, { accessToken: epoch }),
        );
        const url = new URL(endpoints[target].authorize);
        url.search = new URLSearchParams({
          client_id: config.clientId ?? "",
          redirect_uri: redirect.href,
          response_type: "code",
          state,
          code_challenge: createHash("sha256").update(verifier).digest("base64url"),
          code_challenge_method: "S256",
          team: config.teamId ?? "",
          [target === "mcp" ? "scope" : "user_scope"]: config.scopes?.join(",") ?? "",
          ...(target === "web" && { scope: "" }),
        }).toString();
        await options.ui.open(url.href);
        const cleanup = options.ui.manual?.(loopback.submit);
        const { code } = await loopback.response.finally(() => cleanup?.());
        const data = await postSlackToken(
          target,
          new URLSearchParams({
            client_id: config.clientId ?? "",
            grant_type: "authorization_code",
            code,
            code_verifier: verifier,
            redirect_uri: redirect.href,
          }),
          request,
          options.signal,
        );
        const tokens = issuedTokens(data, config, fingerprint);
        await context.store.withLock(slot, async () => {
          options.signal?.throwIfAborted();
          if (
            (await currentProfile(context, target)).fingerprint !== fingerprint ||
            (await context.store.read(`${slot}-attempt`))?.accessToken !== epoch
          )
            throw new Error("Slack settings or login state changed. Sign in again.");
          await context.store.write(slot, tokens);
        });
      } finally {
        options.signal?.removeEventListener("abort", abort);
        loopback.stop();
      }
    });
  } finally {
    active.delete(target);
  }
};

export const slackOAuthHeaders = async (
  context: AuthSupportContext,
  target: SlackTarget,
  force = false,
  request: typeof fetch = fetch,
) => {
  const slot = slackSlot(target);
  const initial = await currentProfile(context, target);
  const seen = requireMatching(await context.store.read(slot), initial.fingerprint);
  const expired = (tokens: Tokens) =>
    tokens.expiresAt !== undefined && tokens.expiresAt <= Date.now() + 60000;
  if (!force && !expired(seen)) return { Authorization: `Bearer ${seen.accessToken}` };
  return context.store.withLock(slot, async () => {
    const { config, fingerprint } = await currentProfile(context, target);
    const latest = requireMatching(await context.store.read(slot), fingerprint);
    if ((!force || latest.accessToken !== seen.accessToken) && !expired(latest))
      return { Authorization: `Bearer ${latest.accessToken}` };
    if (!latest.refreshToken) throw new AuthRequiredError("Slack access expired. Sign in again.");
    try {
      const data = await postSlackToken(
        target,
        new URLSearchParams({
          client_id: config.clientId ?? "",
          grant_type: "refresh_token",
          refresh_token: latest.refreshToken,
        }),
        request,
      );
      const next = issuedTokens(data, config, fingerprint, latest);
      if ((await currentProfile(context, target)).fingerprint !== fingerprint)
        throw new AuthRequiredError("Slack settings changed during refresh. Sign in again.");
      await context.store.write(slot, next);
      return { Authorization: `Bearer ${next.accessToken}` };
    } catch (error) {
      if (error instanceof SlackCredentialError)
        await context.store.write(slot, { ...latest, client: { ...latest.client, reauth: true } });
      throw error;
    }
  });
};
