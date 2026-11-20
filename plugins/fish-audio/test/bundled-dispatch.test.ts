import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CallNotStartedError, isRecord } from "@mcp-cli/core";
import type { JournalEntry } from "../src/application/ports";

test("a bundled dispatch marks the journal failed when the host refuses the call", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fish-bundled-dispatch-"));
  try {
    const built = await Bun.build({
      entrypoints: [fileURLToPath(new URL("../src/application/dispatch.ts", import.meta.url))],
      outdir: directory,
      naming: "plugin.mjs",
      target: "bun",
    });
    expect(built.success).toBe(true);
    const plugin: unknown = await import(pathToFileURL(join(directory, "plugin.mjs")).href);
    if (!isRecord(plugin) || typeof plugin.dispatch !== "function")
      throw new Error("expected a bundled dispatch export");
    const entries = new Map<string, JournalEntry>();
    const ports = {
      store: {
        put: async (key: string, entry: JournalEntry) => {
          entries.set(key, entry);
        },
      },
      callTool: async () => {
        throw new CallNotStartedError("refused");
      },
    };
    await expect(
      Reflect.apply(plugin.dispatch, undefined, [ports, "key", "text_to_speech", {}]),
    ).rejects.toBeInstanceOf(CallNotStartedError);
    expect(entries.get("key")?.status).toBe("failed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
