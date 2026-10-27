import { readFile } from "node:fs/promises";
import { Agent, request } from "node:http";
import { AuthRequiredError, isRecord, UsageError, type ToolSession } from "@mcp-cli/core";
import { daemonDirectory, daemonSocket } from "./endpoint";
import type { DaemonStatus, Operation } from "./protocol";

export const daemonRequest = async <T>(
  operation: string,
  payload: Record<string, unknown> = {},
  directory = daemonDirectory(),
  agent?: Agent,
): Promise<T> => {
  const token = await readFile(`${directory}/token`, "utf8");
  return new Promise<T>((resolve, reject) => {
    const req = request(
      {
        agent,
        socketPath: daemonSocket(directory),
        path: "/",
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("error", reject);
        res.on("end", () => {
          try {
            const value: unknown = JSON.parse(body);
            if (!isRecord(value)) throw new Error("Invalid daemon response");
            if (res.statusCode !== 200) {
              const message =
                typeof value.message === "string" ? value.message : "Daemon request failed";
              throw value.code === "UsageError"
                ? new UsageError(message)
                : value.code === "AuthRequiredError"
                  ? new AuthRequiredError(message)
                  : new Error(message);
            }
            resolve(value.result as T);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    if (["status", "stop"].includes(operation))
      req.setTimeout(3000, () => {
        req.destroy(new Error("Daemon did not respond within 3 seconds"));
      });
    req.on("error", reject);
    req.end(JSON.stringify({ ...payload, operation }));
  });
};

export class DaemonUnavailableError extends Error {
  override name = "DaemonUnavailableError";
}

export const usesDaemon = (env: Record<string, string | undefined> = process.env): boolean => {
  const mode = env.MCP_CLI_DAEMON;
  if (mode === undefined || mode === "" || mode === "1") return true;
  if (mode === "0") return false;
  throw new UsageError("MCP_CLI_DAEMON must be 0 or 1");
};

export const openDaemonSession = async (
  service: string,
  credential?: string,
  workspace?: string,
): Promise<ToolSession> => {
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  const context = {
    service,
    credential,
    workspace,
    cwd: process.cwd(),
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  };
  const call = <T>(operation: Operation, name = "", input: Record<string, unknown> = {}) =>
    daemonRequest<T>(operation, { ...context, name, input }, undefined, agent);
  try {
    await call("ensure");
  } catch (error) {
    agent.destroy();
    if (isRecord(error) && ["ENOENT", "ECONNREFUSED"].includes(String(error.code)))
      throw new DaemonUnavailableError("Daemon is not running", { cause: error });
    throw error;
  }
  return {
    listTools: () => call("listTools"),
    callTool: (name, input) => call("callTool", name, input),
    listResources: () => call("listResources"),
    listResourceTemplates: () => call("listResourceTemplates"),
    readResource: (uri) => call("readResource", uri),
    listPrompts: () => call("listPrompts"),
    getPrompt: (name, args) => call("getPrompt", name, args),
    close: async () => {
      agent.destroy();
    },
  };
};
export const daemonStatus = (directory?: string) =>
  daemonRequest<DaemonStatus>("status", {}, directory);

export const resetDaemonIfRunning = async () => {
  try {
    await daemonRequest("reset");
  } catch (error) {
    if (!isRecord(error) || !["ENOENT", "ECONNREFUSED"].includes(String(error.code))) throw error;
  }
};
