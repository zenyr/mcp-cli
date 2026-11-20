import { spawn } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { isRequestFailure } from "../shared/update-request";
import { replaceArtifacts, type Replacement } from "./replace-artifacts";
import {
  daemonState,
  execute,
  instances,
  launchApp,
  processes,
  runningApps,
  requestShutdown,
  stopDaemon,
  waitFor,
  waitReady,
} from "./update-process";

type Daemon = { pid: number; directory?: string };
type App = { path: string; pid: number };
const stopApps = async (apps: App[], binary: string, daemons: Daemon[]) => {
  const registered = await instances();
  const requests = new Map<number, string>();
  for (const app of apps) {
    const instance = registered.find(
      (item) =>
        item.launcherPid === app.pid && item.executable.startsWith(`${app.path}/Contents/MacOS/`),
    );
    if (instance) {
      const current = (await processes()).find((item) => item.pid === instance.pid);
      if (current?.executable !== instance.executable)
        throw new Error("앱 프로세스가 바뀌어 교체를 중단합니다.");
      requests.set(instance.pid, await requestShutdown(instance));
    } else {
      console.log(`이전 종료 프로토콜: ${app.path}`);
      await waitFor("기존 앱의 CLI 요청 종료", async () => {
        const live = await processes();
        const backends = live.filter((item) => item.parent === app.pid).map((item) => item.pid);
        return !live.some(
          (item) =>
            backends.includes(item.parent) &&
            item.executable.endsWith("/mcp-cli") &&
            !daemons.some((daemon) => daemon.pid === item.pid),
        );
      });
      for (const daemon of daemons) {
        if ((await processes()).some((item) => item.pid === daemon.pid))
          await stopDaemon(binary, daemon.directory);
      }
      await execute(["osascript", "-e", `tell application ${JSON.stringify(app.path)} to quit`]);
    }
  }
  await waitFor("실행 중인 앱 종료", async () => {
    const live = await processes();
    const failed = (await instances()).find(
      (item) =>
        apps.some((app) => app.pid === item.launcherPid) &&
        isRequestFailure(item, requests.get(item.pid)),
    );
    if (failed) throw new Error(failed.error ?? "앱 종료 실패");
    return (
      !apps.some((app) => live.some((item) => item.pid === app.pid)) &&
      !registered.some(
        (instance) =>
          apps.some((app) => app.pid === instance.launcherPid) &&
          live.some((item) => item.pid === instance.pid),
      )
    );
  });
};

const stopDaemons = async (binary: string, daemons: Daemon[]) => {
  for (const daemon of daemons) {
    if ((await processes()).some((item) => item.pid === daemon.pid)) {
      await stopDaemon(binary, daemon.directory);
    }
  }
  await waitFor("진행 중인 대몬 요청 종료", async () => {
    const live = await processes();
    return !daemons.some((daemon) => live.some((item) => item.pid === daemon.pid));
  });
};

const restoreDaemons = async (binary: string, daemons: Daemon[]) => {
  for (const daemon of daemons) {
    if (await daemonState(binary, daemon.directory)) continue;
    const child = spawn(binary, ["daemon", "start", "--json"], {
      env: { ...process.env, ...(daemon.directory && { MCP_CLI_DAEMON_DIR: daemon.directory }) },
      detached: true,
      stdio: "ignore",
    });
    let failure: Error | undefined;
    child.once("error", (error) => {
      failure = error;
    });
    child.unref();
    await waitFor(
      "대몬 재시작",
      async () => {
        if (failure) throw failure;
        return (await daemonState(binary, daemon.directory).catch(() => null)) !== null;
      },
      30_000,
    );
  }
};

export const installBuild = async (stagedDist: string, targetDist: string) => {
  if (process.platform !== "darwin") {
    await replaceArtifacts(
      [{ target: targetDist, prepared: stagedDist }],
      async () => {},
      async () => {},
    );
    return;
  }
  const apps = await runningApps();
  const registered = await instances();
  const binary = join(stagedDist, "mcp-cli");
  const directories = new Set<string | undefined>([undefined]);
  for (const instance of registered) {
    if (apps.some((app) => app.pid === instance.launcherPid))
      directories.add(instance.daemonDirectory);
  }
  const daemons: Daemon[] = [];
  for (const directory of directories) {
    const state = await daemonState(binary, directory);
    if (state && !daemons.some((item) => item.pid === state.pid)) daemons.push(state);
  }
  const preparations: string[] = [];
  const replacements: Replacement[] = [{ target: targetDist, prepared: stagedDist }];
  const installedApps = [...new Set(apps.map((app) => app.path))].filter(
    (path) => path !== join(targetDist, "MCP CLI.app"),
  );
  try {
    for (const path of installedApps) {
      const directory = await mkdtemp(join(dirname(path), `.${basename(path)}-update-`));
      preparations.push(directory);
      const prepared = join(directory, "new.app");
      await cp(join(stagedDist, "MCP CLI.app"), prepared, { recursive: true, dereference: false });
      await execute(["codesign", "--verify", "--deep", "--strict", prepared]);
      replacements.push({ target: path, prepared });
    }
    console.log(
      `새 빌드 검증 완료. 앱 ${apps.length}개와 대몬 ${daemons.length}개의 요청을 마무리합니다.`,
    );
    const restart = async (legacy = false) => {
      for (const path of [...new Set(apps.map((app) => app.path))]) {
        await launchApp(path);
        await waitReady(
          path,
          apps.map((app) => app.pid),
          legacy,
        );
      }
      await restoreDaemons(join(targetDist, "mcp-cli"), daemons);
    };
    try {
      await stopApps(apps, binary, daemons);
      await stopDaemons(binary, daemons);
    } catch (error) {
      for (const app of apps) {
        if (!(await runningApps()).some((live) => live.path === app.path))
          await launchApp(app.path);
      }
      throw error;
    }
    await replaceArtifacts(
      replacements,
      () => restart(),
      () => restart(true),
      async () => {
        const started = (await runningApps()).filter((app) =>
          apps.some((old) => old.path === app.path),
        );
        const activeDaemons: Daemon[] = [];
        for (const directory of directories) {
          const state = await daemonState(join(targetDist, "mcp-cli"), directory);
          if (state) activeDaemons.push(state);
        }
        await stopApps(started, join(targetDist, "mcp-cli"), activeDaemons);
        await stopDaemons(join(targetDist, "mcp-cli"), activeDaemons);
      },
    );
    console.log(
      apps.length
        ? "실행 중이던 앱을 새 버전으로 교체하고 재시작했습니다."
        : "새 빌드를 설치했습니다. 앱은 실행하지 않았습니다.",
    );
  } finally {
    for (const path of preparations) await rm(path, { recursive: true, force: true });
  }
};
