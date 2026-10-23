import { homedir } from "node:os";
import { readdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isUpdateInstance, type UpdateInstance } from "../shared/update-instance";

export const execute = async (args: string[], cwd?: string) => {
  const child = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
  const [output, error, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`${args[0]}: ${error.trim() || `exit ${code}`}`);
  return output.trim();
};

export const processes = async () => {
  const output = await execute(["ps", "-axo", "pid=,ppid=,stat=,comm="]);
  return output.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(line);
    return match && !match[3]?.startsWith("Z")
      ? [{ pid: Number(match[1]), parent: Number(match[2]), executable: match[4] ?? "" }]
      : [];
  });
};

export const waitFor = async (
  description: string,
  check: () => Promise<boolean>,
  timeoutMs = 600_000,
) => {
  const deadline = performance.now() + timeoutMs;
  while (!(await check())) {
    if (performance.now() >= deadline)
      throw new Error(`${description}: 시간 초과로 교체를 중단합니다.`);
    await Bun.sleep(200);
  }
};

const instanceDirectory = join(homedir(), "Library/Caches/app.mcp-cli.desktop/instances");
export const instances = async (): Promise<UpdateInstance[]> => {
  const files = await readdir(instanceDirectory).catch(() => []);
  const found: UpdateInstance[] = [];
  for (const file of files.filter((name) => /^\d+\.json$/.test(name))) {
    const value: unknown = await readFile(join(instanceDirectory, file), "utf8")
      .then((text) => JSON.parse(text))
      .catch(() => null);
    if (isUpdateInstance(value)) found.push(value);
  }
  const live = await processes();
  return found.filter((instance) =>
    live.some((p) => p.pid === instance.pid && p.executable === instance.executable),
  );
};

export const requestShutdown = async (instance: UpdateInstance) => {
  const path = join(instanceDirectory, `${instance.pid}.request`);
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify({ instanceId: instance.instanceId }), { mode: 0o600 });
  await rename(temporary, path);
};

export const runningApps = async () => {
  const found: Array<{ path: string; pid: number }> = [];
  for (const process of await processes()) {
    if (!process.executable.endsWith(".app/Contents/MacOS/mcp-desktop")) continue;
    const path = dirname(dirname(dirname(process.executable)));
    const id = await execute([
      "/usr/libexec/PlistBuddy",
      "-c",
      "Print :CFBundleIdentifier",
      join(path, "Contents/Info.plist"),
    ]);
    if (id !== "app.mcp-cli.desktop")
      throw new Error(`앱 식별자를 확인하지 못해 교체를 중단합니다: ${path}`);
    found.push({ path, pid: process.pid });
  }
  return found;
};

export const daemonState = async (binary: string, directory?: string) => {
  const child = Bun.spawn([binary, "daemon", "status"], {
    env: { ...process.env, ...(directory && { MCP_CLI_DAEMON_DIR: directory }) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [output, , code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    const recovery = Bun.spawn([binary, "daemon", "recover"], {
      env: { ...process.env, ...(directory && { MCP_CLI_DAEMON_DIR: directory }) },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [error, recovered] = await Promise.all([
      new Response(recovery.stderr).text(),
      recovery.exited,
    ]);
    if (recovered !== 0) throw new Error(`대몬 복구를 중단합니다: ${error.trim()}`);
    return null;
  }
  const value: unknown = JSON.parse(output);
  if (
    typeof value !== "object" ||
    value === null ||
    !("pid" in value) ||
    typeof value.pid !== "number"
  )
    throw new Error("대몬 PID 응답을 확인하지 못했습니다.");
  return { pid: value.pid, directory };
};

export const stopDaemon = async (binary: string, directory?: string) => {
  const child = Bun.spawn([binary, "daemon", "stop"], {
    env: { ...process.env, ...(directory && { MCP_CLI_DAEMON_DIR: directory }) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [error, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`대몬 종료 실패: ${error.trim()}`);
};

export const launchApp = async (path: string) => {
  await execute(["open", "-a", path]);
};

export const waitReady = async (path: string, previousPids: number[], legacy = false) => {
  await waitFor(
    "새 앱 시작",
    async () => {
      const records = (await instances()).filter(
        (instance) =>
          instance.executable.startsWith(`${path}/Contents/MacOS/`) &&
          !previousPids.includes(instance.launcherPid),
      );
      const failure = records.find((instance) => instance.state === "failed");
      if (failure) throw new Error(failure.error ?? "앱 초기화 실패");
      if (records.some((instance) => instance.state === "ready")) return true;
      return (
        legacy &&
        (await runningApps()).some((app) => app.path === path && !previousPids.includes(app.pid))
      );
    },
    30_000,
  );
};
