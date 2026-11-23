import { expect, test } from "bun:test";
import { Effect, Fiber } from "effect";
import { decodeSettings } from "../src/settings";
import { listModels, requestHeaders } from "../src/model-api";

const settings = decodeSettings({ baseUrl: "https://models.invalid/v1" });

test("model discovery uses the draft connection and returns distinct IDs", async () => {
  const result = await Effect.runPromise(
    listModels(
      {
        ...settings,
        apiKey: "saved-key",
        headers: { "X-Provider": "custom", Authorization: "custom" },
      },
      {},
      async (url, init) => {
        expect(url).toBe("https://models.invalid/v1/models");
        const headers = new Headers(init.headers);
        expect(headers.get("authorization")).toBe("Bearer saved-key");
        expect(headers.get("x-provider")).toBe("custom");
        return Response.json({ data: [{ id: "z" }, { id: "a" }, { id: "z" }] });
      },
    ),
  );
  expect(result).toEqual(["a", "z"]);
});

test("optional auth, custom authorization, and environment keys have explicit precedence", () => {
  expect(requestHeaders(settings, {}).has("Authorization")).toBe(false);
  expect(
    requestHeaders({ ...settings, headers: { Authorization: "custom" } }, {}).get("Authorization"),
  ).toBe("custom");
  expect(
    requestHeaders({ ...settings, apiKey: "saved" }, { MEM_API_KEY: "env" }).get("Authorization"),
  ).toBe("Bearer env");
  expect(() => requestHeaders({ ...settings, apiKey: "secret\r\nvalue" }, {})).toThrow(
    "Invalid model request headers.",
  );
});

test("HTTP and malformed responses fail without leaking provider bodies", async () => {
  for (const response of [
    new Response("provider-private-token", { status: 401 }),
    Response.json({ data: [{ missing: "id" }] }),
    Response.json({ data: null }),
    new Response("not-json"),
  ]) {
    const result = await Effect.runPromise(
      Effect.result(listModels(settings, {}, async () => response)),
    );
    expect(result._tag).toBe("Failure");
    expect(JSON.stringify(result)).not.toContain("provider-private-token");
  }
  expect(
    await Effect.runPromise(listModels(settings, {}, async () => Response.json({ data: [] }))),
  ).toEqual([]);
});

test("interrupting discovery aborts the HTTP request", async () => {
  let resolveStarted = () => {};
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  let requestSignal: AbortSignal | null | undefined;
  const fiber = Effect.runFork(
    listModels(settings, {}, async (_url, init) => {
      requestSignal = init.signal;
      resolveStarted();
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("interrupted")), {
          once: true,
        });
      });
    }),
  );
  await started;
  await Effect.runPromise(Fiber.interrupt(fiber));
  expect(requestSignal?.aborted).toBe(true);
});
