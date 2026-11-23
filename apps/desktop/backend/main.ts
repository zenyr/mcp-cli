import { resolveLocale, translate, type Locale } from "../shared/i18n";
import { createDrainController } from "../shared/drain-controller";
import { registerUpdateLifecycle } from "./update-lifecycle";
import { createLoginController } from "../shared/login-controller";
import { isSoundKind, type SoundKind } from "../shared/ui-sounds";
import { observeDaemonSound, playUiSound, setSoundsEnabled } from "./ui-sounds";
import { prepareTrayIcons } from "./tray-icon";
import { cliCommand } from "./command";
import { awaitDaemonReady, runCliChild } from "../shared/cli-process";
import { showManagementWindow, syncWindowPresence } from "./window-presence";

const logins = createLoginController();
const operations = createDrainController();
const run = (app: DesktopApp, args: string[], input?: unknown, signal?: AbortSignal) =>
  operations.run(() => runCli(app, args, input, signal));
const runCli = async (app: DesktopApp, args: string[], input?: unknown, signal?: AbortSignal) => {
  const command = await cliCommand(app);
  signal?.throwIfAborted();
  const child = app.spawnHidden([...command, ...args], {
    stdin: input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeout =
    args[0] === "desktop" && args[1] === "login"
      ? 300_000
      : args[1] === "auth-test"
        ? 3_610_000
        : ["reset", "logout", "auth-config", "plugin-action"].includes(args[1] ?? "")
          ? 600_000
          : args[1] === "auth-status" || args[1] === "auth-options" || args[1] === "commands"
            ? 30000
            : 10_000;
  return runCliChild(child, {
    input,
    timeout,
    signal,
    openUrl: (url) => app.push("open-url", url),
  });
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
    const status = await run(app, ["daemon", "status", "--json"]);
    await observe(status);
    return { online: true, status };
  } catch (error) {
    await observe(null);
    return { online: false, error: error instanceof Error ? error.message : String(error) };
  }
};
let starting = false;
let locale: Locale = resolveLocale(navigator.language);
let refreshTray = async () => {};
export const api = {
  setLocale: (params: { locale: string }, app: DesktopApp) =>
    operations.run(async () => {
      if (!["en", "ko", "ja"].includes(params?.locale)) throw new Error("Invalid locale");
      const next = resolveLocale(params.locale);
      await app.store.set("locale", next);
      locale = next;
      await refreshTray();
      return null;
    }),
  plugins: (_params: unknown, app: DesktopApp) => run(app, ["desktop", "plugins"]),
  pluginAction: (params: unknown, app: DesktopApp) =>
    run(app, ["desktop", "plugin-action"], params),
  commands: (params: unknown, app: DesktopApp) => run(app, ["desktop", "commands"], params),
  status: (_params: unknown, app: DesktopApp) => checkDaemonStatus(app),
  workspaceAction: (params: unknown, app: DesktopApp) =>
    run(app, ["desktop", "workspace-action"], params),
  services: (_params: unknown, app: DesktopApp) => run(app, ["desktop", "services"]),
  start: (_params: unknown, app: DesktopApp) =>
    operations.run(async () => {
      if (starting) throw new Error(translate(locale, "대몬 시작을 기다려 주세요."));
      starting = true;
      try {
        const child = app.spawnHidden([...(await cliCommand(app)), "daemon", "start", "--json"], {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        });
        await awaitDaemonReady(child, 10_000, {
          timedOut: translate(locale, "대몬이 {seconds}초 안에 시작하지 않았습니다.", {
            seconds: 10,
          }),
          failed: translate(locale, "대몬을 시작하지 못했습니다."),
          invalid: translate(locale, "대몬 시작 응답을 확인하지 못했습니다."),
        });
        await checkDaemonStatus(app);
      } finally {
        starting = false;
      }
      return null;
    }),
  reset: (_params: unknown, app: DesktopApp) => run(app, ["daemon", "reset", "--json"]),
  stop: (_params: unknown, app: DesktopApp) => run(app, ["daemon", "stop", "--json"]),
  login: (params: unknown, app: DesktopApp) =>
    logins.start((signal) => run(app, ["desktop", "login"], params, signal)),
  logout: (params: unknown, app: DesktopApp) => run(app, ["desktop", "logout"], params),
  authConfig: (params: unknown, app: DesktopApp) => run(app, ["desktop", "auth-config"], params),
  authTest: (params: unknown, app: DesktopApp) => run(app, ["desktop", "auth-test"], params),
  authOptions: (params: unknown, app: DesktopApp) => run(app, ["desktop", "auth-options"], params),
  authStatus: (params: unknown, app: DesktopApp) => run(app, ["desktop", "auth-status"], params),
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
  setSoundsEnabled: (params: { enabled: boolean }, app: DesktopApp) =>
    operations.run(async () => {
      if (typeof params?.enabled !== "boolean") throw new Error("Invalid sound setting");
      await setSoundsEnabled(app, params.enabled);
      return null;
    }),
  saveSettings: (params: { cliCommand?: string[] | null; autoStart: boolean }, app: DesktopApp) =>
    operations.run(async () => {
      if (typeof params.autoStart !== "boolean")
        throw new Error(translate(locale, "자동 시작 설정을 확인해 주세요."));
      const command = params.cliCommand;
      if (command !== undefined) {
        if (
          command !== null &&
          (!Array.isArray(command) ||
            !command.length ||
            command.some((item) => typeof item !== "string" || !item.trim()))
        )
          throw new Error(translate(locale, "CLI 명령을 입력해 주세요."));
        await app.store.set("cliCommand", command);
      }
      await app.store.set("autoStart", params.autoStart);
      return null;
    }),
};
export const init = async (app: DesktopApp) => {
  const storedLocale = await app.store.get("locale");
  if (typeof storedLocale === "string") locale = resolveLocale(storedLocale);
  const ready = await registerUpdateLifecycle(
    app,
    async () => {
      await operations.drain(() => logins.cancel());
      const state = await runCli(app, ["daemon", "status", "--json"]).catch(() => null);
      if (state !== null) await runCli(app, ["daemon", "stop", "--json"]);
    },
    operations.resume,
  );
  app.setHideOnClose(true);
  const trayIcons = await prepareTrayIcons(app);
  const refresh = async () => {
    const state = await api.status(undefined, app);
    app.tray.set({
      ...trayIcons[state.online ? "running" : "stopped"],
      tooltip: `MCP CLI · ${translate(locale, state.online ? "연결 준비됨" : "연결 중지됨")}`,
      menu: [
        { id: "status", label: translate(locale, state.online ? "연결 준비됨" : "연결 중지됨") },
        { id: "show", label: translate(locale, "관리 화면 열기") },
        { separator: true },
        { id: "quit", label: translate(locale, "앱 종료") },
      ],
    });
  };
  refreshTray = refresh;
  const firstLaunch = (await app.store.get("initialized")) !== true;
  if (firstLaunch) {
    showManagementWindow(app);
    await app.store.set("initialized", true);
  }
  await syncWindowPresence(app);
  setInterval(() => void syncWindowPresence(app), 250);
  await refresh();
  setInterval(() => {
    if (operations.accepting()) void refresh();
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
  await ready();
};
export const onTray = (id: string, app: DesktopApp) => {
  if (id === "show") showManagementWindow(app);
  if (id === "quit") app.quit();
};
