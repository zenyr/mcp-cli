import {
  OAuthError,
  OAuthErrorCode,
  refreshAuthorization,
  type FetchLike,
} from "@modelcontextprotocol/client";
import {
  AuthRequiredError,
  loginRequired,
  type Authorize,
  type TokenStore,
  type Tokens,
} from "@mcp-cli/core";
import { clientInformation, decodeClient, serverMetadata, toTokens } from "./oauth-client";

export type OAuthAuthorizeOptions = {
  service: string;
  /** MCP server URL; stored credentials issued for another URL require a new login. */
  url: string;
  store: TokenStore;
  fetchFn?: FetchLike;
  now?: () => number;
  /** Tokens expiring within this window are refreshed before use. */
  skewMs?: number;
};

const rejectedGrant = (error: unknown): boolean =>
  error instanceof OAuthError &&
  (error.code === OAuthErrorCode.InvalidGrant || error.code === OAuthErrorCode.InvalidClient);

const bearer = (tokens: Tokens): Record<string, string> => ({
  Authorization: `Bearer ${tokens.accessToken}`,
});

/** Reads stored tokens per request and refreshes them under the store lock when expired or rejected. */
export const oauthAuthorize = (options: OAuthAuthorizeOptions): Authorize => {
  const { service, url, store } = options;
  const now = options.now ?? Date.now;
  const skew = options.skewMs ?? 60000;
  const expired = (tokens: Tokens) =>
    tokens.expiresAt !== undefined && tokens.expiresAt - skew <= now();
  const load = async (): Promise<Tokens> => {
    const tokens = await store.read(service);
    if (!tokens) throw loginRequired(service, `No credentials for ${service}`);
    // Never send a token to a server other than the one it was issued for.
    const issuedFor = decodeClient(tokens.client)?.serverUrl;
    if (issuedFor !== undefined && issuedFor !== url)
      throw loginRequired(service, `Stored ${service} credentials belong to ${issuedFor}`);
    return tokens;
  };
  const refresh = async (tokens: Tokens): Promise<Tokens> => {
    const record = decodeClient(tokens.client);
    if (!record) throw loginRequired(service, `Stored ${service} credentials cannot be refreshed`);
    if (!tokens.refreshToken) throw loginRequired(service, `${service} access token expired`);
    const refreshed = await refreshAuthorization(record.authorizationServer, {
      metadata: serverMetadata(record),
      clientInformation: clientInformation(record),
      refreshToken: tokens.refreshToken,
      resource: record.resource,
      fetchFn: options.fetchFn,
    }).catch((error: unknown) => {
      if (rejectedGrant(error))
        throw loginRequired(service, `${service} rejected the stored refresh token`);
      throw error;
    });
    const next = {
      ...toTokens(refreshed, record, now()),
      ...(tokens.cacheIdentity ? { cacheIdentity: tokens.cacheIdentity } : {}),
    };
    await store.write(service, next);
    return next;
  };
  return async (request) => {
    const seen = await load();
    if (!request.refresh && !expired(seen)) return bearer(seen);
    return store.withLock(service, async () => {
      const latest = await load();
      // Another process already rotated the tokens this request saw.
      if (latest.accessToken !== seen.accessToken && !expired(latest)) return bearer(latest);
      if (!request.refresh && !expired(latest)) return bearer(latest);
      return bearer(await refresh(latest));
    });
  };
};

/** Finds an auth failure the SDK wrapped while connecting so callers see the login hint directly. */
export const authFailure = (error: unknown): AuthRequiredError | undefined => {
  for (let current = error, depth = 0; current instanceof Error && depth < 5; depth += 1) {
    if (current instanceof AuthRequiredError) return current;
    current = current.cause;
  }
  return undefined;
};
