import type { Runtime } from "./runtime";

export const runtime: Runtime = {
  name: "txiki",
  args: tjs.args.slice(1),
  executable: tjs.exePath,
  fetch: (input, init) => fetch(input instanceof URL ? input.href : input, init),
  spawn: (args) => {
    const child = tjs.spawn(args, { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
    if (!child.stdin || !child.stdout) throw new Error("하위 프로세스의 입출력을 열지 못했습니다.");
    return {
      input: child.stdin,
      output: child.stdout,
      exited: child.wait().then((status) => status.exit_status),
    };
  },
  serve: (handler) => {
    const server = tjs.serve({ listenIp: "127.0.0.1", port: 0, fetch: handler });
    return { url: `http://127.0.0.1:${server.port}/`, close: () => server.close() };
  },
  read: async (path) => new TextDecoder().decode(await tjs.readFile(path)),
  writePrivate: async (path, value) => {
    await tjs.writeFile(`${path}.tmp`, value, { mode: 0o600 });
    await tjs.chmod(`${path}.tmp`, 0o600);
    await tjs.rename(`${path}.tmp`, path);
  },
  input: tjs.stdin,
  output: tjs.stdout,
  exit: (code) => tjs.exit(code),
};
