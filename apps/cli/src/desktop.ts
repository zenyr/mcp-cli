import { createInterface } from "node:readline";
import { credentialSwitches, isRecord, UsageError } from "@mcp-cli/core";
import { authCredentialName, defaultStore, loginCommand, logoutCommand } from "./auth";
import { discover, findPlugin, loadPlugin } from "./discovery";
import { defaultContext } from "./paths";
import { resetDaemonIfRunning } from "./daemon/client";
import {
  authenticationContext,
  authenticationDetails,
  configureAuthentication,
} from "./auth-settings";

const readAuthInput = async (): Promise<string> => {
  const lines = createInterface({ input: process.stdin });
  const input: string[] = [];
  try {
    for await (const line of lines) {
      input.push(line);
      try {
        JSON.parse(input.join("\n"));
        return input.join("\n");
      } catch {
        continue;
      }
    }
    return input.join("\n");
  } finally {
    lines.close();
    process.stdin.destroy();
  }
};

export const desktopCommand = async (args: string[]) => {
  const [action, ...rest] = args;
  if (
    rest.length ||
    !["services", "login", "logout", "auth-config", "auth-status", "auth-detect"].includes(
      action ?? "",
    )
  )
    throw new UsageError("Usage: mcp-cli desktop <services|login|logout|auth-config|auth-status>");
  const registry = await discover(await defaultContext());
  const store = defaultStore();
  if (action === "services") {
    const services = await Promise.all(
      registry.plugins.map(async (found) => {
        const plugin = await loadPlugin(found);
        const switches = credentialSwitches(plugin.auth);
        const credentials = switches.some((credential) => credential.base)
          ? switches
          : [{ flag: "", summary: "기본 인증" }, ...switches];
        return {
          name: plugin.name,
          summary: plugin.summary,
          auth: plugin.auth?.type ?? "none",
          authentication: await authenticationDetails(plugin),
          credentials: await Promise.all(
            credentials.map(async ({ flag, summary }) => ({
              flag,
              summary,
              stored:
                (await store.read(authCredentialName(plugin, flag || undefined))) !== undefined,
              fromEnv:
                plugin.auth?.type === "apiKey" &&
                Boolean(
                  process.env[
                    flag
                      ? (plugin.auth.alternates?.find((item) => item.flag === flag)?.env ?? "")
                      : plugin.auth.env
                  ],
                ),
            })),
          ),
        };
      }),
    );
    console.log(JSON.stringify({ result: services }));
    return;
  }
  const value: unknown = JSON.parse(await readAuthInput());
  if (
    !isRecord(value) ||
    typeof value.service !== "string" ||
    (value.credential !== undefined && typeof value.credential !== "string")
  )
    throw new UsageError("Invalid desktop auth request");
  const service = value.service;
  const plugin = await loadPlugin(findPlugin(registry, service));
  if (action === "auth-detect") {
    if (
      !plugin.authSupport?.inspect ||
      (value.target !== "mcp" && value.target !== "web") ||
      (value.secret !== undefined && typeof value.secret !== "string")
    )
      throw new UsageError("Invalid App detection request");
    await plugin.authSupport.inspect(authenticationContext(), {
      target: value.target,
      secret: typeof value.secret === "string" ? value.secret : undefined,
      forget: value.forget === true,
    });
    await resetDaemonIfRunning();
    console.log(JSON.stringify({ result: await authenticationDetails(plugin) }));
    return;
  }
  if (action === "auth-config" || action === "auth-status") {
    if (action === "auth-config") await configureAuthentication(plugin, value.configuration);
    console.log(
      JSON.stringify({ result: await authenticationDetails(plugin, action === "auth-status") }),
    );
    return;
  }
  const credential =
    typeof value.credential === "string" && value.credential ? value.credential : undefined;
  const flags = credential ? [`--${credential}`] : [];
  if (value.method === "browser") flags.push("--browser");
  if (value.target !== undefined) {
    if (value.target !== "mcp" && value.target !== "web")
      throw new UsageError("Invalid authentication target");
    flags.push(`--${value.target}`);
  }
  const run = action === "login" ? loginCommand : logoutCommand;
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGTERM", abort);
  try {
    await run([service, ...flags], {
      env: process.env,
      store,
      signal: controller.signal,
      plugin: async (name) => loadPlugin(findPlugin(registry, name)),
      writeError: () => undefined,
      open: (url) => {
        console.log(JSON.stringify({ event: "open-url", url }));
      },
      readSecret: async () => {
        if (typeof value.secret !== "string") throw new UsageError("API key is required");
        return value.secret;
      },
    });
  } finally {
    process.removeListener("SIGTERM", abort);
  }
  await resetDaemonIfRunning();
  console.log(JSON.stringify({ result: null }));
};
