import { dlopen, FFIType } from "bun:ffi";

const LOCK_EX = 2;
const LOCK_NB = 4;
const LOCK_UN = 8;

const libraries: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: ["libc.dylib", "/usr/lib/libSystem.B.dylib"],
  linux: ["libc.so.6", "libc.so"],
  freebsd: ["libc.so.7"],
};

export type Flock = {
  /** Takes an exclusive lock without blocking; false while another open file holds it. */
  tryLock: (fd: number) => boolean;
  unlock: (fd: number) => void;
};

const load = (): Flock | undefined => {
  for (const name of libraries[process.platform] ?? []) {
    try {
      const { symbols } = dlopen(name, {
        flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
      });
      return {
        tryLock: (fd) => symbols.flock(fd, LOCK_EX | LOCK_NB) === 0,
        unlock: (fd) => void symbols.flock(fd, LOCK_UN),
      };
    } catch {
      // Tries the next library name; platforms without flock use the lock-file fallback.
    }
  }
  return undefined;
};

/** Kernel advisory locks are released when the holder exits or crashes, so they never go stale. */
export const flock: Flock | undefined = load();
