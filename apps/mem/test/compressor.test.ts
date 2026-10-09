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
};
const input = { source: "원문", context: "context", merge: false, targetBytes: 512 };
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
const command = (script: string, overrides: Partial<Settings> = {}) =>
  createCompressor({ ...settings, command: [process.execPath, "-e", script], ...overrides }, {});
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

test("command receives prompt on stdin and literal arguments without a shell", async () => {
  const literal = "$(echo injected); *";
  const compressor = createCompressor(
    {
      ...settings,
      command: [
        process.execPath,
        "-e",
        "const text = await Bun.stdin.text(); console.log(JSON.stringify({text, arg: process.argv.at(-1)}))",
        literal,
      ],
    },
    {},
  );
  const result = await compressor(input);
  expect(JSON.parse(result.text)).toEqual({
    text: `${SUMMARY_PROMPT}\n${JSON.stringify(input)}\n`,
    arg: literal,
  });
  expect(result).toMatchObject({
    model: "test-model",
    inputTokens: 0,
    outputTokens: 0,
    usageKnown: false,
  });
});

test("command trims stdout and ignores stderr on success", async () => {
  expect(
    (await command('console.error("diagnostic"); console.log("  output  ")')(input)).text,
  ).toBe("output");
});

test("command rejects nonzero exits, empty output, output overflow, and timeout", async () => {
  for (const [script, code, overrides] of [
    ['console.error("private diagnostic"); process.exit(7)', "MODEL_COMMAND_FAILED", {}],
    ['console.log(" ")', "MODEL_PROTOCOL", {}],
    ['console.log("x".repeat(262145))', "MODEL_OUTPUT_OVERFLOW", {}],
    ["setInterval(() => {}, 1000)", "MODEL_TIMEOUT", { timeoutMs: 80 }],
  ] as const) {
    await expect(command(script, overrides)(input)).rejects.toMatchObject({ code });
  }
  await expect(
    command('throw new Error("must not start")', { inputBytes: 1 })(input),
  ).rejects.toMatchObject({ code: "SUMMARY_INPUT_OVERFLOW" });
});
