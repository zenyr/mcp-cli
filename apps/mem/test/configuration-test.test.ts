import { afterEach, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { SUMMARY_PROMPT } from "../src/compressor";
import {
  CONFIGURATION_TEST_SAMPLE,
  ConfigurationTestError,
  testConfiguration,
} from "../src/configuration-test";
import type { Settings } from "../src/types";

const base: Settings = {
  model: "draft-model",
  baseUrl: "http://127.0.0.1",
  nodeBytes: 512,
  contextBytes: 8192,
  inputBytes: 131072,
  timeoutMs: 5000,
  maxOutputTokens: 4096,
};
const servers: ReturnType<typeof Bun.serve>[] = [];
const local = (fetch: (request: Request) => Response | Promise<Response>) => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch });
  servers.push(server);
  return `${server.url}v1`;
};
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

test("sends the fixed sample with the production prompt and returns a secret-free diagnostic", async () => {
  const baseUrl = local(async (request) => {
    expect(new URL(request.url).pathname).toBe("/v1/chat/completions");
    expect(request.headers.get("authorization")).toBe("Bearer draft-secret");
    expect(request.headers.get("x-project")).toBe("p1");
    const body = await request.json();
    expect(body).toMatchObject({ model: "draft-model", thinking: { type: "disabled" } });
    expect(body.messages).toEqual([
      { role: "system", content: SUMMARY_PROMPT },
      { role: "user", content: JSON.stringify(CONFIGURATION_TEST_SAMPLE) },
    ]);
    return Response.json({
      choices: [{ message: { content: " Staging first. " }, finish_reason: "stop" }],
      usage: { prompt_tokens: 120, completion_tokens: 9 },
      model: "served-model",
    });
  });
  const result = await Effect.runPromise(
    testConfiguration({
      ...base,
      baseUrl,
      thinking: "disabled",
      apiKey: "draft-secret",
      headers: { "X-Project": "p1" },
    }),
  );
  expect(result).toMatchObject({
    model: "served-model",
    thinking: "disabled",
    systemPrompt: SUMMARY_PROMPT,
    text: "Staging first.",
    inputTokens: 120,
    outputTokens: 9,
    usageKnown: true,
  });
  expect(result.durationMs).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(result)).not.toContain("draft-secret");
});

test("reports provider default thinking and unknown usage", async () => {
  const baseUrl = local(async (request) => {
    expect((await request.json()).thinking).toBeUndefined();
    return Response.json({ choices: [{ message: { content: "ok" } }] });
  });
  const result = await Effect.runPromise(testConfiguration({ ...base, baseUrl }));
  expect(result).toMatchObject({ model: "draft-model", thinking: "default", usageKnown: false });
});

test("failures are typed with nonempty messages and no secrets", async () => {
  const missing = await Effect.runPromiseExit(testConfiguration({ ...base, model: "" }));
  expect(missing).toEqual(
    Exit.fail(
      new ConfigurationTestError({
        code: "SUMMARY_NOT_CONFIGURED",
        message: "Enter the API base URL and summary model first.",
      }),
    ),
  );
  const baseUrl = local(() => new Response("denied draft-secret", { status: 401 }));
  const error = await Effect.runPromise(
    Effect.flip(testConfiguration({ ...base, baseUrl, apiKey: "draft-secret" })),
  );
  expect(error).toBeInstanceOf(ConfigurationTestError);
  expect(error.code).toBe("MODEL_HTTP_ERROR");
  expect(error.message).toBe("Summarizer rejected the request. (HTTP 401)");
  const closed = await Effect.runPromise(
    Effect.flip(testConfiguration({ ...base, baseUrl: "http://127.0.0.1:1/v1" })),
  );
  expect(closed.code).toBe("MODEL_UNAVAILABLE");
  expect(closed.message.length).toBeGreaterThan(0);
});
