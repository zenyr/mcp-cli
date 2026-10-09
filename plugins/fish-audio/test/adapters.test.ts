import { beforeEach, afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError, type ExtensionContext, type ToolResult } from "@mcp-cli/core";
import { normalizeArgv } from "../src/adapters/cli/normalize";
import { runWorkflow } from "../src/adapters/cli/run";
import { audioSource, sniffAudio } from "../src/adapters/audio";
import { atomicWrite, copyAudio, joinAudio, saveAudio } from "../src/adapters/files";
import { createStore } from "../src/adapters/store";
import { createPorts } from "../src/adapters/ports";

const directories: string[] = [];
const directory = async (): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), "fish-adapters-"));
  directories.push(path);
  return path;
};
const originalCacheHome = process.env.XDG_CACHE_HOME;
beforeEach(async () => {
  process.env.XDG_CACHE_HOME = await directory();
});
afterEach(async () => {
  if (originalCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = originalCacheHome;
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const wav = (): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(44 + 1600);
  const data = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string): void => {
    bytes.set(new TextEncoder().encode(text), offset);
  };
  ascii(0, "RIFF");
  data.setUint32(4, bytes.length - 8, true);
  ascii(8, "WAVEfmt ");
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 1, true);
  data.setUint32(24, 8000, true);
  data.setUint32(28, 16000, true);
  data.setUint16(32, 2, true);
  data.setUint16(34, 16, true);
  ascii(36, "data");
  data.setUint32(40, 1600, true);
  return bytes;
};
const audioResult = (): ToolResult => ({
  content: [{ type: "audio", data: Buffer.from(wav()).toString("base64"), mimeType: "audio/mp3" }],
});
const context = (readStdin = async (): Promise<string> => ""): ExtensionContext => ({
  callTool: async () => {
    throw new Error("Unexpected remote call");
  },
  json: true,
  cacheScope: "test",
  io: {
    readStdin,
    readFile: (path) => readFile(path, "utf8"),
    readBytes: async (path) => new Uint8Array(await readFile(path)),
    write: () => {},
    writeError: () => {},
  },
});

