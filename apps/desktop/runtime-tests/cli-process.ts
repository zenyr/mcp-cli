import type { CliExit } from "../shared/cli-exit";
import { awaitDaemonReady, runCliChild, type CliChild } from "../shared/cli-process";
import { equal, type RuntimeCase } from "./contract";

const output = (chunks: string[], close: boolean) =>
  new ReadableStream<Uint8Array>({
    start: (controller) => {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      if (close) controller.close();
    },
  });

const fakeChild = (
  chunks: string[],
  options: { close: boolean; exit: Promise<CliExit> },
): CliChild & { signals: string[] } => {
  const signals: string[] = [];
  return {
    signals,
    stdin: null,
    stdout: output(chunks, options.close),
    stderr: { text: async () => "" },
    wait: () => options.exit,
    kill: (signal) => {
      signals.push(signal);
    },
  };
};

const failure = (task: Promise<unknown>) =>
  task.then(
    () => "resolved",
    (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : "unknown"),
  );

const messages = { timedOut: "timed out", failed: "failed", invalid: "invalid" };

export const cliProcessCases: RuntimeCase[] = [
  {
    name: "CLI output keeps open-url events and the unterminated final result",
    run: async () => {
      const urls: string[] = [];
      const child = fakeChild(['{"event":"open-url","url":"https://a.test"}\n', '{"result":7}'], {
        close: true,
        exit: Promise.resolve({ exit_status: 0, term_signal: null }),
      });
      const result = await runCliChild(child, {
        timeout: 10_000,
        openUrl: (url) => urls.push(url),
      });
      equal({ result, urls }, { result: 7, urls: ["https://a.test"] });
    },
  },
  {
    name: "CLI killed mid-JSON reports the signal instead of a parse error",
    run: async () => {
      const child = fakeChild(['{"result":{"partial":'], {
        close: true,
        exit: Promise.resolve({ exit_status: 0, term_signal: "SIGTERM" }),
      });
      equal(
        await failure(runCliChild(child, { timeout: 10_000, openUrl: () => {} })),
        "Error: CLI was terminated by SIGTERM",
      );
    },
  },
  {
    name: "Daemon start deadline stops once ready is validated",
    run: async () => {
      const child = fakeChild(['{"event":"ready","pid":1}\n'], {
        close: false,
        exit: new Promise<never>(() => {}),
      });
      await awaitDaemonReady(child, 0, messages);
      // A zero-delay timer queued after the deadline stands in for a slow status check.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      equal(child.signals, []);
    },
  },
  {
    name: "Daemon start rejects an unexpected first event",
    run: async () => {
      const child = fakeChild(['{"event":"other"}\n'], {
        close: false,
        exit: new Promise<never>(() => {}),
      });
      equal(await failure(awaitDaemonReady(child, 10_000, messages)), "Error: invalid");
    },
  },
];
