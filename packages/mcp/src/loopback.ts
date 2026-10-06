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
  stop: () => void;
};

/** Listens on 127.0.0.1 for exactly one OAuth redirect carrying the expected `state`. */
export const startLoopback = (state: string, timeoutMs: number, port = 0): Loopback => {
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
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: (request) => {
      const url = new URL(request.url);
      if (url.pathname !== "/callback") return page("Not found", 404);
      if (done) return page("This login has already finished.", 409);
      const params = url.searchParams;
      if (params.get("state") !== state) {
        finish(new LoginError("Authorization response state does not match"));
        return page("Login failed: state mismatch.", 400);
      }
      const error = params.get("error");
      const code = params.get("code");
      if (error || !code) {
        const detail = params.get("error_description");
        finish(
          new LoginError(
            `Authorization failed: ${error ?? "missing code"}${detail ? ` (${detail})` : ""}`,
          ),
        );
        return page("Login failed. Return to the terminal.", 400);
      }
      finish({ code, iss: params.get("iss") ?? undefined });
      return page("Login complete. You can close this window.", 200);
    },
  });
  const timer = setTimeout(
    () => finish(new LoginError(`Login timed out after ${Math.round(timeoutMs / 1000)}s`)),
    timeoutMs,
  );
  return {
    redirectUrl: `http://127.0.0.1:${server.port}/callback`,
    response,
    stop: () => {
      clearTimeout(timer);
      finish(new LoginError("Login was cancelled"));
      void server.stop(true);
    },
  };
};
