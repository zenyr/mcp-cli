import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "../src";
import plugin from "../../../plugins/demo/src";

test("real stdio MCP discovery and execution", async () => {
  const session = await connect(plugin.connection({}));
  try {
    const tools = await session.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["demo-echo", "demo-fail"]);
    expect(await session.callTool("demo-echo", { text: "hello", count: 2 })).toMatchObject({
      content: [{ type: "text", text: "hello\nhello" }],
    });
    expect((await session.callTool("demo-fail", {})).isError).toBe(true);
  } finally {
    await session.close();
  }
});

test("connection timeout closes a silent stdio process", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-to-cli-timeout-"));
  const pidFile = join(directory, "pid");
  try {
    const script = `await Bun.write(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
    await expect(
      connect({ type: "stdio", command: "bun", args: ["-e", script] }, { timeoutMs: 200 }),
    ).rejects.toThrow();
    const pid = Number(await readFile(pidFile, "utf8"));
    expect(Number.isInteger(pid) && pid > 0).toBe(true);
    const isRunning = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let attempt = 0; attempt < 300 && isRunning(); attempt += 1) await Bun.sleep(10);
    expect(isRunning()).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 5000);

test("invalid timeout fails before starting transport", async () => {
  for (const timeoutMs of [0, -1, Number.NaN, Infinity]) {
    await expect(connect(plugin.connection({}), { timeoutMs })).rejects.toThrow("Timeout");
  }
});