test("normalization changes only new Fish paths and sole --skill", () => {
  for (const args of [
    ["speech", "create", "--text", "hi"],
    ["transcription", "create", "--audio-url", "https://a"],
    ["call", "text_to_speech", "--input", "{}"],
    ["--skill", "--offline"],
  ])
    expect(normalizeArgv(args)).toBe(args);
  expect(normalizeArgv(["--skill"])).toEqual(["skill"]);
  expect(normalizeArgv(["tts", "hello\nworld", "-o", "hello.wav", "-y", "--voice", "v"])).toEqual([
    "tts",
    "--text=hello\nworld",
    "--output=hello.wav",
    "--yes",
    "--voice-id=v",
  ]);
  expect(normalizeArgv(["--json", "stt", "-", "--speakers"])).toEqual([
    "--json",
    "stt",
    "--audio-url=-",
    "--speakers",
  ]);
  expect(normalizeArgv(["tts", "--voice=v", "--", "--literal"])).toEqual([
    "tts",
    "--voice-id=v",
    "--text=--literal",
  ]);
  expect(normalizeArgv(["roundtrip", "hi", "--fail-over", "0.1"])).toEqual([
    "roundtrip",
    "--text=hi",
    "--max-cer=0.1",
  ]);
});
test("normalization rejects unknown options, missing values and extra positionals", () => {
  for (const args of [
    ["tts", "hello", "world"],
    ["tts", "--invalid", "x"],
    ["tts", "-o"],
    ["tts", "--voice", "--json"],
  ])
    expect(() => normalizeArgv(args)).toThrow(UsageError);
});
test("atomic writes leave the previous output and remove temporary files on failure", async () => {
  const root = await directory();
  const path = join(root, "out.wav");
  await writeFile(path, "original");
  await expect(
    atomicWrite(path, async (temp) => {
      await writeFile(temp, "partial");
      throw new Error("fixture");
    }),
  ).rejects.toThrow();
  expect(await readFile(path, "utf8")).toBe("original");
  expect(await readdir(root)).toEqual(["out.wav"]);
});
test("audio magic wins over MIME and data sources support resource, data URI and nested envelope", async () => {
  const root = await directory();
  const path = join(root, "out.wav");
  await saveAudio(audioResult(), path);
  expect(new Uint8Array(await readFile(path))).toEqual(wav());
  const base64 = Buffer.from(wav()).toString("base64");
  for (const result of [
    { content: [{ type: "resource", resource: { blob: base64 } }] },
    { content: [], structuredContent: { data: { audio: `data:audio/wav;base64,${base64}` } } },
    { content: [{ type: "text", text: JSON.stringify({ audio_base64: base64 }) }] },
  ])
    expect(audioSource(result)).toEqual({ bytes: wav() });
});
test.skipIf(!Bun.which("ffmpeg"))(
  "ffmpeg converts and joins fixtures atomically, preserving destination on failure",
  async () => {
    const root = await directory();
    const source = join(root, "part.wav");
    const converted = join(root, "output.flac");
    const merged = join(root, "joined.wav");
    await saveAudio(audioResult(), source);
    await copyAudio(source, converted);
    expect(sniffAudio(new Uint8Array(await readFile(converted)))).toBe("flac");
    await joinAudio([source, source], merged);
    expect(sniffAudio(new Uint8Array(await readFile(merged)))).toBe("wav");
    expect((await readFile(merged)).length).toBeGreaterThan(wav().length);
    const before = await readFile(merged);
    await expect(joinAudio([source, join(root, "missing.wav")], merged)).rejects.toThrow();
    expect(await readFile(merged)).toEqual(before);
    expect((await readdir(root)).sort()).toEqual(["joined.wav", "output.flac", "part.wav"]);
  },
);
test("journal persists atomically, isolates output and credential scopes, and fails closed", async () => {
  const root = await directory();
  const path = join(root, "out.wav");
  const store = createStore(path, "account-a");
  const key = "request";
  const result = audioResult();
  const input = { text: "hi" };
  await store.store.put(key, { status: "generated", input, result });
  expect(await createStore(path, "account-a").store.get(key)).toMatchObject({
    status: "generated",
  });
  expect(await createStore(path, "account-b").store.get(key)).toBeUndefined();
  expect(await createStore(join(root, "other.wav"), "account-a").store.get(key)).toBeUndefined();
  await store.store.put(key, { status: "ready", input, result, path: store.cachePath(key) });
  expect(await store.store.get(key)).toMatchObject({ status: "generated" });
  await expect(
    store.store.put(key, { status: "ready", input, result, path: join(root, "outside.wav") }),
  ).rejects.toThrow();
  await writeFile(store.cachePath(key).replace(/\.audio$/, ".json"), "{");
  await expect(store.store.get(key)).rejects.toThrow();
});
test("output cache lock excludes concurrent runs and can be released", async () => {
  const root = await directory();
  const first = createStore(join(root, "out.wav"), "account");
  const second = createStore(join(root, "out.wav"), "account");
  await first.acquire();
  await expect(second.acquire()).rejects.toThrow();
  await second.release();
  await expect(second.acquire()).rejects.toThrow();
  await first.release();
  await second.acquire();
  await second.release();
});
test("local audio validation returns @path without uploading or calling MCP", async () => {
  const root = await directory();
  const path = join(root, "input.wav");
  await writeFile(path, wav());
  const ports = createPorts(context(), join(root, "out"), new AbortController().signal);
  expect(await ports.prepareAudioReference(path)).toBe(`@${path}`);
});
test("STT stdin is consumed once and cancellation listeners are removed after failure", async () => {
  let reads = 0;
  const root = await directory();
  const before = process.listenerCount("SIGINT");
  const ctx = context(async () => {
    reads++;
    return "https://example.com/audio.wav\n";
  });
  await expect(
    runWorkflow("stt", { audio_url: "-", output: join(root, "out.txt") }, ctx),
  ).rejects.toThrow();
  expect(reads).toBe(1);
  expect(process.listenerCount("SIGINT")).toBe(before);
});

