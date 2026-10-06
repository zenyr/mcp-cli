export type JsonSchema = Record<string, unknown>;
export type ToolDefinition = {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
};
export type CommandCustomization = {
  path: string[];
  summary?: string;
  details?: string;
  examples?: string[];
  rules?: string[];
};
export type CommandSpec = CommandCustomization & ToolDefinition;
export type Manifest = {
  version: 1;
  service: string;
  summary: string;
  commands: CommandSpec[];
};
export type ToolResult = {
  content: Array<Record<string, unknown>>;
  structuredContent?: unknown;
  isError?: boolean;
};
export type ToolCaller = (name: string, input: Record<string, unknown>) => Promise<ToolResult>;
export type ToolSession = {
  listTools(): Promise<ToolDefinition[]>;
  callTool: ToolCaller;
  close(): Promise<void>;
};
export type Connection =
  | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { type: "http"; url: string; headers?: Record<string, string> };
export type ServicePlugin = {
  name: string;
  summary: string;
  commands?: Record<string, CommandCustomization>;
  skill?: string;
  connection(env: Record<string, string | undefined>): Connection;
  beforeCall?: (command: CommandSpec, input: Record<string, unknown>) => Promise<void>;
};
export const definePlugin = (plugin: ServicePlugin): ServicePlugin => {
  if (!/^[a-z][a-z0-9-]*$/.test(plugin.name)) throw new Error("Invalid service name");
  return plugin;
};
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const RESERVED_COMMANDS: readonly string[] = ["help", "methods", "call", "skill"];
export const RESERVED_FLAGS: readonly string[] = ["json", "help", "input", "input-file"];
export const fallbackPath = (toolName: string): string[] => ["call", toolName];
