import { prepareTrayIcon } from "./tray-icon";
import { defaultCommand } from "./default-command";

let loginBusy = false;
let loginProcess: tjs.Process | undefined;
const cliCommand = async (app: DesktopApp): Promise<string[]> => {
  const saved = await app.store.get("cliCommand");
  if (Array.isArray(saved) && saved.length && saved.every((item) => typeof item === "string"))
    return saved;
  const entry = tjs.env.MCP_CLI_DESKTOP_ENTRY;
  return entry ? [tjs.env.MCP_CLI_DESKTOP_BUN || "bun", entry] : defaultCommand;
};
const run = async (app: DesktopApp, args: string[], input?: unknown) => {
  const decoder = new TextDecoder();
  const child = app.spawnHidden([...(await cliCommand(app)), ...args], {
    stdin: input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const isLogin = args[0] === "desktop" && args[1] === "login";
  if (isLogin) loginProcess = child;
  const deadline = setTimeout(
    () => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* The process already exited. */
      }
    },
    isLogin ? 300_000 : args[1] === "reset" || args[1] === "logout" ? 600_000 : 10_000,
  );
  try {
    const writer = child.stdin?.getWriter();
    if (writer) {
      await writer.write(new TextEncoder().encode(JSON.stringify(input ?? {})));
      await writer.close();
    }
    const errors = child.stderr?.text();
    const reader = child.stdout?.getReader();
    let buffer = "";
    let result: unknown = null;
    const line = (text: string) => {
      if (!text.trim()) return;
      const value: unknown = JSON.parse(text);
      if (typeof value !== "object" || value === null) {
        result = value;
        return;
      }
      if (
        "event" in value &&
        value.event === "open-url" &&
        "url" in value &&
        typeof value.url === "string"
      )
        app.push("open-url", value.url);
      else result = "result" in value ? value.result : value;
    };
    if (reader) {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const text of lines) line(text);
      }
      buffer += decoder.decode();
      line(buffer);
    }
    const status = await child.wait();

    const error = await errors;
    if (status.exit_status !== 0)
      throw new Error(error?.trim() || `CLI exited with ${status.exit_status}`);
    return result;
  } finally {
    clearTimeout(deadline);
    if (loginProcess === child) loginProcess = undefined;
  }
};
let starting = false;
export const api = {
  status: async (_params: unknown, app: DesktopApp) => {
    try {
      return { online: true, status: await run(app, ["daemon", "status"]) };
    } catch (error) {
      return { online: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  services: (_params: unknown, app: DesktopApp) => run(app, ["desktop", "services"]),
  start: async (_params: unknown, app: DesktopApp) => {
    if (starting) throw new Error("대몬 시작을 기다려 주세요.");
    starting = true;
    try {
      const child = app.spawnHidden([...(await cliCommand(app)), "daemon", "start"], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const errors = child.stderr?.text();
      const reader = child.stdout?.getReader();
      const deadline = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {
          /* The process already exited. */
        }
      }, 10_000);
      try {
        const chunk = await reader?.read();
        if (!chunk || chunk.done) {
          await child.wait();
          throw new Error((await errors)?.trim() || "대몬을 시작하지 못했습니다.");
        }
        const value: unknown = JSON.parse(new TextDecoder().decode(chunk.value));
        if (
          typeof value !== "object" ||
          value === null ||
          !("event" in value) ||
          value.event !== "ready"
        )
          throw new Error("대몬 시작 응답을 확인하지 못했습니다.");
        await reader?.cancel();
      } finally {
        clearTimeout(deadline);
      }
    } finally {
      starting = false;
    }
    return null;
  },
  reset: (_params: unknown, app: DesktopApp) => run(app, ["daemon", "reset"]),
  stop: (_params: unknown, app: DesktopApp) => run(app, ["daemon", "stop"]),
  login: async (params: unknown, app: DesktopApp) => {
    if (loginBusy) throw new Error("기존 로그인 요청을 먼저 완료해 주세요.");
    loginBusy = true;
    try {
      return await run(app, ["desktop", "login"], params);
    } finally {
      loginBusy = false;
    }
  },
  logout: (params: unknown, app: DesktopApp) => run(app, ["desktop", "logout"], params),
  cancelLogin: async () => {
    try {
      loginProcess?.kill("SIGTERM");
    } catch {
      /* The login already finished. */
    }
    return null;
  },
  settings: async (_params: unknown, app: DesktopApp) => ({
    cliCommand: await cliCommand(app),
    autoStart: (await app.store.get("autoStart")) === true,
  }),
  saveSettings: async (params: { cliCommand: string[]; autoStart: boolean }, app: DesktopApp) => {
    if (
      typeof params.autoStart !== "boolean" ||
      !Array.isArray(params.cliCommand) ||
      !params.cliCommand.length ||
      params.cliCommand.some((item) => typeof item !== "string" || !item.trim())
    )
      throw new Error("CLI 명령을 입력해 주세요.");
    await app.store.set("cliCommand", params.cliCommand);
    await app.store.set("autoStart", params.autoStart);
    return null;
  },
};
export const init = async (app: DesktopApp) => {
  app.setHideOnClose(true);
  const trayIcon = await prepareTrayIcon(app);
  const refresh = async () => {
    const state = await api.status(undefined, app);
    app.tray.set({
      ...trayIcon,
      tooltip: state.online ? "MCP CLI · 실행 중" : "MCP CLI · 연결 안 됨",
      menu: [
        { id: "status", label: state.online ? "대몬 실행 중" : "대몬 연결 안 됨" },
        { id: "show", label: "관리 화면 열기" },
        { separator: true },
        { id: "quit", label: "앱 종료" },
      ],
    });
  };
  await refresh();
  setInterval(() => {
    void refresh();
  }, 5000);
  if ((await app.store.get("autoStart")) === true) {
    const state = await api.status(undefined, app);
    if (!state.online) {
      try {
        await api.start(undefined, app);
      } catch (error) {
        app.push("startup-error", error instanceof Error ? error.message : String(error));
      }
    }
  }
};
export const onTray = (id: string, app: DesktopApp) => {
  if (id === "show") app.show();
  if (id === "quit") app.quit();
};
