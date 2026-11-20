import type { UpdateInstance } from "../shared/update-instance";
import { createUpdateRequestHandler } from "../shared/update-request";

export const registerUpdateLifecycle = async (
  app: DesktopApp,
  stop: () => Promise<void>,
  resume: () => void,
) => {
  if (tjs.env.OS === "Windows_NT") return async () => {};
  const directory = `${app.paths.cache}/instances`;
  await tjs.makeDir(directory, { recursive: true });
  await tjs.chmod(directory, 0o700);
  const path = `${directory}/${tjs.pid}.json`;
  const requestPath = `${directory}/${tjs.pid}.request`;
  const instanceId = crypto.randomUUID();
  const handler = createUpdateRequestHandler({
    instanceId,
    read: async () => {
      const bytes = await tjs.readFile(requestPath).catch(() => null);
      return bytes && new TextDecoder().decode(bytes);
    },
    record: async (state, detail) => {
      const instance: UpdateInstance = {
        instanceId,
        pid: tjs.pid,
        launcherPid: tjs.ppid,
        executable: tjs.exePath,
        daemonDirectory: tjs.env.MCP_CLI_DAEMON_DIR,
        state,
        ...(detail?.error && { error: detail.error }),
        ...(detail?.requestId && { requestId: detail.requestId }),
      };
      const temporary = `${path}.tmp`;
      await tjs.writeFile(temporary, JSON.stringify(instance));
      await tjs.chmod(temporary, 0o600);
      await tjs.rename(temporary, path);
    },
    stop,
    resume,
    discard: () => tjs.remove(requestPath),
    finish: async () => {
      await tjs.remove(requestPath);
      await tjs.remove(path);
      app.quit();
    },
  });
  await handler.start();
  setInterval(() => {
    void handler.check();
  }, 200);
  return handler.ready;
};
