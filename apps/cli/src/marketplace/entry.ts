import { formatOutput } from "@mcp-cli/runtime";
import { Effect } from "effect";
import { attempt, attemptSync } from "../attempt";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { UsageError, type MarketplaceView } from "@mcp-cli/core";
import { CliHost, printLine } from "../host";
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

/** Reports marketplace failures as usage errors and leaves defects untouched. */
export const runMarketplace = <A, R>(
  operation: Effect.Effect<A, MarketplaceError, R>,
): Effect.Effect<A, UsageError, R> =>
  Effect.mapError(operation, (error) => new UsageError(error.message));

/** Applies one plugin action, aborting its work when the host receives a termination signal. */
export const marketplaceRequest = (input: unknown) =>
  Effect.scoped(
    Effect.gen(function* () {
      const host = yield* CliHost;
      const controller = new AbortController();
      yield* Effect.acquireRelease(
        Effect.sync(() => host.onTermination(["SIGTERM", "SIGINT"], () => controller.abort())),
        (remove) => Effect.sync(remove),
      );
      const context = {
        ...(yield* attempt(() => defaultContext(host.env))),
        signal: controller.signal,
        reset: () => resetDaemonIfRunning(host.env),
      };
      return yield* runMarketplace(manage(context, input));
    }),
  );

export const marketplaceView = (): Effect.Effect<MarketplaceView, unknown, CliHost> =>
  Effect.gen(function* () {
    const host = yield* CliHost;
    return yield* runMarketplace(marketView(yield* attempt(() => defaultContext(host.env))));
  });

const usage = `Usage: mcp-cli plugins [list [--json]]
       mcp-cli plugins catalog <recommended|add URL|refresh ID|remove ID>
       mcp-cli plugins install <catalog-id> <plugin-id> [--allow-local-code]
       mcp-cli plugins <enable|disable|remove> <service> [--allow-local-code]
       mcp-cli plugins link <directory>
       mcp-cli plugins init <service> <directory>
       mcp-cli plugins pack <directory> <output.tar.gz>
       mcp-cli plugins commands [directory]`;

const stateLabel = (plugin: MarketplaceView["plugins"][number]): string =>
  plugin.revoked
    ? "revoked"
    : plugin.enabled
      ? "enabled"
      : plugin.installed
        ? "disabled"
        : "available";

export const pluginsCommand = (args: string[]): Effect.Effect<void, unknown, CliHost> =>
  Effect.gen(function* () {
    const host = yield* CliHost;
    const absolute = (path: string) => resolve(host.cwd, path);
    const json = args.includes("--json");
    const [action, ...rest] = args.filter((arg) => arg !== "--json");
    const invalid = Effect.fail(new UsageError(usage));
    if (action === "--help" || action === "-h") return yield* printLine(usage);
    if (!action || action === "list") {
      if (rest.length) return yield* invalid;
      const view = yield* marketplaceView();
      if (json) return yield* printLine(JSON.stringify(view));
      yield* printLine("SERVICE\tSTATE\tVERSION\tCATALOG\tPLUGIN ID");
      for (const plugin of view.plugins)
        yield* printLine(
          [
            plugin.service,
            stateLabel(plugin),
            plugin.installedVersion ?? plugin.version,
            plugin.sourceId,
            plugin.id,
          ].join("\t"),
        );
      const registry = yield* attempt(async () => discover(await defaultContext(host.env)));
      const development = {
        ...registry,
        plugins: registry.plugins.filter((item) => !item.installed),
      };
      if (development.plugins.length)
        yield* printLine(yield* attempt(() => listPlugins(development, [])));
      return;
    }
    if (action === "pack") {
      const [directory, output] = rest;
      if (rest.length !== 2 || !directory || !output) return yield* invalid;
      const bytes = yield* attempt(() => packDirectory(absolute(directory)));
      const manifest = yield* attemptSync(() => packageManifest(unpack(bytes)));
      yield* attempt(async () => {
        await mkdir(dirname(absolute(output)), { recursive: true });
        await writeFile(absolute(output), bytes, { flag: "wx" });
      });
      return yield* printLine(
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
    }
    if (action === "init") {
      const [service, directory] = rest;
      if (rest.length !== 2 || !service || !directory) return yield* invalid;
      yield* attempt(() => scaffold(service, absolute(directory)));
      return yield* printLine(
        `Created ${absolute(directory)}. Link the folder from the app to test it.`,
      );
    }
    let request: Action;
    if (action === "catalog") {
      const [operation, value] = rest;
      if (operation === "recommended" && rest.length === 1) {
        const view = yield* marketplaceView();
        for (const item of view.recommendations) yield* printLine(`${item.name}\t${item.url}`);
        return;
      }
      if (rest.length !== 2 || !value) return yield* invalid;
      if (operation === "add")
        request = { type: "source.add", url: value.startsWith(".") ? absolute(value) : value };
      else if (operation === "refresh" || operation === "remove")
        request = { type: `source.${operation}`, id: value };
      else return yield* invalid;
    } else if (action === "install") {
      if (
        !rest[0] ||
        !rest[1] ||
        rest.length < 2 ||
        rest.length > 3 ||
        (rest[2] !== undefined && rest[2] !== "--allow-local-code")
      )
        return yield* invalid;
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
        return yield* invalid;
      const view = yield* marketplaceView();
      const plugin = view.plugins.find(
        (item) => item.installed && (item.key === rest[0] || item.service === rest[0]),
      );
      if (!plugin) return yield* Effect.fail(new UsageError("Installed plugin not found."));
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
      if (rest.length !== 1 || !rest[0]) return yield* invalid;
      request = { type: "plugin.link", directory: absolute(rest[0]) };
    } else if (action === "commands") {
      if (rest.length > 1) return yield* invalid;
      request = { type: "commands.install", ...(rest[0] ? { directory: absolute(rest[0]) } : {}) };
    } else return yield* invalid;
    yield* printLine((yield* marketplaceRequest(request)).message);
  });
