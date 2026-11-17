import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { prepareOwnership } from "../src/daemon/ownership";
import { startDaemon } from "../src/daemon/server";
import { daemonStatus } from "../src/daemon/client";

// A dead owner needs the PID of a real exited process, so one short-lived child serves every test.
let exited: Promise<number> | undefined;
const deadPid = () => {
  exited ??= (async () => {
    const child = Bun.spawn([process.execPath, "-e", ""], { stdout: "ignore" });
    await child.exited;
    return child.pid;
  })();
  return exited;
};

const fixture = async (run: (directory: string, deadPid: number) => Promise<void>) => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-owner-"));
  try {
    await run(directory, await deadPid());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test("daemon start recovers a dead owner and replaces obsolete credentials", async () => {
  await fixture(async (directory, pid) => {
    await writeFile(join(directory, "owner"), String(pid));
    await writeFile(join(directory, "token"), "obsolete");
    const daemon = await startDaemon(directory);
    try {
      expect((await daemonStatus(directory)).pid).toBe(process.pid);
      expect(await readFile(join(directory, "token"), "utf8")).not.toBe("obsolete");
      await expect(prepareOwnership(directory)).rejects.toThrow("still running");
    } finally {
      await daemon.stop();
    }
  });
});

test("recovery preserves a live owner and malformed ownership", async () => {
  await fixture(async (directory) => {
    for (const owner of [String(process.pid), "invalid", "0", "-1"]) {
      await writeFile(join(directory, "owner"), owner);
      await writeFile(join(directory, "token"), "preserve");
      await expect(prepareOwnership(directory)).rejects.toThrow();
      expect(await readFile(join(directory, "owner"), "utf8")).toBe(owner);
      expect(await readFile(join(directory, "token"), "utf8")).toBe("preserve");
    }
  });
});

test.skipIf(process.platform === "win32")(
  "recovery preserves an active socket despite a dead owner",
  async () => {
    await fixture(async (directory, pid) => {
      await writeFile(join(directory, "owner"), String(pid));
      const server = createServer((socket) => socket.end());
      await new Promise<void>((resolve) => server.listen(join(directory, "daemon.sock"), resolve));
      try {
        await expect(prepareOwnership(directory)).rejects.toThrow("still active");
        expect(await readFile(join(directory, "owner"), "utf8")).toBe(String(pid));
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    });
  },
);

test("concurrent claims never both acquire ownership", async () => {
  await fixture(async (directory) => {
    const results = await Promise.allSettled([
      prepareOwnership(directory, true),
      prepareOwnership(directory, true),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await readFile(join(directory, "owner"), "utf8")).toBe(String(process.pid));
  });
});

test("restart recovers socket and credentials left by an abruptly terminated daemon", async () => {
  await fixture(async (directory) => {
    // Only a separate process can own the directory and then die without running cleanup.
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        'import { startDaemon } from "./apps/cli/src/daemon/server.ts"; await startDaemon(process.argv[1]); console.log("ready");',
        directory,
      ],
      { stdout: "pipe", stderr: "pipe", cwd: new URL("../../../", import.meta.url).pathname },
    );
    try {
      const reader = child.stdout.getReader();
      const ready = await reader.read();
      expect(new TextDecoder().decode(ready.value)).toContain("ready");
      reader.releaseLock();
      child.kill("SIGKILL");
      await child.exited;
      expect(await readFile(join(directory, "owner"), "utf8")).toBe(String(child.pid));
      await prepareOwnership(directory);
      const daemon = await startDaemon(directory);
      try {
        expect((await daemonStatus(directory)).pid).toBe(process.pid);
      } finally {
        await daemon.stop();
      }
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
      await child.exited;
    }
  });
});

test("an existing recovery lock preserves daemon state", async () => {
  await fixture(async (directory, pid) => {
    await writeFile(join(directory, "owner"), String(pid));
    await mkdir(join(directory, ".ownership-lock"));
    await expect(prepareOwnership(directory)).rejects.toThrow();
    expect(await readFile(join(directory, "owner"), "utf8")).toBe(String(pid));
  });
});
