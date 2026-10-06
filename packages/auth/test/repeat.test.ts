import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileRepeatGuard, repeatGuardDir } from "../src";

let root = "";
let clock = 0;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mcp-cli-repeat-"));
  clock = 1_000_000;
});
afterEach(() => rm(root, { recursive: true, force: true }));
const guard = () => fileRepeatGuard({ dir: root, windowMs: 300_000, now: () => clock });

test("journal directory follows XDG_STATE_HOME and falls back to HOME", () => {
  expect(repeatGuardDir({ XDG_STATE_HOME: "/s" }, "/h")).toBe("/s/mcp-cli/calls");
  expect(repeatGuardDir({}, "/h")).toBe("/h/.local/state/mcp-cli/calls");
});

test("pending and successful calls block an identical call inside the window", async () => {
  const calls = guard();
  expect(await calls.begin("slack", "k", "send", "a1")).toBeUndefined();
  expect(await calls.begin("slack", "k", "send", "a2")).toEqual({
    tool: "send",
    at: clock,
    status: "pending",
    attempt: "a1",
  });
  await calls.finish("slack", "k", "a1", "ok");
  clock += 299_999;
  expect((await calls.begin("slack", "k", "send", "a3"))?.status).toBe("ok");
  expect(await calls.begin("slack", "other", "send", "a4")).toBeUndefined();
  expect(await calls.begin("linear", "k", "send", "a5")).toBeUndefined();
  expect((await stat(join(root, "slack.json"))).mode & 0o777).toBe(0o600);
});

test("tool errors and expired records allow the call again", async () => {
  const calls = guard();
  await calls.begin("slack", "k", "send", "a1");
  await calls.finish("slack", "k", "a1", "error");
  expect(await calls.begin("slack", "k", "send", "a2")).toBeUndefined();
  await calls.finish("slack", "k", "a2", "ok");
  clock += 300_000;
  expect(await calls.begin("slack", "k", "send", "a3")).toBeUndefined();
  const journal = JSON.parse(await readFile(join(root, "slack.json"), "utf8"));
  expect(journal).toEqual({ k: { tool: "send", at: clock, status: "pending", attempt: "a3" } });
});

test("a late finish from an expired attempt cannot settle the newer attempt", async () => {
  const calls = guard();
  await calls.begin("slack", "k", "send", "old");
  clock += 300_000;
  expect(await calls.begin("slack", "k", "send", "new")).toBeUndefined();
  await calls.finish("slack", "k", "old", "error");
  expect((await calls.begin("slack", "k", "send", "third"))?.attempt).toBe("new");
});

test("a malformed journal starts over instead of failing the call", async () => {
  await writeFile(join(root, "slack.json"), "{broken");
  expect(await guard().begin("slack", "k", "send", "a1")).toBeUndefined();
  await writeFile(join(root, "slack.json"), JSON.stringify({ k: { tool: 1 }, j: "x" }));
  expect(await guard().begin("slack", "k", "send", "a2")).toBeUndefined();
});

test("concurrent identical calls let exactly one through", async () => {
  const calls = guard();
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      fileRepeatGuard({ dir: root, windowMs: 300_000 }).begin("slack", "k", "send", `a${index}`),
    ),
  );
  expect(results.filter((result) => result === undefined)).toHaveLength(1);
  expect(await calls.begin("slack", "k", "send", "late")).toBeDefined();
});

test("records written before attempt ids still block until they expire", async () => {
  const legacy = (status: "pending" | "ok" | "error", at = clock) => ({ tool: "send", at, status });
  await writeFile(
    join(root, "slack.json"),
    JSON.stringify({
      ok: legacy("ok"),
      pending: legacy("pending"),
      error: legacy("error"),
      expired: legacy("ok", clock - 300_000),
    }),
  );
  const calls = guard();
  expect(await calls.begin("slack", "ok", "send", "a1")).toEqual({ ...legacy("ok"), attempt: "" });
  expect((await calls.begin("slack", "pending", "send", "a2"))?.status).toBe("pending");
  expect(await calls.begin("slack", "error", "send", "a3")).toBeUndefined();
  expect(await calls.begin("slack", "expired", "send", "a4")).toBeUndefined();
});
