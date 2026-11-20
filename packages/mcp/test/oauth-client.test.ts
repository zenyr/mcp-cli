import { expect, test } from "bun:test";
import { refreshAuthorization, type FetchLike } from "@modelcontextprotocol/client";
import { tokenRequest } from "../src/oauth-client";

const secret = "sk_live_leaked_secret";

const respond =
  (body: string, status: number): FetchLike =>
  async () =>
    new Response(body, { status, headers: { "content-type": "application/json" } });

const refresh = (fetchFn: FetchLike) =>
  tokenRequest("svc token refresh failed", fetchFn, (recording) =>
    refreshAuthorization("https://auth.example", {
      clientInformation: { client_id: "client" },
      refreshToken: "refresh",
      fetchFn: recording,
    }),
  );

const failure = async (fetchFn: FetchLike): Promise<Error> => {
  const error = await refresh(fetchFn).catch((caught: unknown) => caught);
  if (!(error instanceof Error)) throw new Error("expected a token request failure");
  return error;
};

test("a known OAuth error code is reported with the HTTP status", async () => {
  const error = await failure(respond(JSON.stringify({ error: "invalid_client" }), 401));
  expect(error.message).toBe("svc token refresh failed (invalid_client, HTTP 401)");
});

test("an unknown error code echoing a secret is replaced with a generic label", async () => {
  const error = await failure(respond(JSON.stringify({ error: secret }), 400));
  expect(error.message).toBe("svc token refresh failed (unknown OAuth error, HTTP 400)");
  expect(error.cause).toBeUndefined();
});

test("a malformed success body is reported without its contents", async () => {
  const error = await failure(respond(`${secret} not json`, 200));
  expect(error.message).toBe("svc token refresh failed (invalid response, HTTP 200)");
  expect(error.message).not.toContain(secret);
  expect(error.cause).toBeUndefined();
});

test("an abort passes through unchanged", async () => {
  const abort = new DOMException("stopped", "AbortError");
  const error = await failure(async () => {
    throw abort;
  });
  expect(error).toBe(abort);
});
