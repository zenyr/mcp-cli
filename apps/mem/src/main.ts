#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import { parse, readRecord, recall } from "./commands";
import { createCompressor } from "./compressor";
import { startPacket } from "./packets";
import { pinCommand } from "./pin-commands";
import { zoom } from "./zoom";
import { resolvePaths, resolveScopes } from "./paths";
import { loadSettings } from "./settings";
import { generationFor, openStore } from "./store";
import { summarize } from "./tree";
import type { Compressor, Env, Store } from "./types";
import { SUMMARY_POLICY } from "./types";
import { bytes, fail, isRecord, output } from "./values";

export type Dependencies = {
  env?: Env;
  cwd?: string;
  compress?: Compressor;
  io?: {
    write: (text: string) => void;
    readFile: (path: string) => Promise<string>;
    readStdin: () => Promise<string>;
  };
};
const help = `Usage: mem <start|save|summarize|recall|read|zoom|pin|unpin|pins|status|config> [options]
  save <text> | --stdin | --file <path> [--kind user|talk|tool|echo|note] [--receipt UUID]
  recall <keyword> [--cursor <opaque>] [--limit <count>]
  read <scopeId/index> [--cursor <scalar offset>]
  zoom <scopeId/index> --count <power of two> --generation <id> [--cursor <offset>]
  pin <scopeId/index> --key <name> --from <scalar> --to <scalar> --expected-revision <n> --receipt <UUID>
  unpin <key> --expected-revision <n> --receipt <UUID>
  pins [--key <name>]
  --global | --project   Select scopes
  --model <name> --base-url <url> --max-bytes <512..20480>
`;
const errorInfo = (
  error: unknown,
): { code: string; message: string; details: Record<string, unknown> } => ({
  code: isRecord(error) && typeof error.code === "string" ? error.code : "FAILURE",
  message: error instanceof Error ? error.message : "Command failed.",
  details: isRecord(error) && isRecord(error.details) ? error.details : {},
});
export const main = async (argv: string[], dependencies: Dependencies = {}): Promise<number> => {
  const env = dependencies.env ?? process.env;
  const cwd = dependencies.cwd ?? process.cwd();
  const io = dependencies.io ?? {
    write: (text: string) => {
      process.stdout.write(text);
    },
    readFile: (path: string) => Bun.file(path).text(),
    readStdin: () => Bun.stdin.text(),
  };
  let maxBytes = 8192;
  let store: Store | undefined;
  try {
    const options = parse(argv);
    maxBytes = options.maxBytes;
    if (["--help", "-h", "help"].includes(options.command)) {
      io.write(help);
      return 0;
    }
    const paths = resolvePaths(env);
    const settings = await loadSettings(paths.configFile, {
      ...env,
      ...(options.model ? { MEM_MODEL: options.model } : {}),
      ...(options.baseUrl ? { MEM_BASE_URL: options.baseUrl } : {}),
    });
    if (options.command === "config") {
      io.write(
        output(
          {
            ok: true,
            settings: {
              model: settings.model,
              baseUrl: settings.baseUrl,
              nodeBytes: settings.nodeBytes,
              contextBytes: settings.contextBytes,
              contextBytesIgnored: true,
              summaryInputPolicy: SUMMARY_POLICY,
              inputBytes: settings.inputBytes,
              timeoutMs: settings.timeoutMs,
              maxOutputTokens: settings.maxOutputTokens,
              thinking: settings.thinking ?? "provider-default",
            },
          },
          maxBytes,
        ),
      );
      return 0;
    }
    const selection =
      options.selection ??
      (["save", "pin", "unpin"].includes(options.command) ? "project" : "both");
    const scopes = await resolveScopes(cwd, selection, ["save", "start"].includes(options.command));
    store = openStore(paths.databaseFile);
    for (const scope of scopes) store.scope(scope);
    const generation = generationFor(settings);
    const compress = dependencies.compress ?? createCompressor(settings, env);
    let result: unknown;
    if (options.command === "save") {
      const scope = scopes[0];
      if (!scope) return fail("PROJECT_REQUIRED", "Use --global outside a Git project.");
      const text = options.stdin
        ? await io.readStdin()
        : options.file
          ? await io.readFile(options.file)
          : options.text.join(" ");
      if (!text.trim()) fail("INVALID_OPTION", "Saved text must not be empty.");
      if (bytes(text) > 1048576)
        fail("INPUT_TOO_LARGE", "Raw input exceeds the 1 MiB record limit.");
      const receipt = options.receipt ?? randomUUID();
      const entry = store.append(scope.id, options.kind, text, receipt);
      const recordId = `${scope.id}/${entry.i}`;
      try {
        await summarize(store, scope, generation, settings, compress);
      } catch (error) {
        const info = errorInfo(error);
        fail(info.code, "Raw record saved; summarization failed.", {
          recordId,
          receipt,
          recoveryCommand: `mem summarize --${scope.kind}`,
          cause: info.code,
        });
      }
      result = { ok: true, recordId, receipt, generation };
    } else if (options.command === "summarize") {
      for (const scope of scopes) await summarize(store, scope, generation, settings, compress);
      result = {
        ok: true,
        generation,
        scopes: store.status(scopes, generation),
        usage: store.usage(),
      };
    } else if (options.command === "start") {
      const pending = store.status(scopes, generation).filter((scope) => scope.pending > 0);
      if (pending.length)
        fail("SUMMARY_PENDING", "Run mem summarize before start.", {
          recoveryCommand: "mem summarize",
          scopes: pending.map((scope) => scope.id),
        });
      result = startPacket(store, scopes, generation, maxBytes);
    } else if (options.command === "read") result = readRecord(store, scopes, options);
    else if (options.command === "zoom")
      result = zoom(store, scopes, {
        recordId: options.text[0] ?? "",
        count: options.count ?? 0,
        generation: options.generation ?? "",
        maxBytes,
        cursor: options.cursor,
      });
    else if (["pin", "unpin", "pins"].includes(options.command))
      result = pinCommand(store, scopes, options);
    else if (options.command === "recall") result = recall(store, scopes, options);
    else
      result = {
        ok: true,
        generation,
        scopes: store.status(scopes, generation),
        usage: store.usage(),
      };
    io.write(output(result, maxBytes));
    return 0;
  } catch (error) {
    const info = errorInfo(error);
    let response = { ok: false, error: info };
    try {
      io.write(output(response, maxBytes));
    } catch {
      response = {
        ok: false,
        error: {
          code: info.code,
          message: "Command failed; response exceeds byte limit.",
          details: {
            ...(typeof info.details.recordId === "string"
              ? { recordId: info.details.recordId }
              : {}),
            ...(typeof info.details.receipt === "string" ? { receipt: info.details.receipt } : {}),
          },
        },
      };
      io.write(output(response, maxBytes));
    }
    return info.code === "INVALID_OPTION" ? 2 : 1;
  } finally {
    store?.close();
  }
};
if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
