import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CredentialsFormatError, credentialsDir, fileTokenStore, LockTimeoutError } from "../src";

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
  expect(await readdir(dir)).toEqual([]);
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
