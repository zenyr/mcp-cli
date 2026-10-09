import { expect, test } from "bun:test";
import type { ToolResult } from "@mcp-cli/core";
import { createWorkflows } from "../src/application/workflows";
import type { FishPorts, JournalEntry } from "../src/application/ports";
import { resultData, resultOf } from "../src/domain/result";
import { normalizeScript, splitScript, utf8Bytes } from "../src/domain/script";
import { characterErrorRate } from "../src/domain/textdiff";

const fixture = () => {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const entries = new Map<string, JournalEntry>();
  const transitions: string[] = [];
  const writes: string[] = [];
  const ports: FishPorts = {
    callTool: async (name, input) => {
      calls.push({ name, input });
      if (name === "get_credit_balance")
        return resultOf({ tts_max_text_bytes_per_call: 500, package_balance: 100000 });
      if (name === "speech_to_text")
        return resultOf({ text: "<|speaker:0|>Hello <|speaker:1|>world", credits_charged: 2 });
      return resultOf({
        audio_url: "https://example.com/audio.mp3",
        voice: { id: "pinned" },
        credits_charged: utf8Bytes(String(input.text)),
      });
    },
    readText: async () => "Hello world",
    readStdin: async () => "Hello world",
    saveAudio: async (_result, path) => {
      writes.push(path);
      return path;
    },
    copyAudio: async (_source, destination) => {
      writes.push(destination);
    },
    joinAudio: async (_paths, path) => {
      writes.push(path);
    },
    ensureConverter: async () => {},
    store: {
      get: async (key) => entries.get(key),
      put: async (key, entry) => {
        transitions.push(entry.status);
        entries.set(key, entry);
      },
    },
    confirm: async () => true,
    cancelled: () => false,
    cachePath: (key) => `cache/${key}.mp3`,
    writeText: async (_path, text) => {
      writes.push(text);
    },
    prepareAudioReference: async (path) => `@${path}`,
    audioIdentity: async (reference) => reference,
  };
  return {
    ports,
    calls,
    entries,
    transitions,
    writes,
    app: createWorkflows(ports),
    paid: () => calls.filter((call) => call.name === "text_to_speech"),
  };
};

test("UTF8 chunking preserves paragraphs, tags and graphemes losslessly", () => {
  const text = "첫 문장. [pause] 둘째 문장.\r\n\r\n" + "👩‍👩‍👧 한글. ".repeat(20);
  const pieces = splitScript(text, { maxChars: 30, maxBytes: 70 });
  expect(pieces.join("")).toBe(normalizeScript(text));
  for (const piece of pieces) {
    expect(utf8Bytes(piece)).toBeLessThanOrEqual(70);
    expect([...piece].length).toBeLessThanOrEqual(30);
    expect(piece.includes("[pause")).toBe(piece.includes("[pause]"));
  }
  expect(() => splitScript("[long pause]", { maxChars: 5, maxBytes: 50 })).toThrow();
});

test("single chunk budget, confirmation, estimate and invalid options prevent paid calls", async () => {
  const f = fixture();
  await expect(f.app.tts("Hello", { maxCredits: 9 })).rejects.toThrow("Reserved");
  await expect(f.app.tts("Hello", { concurrency: 5 })).rejects.toThrow("Concurrency");
  await expect(f.app.tts("Hello", { output: "bad.exe" })).rejects.toThrow("extension");
  await expect(f.app.roundtrip("Hello", { maxCer: -1 })).rejects.toThrow("maxCer");
  await f.app.tts("Hello", { estimate: true });
  f.ports.confirm = async () => false;
  expect((await f.app.tts("Hello")).exitCode).toBe(1);
  expect(f.paid()).toHaveLength(0);
});

test("first voice pins later chunks, identical chunks deduplicate and complete cache persists", async () => {
  const f = fixture();
  await f.app.script("aaa bbb bbb ccc", { chunkChars: 4, output: "out.mp3", yes: true });
  expect(f.paid().map((call) => call.input.text)).toEqual(["aaa ", "bbb ", "ccc"]);
  expect(
    f
      .paid()
      .slice(1)
      .every((call) => call.input.voice_id === "pinned"),
  ).toBe(true);
  expect([...f.entries.values()].every((entry) => entry.status === "ready")).toBe(true);
  await f.app.script("aaa bbb bbb ccc", {
    chunkChars: 4,
    output: "again.mp3",
    yes: true,
    maxCredits: 0,
  });
  expect(f.paid()).toHaveLength(3);
});

