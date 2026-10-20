import { createHash } from "node:crypto";

export type FakeAuthServer = {
  base: string;
  resource: string;
  registrations: Array<Record<string, unknown>>;
  authorizeRequests: URLSearchParams[];
  tokenRequests: URLSearchParams[];
  refreshCount: () => number;
  /** Overrides the authorization redirect, e.g. to deny access or change `state`. */
  redirect: { error?: string; state?: string };
  refreshDelayMs: number;
  current: () => { access: string; refresh: string };
  stop: () => Promise<void>;
};

const json = (body: unknown, status = 200) => Response.json(body, { status });
const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

/** Implements protected-resource and authorization-server metadata, DCR, authorize and token endpoints. */
export const startFakeAuthServer = (): FakeAuthServer => {
  const registrations: Array<Record<string, unknown>> = [];
  const authorizeRequests: URLSearchParams[] = [];
  const tokenRequests: URLSearchParams[] = [];
  const challenges = new Map<string, { challenge: string; redirect: string }>();
  let generation = 0;
  let refreshes = 0;
  const tokens = () => ({ access: `access-${generation}`, refresh: `refresh-${generation}` });
  const issue = () => {
    generation += 1;
    const { access, refresh } = tokens();
    return json({
      access_token: access,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refresh,
    });
  };
  const state: Pick<FakeAuthServer, "redirect" | "refreshDelayMs"> = {
    redirect: {},
    refreshDelayMs: 0,
  };
  const server: Bun.Server<undefined> = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      const base = server.url.origin;
      if (url.pathname.startsWith("/.well-known/oauth-protected-resource"))
        return json({
          resource: `${base}/mcp`,
          authorization_servers: [base],
          scopes_supported: ["read", "write"],
        });
      if (url.pathname === "/.well-known/oauth-authorization-server")
        return json({
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
          grant_types_supported: ["authorization_code", "refresh_token"],
        });
      if (url.pathname === "/register" && request.method === "POST") {
        const body: Record<string, unknown> = await request.json();
        registrations.push(body);
        return json({ ...body, client_id: `client-${registrations.length}` }, 201);
      }
      if (url.pathname === "/authorize") {
        const params = url.searchParams;
        authorizeRequests.push(params);
        const redirect = new URL(params.get("redirect_uri") ?? "");
        const code = `code-${authorizeRequests.length}`;
        challenges.set(code, {
          challenge: params.get("code_challenge") ?? "",
          redirect: redirect.href,
        });
        redirect.searchParams.set("state", state.redirect.state ?? params.get("state") ?? "");
        if (state.redirect.error) redirect.searchParams.set("error", state.redirect.error);
        else redirect.searchParams.set("code", code);
        return Response.redirect(redirect.href, 302);
      }
      if (url.pathname === "/token" && request.method === "POST") {
        const params = new URLSearchParams(await request.text());
        tokenRequests.push(params);
        if (params.get("grant_type") === "authorization_code") {
          const expected = challenges.get(params.get("code") ?? "");
          if (
            !expected ||
            expected.challenge !== s256(params.get("code_verifier") ?? "") ||
            expected.redirect !== params.get("redirect_uri")
          )
            return json({ error: "invalid_grant" }, 400);
          return issue();
        }
        if (params.get("grant_type") === "refresh_token") {
          refreshes += 1;
          await Bun.sleep(state.refreshDelayMs);
          if (params.get("refresh_token") !== tokens().refresh)
            return json({ error: "invalid_grant" }, 400);
          return issue();
        }
      }
      return new Response("not found", { status: 404 });
    },
  });
  const base = `http://127.0.0.1:${server.port}`;
  return Object.assign(state, {
    base,
    resource: `${base}/mcp`,
    registrations,
    authorizeRequests,
    tokenRequests,
    refreshCount: () => refreshes,
    current: tokens,
    stop: () => server.stop(true),
  });
};
