import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { stat } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { createInterface } from "node:readline/promises";
import { UsageError, type ExtensionContext } from "@mcp-cli/core";
import type { FishPorts } from "../application/ports";
import { copyAudio, ensureConverter, joinAudio, saveAudio, writeText } from "./files";
import { createStore } from "./store";

export const createPorts = (
  context: ExtensionContext,
  output: string | undefined,
  signal: AbortSignal,
): FishPorts & { acquire: () => Promise<void>; release: () => Promise<void> } => {
  let stdin: Promise<string> | undefined;
  const scope = context.cacheScope ?? "offline-test";
  const configured = process.env.XDG_CACHE_HOME;
  const root = configured && isAbsolute(configured) ? configured : join(homedir(), ".cache");
  const cacheRoot = context.cacheScope || !output ? join(root, "mcp-cli", "fish-audio") : undefined;
  return {
    callTool: context.callTool,
    readText: context.io.readFile,
    readStdin: () => (stdin ??= context.io.readStdin()),
    saveAudio,
    joinAudio,
    ensureConverter,
    copyAudio,
    writeText,
    cancelled: () => signal.aborted,
    delay: (seconds) => sleep(seconds * 1000, undefined, { signal }),
    ...createStore(output, scope, cacheRoot),
    confirm: async (message) => {
      if (!process.stdin.isTTY || !process.stderr.isTTY || stdin || signal.aborted) return false;
      const prompt = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return /^(y|yes)$/i.test((await prompt.question(`${message} [y/N] `, { signal })).trim());
      } finally {
        prompt.close();
      }
    },
    audioIdentity: async (reference) =>
      reference.startsWith("@")
        ? `sha256:${createHash("sha256")
            .update(await context.io.readBytes(reference.slice(1)))
            .digest("hex")}`
        : reference,
    prepareAudioReference: async (path) => {
      const info = await stat(path);
      if (!info.isFile() || info.size < 1 || info.size > 20_000_000)
        throw new UsageError("Audio input must be a nonempty regular file of at most 20 MB");
      const bytes = await context.io.readBytes(path);
      if (!bytes.length || bytes.length > 20_000_000)
        throw new UsageError("Audio input must be nonempty and at most 20 MB");
      return `@${path}`;
    },
  };
};
