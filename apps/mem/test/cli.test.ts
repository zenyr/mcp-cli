import { describe, expect, test } from "bun:test";
import { parse, readRecord, recall } from "../src/commands";
import { openStore } from "../src/store";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Scope } from "../src/types";

const scope: Scope = { id: "global", name: "Global", kind: "global" };
describe("mem CLI pages", () => {
  test("rejects ambiguous input and unknown options", () => {
    for (const args of [
      ["save", "text", "--stdin"],
      ["status", "--wat"],
      ["status", "--global", "--project"],
      ["read", "global/0", "--max-bytes", "511"],
    ])
      expect(() => parse(args)).toThrow();
  });
  test("reads scalar pages without losing escaped or multibyte text", () => {
    const directory = mkdtempSync(join(tmpdir(), "mem-cli-"));
    const store = openStore(join(directory, "db"));
    try {
      store.scope(scope);
      const text = '😀한글"\\\n'.repeat(250);
      store.append(scope.id, "note", text, "r");
      let cursor: string | null = "0";
      let reconstructed = "";
      while (cursor !== null) {
        const page = readRecord(
          store,
          [scope],
          parse(["read", "global/0", "--max-bytes", "512", "--cursor", cursor]),
        );
        expect(Buffer.byteLength(`${JSON.stringify(page)}\n`)).toBeLessThanOrEqual(512);
        if (typeof page !== "object" || page === null || !("text" in page) || !("cursor" in page))
          throw new Error("Invalid page");
        expect(typeof page.text).toBe("string");
        reconstructed += String(page.text);
        cursor = typeof page.cursor === "string" ? page.cursor : null;
      }
      expect(reconstructed).toBe(text);
      expect(() => readRecord(store, [], parse(["read", "global/0"]))).toThrow();
    } finally {
      store.close();
      rmSync(directory, { recursive: true });
    }
  });
  test("recall cursor preserves boundaries and does not skip hits", () => {
    const directory = mkdtempSync(join(tmpdir(), "mem-cli-"));
    const store = openStore(join(directory, "db"));
    try {
      store.scope(scope);
      for (let i = 0; i < 12; i++)
        store.append(scope.id, "note", `CAFÉ ${i} ${"x".repeat(300)}`, String(i));
      let cursor: string | undefined;
      const ids: string[] = [];
      do {
        const args = ["recall", "café", "--max-bytes", "512"];
        if (cursor) args.push("--cursor", cursor);
        const page = recall(store, [scope], parse(args));
        expect(Buffer.byteLength(`${JSON.stringify(page)}\n`)).toBeLessThanOrEqual(512);
        if (
          typeof page !== "object" ||
          page === null ||
          !("results" in page) ||
          !Array.isArray(page.results) ||
          !("cursor" in page)
        )
          throw new Error("Invalid page");
        for (const item of page.results) ids.push(item.recordId);
        cursor = typeof page.cursor === "string" ? page.cursor : undefined;
        if (ids.length === 1) store.append(scope.id, "note", "café later", "later");
      } while (cursor);
      expect(ids.length).toBe(12);
      expect(new Set(ids).size).toBe(12);
    } finally {
      store.close();
      rmSync(directory, { recursive: true });
    }
  });
});

