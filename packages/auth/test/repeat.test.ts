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
  expect(await calls.begin("slack", "k", "send")).toBeUndefined();
  expect(await calls.begin("slack", "k", "send")).toEqual({
    tool: "send",
    at: clock,
    status: "pending",
  });
  await calls.finish("slack", "k", "ok");
  clock += 299_999;
  expect((await calls.begin("slack", "k", "send"))?.status).toBe("ok");
  expect(await calls.begin("slack", "other", "send")).toBeUndefined();
  expect(await calls.begin("linear", "k", "send")).toBeUndefined();
  expect((await stat(join(root, "slack.json"))).mode & 0o777).toBe(0o600);
});

test("tool errors and expired records allow the call again", async () => {
  const calls = guard();
  await calls.begin("slack", "k", "send");
  await calls.finish("slack", "k", "error");
  expect(await calls.begin("slack", "k", "send")).toBeUndefined();
  await calls.finish("slack", "k", "ok");
  clock += 300_000;
  expect(await calls.begin("slack", "k", "send")).toBeUndefined();
  const journal = JSON.parse(await readFile(join(root, "slack.json"), "utf8"));
  expect(journal).toEqual({ k: { tool: "send", at: clock, status: "pending" } });
});

test("a malformed journal starts over instead of failing the call", async () => {
  await writeFile(join(root, "slack.json"), "{broken");
  expect(await guard().begin("slack", "k", "send")).toBeUndefined();
  await writeFile(join(root, "slack.json"), JSON.stringify({ k: { tool: 1 }, j: "x" }));
  expect(await guard().begin("slack", "k", "send")).toBeUndefined();
});

test("concurrent identical calls let exactly one through", async () => {
  const calls = guard();
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      fileRepeatGuard({ dir: root, windowMs: 300_000 }).begin("slack", "k", "send"),
    ),
  );
  expect(results.filter((result) => result === undefined)).toHaveLength(1);
  expect(await calls.begin("slack", "k", "send")).toBeDefined();
});
