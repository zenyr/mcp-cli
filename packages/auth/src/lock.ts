import { randomUUID } from "node:crypto";
import { link, open, readFile, rename, rm, stat, utimes } from "node:fs/promises";
import { flock, type Flock } from "./flock";

export type LockOptions = {
  /** Maximum time to wait for another holder before failing. */
  timeoutMs: number;
  /** Lock-file fallback only: a lock not touched for this long belongs to a dead holder. */
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

/** Moves aside the lock last seen holding `observed`, restoring it if another waiter replaced it. */
export const takeStale = async (path: string, observed: string): Promise<void> => {
  const aside = `${path}.${randomUUID()}.stale`;
  const moved = await rename(path, aside).then(() => true, ignoreMissing);
  if (!moved) return;
  const taken = await readFile(aside, "utf8").catch(ignoreMissing);
  if (taken !== observed)
    await link(aside, path).catch((error: unknown) => {
      if (!hasCode(error, "EEXIST")) throw error;
    });
  await rm(aside, { force: true });
};

const clearStale = async (path: string, staleMs: number): Promise<void> => {
  const info = await stat(path).catch(ignoreMissing);
  if (!info || Date.now() - info.mtimeMs < staleMs) return;
  const observed = await readFile(path, "utf8").catch(ignoreMissing);
  if (observed !== undefined) await takeStale(path, observed);
};

const release = async (path: string, token: string): Promise<void> => {
  const current = await readFile(path, "utf8").catch(ignoreMissing);
  if (current === token) await rm(path, { force: true });
};

/** Lock-file fallback for platforms without `flock`; liveness comes from a heartbeat. */
export const withLockFile = async <T>(
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

/** Holds a kernel `flock` on the file; the file is never deleted, which avoids unlink races. */
export const withKernelLock = async <T>(
  kernel: Flock,
  path: string,
  options: LockOptions,
  fn: () => Promise<T>,
): Promise<T> => {
  const handle = await open(path, "a", 0o600);
  try {
    const deadline = Date.now() + options.timeoutMs;
    while (!kernel.tryLock(handle.fd)) {
      if (Date.now() >= deadline) throw new LockTimeoutError(`Timed out waiting for lock ${path}`);
      await Bun.sleep(options.pollMs);
    }
    try {
      return await fn();
    } finally {
      kernel.unlock(handle.fd);
    }
  } finally {
    await handle.close();
  }
};

/** Runs `fn` under an exclusive cross-process lock, preferring kernel locks over lock files. */
export const withFileLock = <T>(
  path: string,
  options: LockOptions,
  fn: () => Promise<T>,
): Promise<T> =>
  flock ? withKernelLock(flock, path, options, fn) : withLockFile(path, options, fn);
