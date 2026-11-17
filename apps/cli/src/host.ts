import { Context, Effect, Layer } from "effect";
import { createInterface } from "node:readline";
import { readSecret } from "./secret";

export type Env = Record<string, string | undefined>;
export type TerminationSignal = "SIGINT" | "SIGTERM";

/** Process I/O the CLI may touch; only the process layer below reads Node or Bun globals. */
export type Host = {
  env: Env;
  cwd: string;
  /** True when stderr is a terminal, so a login may launch a local browser. */
  stderrIsTTY?: boolean;
  /** Writes text verbatim and resolves once it is flushed. */
  write: (text: string) => Promise<void>;
  writeError: (text: string) => void;
  readStdin: () => Promise<string>;
  /** Feeds each stdin line to the handler, calls `onEnd` when stdin closes, and returns the unsubscribe. */
  onStdinLine: (handler: (line: string) => void, onEnd?: () => void) => () => void;
  /** Prompts without echo on a terminal, or reads piped stdin. */
  readSecret: (prompt: string) => Promise<string>;
  /** Registers a termination handler and returns its removal. */
  onTermination: (signals: TerminationSignal[], handler: () => void) => () => void;
};

export class CliHost extends Context.Service<CliHost, Host>()("mcp-cli/CliHost") {}

/** Prints one line to stdout the way console.log would. */
export const printLine = (text: string): Effect.Effect<void, never, CliHost> =>
  Effect.flatMap(CliHost, (host) => Effect.promise(() => host.write(`${text}\n`)));

/** Prints one line to stderr the way console.error would. */
export const printError = (text: string): Effect.Effect<void, never, CliHost> =>
  Effect.map(CliHost, (host) => host.writeError(`${text}\n`));

const onStdinLine = (handler: (line: string) => void, onEnd?: () => void): (() => void) => {
  const lines = createInterface({ input: process.stdin, terminal: false });
  lines.on("line", handler);
  if (onEnd) lines.on("close", onEnd);
  return () => {
    if (onEnd) lines.off("close", onEnd);
    lines.close();
    process.stdin.pause();
  };
};

/** The real process: environment, working directory, stdio and signals. */
export const processHost: Host = {
  env: process.env,
  cwd: process.cwd(),
  stderrIsTTY: Boolean(process.stderr.isTTY),
  // Bun truncates piped console.log output at 64 KiB once process.stdout exists.
  write: (text) =>
    new Promise<void>((resolve, reject) =>
      process.stdout.write(text, (error) => (error ? reject(error) : resolve())),
    ),
  writeError: (text) => void process.stderr.write(text),
  readStdin: () => Bun.stdin.text(),
  onStdinLine,
  readSecret,
  onTermination: (signals, handler) => {
    for (const signal of signals) process.once(signal, handler);
    return () => {
      for (const signal of signals) process.removeListener(signal, handler);
    };
  },
};

export const processHostLayer: Layer.Layer<CliHost> = Layer.succeed(CliHost, processHost);
