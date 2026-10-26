import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CredentialsFormatError, credentialsDir, fileTokenStore, LockTimeoutError } from "../src";
import { withLockFile } from "../src/lock";

let root = "";
let dir = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mcp-cli-auth-"));
  dir = join(root, "credentials");
});
afterEach(() => rm(root, { recursive: true, force: true }));

const mode = async (path: string) => (await stat(path)).mode & 0o777;

test("credentials directory follows XDG_CONFIG_HOME and falls back to HOME", () => {
  expect(credentialsDir({ XDG_CONFIG_HOME: "/x" }, "/h")).toBe("/x/mcp-cli/credentials");
  expect(credentialsDir({ XDG_CONFIG_HOME: "relative" }, "/h")).toBe(
    "/h/.config/mcp-cli/credentials",
  );
  expect(credentialsDir({}, "/h")).toBe("/h/.config/mcp-cli/credentials");
});

test("write, read and delete round-trip with private permissions", async () => {
  const store = fileTokenStore({ dir });
  expect(await store.read("notion")).toBeUndefined();
  const tokens = { accessToken: "a", refreshToken: "r", expiresAt: 1, client: { id: "c" } };
  await store.write("notion", tokens);
  expect(await store.read("notion")).toEqual(tokens);
  expect(await mode(dir)).toBe(0o700);
  expect(await mode(join(dir, "notion.json"))).toBe(0o600);
  await store.delete("notion");
  expect(await store.read("notion")).toBeUndefined();
  await store.delete("notion");
});

test("concurrent writes leave one complete file and no temporary files", async () => {
  const store = fileTokenStore({ dir });
  await Promise.all(
    Array.from({ length: 20 }, (_, i) => store.write("notion", { accessToken: `token-${i}` })),
  );
  expect((await store.read("notion"))?.accessToken).toMatch(/^token-\d+$/);
  expect(await readdir(dir)).toEqual(["notion.json"]);
});

test("invalid service names and malformed files are rejected", async () => {
  const store = fileTokenStore({ dir });
  await expect(store.read("../escape")).rejects.toThrow("Invalid service name");
  await store.write("notion", { accessToken: "a" });
  await writeFile(join(dir, "notion.json"), "{");
  await expect(store.read("notion")).rejects.toThrow(CredentialsFormatError);
  await writeFile(join(dir, "notion.json"), JSON.stringify({ accessToken: 1 }));
  await expect(store.read("notion")).rejects.toThrow(CredentialsFormatError);
});

test("withLock serializes two concurrent holders", async () => {
  const store = fileTokenStore({ dir });
  const events: string[] = [];
  const hold = (name: string) =>
    store.withLock("notion", async () => {
      events.push(`${name}:start`);
      await Bun.sleep(50);
      events.push(`${name}:end`);
      return name;
    });
  expect(await Promise.all([hold("a"), hold("b")])).toEqual(["a", "b"]);
  expect(events[1]).toBe(`${events[0]?.split(":")[0]}:end`);
  expect(await readdir(dir)).toEqual(["notion.lock"]);
});

