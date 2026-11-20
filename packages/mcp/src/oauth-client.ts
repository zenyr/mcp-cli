import {
  OAuthError,
  OAuthErrorCode,
  type AuthorizationServerMetadata,
  type FetchLike,
  type OAuthClientInformationMixed,
  type OAuthTokens,
} from "@modelcontextprotocol/client";
import { isRecord, type Tokens } from "@mcp-cli/core";

/** Registration and endpoints persisted in `Tokens.client` so refresh needs no rediscovery. */
export type ClientRecord = {
  serverUrl: string;
  authorizationServer: string;
  issuer?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  authMethods?: string[];
  clientId: string;
  clientSecret?: string;
  clientAuthMethod?: string;
  resource?: string;
};

const text = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
};

export const decodeClient = (value: unknown): ClientRecord | undefined => {
  if (!isRecord(value)) return undefined;
  const serverUrl = text(value, "serverUrl");
  const authorizationServer = text(value, "authorizationServer");
  const clientId = text(value, "clientId");
  if (!serverUrl || !authorizationServer || !clientId) return undefined;
  const methods = value.authMethods;
  return {
    serverUrl,
    authorizationServer,
    clientId,
    issuer: text(value, "issuer"),
    authorizationEndpoint: text(value, "authorizationEndpoint"),
    tokenEndpoint: text(value, "tokenEndpoint"),
    authMethods: Array.isArray(methods)
      ? methods.filter((method) => typeof method === "string")
      : undefined,
    clientSecret: text(value, "clientSecret"),
    clientAuthMethod: text(value, "clientAuthMethod"),
    resource: text(value, "resource"),
  };
};

export const clientRecord = (
  serverUrl: string,
  authorizationServer: string,
  metadata: AuthorizationServerMetadata | undefined,
  client: OAuthClientInformationMixed,
  resource: string | undefined,
): ClientRecord => ({
  serverUrl,
  authorizationServer,
  issuer: metadata?.issuer,
  authorizationEndpoint: metadata?.authorization_endpoint,
  tokenEndpoint: metadata?.token_endpoint,
  authMethods: metadata?.token_endpoint_auth_methods_supported,
  clientId: client.client_id,
  clientSecret: client.client_secret,
  clientAuthMethod:
    "token_endpoint_auth_method" in client ? client.token_endpoint_auth_method : undefined,
  resource,
});

export const clientInformation = (record: ClientRecord): OAuthClientInformationMixed => ({
  client_id: record.clientId,
  ...(record.clientSecret !== undefined && { client_secret: record.clientSecret }),
  ...(record.clientAuthMethod !== undefined && {
    token_endpoint_auth_method: record.clientAuthMethod,
  }),
});

/** Rebuilds the metadata fields the SDK reads for token requests. */
export const serverMetadata = (record: ClientRecord): AuthorizationServerMetadata | undefined =>
  record.issuer && record.authorizationEndpoint && record.tokenEndpoint
    ? {
        issuer: record.issuer,
        authorization_endpoint: record.authorizationEndpoint,
        token_endpoint: record.tokenEndpoint,
        response_types_supported: ["code"],
        ...(record.authMethods && { token_endpoint_auth_methods_supported: record.authMethods }),
      }
    : undefined;

export const toTokens = (tokens: OAuthTokens, record: ClientRecord, now: number): Tokens => ({
  accessToken: tokens.access_token,
  tokenType: tokens.token_type,
  ...(tokens.refresh_token !== undefined && { refreshToken: tokens.refresh_token }),
  ...(tokens.expires_in !== undefined && { expiresAt: now + tokens.expires_in * 1000 }),
  ...(tokens.scope !== undefined && { scope: tokens.scope }),
  client: { ...record },
});

const knownCodes: ReadonlySet<string> = new Set(Object.values(OAuthErrorCode));

/** Runs a token endpoint request and replaces OAuth and JSON parse errors, whose messages can echo the response body, with a known code and the HTTP status. */
export const tokenRequest = async <T>(
  failure: string,
  fetchFn: FetchLike | undefined,
  request: (fetchFn: FetchLike) => Promise<T>,
): Promise<T> => {
  let status: number | undefined;
  const recording: FetchLike = async (url, init) => {
    const response = await (fetchFn ?? fetch)(url, init);
    status = response.status;
    return response;
  };
  return request(recording).catch((error: unknown) => {
    const label =
      error instanceof OAuthError
        ? knownCodes.has(error.code)
          ? error.code
          : "unknown OAuth error"
        : error instanceof SyntaxError
          ? "invalid response"
          : undefined;
    if (label === undefined) throw error;
    throw new Error(`${failure} (${status === undefined ? label : `${label}, HTTP ${status}`})`);
  });
};
