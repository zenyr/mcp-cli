import { fileURLToPath } from "node:url";
import type { Env, Host, TerminationSignal } from "../src/host";
import { execute } from "../src/main";

export const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

export type MemoryHostOptions = { env?: Env; cwd?: string; stdin?: string };
export type MemoryHost = {
  host: Host;
  stdout: () => string;
  stderr: () => string;
  /** Delivers a termination signal to every registered handler. */
  terminate: (signal: TerminationSignal) => void;
};

/** An in-process host: env and stdin come from options, and output is captured. */
export const memoryHost = (options: MemoryHostOptions = {}): MemoryHost => {
  const out: string[] = [];
  const err: string[] = [];
  const handlers = new Set<{ signals: TerminationSignal[]; handler: () => void }>();
  const stdin = options.stdin ?? "";
  const host: Host = {
    env: options.env ?? {},
    cwd: options.cwd ?? repositoryRoot,
    write: async (text) => void out.push(text),
    writeError: (text) => void err.push(text),
    readStdin: async () => stdin,
    onStdinLine: (handler, onEnd) => {
      let active = true;
      queueMicrotask(() => {
        for (const line of stdin.split("\n").filter(Boolean)) if (active) handler(line);
        if (active) onEnd?.();
      });
      return () => {
        active = false;
      };
    },
    readSecret: async () => stdin,
    onTermination: (signals, handler) => {
      const entry = { signals, handler };
      handlers.add(entry);
      return () => void handlers.delete(entry);
    },
  };
  return {
    host,
    stdout: () => out.join(""),
    stderr: () => err.join(""),
    terminate: (signal) => {
      for (const entry of handlers) if (entry.signals.includes(signal)) entry.handler();
    },
  };
};

export type CliResult = { stdout: string; stderr: string; code: number };

/** Runs one CLI invocation in this process, matching the shape spawn-based helpers returned. */
export const runCli = async (
  args: string[],
  options: MemoryHostOptions = {},
): Promise<CliResult> => {
  const memory = memoryHost(options);
  const code = await execute(args, memory.host);
  return { stdout: memory.stdout(), stderr: memory.stderr(), code };
};