test("withLock releases the lock when the holder throws", async () => {
  const store = fileTokenStore({ dir });
  await expect(
    store.withLock("notion", async () => {
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");
  expect(await store.withLock("notion", async () => "next")).toBe("next");
});

test("a stale lock from a dead holder is removed", async () => {
  const store = fileTokenStore({ dir, lock: { staleMs: 1000, timeoutMs: 2000 } });
  await store.write("notion", { accessToken: "a" });
  const lock = join(dir, "notion.lock");
  await writeFile(lock, "999999 dead");
  const old = new Date(Date.now() - 5000);
  await utimes(lock, old, old);
  const started = Date.now();
  expect(await store.withLock("notion", async () => "acquired")).toBe("acquired");
  expect(Date.now() - started).toBeLessThan(1000);
});

test("waiting for a live holder is bounded", async () => {
  const store = fileTokenStore({ dir, lock: { staleMs: 60000, timeoutMs: 100 } });
  let release = () => {};
  const holding = store.withLock(
    "notion",
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await Bun.sleep(20);
  await expect(store.withLock("notion", async () => undefined)).rejects.toThrow(LockTimeoutError);
  release();
  await holding;
});

const child = (mode: string) =>
  Bun.spawn([process.execPath, join(import.meta.dir, "fixtures", "lock-child.ts"), dir, mode], {
    stdout: "pipe",
    stderr: "inherit",
  });

test("separate processes never overlap inside withLock", async () => {
  const children = Array.from({ length: 8 }, () => child("increment"));
  expect(await Promise.all(children.map((process) => process.exited))).toEqual(
    Array.from({ length: 8 }, () => 0),
  );
  expect(await readFile(join(dir, "counter"), "utf8")).toBe("8");
});

test("the kernel releases the lock of a killed holder without waiting for staleness", async () => {
  const holder = child("hold");
  const reader = holder.stdout.getReader();
  await reader.read();
  const store = fileTokenStore({ dir, lock: { staleMs: 60000, timeoutMs: 100 } });
  await expect(store.withLock("svc", async () => undefined)).rejects.toThrow(LockTimeoutError);
  holder.kill("SIGKILL");
  await holder.exited;
  const started = Date.now();
  const relaxed = fileTokenStore({ dir, lock: { staleMs: 60000, timeoutMs: 2000 } });
  expect(await relaxed.withLock("svc", async () => "acquired")).toBe("acquired");
  expect(Date.now() - started).toBeLessThan(1000);
});

test("the lock-file fallback keeps one holder when waiters race to clear a stale lock", async () => {
  const options = { staleMs: 200, timeoutMs: 5000, pollMs: 1 };
  await mkdir(dir, { recursive: true });
  for (let round = 0; round < 20; round++) {
    const path = join(dir, `race-${round}.lock`);
    await writeFile(path, "999999 dead");
    const old = new Date(Date.now() - 5000);
    await utimes(path, old, old);
    let inside = 0;
    let overlap = false;
    const hold = () =>
      withLockFile(path, options, async () => {
        inside++;
        if (inside > 1) overlap = true;
        await Bun.sleep(2);
        inside--;
      });
    await Promise.all(Array.from({ length: 6 }, hold));
    expect(overlap).toBe(false);
  }
});

test("the fallback never steals an old lock from a live process", async () => {
  await mkdir(dir, { recursive: true });
  const path = join(dir, "live.lock");
  const owner = `${process.pid} live-holder`;
  await writeFile(path, owner);
  const old = new Date(Date.now() - 5000);
  await utimes(path, old, old);
  let entered = false;
  await expect(
    withLockFile(path, { staleMs: 1, timeoutMs: 50, pollMs: 1 }, async () => {
      entered = true;
    }),
  ).rejects.toThrow(LockTimeoutError);
  expect(entered).toBe(false);
  expect(await readFile(path, "utf8")).toBe(owner);
});

test("a held transition guard prevents stale cleanup and acquisition", async () => {
  await mkdir(dir, { recursive: true });
  const path = join(dir, "svc.lock");
  await mkdir(`${path}.guard`);
  await writeFile(path, "999999 dead");
  const old = new Date(Date.now() - 5000);
  await utimes(path, old, old);
  let entered = false;
  const options = { staleMs: 1, timeoutMs: 30, pollMs: 1 };
  await expect(
    withLockFile(path, options, async () => {
      entered = true;
    }),
  ).rejects.toThrow(LockTimeoutError);
  expect(entered).toBe(false);
  expect(await readFile(path, "utf8")).toBe("999999 dead");
  await rm(`${path}.guard`, { recursive: true });
  expect(await withLockFile(path, options, async () => "recovered")).toBe("recovered");
  expect(await readdir(dir)).toEqual([]);
});

test("unknown fallback owners are retained instead of being guessed dead", async () => {
  await mkdir(dir, { recursive: true });
  const path = join(dir, "unknown.lock");
  for (const owner of ["", "broken", "0 owner", "-1 owner"]) {
    await writeFile(path, owner);
    const old = new Date(Date.now() - 5000);
    await utimes(path, old, old);
    await expect(
      withLockFile(path, { staleMs: 1, timeoutMs: 15, pollMs: 1 }, async () => {}),
    ).rejects.toThrow(LockTimeoutError);
    expect(await readFile(path, "utf8")).toBe(owner);
  }
});

test("fallback critical sections do not overlap across independent processes", async () => {
  const children = Array.from({ length: 8 }, () => child("file-increment"));
  expect(await Promise.all(children.map((process) => process.exited))).toEqual(Array(8).fill(0));
  expect(await readFile(join(dir, "counter"), "utf8")).toBe("8");
  expect(await readdir(dir)).toEqual(["counter"]);
});

test("fallback recovers an exited owner after its transition guard is released", async () => {
  const holder = child("file-hold");
  const reader = holder.stdout.getReader();
  await reader.read();
  holder.kill("SIGKILL");
  await holder.exited;
  const path = join(dir, "svc.lock");
  const old = new Date(Date.now() - 5000);
  await utimes(path, old, old);
  expect(
    await withLockFile(path, { staleMs: 1, timeoutMs: 1000, pollMs: 1 }, async () => "recovered"),
  ).toBe("recovered");
  expect(await readdir(dir)).toEqual([]);
});

test("fallback releases both the lock and guard when the protected operation throws", async () => {
  await mkdir(dir, { recursive: true });
  const path = join(dir, "error.lock");
  const options = { staleMs: 1000, timeoutMs: 1000, pollMs: 1 };
  await expect(
    withLockFile(path, options, async () => {
      throw new Error("operation failed");
    }),
  ).rejects.toThrow("operation failed");
  expect(await readdir(dir)).toEqual([]);
  expect(await withLockFile(path, options, async () => "next")).toBe("next");
});
