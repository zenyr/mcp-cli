export type AuthorizationResponse = { code: string; iss?: string };

/** The browser step of a login failed, was denied, or did not finish in time. */
export class LoginError extends Error {
  override name = "LoginError";
}

const page = (message: string, status: number): Response =>
  new Response(`<!doctype html><title>mcp-cli</title><p>${message}</p>`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

export type Loopback = {
  redirectUrl: string;
  /** Resolves with the first callback; rejects on denial, state mismatch or timeout. */
  response: Promise<AuthorizationResponse>;
  /** Accepts a redirect URL copied by hand, for logins finished in a browser on another machine. */
  submit: (input: string) => void;
  stop: () => void;
};

/** Listens on 127.0.0.1 for exactly one OAuth redirect carrying the expected `state`. */
export const startLoopback = (
  state: string,
  timeoutMs: number,
  port = 0,
  redirectUri?: string,
): Loopback => {
  const settle = Promise.withResolvers<AuthorizationResponse>();
  const response = settle.promise;
  // The callback can settle while the browser step is still running, before anyone awaits it.
  response.catch(() => undefined);
  let done = false;
  const finish = (outcome: AuthorizationResponse | LoginError): void => {
    if (done) return;
    done = true;
    if (outcome instanceof LoginError) settle.reject(outcome);
    else settle.resolve(outcome);
  };
  const accept = (params: URLSearchParams): boolean => {
    if (params.getAll("state").length !== 1 || params.get("state") !== state) {
      finish(new LoginError("Authorization response state does not match"));
      return false;
    }
    const error = params.get("error");
    const code = params.get("code");
    if (error || !code || params.getAll("code").length !== 1) {
      finish(new LoginError("Authorization was denied or returned an invalid code"));
      return false;
    }
    finish({ code, iss: params.get("iss") ?? undefined });
    return true;
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: (request) => {
      const url = new URL(request.url);
      const expected = new URL(redirectUri ?? `http://127.0.0.1:${server.port}/callback`);
      if (
        request.method !== "GET" ||
        url.origin !== expected.origin ||
        url.pathname !== expected.pathname
      )
        return page("Not found", 404);
      if (done) return page("This login has already finished.", 409);
      return accept(url.searchParams)
        ? page("Login complete. You can close this window.", 200)
        : page("Login failed. Return to the terminal.", 400);
    },
  });
  const timer = setTimeout(
    () => finish(new LoginError(`Login timed out after ${Math.round(timeoutMs / 1000)}s`)),
    timeoutMs,
  );
  return {
    redirectUrl: redirectUri ?? `http://127.0.0.1:${server.port}/callback`,
    response,
    submit: (input) => {
      const text = input.trim();
      if (!text || done) return;
      try {
        const url = new URL(text);
        const expected = new URL(redirectUri ?? `http://127.0.0.1:${server.port}/callback`);
        if (
          url.origin !== expected.origin ||
          url.pathname !== expected.pathname ||
          url.hash ||
          url.username ||
          url.password
        )
          throw new LoginError("Callback address does not match the login request");
        accept(url.searchParams);
      } catch {
        finish(new LoginError("Callback address does not match the login request"));
      }
    },
    stop: () => {
      clearTimeout(timer);
      finish(new LoginError("Login was cancelled"));
      void server.stop(true);
    },
  };
};
