import { afterEach, expect, test } from "bun:test";
import { createCompressor, decodeCompletion, SUMMARY_PROMPT } from "../src/compressor";
import type { Settings } from "../src/types";

const settings: Settings = {
  model: "test-model",
  baseUrl: "http://127.0.0.1",
  nodeBytes: 512,
  contextBytes: 1024,
  inputBytes: 131072,
  timeoutMs: 1000,
  maxOutputTokens: 1024,
};
const input = { source: "원문", merge: false, targetBytes: 512 };
test("invalid token counters are explicitly unmeasured", () => {
  const result = decodeCompletion(
    {
      choices: [{ message: { content: "summary" } }],
      usage: { prompt_tokens: -1, completion_tokens: 1.5 },
    },
    "test",
  );
  expect(result.usageKnown).toBe(false);
  expect(result.inputTokens).toBe(0);
  expect(result.outputTokens).toBe(0);
});
const servers: ReturnType<typeof Bun.serve>[] = [];
const local = (fetch: (request: Request) => Response | Promise<Response>) => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch });
  servers.push(server);
  return { ...settings, baseUrl: `${server.url}v1/` };
};
const completion = (content = "summary") => ({
  choices: [{ message: { content }, finish_reason: "stop" }],
  usage: { prompt_tokens: 11, completion_tokens: 4 },
  model: "returned-model",
});
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

test("HTTP sends system prompt, JSON input, model, cap, and API key header", async () => {
  let requests = 0;
  const config = local(async (request) => {
    requests += 1;
    expect(new URL(request.url).pathname).toBe("/v1/chat/completions");
    expect(request.method).toBe("POST");
    expect(request.headers.get("authorization")).toBe("Bearer secret-test-key");
    expect(await request.json()).toEqual({
      model: "test-model",
      stream: false,
      max_tokens: 1024,
      messages: [
        { role: "system", content: SUMMARY_PROMPT },
        { role: "user", content: JSON.stringify(input) },
      ],
    });
    return Response.json(completion("  summary\n"));
  });
  expect(await createCompressor(config, { MEM_API_KEY: "secret-test-key" })(input)).toEqual({
    text: "summary",
    model: "returned-model",
    inputTokens: 11,
    outputTokens: 4,
    usageKnown: true,
  });
  expect(requests).toBe(1);
});

test("HTTP errors do not expose credentials or response bodies", async () => {
  const config = local(() => new Response("secret-test-key provider detail", { status: 401 }));
  try {
    await createCompressor(config, { MEM_API_KEY: "secret-test-key" })(input);
    throw new Error("Expected rejection");
  } catch (error) {
    expect(error).toMatchObject({ code: "MODEL_HTTP_ERROR", details: { status: 401 } });
    expect(String(error)).not.toContain("secret-test-key");
    expect(String(error)).not.toContain("provider detail");
  }
});

test("thinking configuration is sent only when explicitly selected", async () => {
  const config = local(async (request) => {
    expect(await request.json()).toMatchObject({ thinking: { type: "disabled" } });
    return Response.json(completion());
  });
  await createCompressor({ ...config, thinking: "disabled" }, {})(input);
});

test("HTTP rejects missing text, truncation, oversized responses, and invalid JSON", async () => {
  for (const [response, code] of [
    [Response.json(completion(" ")), "MODEL_PROTOCOL"],
    [
      Response.json({ choices: [{ message: { content: "partial" }, finish_reason: "length" }] }),
      "MODEL_OUTPUT_INCOMPLETE",
    ],
    [new Response("x".repeat(262145)), "MODEL_OUTPUT_OVERFLOW"],
    [new Response("{"), "INVALID_JSON"],
  ] as const) {
    await expect(
      createCompressor(
        local(() => response),
        {},
      )(input),
    ).rejects.toMatchObject({ code });
  }
});

test("HTTP enforces input cap before making requests and bounds network timeout", async () => {
  let requests = 0;
  const config = local(() => {
    requests += 1;
    return new Promise<Response>(() => {});
  });
  await expect(createCompressor({ ...config, inputBytes: 1 }, {})(input)).rejects.toMatchObject({
    code: "SUMMARY_INPUT_OVERFLOW",
  });
  expect(requests).toBe(0);
  await expect(createCompressor({ ...config, timeoutMs: 30 }, {})(input)).rejects.toMatchObject({
    code: "MODEL_UNAVAILABLE",
  });
  expect(requests).toBe(1);
});

test("HTTP whitelists range-only fields and retains two stateless messages on retry", async () => {
  const config = local(async (request) => {
    expect(await request.json()).toMatchObject({
      messages: [
        { role: "system", content: SUMMARY_PROMPT },
        { role: "user", content: JSON.stringify({ ...input, retry: true }) },
      ],
    });
    return Response.json(completion());
  });
  const structuralInput = {
    ...input,
    retry: true,
    context: "outside context",
    history: ["previous reply"],
    pins: ["outside pin"],
    scopes: ["other scope"],
  };
  await createCompressor(config, {})(structuralInput);
});

test("missing model or URL fails before contacting the provider", async () => {
  let calls = 0;
  const config = local(() => {
    calls += 1;
    return Response.json(completion());
  });
  for (const missing of [{ model: "" }, { baseUrl: "" }]) {
    await expect(createCompressor({ ...config, ...missing }, {})(input)).rejects.toMatchObject({
      code: "SUMMARY_NOT_CONFIGURED",
    });
  }
  expect(calls).toBe(0);
});
