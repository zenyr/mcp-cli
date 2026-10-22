import type { UpdateInstance } from "../shared/update-instance";

export const registerUpdateLifecycle = async (app: DesktopApp, stop: () => Promise<void>) => {
  if (tjs.env.OS === "Windows_NT") return async () => {};
  const directory = `${app.paths.cache}/instances`;
  await tjs.makeDir(directory, { recursive: true });
  await tjs.chmod(directory, 0o700);
  const path = `${directory}/${tjs.pid}.json`;
  const requestPath = `${directory}/${tjs.pid}.request`;
  const instanceId = crypto.randomUUID();
  const write = async (state: UpdateInstance["state"], error?: string) => {
    const instance: UpdateInstance = {
      instanceId,
      pid: tjs.pid,
      launcherPid: tjs.ppid,
      executable: tjs.exePath,
      daemonDirectory: tjs.env.MCP_CLI_DAEMON_DIR,
      state,
      ...(error && { error }),
    };
    const temporary = `${path}.tmp`;
    await tjs.writeFile(temporary, JSON.stringify(instance));
    await tjs.chmod(temporary, 0o600);
    await tjs.rename(temporary, path);
  };
  let stopping = false;
  let checking = false;
  const check = async () => {
    if (stopping || checking) return;
    checking = true;
    try {
      const bytes = await tjs.readFile(requestPath).catch(() => null);
      if (!bytes) return;
      const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (
        typeof value !== "object" ||
        value === null ||
        !("instanceId" in value) ||
        value.instanceId !== instanceId
      )
        return;
      stopping = true;
      await write("draining");
      await stop();
      await tjs.remove(requestPath);
      await tjs.remove(path);
      app.quit();
    } catch (error) {
      if (stopping) await write("failed", error instanceof Error ? error.message : String(error));
    } finally {
      checking = false;
    }
  };
  await write("starting");
  setInterval(() => {
    void check();
  }, 200);
  return async () => {
    if (!stopping) await write("ready");
  };
};