test("STT exports speaker TXT and JSON while --json keeps the result envelope", async () => {
  const root = await directory();
  const calls: Record<string, unknown>[] = [];
  const ctx: ExtensionContext = {
    ...context(),
    json: false,
    callTool: async (name, input) => {
      expect(name).toBe("speech_to_text");
      calls.push(input);
      return { content: [], structuredContent: { text: "<|speaker:0|>Hello<|speaker:1|>World" } };
    },
  };
  const output = join(root, "transcript.txt");
  const outcome = await runWorkflow(
    "stt",
    { audio_url: "https://example.com/a.wav", output, speakers: true, text: true },
    ctx,
  );
  expect(await readFile(output, "utf8")).toBe("Speaker 1: Hello\nSpeaker 2: World\n");
  expect(outcome.result.content).toEqual([
    { type: "text", text: "Speaker 1: Hello\nSpeaker 2: World" },
  ]);
  const jsonOutput = join(root, "transcript.json");
  const envelope = await runWorkflow(
    "stt",
    { audio_url: "https://example.com/a.wav", output: jsonOutput, text: true },
    { ...ctx, json: true },
  );
  expect(envelope.result.structuredContent).toMatchObject({ text: "Hello World" });
  expect(JSON.parse(await readFile(jsonOutput, "utf8"))).toMatchObject({
    text: "Hello World",
    segments: [
      { speaker: 0, text: "Hello" },
      { speaker: 1, text: "World" },
    ],
  });
  expect(calls).toEqual([{ audio_url: "https://example.com/a.wav" }]);
});
test("TTS saves fixture audio through guarded tool port without leaking local options", async () => {
  const root = await directory();
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const ctx: ExtensionContext = {
    ...context(),
    callTool: async (name, input) => {
      calls.push({ name, input });
      if (name === "get_credit_balance")
        return {
          content: [],
          structuredContent: { package_balance: 1000, tts_max_text_bytes_per_call: 500 },
        };
      expect(name).toBe("text_to_speech");
      return { ...audioResult(), structuredContent: { voice: { id: "voice-fixture" } } };
    },
  };
  const output = join(root, "hello.wav");
  await runWorkflow(
    "tts",
    {
      text: "Hello",
      yes: true,
      output,
      max_credits: 50,
      language: "en",
      voice_id: "voice-fixture",
    },
    ctx,
  );
  expect(calls.filter((call) => call.name === "text_to_speech")).toEqual([
    { name: "text_to_speech", input: { text: "Hello", language: "en", voice_id: "voice-fixture" } },
  ]);
  expect(new Uint8Array(await readFile(output))).toEqual(wav());
});

test("downloaded audio is saved atomically and failed downloads preserve existing output", async () => {
  const root = await directory();
  const path = join(root, "download.wav");
  const result: ToolResult = {
    content: [],
    structuredContent: { audio_url: "https://fixture.invalid/audio.wav" },
  };
  const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(wav(), { status: 200 }),
  );
  try {
    await saveAudio(result, path);
    expect(new Uint8Array(await readFile(path))).toEqual(wav());
    fetchMock.mockResolvedValue(new Response("unavailable", { status: 503 }));
    await expect(saveAudio(result, path)).rejects.toThrow();
    expect(new Uint8Array(await readFile(path))).toEqual(wav());
    expect(await readdir(root)).toEqual(["download.wav"]);
  } finally {
    fetchMock.mockRestore();
  }
});

test("a second signal exits a stalled workflow while the first signal drains", async () => {
  const root = await directory();
  const source = `
    import { runWorkflow } from ${JSON.stringify(new URL("../src/adapters/cli/run.ts", import.meta.url).pathname)};
    setInterval(() => {}, 1000);
    await runWorkflow("tts", { text: "hello", yes: true, output: ${JSON.stringify(join(root, "out.wav"))} }, {
      json: false,
      io: { write() {}, writeError: text => console.error(text), readFile: async () => "", readBytes: async () => new Uint8Array(), readStdin: async () => "" },
      callTool: async name => {
        if (name === "get_credit_balance") return { content: [], structuredContent: { package_balance: 1000, tts_max_text_bytes_per_call: 500 } };
        console.log("dispatched");
        return new Promise(() => {});
      }
    });
  `;
  const child = Bun.spawn([process.execPath, "--eval", source], { stdout: "pipe", stderr: "pipe" });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 4000);
  try {
    const stdout = child.stdout.getReader();
    const first = await stdout.read();
    expect(new TextDecoder().decode(first.value)).toContain("dispatched");
    child.kill("SIGINT");
    const stderr = child.stderr.getReader();
    const notice = await stderr.read();
    expect(new TextDecoder().decode(notice.value)).toContain("draining");
    expect(child.exitCode).toBeNull();
    child.kill("SIGINT");
    await child.exited;
    expect(child.signalCode).toBe("SIGTERM");
    expect(
      JSON.parse(await readFile(join(root, "out.wav.parts", ".lock", "owner.json"), "utf8")).pid,
    ).toBe(child.pid);
    stdout.releaseLock();
    stderr.releaseLock();
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null) child.kill("SIGKILL");
    await child.exited;
  }
});
