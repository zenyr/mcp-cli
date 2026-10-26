import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isRecord, type SettingsStore } from "@mcp-cli/core";
import { checked, ensurePrivateDir, writeAtomic } from "./files";
import { DEFAULT_LOCK_OPTIONS, hasCode, withFileLock } from "./lock";

export const fileSettingsStore = (directory: string): SettingsStore => {
  const path = (name: string) => join(directory, `${checked(name)}.json`);
  return {
    read: async (name) => {
      const text = await readFile(path(name), "utf8").catch((error: unknown) => {
        if (hasCode(error, "ENOENT")) return undefined;
        throw error;
      });
      if (text === undefined) return undefined;
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        throw new Error("Invalid authentication settings JSON");
      }
      if (!isRecord(value)) throw new Error("Invalid authentication settings object");
      return value;
    },
    write: async (name, value) => {
      await ensurePrivateDir(directory);
      await writeAtomic(path(name), `${JSON.stringify(value, null, 2)}\n`);
    },
    withLock: async (name, run) => {
      const lock = join(directory, `${checked(name)}.lock`);
      await ensurePrivateDir(dirname(lock));
      return withFileLock(lock, DEFAULT_LOCK_OPTIONS, run);
    },
  };
};
