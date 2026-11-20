import { cliExitFailure, startDeadline, type CliExit } from "./cli-exit";

export type CliChild = {
  stdin: WritableStream<Uint8Array> | null;
  stdout: ReadableStream<Uint8Array> | null;
  stderr: { text: () => Promise<string> } | null;
  wait: () => Promise<CliExit>;
  kill: (signal: "SIGTERM") => void;
};

export const runCliChild = async (
  child: CliChild,
  options: {
    input?: unknown;
    timeout: number;
    signal?: AbortSignal;
    openUrl: (url: string) => void;
  },
) => {
  const decoder = new TextDecoder();
  const terminate = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      /* The process already exited. */
    }
  };
  options.signal?.addEventListener("abort", terminate, { once: true });
  const deadline = startDeadline(child, options.timeout);
  try {
    const writer = child.stdin?.getWriter();
    if (writer) {
      // tjs sends pipe bytes without settling write(), so the CLI reads a newline-framed request.
      void writer
        .write(new TextEncoder().encode(`${JSON.stringify(options.input ?? {})}\n`))
        .catch(terminate);
    }
    const errors = child.stderr?.text();
    const reader = child.stdout?.getReader();
    let buffer = "";
    let result: unknown = null;
    const line = (text: string) => {
      if (!text.trim()) return;
      const value: unknown = JSON.parse(text);
      if (typeof value !== "object" || value === null) {
        result = value;
        return;
      }
      if (
        "event" in value &&
        value.event === "open-url" &&
        "url" in value &&
        typeof value.url === "string"
      )
        options.openUrl(value.url);
      else result = "result" in value ? value.result : value;
    };
    if (reader) {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const text of lines) line(text);
      }
      buffer += decoder.decode();
    }
    const status = await child.wait();
    const failure = cliExitFailure(
      status,
      await errors,
      deadline.expired() ? options.timeout : undefined,
    );
    if (failure !== undefined) throw new Error(failure);
    // A killed child can leave a partial last line, so it is parsed only after a clean exit.
    line(buffer);
    return result;
  } finally {
    deadline.clear();
    options.signal?.removeEventListener("abort", terminate);
  }
};

export const awaitDaemonReady = async (
  child: CliChild,
  timeout: number,
  messages: { timedOut: string; failed: string; invalid: string },
) => {
  const errors = child.stderr?.text();
  const reader = child.stdout?.getReader();
  const deadline = startDeadline(child, timeout);
  try {
    const chunk = await reader?.read();
    if (!chunk || chunk.done) {
      await child.wait();
      const stderr = await errors;
      throw new Error(deadline.expired() ? messages.timedOut : stderr?.trim() || messages.failed);
    }
    const value: unknown = JSON.parse(new TextDecoder().decode(chunk.value));
    if (
      typeof value !== "object" ||
      value === null ||
      !("event" in value) ||
      value.event !== "ready"
    )
      throw new Error(messages.invalid);
  } finally {
    deadline.clear();
  }
  await reader?.cancel();
};
