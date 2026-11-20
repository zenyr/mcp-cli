import { randomBytes } from "node:crypto";
import {
  checkResourceAllowed,
  discoverOAuthServerInfo,
  exchangeAuthorization,
  registerClient,
  resourceUrlFromServerUrl,
  startAuthorization,
  type FetchLike,
  type OAuthClientInformationMixed,
  type OAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/client";
import type { OAuthSpec, TokenStore, Tokens } from "@mcp-cli/core";
import { startLoopback, LoginError } from "./loopback";
import { clientRecord, toTokens } from "./oauth-client";

export type LoginUi = {
  open: (url: string) => void | Promise<void>;
  /** Feeds hand-copied redirect URLs into the login; returns a cleanup called when it ends. */
  manual?: (submit: (input: string) => void) => () => void;
};
export type LoginOptions = {
  service: string;
  url: string;
  spec: OAuthSpec;
  store: TokenStore;
  ui: LoginUi;
  fetchFn?: FetchLike;
  /** Cancels the login, settling the loopback wait and skipping the token write. */
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: () => number;
};

// Sends the metadata string verbatim because servers compare the resource indicator exactly.
const resourceFor = (url: string, metadata: OAuthProtectedResourceMetadata | undefined) => {
  if (!metadata) return undefined;
  const requested = resourceUrlFromServerUrl(url);
  if (
    !checkResourceAllowed({ requestedResource: requested, configuredResource: metadata.resource })
  )
    throw new LoginError(
      `Protected resource ${metadata.resource} does not match ${requested.href}`,
    );
  return metadata.resource;
};

const abortable = (fetchFn: FetchLike | undefined, signal: AbortSignal | undefined) =>
  signal
    ? (url: string | URL, init?: RequestInit) =>
        (fetchFn ?? fetch)(url, {
          ...init,
          signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal,
        })
    : fetchFn;

/** Runs discovery, optional dynamic registration and a PKCE authorization code flow on a loopback redirect. */
export const login = async (options: LoginOptions): Promise<Tokens> => {
  const { service, url, spec, store, ui, signal } = options;
  const fetchFn = abortable(options.fetchFn, signal);
  signal?.throwIfAborted();
  const now = options.now ?? Date.now;
  const info = await discoverOAuthServerInfo(url, { fetchFn });
  const server = info.authorizationServerUrl;
  const metadata = info.authorizationServerMetadata;
  const resource = resourceFor(url, info.resourceMetadata);
  const scope = (spec.scopes ?? info.resourceMetadata?.scopes_supported)?.join(" ") || undefined;
  const state = randomBytes(32).toString("base64url");
  const loopback = startLoopback(state, options.timeoutMs ?? 300000, spec.redirectPort);
  const cancel = () => loopback.stop();
  try {
    signal?.throwIfAborted();
    signal?.addEventListener("abort", cancel, { once: true });
    const client: OAuthClientInformationMixed = spec.clientId
      ? { client_id: spec.clientId }
      : await registerClient(server, {
          metadata,
          clientMetadata: {
            client_name: spec.clientName ?? "mcp-cli",
            redirect_uris: [loopback.redirectUrl],
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: "none",
          },
          scope,
          fetchFn,
        });
    const { authorizationUrl, codeVerifier } = await startAuthorization(server, {
      metadata,
      clientInformation: client,
      redirectUrl: loopback.redirectUrl,
      scope,
      state,
      resource,
    });
    await ui.open(authorizationUrl.href);
    const stopManual = ui.manual?.(loopback.submit);
    const { code, iss } = await loopback.response.finally(() => stopManual?.());
    const issued = await exchangeAuthorization(server, {
      metadata,
      clientInformation: client,
      authorizationCode: code,
      iss,
      codeVerifier,
      redirectUri: loopback.redirectUrl,
      resource,
      fetchFn,
    });
    const tokens = toTokens(issued, clientRecord(url, server, metadata, client, resource), now());
    await store.withLock(service, () => {
      signal?.throwIfAborted();
      return store.write(service, tokens);
    });
    return tokens;
  } finally {
    signal?.removeEventListener("abort", cancel);
    loopback.stop();
  }
};
