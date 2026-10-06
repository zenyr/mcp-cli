import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { isRecord, type CallRecord, type RepeatGuard } from "@mcp-cli/core";
import { checked, ensurePrivateDir, writeAtomic } from "./files";
import { DEFAULT_LOCK_OPTIONS, hasCode, withFileLock, type LockOptions } from "./lock";

type Env = Record<string, string | undefined>;
export type FileRepeatGuardOptions = {
  windowMs: number;
  /** Journal directory; defaults to `$XDG_STATE_HOME/mcp-cli/calls`. */
  dir?: string;
  env?: Env;
  home?: string;
  lock?: Partial<LockOptions>;
  now?: () => number;
};
type Journal = Record<string, CallRecord>;

export const repeatGuardDir = (env: Env = process.env, home = env.HOME || homedir()): string => {
  const xdg = env.XDG_STATE_HOME;
  const base = xdg && isAbsolute(xdg) ? xdg : join(home, ".local", "state");
  return join(base, "mcp-cli", "calls");
};

const isCallRecord = (value: unknown): value is CallRecord =>
  isRecord(value) &&
  typeof value.tool === "string" &&
  typeof value.at === "number" &&
  typeof value.attempt === "string" &&
  (value.status === "pending" || value.status === "ok" || value.status === "error");

// The journal only prevents accidents, so an unreadable file starts over instead of failing the call.
const readJournal = async (path: string): Promise<Journal> => {
  const text = await readFile(path, "utf8").catch((error: unknown) => {
    if (hasCode(error, "ENOENT")) return "{}";
    throw error;
  });
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return {};
  }
  if (!isRecord(value)) return {};
  const journal: Journal = {};
  for (const [key, record] of Object.entries(value))
    if (isCallRecord(record)) journal[key] = record;
  return journal;
};

/** File-backed journal: one JSON file per service, pruned to the window on every write. */
export const fileRepeatGuard = (options: FileRepeatGuardOptions): RepeatGuard => {
  const dir = options.dir ?? repeatGuardDir(options.env, options.home);
  const lock = { ...DEFAULT_LOCK_OPTIONS, ...options.lock };
  const now = options.now ?? Date.now;
  const update = async <T>(
    service: string,
    fn: (journal: Journal, at: number) => T,
  ): Promise<T> => {
    const path = join(dir, `${checked(service)}.json`);
    await ensurePrivateDir(dir);
    return withFileLock(join(dir, `${service}.lock`), lock, async () => {
      const at = now();
      const journal = await readJournal(path);
      for (const [key, record] of Object.entries(journal))
        if (at - record.at >= options.windowMs) delete journal[key];
      const result = fn(journal, at);
      await writeAtomic(path, `${JSON.stringify(journal)}\n`);
      return result;
    });
  };
  return {
    begin: (service, key, tool, attempt) =>
      update(service, (journal, at) => {
        const earlier = journal[key];
        if (earlier && earlier.status !== "error") return earlier;
        journal[key] = { tool, at, status: "pending", attempt };
        return undefined;
      }),
    finish: async (service, key, attempt, status) => {
      await update(service, (journal) => {
        const record = journal[key];
        if (record?.attempt === attempt) journal[key] = { ...record, status };
      });
    },
  };
};
