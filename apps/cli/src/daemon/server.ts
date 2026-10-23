import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { isAbsolute } from "node:path";
import { canonicalize, isRecord, UsageError, type ToolSession } from "@mcp-cli/core";
import { connect } from "@mcp-cli/mcp";
import { defaultStore, resolveConnection } from "../auth";
import { extensionCacheScope } from "../cache-scope";
import { discover, findPlugin, loadPlugin } from "../discovery";
import { defaultContext } from "../paths";
import { daemonDirectory, daemonSocket } from "./endpoint";
import { prepareOwnership } from "./ownership";
import { createPool } from "./pool";
import { decodeSessionRequest, type SessionRequest } from "./protocol";

const execute = (session: ToolSession, request: SessionRequest): Promise<unknown> => {
  switch (request.operation) {
    case "ensure":
      return Promise.resolve(null);
    case "listTools":
      return session.listTools();
    case "callTool":
      return session.callTool(request.name, request.input);
    case "listResources":
      return session.listResources();
    case "listResourceTemplates":
      return session.listResourceTemplates();
    case "readResource":
      return session.readResource(request.name);
    case "listPrompts":
      return session.listPrompts();
    case "getPrompt": {
      if (Object.values(request.input).some((value) => typeof value !== "string"))
        throw new UsageError("Prompt arguments must be strings");
      return session.getPrompt(request.name, request.input as Record<string, string>);
    }
  }
};

export const startDaemon = async (directory = daemonDirectory(), idleMs = 60_000) => {
  if (!isAbsolute(directory)) throw new UsageError("MCP_CLI_DAEMON_DIR must be absolute");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const ownership = `${directory}/owner`;
  await prepareOwnership(directory, true);
  const token = randomBytes(32).toString("hex");
  const pool = createPool(idleMs);
  const startedAt = Date.now();
  let stopping: Promise<void> | undefined;
  const leases = new Map<Socket, { session: ToolSession; release: () => void }>();
  const run = async (value: unknown, socket: Socket): Promise<unknown> => {
    if (!isRecord(value)) throw new UsageError("Invalid daemon request");
    if (value.operation === "status")
      return {
        pid: process.pid,
        startedAt,
        address: daemonSocket(directory),
        idleMs,
        connections: pool.status(),
      };
    if (value.operation === "reset") {
      await pool.reset();
      for (const lease of leases.values()) lease.release();
      leases.clear();
      return null;
    }
    if (value.operation === "stop") {
      setImmediate(() => {
        void stop().catch((error: unknown) => console.error(error));
      });
      return null;
    }
    const request = decodeSessionRequest(value);
    if (!isAbsolute(request.cwd)) throw new UsageError("Daemon cwd must be absolute");
    const registry = await discover(await defaultContext(request.env));
    const found = findPlugin(registry, request.service);
    const plugin = await loadPlugin(found);
    const store = defaultStore(request.env);
    const config = await resolveConnection(plugin, request.env, store, request.credential);
    const identity = await extensionCacheScope(plugin, request.env, store, request.credential);
    const key = createHash("sha256")
      .update(
        JSON.stringify(
          canonicalize({
            service: request.service,
            credential: request.credential,
            cwd: request.cwd,
            env: request.env,
            config: { ...config, authorize: undefined },
            identity,
            plugin: found,
          }),
        ),
      )
      .digest("hex");
    const connection =
      config.type === "stdio"
        ? { ...config, cwd: config.cwd ?? request.cwd, env: { ...request.env, ...config.env } }
        : config;
    return pool.use(
      key,
      request.service,
      () => connect(connection),
      (session) => {
        if (leases.get(socket)?.session !== session) {
          leases.get(socket)?.release();
          leases.set(socket, { session, release: pool.retain(key) });
        }
        return execute(session, request);
      },
      request.credential,
    );
  };
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("content-type", "application/json");
    if (
      req.method !== "POST" ||
      req.url !== "/" ||
      req.headers.authorization !== `Bearer ${token}`
    ) {
      res
        .writeHead(403)
        .end(JSON.stringify({ code: "Forbidden", message: "Unauthorized daemon request" }));
      return;
    }
    try {
      req.setEncoding("utf8");
      let body = "";
      for await (const chunk of req) {
        body += String(chunk);
        if (Buffer.byteLength(body) > 4 * 1024 * 1024)
          throw new UsageError("Daemon request exceeds 4 MiB");
      }
      const value: unknown = JSON.parse(body);
      res.end(JSON.stringify({ result: await run(value, req.socket) }));
    } catch (error) {
      res.writeHead(400).end(
        JSON.stringify({
          code: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };
  const server = createServer((req, res) => {
    void handle(req, res);
  });
  server.keepAliveTimeout = 0;
  server.on("connection", (socket) => {
    socket.once("close", () => {
      leases.get(socket)?.release();
      leases.delete(socket);
    });
  });
  const cleanup = async () => {
    await rm(`${directory}/token`, { force: true });
    if (process.platform !== "win32") await rm(daemonSocket(directory), { force: true });
    await rm(ownership, { force: true });
  };
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      const closed = new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await pool.reset(true);
      await closed;
      await cleanup();
    })();
    return stopping;
  };
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(daemonSocket(directory), resolve);
    });
    if (process.platform !== "win32") await chmod(daemonSocket(directory), 0o600);
    await writeFile(`${directory}/token`, token, { mode: 0o600 });
  } catch (error) {
    server.close();
    await cleanup();
    throw error;
  }
  return { stop, status: () => pool.status() };
};
