import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm, stat, utimes } from "node:fs/promises";

export type LockOptions = {
  /** Maximum time to wait for another holder before failing. */
  timeoutMs: number;
  /** A lock whose file was not touched for this long belongs to a dead holder and is removed. */
  staleMs: number;
  pollMs: number;
};

export const DEFAULT_LOCK_OPTIONS: LockOptions = { timeoutMs: 30000, staleMs: 15000, pollMs: 25 };

/** Another process held the credential lock past the wait timeout. */
export class LockTimeoutError extends Error {
  override name = "LockTimeoutError";
}

export const hasCode = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code;

const ignoreMissing = (error: unknown): undefined => {
  if (hasCode(error, "ENOENT")) return undefined;
  throw error;
};

const tryCreate = async (path: string, token: string): Promise<boolean> => {
  try {
    const handle = await open(path, "wx", 0o600);
    try {
      await handle.writeFile(token);
    } finally {
      await handle.close();
    }
    return true;
  } catch (error) {
    if (hasCode(error, "EEXIST")) return false;
    throw error;
  }
};

// Renaming first makes stale removal atomic, so two waiters cannot both delete a fresh lock.
const clearStale = async (path: string, staleMs: number): Promise<void> => {
  const info = await stat(path).catch(ignoreMissing);
  if (!info || Date.now() - info.mtimeMs < staleMs) return;
  const aside = `${path}.${randomUUID()}.stale`;
  const moved = await rename(path, aside).then(() => true, ignoreMissing);
  if (moved) await rm(aside, { force: true });
};

const release = async (path: string, token: string): Promise<void> => {
  const current = await readFile(path, "utf8").catch(ignoreMissing);
  if (current === token) await rm(path, { force: true });
};

/** Runs `fn` while holding an exclusive lock file, touching it so live holders never look stale. */
export const withFileLock = async <T>(
  path: string,
  options: LockOptions,
  fn: () => Promise<T>,
): Promise<T> => {
  const token = `${process.pid} ${randomUUID()}`;
  const deadline = Date.now() + options.timeoutMs;
  while (!(await tryCreate(path, token))) {
    await clearStale(path, options.staleMs);
    if (Date.now() >= deadline) throw new LockTimeoutError(`Timed out waiting for lock ${path}`);
    await Bun.sleep(options.pollMs);
  }
  const heartbeat = setInterval(
    () => {
      const now = new Date();
      utimes(path, now, now).catch(() => undefined);
    },
    Math.max(options.staleMs / 3, 10),
  );
  try {
    return await fn();
  } finally {
    clearInterval(heartbeat);
    await release(path, token);
  }
};
