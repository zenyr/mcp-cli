import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm, rmdir, stat } from "node:fs/promises";
import { flock, type Flock } from "./flock";

export type LockOptions = {
  /** Maximum time to wait for another holder before failing. */
  timeoutMs: number;
  /** Minimum age before recovering a fallback lock whose owner is confirmed dead. */
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
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    } finally {
      await handle.close();
    }
    return true;
  } catch (error) {
    if (hasCode(error, "EEXIST")) return false;
    throw error;
  }
};

/** Serializes every fallback lock transition without ever reclaiming a possibly live guard. */
const withGuard = async <T>(
  path: string,
  options: LockOptions,
  deadline: number,
  run: () => Promise<T>,
): Promise<T> => {
  const guard = `${path}.guard`;
  for (;;) {
    const acquired = await mkdir(guard, { mode: 0o700 }).then(
      () => true,
      (error: unknown) => {
        if (hasCode(error, "EEXIST")) return false;
        throw error;
      },
    );
    if (acquired) break;
    if (Date.now() >= deadline)
      throw new LockTimeoutError(
        `Timed out waiting for lock guard ${guard}; verify that no process uses it before manual recovery`,
      );
    await Bun.sleep(options.pollMs);
  }
  try {
    return await run();
  } finally {
    await rmdir(guard);
  }
};

const ownerIsDead = (contents: string): boolean => {
  const match = /^(\d+) \S+$/.exec(contents);
  const pid = Number(match?.[1]);
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return hasCode(error, "ESRCH");
  }
};

const clearStaleLocked = async (path: string, staleMs: number): Promise<void> => {
  const info = await stat(path).catch(ignoreMissing);
  if (!info || Date.now() - info.mtimeMs < staleMs) return;
  const observed = await readFile(path, "utf8").catch(ignoreMissing);
  if (observed !== undefined && ownerIsDead(observed)) await rm(path);
};

const release = async (path: string, token: string): Promise<void> => {
  const current = await readFile(path, "utf8").catch(ignoreMissing);
  if (current === token) await rm(path, { force: true });
};

/** Uses a transition guard and local PID liveness when kernel locking is unavailable. */
export const withLockFile = async <T>(
  path: string,
  options: LockOptions,
  fn: () => Promise<T>,
): Promise<T> => {
  const token = `${process.pid} ${randomUUID()}`;
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    const acquired = await withGuard(path, options, deadline, async () => {
      if (await tryCreate(path, token)) return true;
      await clearStaleLocked(path, options.staleMs);
      return tryCreate(path, token);
    });
    if (acquired) break;
    if (Date.now() >= deadline) throw new LockTimeoutError(`Timed out waiting for lock ${path}`);
    await Bun.sleep(options.pollMs);
  }
  try {
    return await fn();
  } finally {
    await withGuard(path, options, Date.now() + options.timeoutMs, () => release(path, token));
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
