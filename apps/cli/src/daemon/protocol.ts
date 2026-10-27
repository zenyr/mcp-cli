import { isRecord, UsageError } from "@mcp-cli/core";

export type Operation =
  | "ensure"
  | "listTools"
  | "callTool"
  | "listResources"
  | "listResourceTemplates"
  | "readResource"
  | "listPrompts"
  | "getPrompt";
export type SessionRequest = {
  operation: Operation;
  service: string;
  credential?: string;
  workspace?: string;
  env: Record<string, string>;
  cwd: string;
  name: string;
  input: Record<string, unknown>;
};
const operations = new Set([
  "ensure",
  "listTools",
  "callTool",
  "listResources",
  "listResourceTemplates",
  "readResource",
  "listPrompts",
  "getPrompt",
]);
export const decodeSessionRequest = (value: unknown): SessionRequest => {
  if (
    !isRecord(value) ||
    typeof value.operation !== "string" ||
    !operations.has(value.operation) ||
    typeof value.service !== "string" ||
    typeof value.cwd !== "string" ||
    typeof value.name !== "string" ||
    !isRecord(value.input) ||
    !isRecord(value.env) ||
    Object.values(value.env).some((item) => typeof item !== "string") ||
    (value.credential !== undefined && typeof value.credential !== "string") ||
    (value.workspace !== undefined && typeof value.workspace !== "string")
  )
    throw new UsageError("Invalid daemon session request");
  return {
    operation: value.operation as Operation,
    service: value.service,
    cwd: value.cwd,
    name: value.name,
    input: value.input,
    env: value.env as Record<string, string>,
    credential: value.credential,
    workspace: value.workspace,
  };
};
export type DaemonStatus = {
  pid: number;
  startedAt: number;
  address: string;
  idleMs: number;
  connections: {
    id: string;
    service: string;
    credential?: string;
    workspace?: string;
    openedAt: number;
    active: number;
    leases: number;
    lastUsed: number;
  }[];
};
