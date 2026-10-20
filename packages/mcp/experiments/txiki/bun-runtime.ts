import { chmod, rename } from "node:fs/promises";
import type { Runtime } from "./runtime";

export const runtime: Runtime = {
  name: "bun",
  args: process.argv.slice(2),
  executable: process.execPath,
  fetch,
  spawn: (args) => {
    const child = Bun.spawn(args, { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
    return {
      input: new WritableStream({
        write: (chunk) => {
          child.stdin.write(chunk);
        },
        close: () => {
          child.stdin.end();
        },
      }),
      output: child.stdout,
      exited: child.exited,
    };
  },
  serve: (handler) => {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
    return { url: server.url.href, close: () => server.stop(true) };
  },
  read: (path) => Bun.file(path).text(),
  writePrivate: async (path, value) => {
    await Bun.write(`${path}.tmp`, value, { mode: 0o600 });
    await chmod(`${path}.tmp`, 0o600);
    await rename(`${path}.tmp`, path);
  },
  input: Bun.stdin.stream(),
  output: new WritableStream({
    write: async (chunk) => {
      await Bun.stdout.write(chunk);
    },
  }),
  exit: (code) => process.exit(code),
};
