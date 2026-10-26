import { chmod, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { UsageError } from "@mcp-cli/core";
import { atomicWrite, missing, readOptional, type MarketContext } from "./storage";
import type { State } from "./schema";

declare const MCP_CLI_BUNDLED: boolean;
export const standalone = (): boolean => typeof MCP_CLI_BUNDLED !== "undefined" && MCP_CLI_BUNDLED;
export const launcher = (): string[] =>
  standalone()
    ? [process.execPath]
    : [process.execPath, fileURLToPath(new URL("../main.ts", import.meta.url))];
export const userBin = (context: MarketContext): string =>
  process.platform === "win32"
    ? join(context.env.LOCALAPPDATA || join(context.home, "AppData", "Local"), "MCP CLI", "bin")
    : join(context.home, ".local", "bin");
export const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
export const commandText = (
  prefix: readonly string[],
  service: string,
  platform = process.platform,
): string => {
  if (platform !== "win32")
    return `#!/bin/sh\n# Managed by MCP CLI.\nexec ${[...prefix, service].map(shellQuote).join(" ")} "$@"\n`;
  const quoted = [...prefix, service].map((part) => {
    if (/["\r\n]/.test(part)) throw new UsageError("Invalid Windows command path.");
    return `"${part.replaceAll("%", "%%")}"`;
  });
  return `@echo off\r\nrem Managed by MCP CLI.\r\nsetlocal DisableDelayedExpansion\r\n${quoted.join(" ")} %*\r\n`;
};

const content = async (path: string): Promise<string | undefined> => {
  const info = await lstat(path).catch((error: unknown) => {
    if (missing(error)) return undefined;
    throw error;
  });
  if (!info) return undefined;
  if (!info.isFile() || info.isSymbolicLink())
    throw new UsageError(`Command path is not a regular file: ${path}`);
  return readFile(path, "utf8");
};

export const syncCommands = async (
  previous: State,
  next: State,
  context: MarketContext,
): Promise<{
  state: State;
  rollback: () => Promise<void>;
}> => {
  const settings = next.commands ?? {
    directory: userBin(context),
    launcher: launcher(),
    receipts: {},
  };
  const receipts: Record<string, string> = {};
  for (const plugin of next.installed.filter((item) => item.enabled)) {
    const name = `${plugin.metadata.service}${process.platform === "win32" ? ".cmd" : ""}`;
    receipts[join(settings.directory, name)] = commandText(
      settings.launcher,
      plugin.metadata.service,
    );
  }
  const owned = previous.commands?.receipts ?? {};
  const paths = new Set([...Object.keys(owned), ...Object.keys(receipts)]);
  const before = new Map<string, string | undefined>();
  for (const path of paths) {
    const current = await content(path);
    before.set(path, current);
    if (current !== undefined && current !== owned[path]) {
      if (!receipts[path]) continue;
      throw new UsageError(`Command already exists and is not owned by this app: ${path}`);
    }
  }
  const rollback = async () => {
    for (const [path, old] of before) {
      const current = await content(path);
      if (current !== receipts[path] && current !== undefined) continue;
      if (old === undefined) await rm(path, { force: true });
      else await atomicWrite(path, old, 0o755);
    }
  };
  try {
    for (const [path, old] of before) {
      const desired = receipts[path];
      if (desired === old) continue;
      if (desired === undefined) {
        if (old === owned[path]) await rm(path, { force: true });
      } else {
        await mkdir(settings.directory, { recursive: true, mode: 0o700 });
        if (old === undefined) await writeFile(path, desired, { flag: "wx", mode: 0o755 });
        else await atomicWrite(path, desired, 0o755);
        await chmod(path, 0o755);
      }
    }
  } catch (error) {
    await rollback();
    throw error;
  }
  return { state: { ...next, commands: { ...settings, receipts } }, rollback };
};

export const pathStatus = (context: MarketContext, directory: string): boolean =>
  (context.env.PATH ?? "")
    .split(process.platform === "win32" ? ";" : ":")
    .some((part) =>
      process.platform === "win32"
        ? part.toLowerCase() === directory.toLowerCase()
        : part === directory,
    );

export const installPath = async (context: MarketContext, directory: string): Promise<string> => {
  if (process.platform === "win32") {
    const script =
      "$p=[Environment]::GetEnvironmentVariable('Path','User'); $d=$env:MCP_CLI_BIN; if (($p -split ';') -notcontains $d) { [Environment]::SetEnvironmentVariable('Path', ($p.TrimEnd(';')+';'+$d), 'User') }";
    const child = Bun.spawn(
      ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
      {
        env: { ...context.env, MCP_CLI_BIN: directory },
        stdout: "ignore",
        stderr: "pipe",
      },
    );
    const error = await new Response(child.stderr).text();
    if (await child.exited) throw new UsageError(`Could not update user PATH: ${error.trim()}`);
    return "사용자 PATH에 등록했습니다. 새 터미널을 열어 주세요.";
  }
  const shell = basename(context.env.SHELL || "/bin/sh");
  const fish = shell === "fish";
  const profile = fish
    ? join(context.home, ".config/fish/conf.d/mcp-cli.fish")
    : join(
        context.home,
        shell === "zsh"
          ? ".zshrc"
          : shell === "bash"
            ? process.platform === "darwin"
              ? ".bash_profile"
              : ".bashrc"
            : ".profile",
      );
  const line = fish
    ? `fish_add_path -- ${shellQuote(directory)}`
    : `export PATH=${shellQuote(directory)}:"$PATH"`;
  const existing = (await readOptional(profile)) ?? "";
  if (!existing.split("\n").includes(line)) {
    await mkdir(join(profile, ".."), { recursive: true, mode: 0o700 });
    await writeFile(
      profile,
      `${existing}${existing.endsWith("\n") || !existing ? "" : "\n"}\n# MCP CLI service commands\n${line}\n`,
    );
  }
  return `${profile}에 등록했습니다. 새 터미널을 열어 주세요.`;
};
