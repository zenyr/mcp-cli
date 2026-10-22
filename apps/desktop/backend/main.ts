import { createLoginController } from "../shared/login-controller";
import { isSoundKind, type SoundKind } from "../shared/ui-sounds";
import { observeDaemonSound, playUiSound, setSoundsEnabled } from "./ui-sounds";
import { prepareTrayIcons } from "./tray-icon";
import { cliCommand } from "./command";

const logins = createLoginController();
const run = async (app: DesktopApp, args: string[], input?: unknown, signal?: AbortSignal) => {
  const decoder = new TextDecoder();
  const command = await cliCommand(app);
  signal?.throwIfAborted();
  const child = app.spawnHidden([...command, ...args], {
    stdin: input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const isLogin = args[0] === "desktop" && args[1] === "login";
  const terminate = () => {
    try {
      child.kill("SIGKILL");
    } catch {
      /* The process already exited. */
    }
  };
  signal?.addEventListener("abort", terminate, { once: true });
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
      // tjs sends pipe bytes without settling write(), so the CLI reads a newline-framed request.
      void writer
        .write(new TextEncoder().encode(`${JSON.stringify(input ?? {})}\n`))
        .catch(terminate);
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
    signal?.removeEventListener("abort", terminate);
  }
};
let statusSequence = 0;
let observedSequence = 0;
const checkDaemonStatus = async (app: DesktopApp) => {
  const sequence = ++statusSequence;
  const observe = async (status: unknown) => {
    if (sequence <= observedSequence) return;
    observedSequence = sequence;
    await observeDaemonSound(app, status);
  };
  try {
    const status = await run(app, ["daemon", "status"]);
    await observe(status);
    return { online: true, status };
  } catch (error) {
    await observe(null);
    return { online: false, error: error instanceof Error ? error.message : String(error) };
  }
};
let starting = false;
export const api = {
  status: (_params: unknown, app: DesktopApp) => checkDaemonStatus(app),
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
        await checkDaemonStatus(app);
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
  login: (params: unknown, app: DesktopApp) =>
    logins.start((signal) => run(app, ["desktop", "login"], params, signal)),
  logout: (params: unknown, app: DesktopApp) => run(app, ["desktop", "logout"], params),
  cancelLogin: async () => {
    await logins.cancel();
    return null;
  },
  settings: async (_params: unknown, app: DesktopApp) => ({
    cliCommand: await cliCommand(app),
    autoStart: (await app.store.get("autoStart")) === true,
    soundsEnabled: (await app.store.get("soundsEnabled")) !== false,
  }),
  sound: (params: { kind: SoundKind }, app: DesktopApp) => {
    if (!isSoundKind(params?.kind)) throw new Error("Unknown UI sound");
    return playUiSound(app, params.kind);
  },
  setSoundsEnabled: async (params: { enabled: boolean }, app: DesktopApp) => {
    if (typeof params?.enabled !== "boolean") throw new Error("Invalid sound setting");
    await setSoundsEnabled(app, params.enabled);
    return null;
  },
  saveSettings: async (
    params: { cliCommand?: string[] | null; autoStart: boolean },
    app: DesktopApp,
  ) => {
    if (typeof params.autoStart !== "boolean") throw new Error("자동 시작 설정을 확인해 주세요.");
    const command = params.cliCommand;
    if (command !== undefined) {
      if (
        command !== null &&
        (!Array.isArray(command) ||
          !command.length ||
          command.some((item) => typeof item !== "string" || !item.trim()))
      )
        throw new Error("CLI 명령을 입력해 주세요.");
      await app.store.set("cliCommand", command);
    }
    await app.store.set("autoStart", params.autoStart);
    return null;
  },
};
export const init = async (app: DesktopApp) => {
  app.setHideOnClose(true);
  const trayIcons = await prepareTrayIcons(app);
  const refresh = async () => {
    const state = await api.status(undefined, app);
    app.tray.set({
      ...trayIcons[state.online ? "running" : "stopped"],
      tooltip: state.online ? "MCP CLI · 연결 준비됨" : "MCP CLI · 연결 중지됨",
      menu: [
        { id: "status", label: state.online ? "연결 준비됨" : "연결 중지됨" },
        { id: "show", label: "관리 화면 열기" },
        { separator: true },
        { id: "quit", label: "앱 종료" },
      ],
    });
  };
  const firstLaunch = (await app.store.get("initialized")) !== true;
  if (firstLaunch) {
    app.show();
    await app.store.set("initialized", true);
  }
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
