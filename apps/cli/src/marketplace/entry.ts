import { formatOutput } from "@mcp-cli/runtime";
import { Cause, Effect, Exit } from "effect";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { UsageError } from "@mcp-cli/core";
import { defaultContext } from "../paths";
import { resetDaemonIfRunning } from "../daemon/client";
import { listPlugins } from "../list";
import { discover } from "../discovery";
import { packDirectory, unpack } from "./archive";
import { packageManifest } from "./packages";
import { manage, type Action } from "./manager";
import { marketView } from "./catalog";
import { MarketplaceError, digest } from "./storage";
import { scaffold } from "./scaffold";

export const runMarketplace = async <A>(
  operation: Effect.Effect<A, MarketplaceError>,
): Promise<A> => {
  const exit = await Effect.runPromiseExit(operation);
  if (Exit.isSuccess(exit)) return exit.value;
  const error = Cause.squash(exit.cause);
  if (error instanceof MarketplaceError) throw new UsageError(error.message);
  throw error;
};
export const marketplaceRequest = async (input: unknown) => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGTERM", abort);
  process.once("SIGINT", abort);
  try {
    const context = {
      ...(await defaultContext()),
      signal: controller.signal,
      reset: () => resetDaemonIfRunning(),
    };
    return await runMarketplace(manage(context, input));
  } finally {
    process.removeListener("SIGTERM", abort);
    process.removeListener("SIGINT", abort);
  }
};
export const marketplaceView = async () => runMarketplace(marketView(await defaultContext()));

const usage = `Usage: mcp-cli plugins [list [--json]]
       mcp-cli plugins catalog <recommended|add URL|refresh ID|remove ID>
       mcp-cli plugins install <catalog-id> <plugin-id> [--allow-local-code]
       mcp-cli plugins <enable|disable|remove> <service> [--allow-local-code]
       mcp-cli plugins link <directory>
       mcp-cli plugins init <service> <directory>
       mcp-cli plugins pack <directory> <output.tar.gz>
       mcp-cli plugins commands [directory]`;

export const pluginsCommand = async (args: string[]): Promise<void> => {
  const json = args.includes("--json");
  const [action, ...rest] = args.filter((arg) => arg !== "--json");
  if (action === "--help" || action === "-h") {
    console.log(usage);
    return;
  }
  if (!action || action === "list") {
    if (rest.length) throw new UsageError(usage);
    const view = await marketplaceView();
    if (json) {
      console.log(JSON.stringify(view));
      return;
    }
    console.log("SERVICE\tSTATE\tVERSION\tCATALOG\tPLUGIN ID");
    for (const plugin of view.plugins)
      console.log(
        [
          plugin.service,
          plugin.revoked
            ? "revoked"
            : plugin.enabled
              ? "enabled"
              : plugin.installed
                ? "disabled"
                : "available",
          plugin.installedVersion ?? plugin.version,
          plugin.sourceId,
          plugin.id,
        ].join("\t"),
      );
    const registry = await discover(await defaultContext());
    const development = {
      ...registry,
      plugins: registry.plugins.filter((item) => !item.installed),
    };
    if (development.plugins.length) console.log(await listPlugins(development, []));
    return;
  }
  if (action === "pack") {
    if (rest.length !== 2) throw new UsageError(usage);
    const [directory, output] = rest;
    if (!directory || !output) throw new UsageError(usage);
    const bytes = await packDirectory(resolve(directory));
    const manifest = packageManifest(unpack(bytes));
    await mkdir(dirname(resolve(output)), { recursive: true });
    await writeFile(resolve(output), bytes, { flag: "wx" });
    console.log(
      formatOutput(
        {
          id: manifest.id,
          service: manifest.service,
          name: manifest.name,
          description: manifest.description,
          version: manifest.version,
          permissions: manifest.permissions,
          artifacts: [
            {
              url: "https://REPLACE-WITH-DOWNLOAD-URL",
              sha256: digest(bytes),
              platform: "any",
              arch: "any",
            },
          ],
        },
        json,
      ),
    );
    return;
  }
  let request: Action;
  if (action === "init") {
    if (rest.length !== 2 || !rest[0] || !rest[1]) throw new UsageError(usage);
    await scaffold(rest[0], resolve(rest[1]));
    console.log(`Created ${resolve(rest[1])}. Link the folder from the app to test it.`);
    return;
  }
  if (action === "catalog") {
    const [operation, value] = rest;
    if (operation === "recommended" && rest.length === 1) {
      const view = await marketplaceView();
      for (const item of view.recommendations) console.log(`${item.name}\t${item.url}`);
      return;
    }
    if (rest.length !== 2 || !value) throw new UsageError(usage);
    if (operation === "add")
      request = { type: "source.add", url: value.startsWith(".") ? resolve(value) : value };
    else if (operation === "refresh" || operation === "remove")
      request = { type: `source.${operation}`, id: value };
    else throw new UsageError(usage);
  } else if (action === "install") {
    if (
      !rest[0] ||
      !rest[1] ||
      rest.length < 2 ||
      rest.length > 3 ||
      (rest[2] !== undefined && rest[2] !== "--allow-local-code")
    )
      throw new UsageError(usage);
    request = {
      type: "plugin.install",
      sourceId: rest[0],
      pluginId: rest[1],
      enable: rest[2] === "--allow-local-code",
      allowLocalCode: rest[2] === "--allow-local-code",
    };
  } else if (["enable", "disable", "remove"].includes(action)) {
    if (
      !rest[0] ||
      rest.length > 2 ||
      (rest[1] !== undefined && (action !== "enable" || rest[1] !== "--allow-local-code"))
    )
      throw new UsageError(usage);
    const view = await marketplaceView();
    const plugin = view.plugins.find(
      (item) => item.installed && (item.key === rest[0] || item.service === rest[0]),
    );
    if (!plugin) throw new UsageError("Installed plugin not found.");
    request =
      action === "remove"
        ? { type: "plugin.remove", key: plugin.key }
        : {
            type: "plugin.enable",
            key: plugin.key,
            enabled: action === "enable",
            allowLocalCode: rest[1] === "--allow-local-code",
          };
  } else if (action === "link") {
    if (rest.length !== 1 || !rest[0]) throw new UsageError(usage);
    request = { type: "plugin.link", directory: resolve(rest[0]) };
  } else if (action === "commands") {
    if (rest.length > 1) throw new UsageError(usage);
    request = { type: "commands.install", ...(rest[0] ? { directory: resolve(rest[0]) } : {}) };
  } else throw new UsageError(usage);
  console.log((await marketplaceRequest(request)).message);
};