test("download failure resumes generated response without another paid call", async () => {
  const f = fixture();
  f.ports.saveAudio = async () => {
    throw new Error("download interrupted");
  };
  await expect(f.app.tts("hello", { output: "out.mp3", yes: true })).rejects.toThrow("download");
  expect(f.transitions).toEqual(["pending", "generated"]);
  f.ports.saveAudio = async (_result, path) => path;
  await f.app.tts("hello", { output: "out.mp3", yes: true, maxCredits: 0 });
  expect(f.paid()).toHaveLength(1);
  expect(f.transitions.at(-1)).toBe("ready");
});

test("unknown transport outcome never retries, including on resume", async () => {
  const f = fixture();
  const call = f.ports.callTool;
  f.ports.callTool = async (name, input) => {
    const result = await call(name, input);
    if (name === "text_to_speech") throw new Error("connection lost");
    return result;
  };
  await expect(f.app.tts("hello", { yes: true })).rejects.toThrow("connection lost");
  await expect(f.app.tts("hello", { yes: true })).rejects.toThrow("Unknown");
  expect(f.paid()).toHaveLength(1);
});

test("explicit isError retries once, full input options isolate cache", async () => {
  const f = fixture();
  const call = f.ports.callTool;
  let rejected = false;
  f.ports.callTool = async (name, input) => {
    const result = await call(name, input);
    if (name === "text_to_speech" && !rejected) {
      rejected = true;
      return { ...result, isError: true };
    }
    return result;
  };
  await f.app.tts("hello", { yes: true, language: "en", toolInput: { speed: 1 } });
  await f.app.tts("hello", { yes: true, language: "ko", toolInput: { speed: 1 } });
  await f.app.tts("hello", { yes: true, language: "ko", toolInput: { speed: 2 } });
  expect(f.paid()).toHaveLength(4);
});

test("no-output TTS retains original result and a generated journal without downloading", async () => {
  const f = fixture();
  f.ports.readStdin = async () => " hello\n";
  const result = await f.app.tts("-", { yes: true });
  expect(f.paid()[0]?.input.text).toBe(" hello\n");
  expect(result.result.structuredContent).toEqual({
    audio_url: "https://example.com/audio.mp3",
    voice: { id: "pinned" },
    credits_charged: 7,
  });
  expect(f.writes).toEqual([]);
  expect(f.transitions).toEqual(["pending", "generated"]);
});

test("STT forwards validated @path to runtime, supports stdin, and formats speakers", async () => {
  const f = fixture();
  await f.app.transcribe("@take.wav", { output: "text.txt", speakers: true });
  expect(f.calls[0]?.input.audio_url).toBe("@take.wav");
  expect(f.writes[0]).toBe("Speaker 1: Hello\nSpeaker 2: world\n");
  f.ports.readStdin = async () => "https://example.com/audio.wav\n";
  const json = await f.app.transcribe("-", { format: "json" });
  expect(JSON.parse(String(resultData(json.result).rendered)).segments).toHaveLength(2);
});

test("roundtrip checks existing audio or generated TTS with bounded-memory CER", async () => {
  const f = fixture();
  const result = await f.app.roundtrip("Hello there", { audio: "take.wav", maxCer: 0 });
  expect(result.exitCode).toBe(1);
  expect(f.paid()).toHaveLength(0);
  const success = await f.app.roundtrip("Hello world", { yes: true, maxCer: 0 });
  expect(resultData(success.result).cer).toBe(0);
  expect(f.paid()).toHaveLength(1);
  expect(characterErrorRate("[pause] 안녕!", "안 녕")).toBe(0);
  expect(characterErrorRate("", "x")).toBe(1);
});

test("parallel failures drain active workers before rejecting and stop queued calls", async () => {
  const f = fixture();
  const call = f.ports.callTool;
  let release: (result: ToolResult) => void = () => {};
  const waiting = new Promise<ToolResult>((resolve) => {
    release = resolve;
  });
  let started: () => void = () => {};
  const active = new Promise<void>((resolve) => {
    started = resolve;
  });
  f.ports.callTool = async (name, input) => {
    const result = await call(name, input);
    if (name === "text_to_speech" && input.text === "bbb ") {
      await active;
      throw new Error("unknown");
    }
    if (name === "text_to_speech" && input.text === "ccc ") {
      started();
      return waiting;
    }
    return result;
  };
  let settled = false;
  const run = f.app
    .tts("aaa bbb ccc ddd", { chunkChars: 4, output: "out.mp3", concurrency: 2, yes: true })
    .catch((error) => {
      settled = true;
      return error;
    });
  await active;
  await Promise.resolve();
  expect(settled).toBe(false);
  release(resultOf({ audio_url: "https://example.com/c.mp3", voice: { id: "pinned" } }));
  expect(await run).toBeInstanceOf(Error);
  expect(f.paid().map((item) => item.input.text)).not.toContain("ddd");
});