test("CLI saves raw text, reports recovery, retries and reads global records", async () => {
  const { main } = await import("../src/main");
  const directory = mkdtempSync(join(tmpdir(), "mem-main-"));
  let stdout = "";
  let broken = true;
  let calls = 0;
  const dependencies = {
    cwd: directory,
    env: {
      HOME: directory,
      XDG_CONFIG_HOME: join(directory, "config"),
      XDG_DATA_HOME: join(directory, "data"),
      MEM_NODE_BYTES: "8",
    },
    io: {
      write: (text: string) => {
        stdout += text;
      },
      readFile: async () => "file source",
      readStdin: async () => "stdin source",
    },
    compress: async () => {
      calls++;
      if (broken) throw new Error("fixture failure");
      return { text: "brief", inputTokens: 2, outputTokens: 1, model: "fixture" };
    },
  };
  const run = async (args: string[]) => {
    stdout = "";
    const code = await main(args, dependencies);
    const value: unknown = JSON.parse(stdout);
    return { code, value, stdout };
  };
  try {
    const receipt = "550e8400-e29b-41d4-a716-446655440000";
    const saved = await run([
      "save",
      "long raw text for compression",
      "--global",
      "--receipt",
      receipt,
    ]);
    expect(saved.code).toBe(1);
    expect(saved.stdout).toContain('"recordId":"global/0"');
    expect(saved.stdout).toContain('"recoveryCommand":"mem summarize --global"');
    expect((await run(["read", "global/0", "--global"])).stdout).toContain(
      "long raw text for compression",
    );
    expect((await run(["start", "--global"])).code).toBe(1);
    broken = false;
    expect((await run(["summarize", "--global"])).code).toBe(0);
    const beforeStart = calls;
    expect((await run(["start", "--global"])).code).toBe(0);
    expect(calls).toBe(beforeStart);
    expect(
      (await run(["save", "long raw text for compression", "--global", "--receipt", receipt])).code,
    ).toBe(0);
    expect((await run(["save", "different", "--global", "--receipt", receipt])).stdout).toContain(
      "IDEMPOTENCY_CONFLICT",
    );
    expect((await run(["save", "--global", "--stdin"])).code).toBe(0);
    expect((await run(["save", "--global", "--file", "fixture"])).code).toBe(0);
    expect((await run(["status", "--unknown"])).code).toBe(2);
    expect((await run(["config", "--base-url", "file:///tmp/model"])).stdout).toContain(
      "INVALID_CONFIG",
    );
    expect((await run(["save", "outside"])).code).toBe(1);
    expect((await run(["read", "project-other/0", "--global"])).stdout).toContain(
      "RECORD_UNAVAILABLE",
    );
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("recall excerpts include a match beyond the original prefix", () => {
  const directory = mkdtempSync(join(tmpdir(), "mem-excerpt-"));
  const store = openStore(join(directory, "db"));
  try {
    store.scope(scope);
    store.append(scope.id, "note", `${"unrelated ".repeat(100)}E731 token expired`, "r");
    const page = recall(store, [scope], parse(["recall", "E731"]));
    expect(JSON.stringify(page)).toContain("E731 token expired");
  } finally {
    store.close();
    rmSync(directory, { recursive: true });
  }
});

test("root script and direct entry point expose identical help", async () => {
  const root = join(import.meta.dir, "../../..");
  const run = async (args: string[]) => {
    const child = Bun.spawn([process.execPath, ...args], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code).toBe(0);
    return stdout;
  };
  expect(await run(["run", "mem", "--help"])).toBe(await run(["apps/mem/src/main.ts", "--help"]));
});

test("small error packets retain saved identity and receipt after summary failure", async () => {
  const { main } = await import("../src/main");
  const directory = mkdtempSync(join(tmpdir(), "mem-error-"));
  const git = async (args: string[]) => {
    const child = Bun.spawn(["git", "-C", directory, ...args], { stdout: "pipe", stderr: "pipe" });
    const [code] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code).toBe(0);
  };
  try {
    await git(["init"]);
    await git(["config", "mem.project-id", "x".repeat(128)]);
    let stdout = "";
    const receipt = "550e8400-e29b-41d4-a716-446655440000";
    const code = await main(["save", "long record", "--receipt", receipt, "--max-bytes", "512"], {
      cwd: directory,
      env: { HOME: directory, MEM_NODE_BYTES: "1" },
      compress: async () => {
        throw Object.assign(new Error("fixture"), { code: "MODEL_OUTPUT_INCOMPLETE" });
      },
      io: {
        write: (text) => {
          stdout += text;
        },
        readFile: async () => "",
        readStdin: async () => "",
      },
    });
    expect(code).toBe(1);
    expect(Buffer.byteLength(stdout)).toBeLessThanOrEqual(512);
    expect(stdout).toContain(receipt);
    expect(stdout).toContain(`project-${"x".repeat(128)}/0`);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
