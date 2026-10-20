import {
  discoverOAuthServerInfo,
  registerClient,
  startAuthorization,
  exchangeAuthorization,
  refreshAuthorization,
  type OAuthTokens,
} from "@modelcontextprotocol/client";
import type { Runtime } from "./runtime";

export class CallbackRejected extends Error {}

export const oauthProbe = async (runtime: Runtime, resource: string, path: string) => {
  const info = await discoverOAuthServerInfo(resource, { fetchFn: runtime.fetch });
  const metadata = info.authorizationServerMetadata;
  const state = crypto.randomUUID();
  const callback = Promise.withResolvers<string>();
  void callback.promise.catch(() => undefined);
  const server = runtime.serve((request) => {
    const url = new URL(request.url);
    if (url.pathname !== "/callback") return new Response("not found", { status: 404 });
    const code = url.searchParams.get("code");
    if (url.searchParams.get("state") !== state || url.searchParams.has("error") || !code) {
      callback.reject(new CallbackRejected("OAuth 응답을 거부했습니다."));
      return new Response("rejected", { status: 400 });
    }
    callback.resolve(code);
    return new Response("ok");
  });
  try {
    const redirectUrl = `${server.url}callback`;
    const client = await registerClient(info.authorizationServerUrl, {
      metadata,
      clientMetadata: {
        client_name: "runtime-probe",
        redirect_uris: [redirectUrl],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      fetchFn: runtime.fetch,
    });
    const resourceUrl = info.resourceMetadata?.resource;
    const authorization = await startAuthorization(info.authorizationServerUrl, {
      metadata,
      clientInformation: client,
      redirectUrl,
      state,
      resource: resourceUrl,
    });
    await runtime.fetch(authorization.authorizationUrl.href);
    const issued = await exchangeAuthorization(info.authorizationServerUrl, {
      metadata,
      clientInformation: client,
      authorizationCode: await callback.promise,
      codeVerifier: authorization.codeVerifier,
      redirectUri: redirectUrl,
      resource: resourceUrl,
      fetchFn: runtime.fetch,
    });
    await runtime.writePrivate(path, JSON.stringify(issued));
    const stored: unknown = JSON.parse(await runtime.read(path));
    const reloaded = decodeTokens(stored);
    if (!reloaded.refresh_token) throw new Error("갱신 토큰이 없습니다.");
    const refreshed = await refreshAuthorization(info.authorizationServerUrl, {
      metadata,
      clientInformation: client,
      refreshToken: reloaded.refresh_token,
      resource: resourceUrl,
      fetchFn: runtime.fetch,
    });
    await runtime.writePrivate(path, JSON.stringify(refreshed));
    return {
      callback: true,
      persisted: reloaded.access_token === issued.access_token,
      rotated:
        refreshed.access_token !== issued.access_token &&
        refreshed.refresh_token !== issued.refresh_token,
    };
  } finally {
    await server.close();
  }
};

const decodeTokens = (value: unknown): OAuthTokens => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("access_token" in value) ||
    typeof value.access_token !== "string" ||
    !("refresh_token" in value) ||
    typeof value.refresh_token !== "string"
  )
    throw new Error("저장한 토큰이 올바르지 않습니다.");
  return {
    access_token: value.access_token,
    refresh_token: value.refresh_token,
    token_type: "Bearer",
  };
};