test("parallel reservations include in-flight charges before starting another paid call", async () => {
  const f = fixture();
  const call = f.ports.callTool;
  f.ports.callTool = async (name, input) => {
    const result = await call(name, input);
    return name === "text_to_speech" && input.text === "aaa "
      ? resultOf({
          audio_url: "https://example.com/a.mp3",
          voice: { id: "pinned" },
          credits_charged: 17,
        })
      : result;
  };
  await expect(
    f.app.tts("aaa bbb ccc", {
      chunkChars: 4,
      output: "out.mp3",
      yes: true,
      concurrency: 2,
      maxCredits: 22,
    }),
  ).rejects.toThrow("reservation");
  expect(f.paid()).toHaveLength(1);
});

test("cancellation drains and journals active calls without dispatching queued chunks", async () => {
  const f = fixture();
  const call = f.ports.callTool;
  let cancelled = false;
  f.ports.cancelled = () => cancelled;
  f.ports.callTool = async (name, input) => {
    const result = await call(name, input);
    if (name === "text_to_speech" && input.text === "bbb ") cancelled = true;
    return result;
  };
  await expect(
    f.app.tts("aaa bbb ccc ddd", {
      chunkChars: 4,
      output: "out.mp3",
      yes: true,
      concurrency: 1,
    }),
  ).rejects.toThrow("cancelled");
  expect(f.paid().map((item) => item.input.text)).toEqual(["aaa ", "bbb "]);
  expect([...f.entries.values()].every((entry) => entry.status === "ready")).toBe(true);
  expect(f.writes).not.toContain("out.mp3");
});

test("transcript save failure and roundtrip rerun reuse the completed STT response", async () => {
  const f = fixture();
  let fail = true;
  f.ports.writeText = async () => {
    if (fail) throw new Error("disk full");
  };
  await expect(f.app.transcribe("@audio.wav", { output: "out.txt" })).rejects.toThrow("disk full");
  fail = false;
  await f.app.transcribe("@audio.wav", { output: "out.txt" });
  await f.app.roundtrip("Hello world", { audio: "audio.wav", maxCer: 0 });
  expect(f.calls.filter((call) => call.name === "speech_to_text")).toHaveLength(1);
});

test("STT cache follows audio contents and never retries uncertain outcomes", async () => {
  const f = fixture();
  let identity = "first-content";
  f.ports.audioIdentity = async () => identity;
  await f.app.transcribe("@audio.wav");
  await f.app.transcribe("@renamed.wav");
  expect(f.calls.filter((call) => call.name === "speech_to_text")).toHaveLength(1);
  identity = "changed-content";
  const original = f.ports.callTool;
  f.ports.callTool = async (name, input) => {
    await original(name, input);
    throw new Error("timeout");
  };
  await expect(f.app.transcribe("@audio.wav")).rejects.toThrow("timeout");
  await expect(f.app.transcribe("@audio.wav")).rejects.toThrow("Unknown STT");
  expect(f.calls.filter((call) => call.name === "speech_to_text")).toHaveLength(2);
});

test("pre-dispatch rejection leaves retryable journals without hiding the original error", async () => {
  const { CallNotStartedError, RepeatedCallError } = await import("@mcp-cli/core");
  const f = fixture();
  const original = f.ports.callTool;
  f.ports.callTool = async (name, input) => {
    if (name !== "get_credit_balance")
      throw new CallNotStartedError("refused", { cause: new RepeatedCallError("duplicate") });
    return original(name, input);
  };
  await expect(f.app.tts("hello", { yes: true })).rejects.toBeInstanceOf(CallNotStartedError);
  await expect(f.app.transcribe("https://example.com/audio.mp3")).rejects.toBeInstanceOf(
    CallNotStartedError,
  );
  expect([...f.entries.values()].every((entry) => entry.status === "failed")).toBe(true);
  f.ports.callTool = original;
  await f.app.tts("hello", { yes: true });
  await f.app.transcribe("https://example.com/audio.mp3");
  expect(f.paid()).toHaveLength(1);
});

test("roundtrip resolves file and stdin sources once even when text resembles a source", async () => {
  for (const text of ["@other.txt", "-"]) {
    const f = fixture();
    const reads: string[] = [];
    f.ports.readText = async (path) => {
      reads.push(path);
      return text;
    };
    f.ports.readStdin = async () => {
      throw new Error("Must not read stdin again");
    };
    await f.app.roundtrip("", { file: "script.txt", yes: true });
    expect(reads).toEqual(["script.txt"]);
    expect(f.paid()[0]?.input.text).toBe(text);
  }
});
