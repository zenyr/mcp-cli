import type { JsonSchema, ToolCaller, ToolResult } from "./index";

export type ExtensionIO = {
  write(text: string): void;
  writeError(text: string): void;
  readFile(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  readStdin(): Promise<string>;
};
export type ExtensionContext = {
  callTool: ToolCaller;
  io: ExtensionIO;
  json: boolean;
  credential?: string;
  workspace?: import("./workspaces").Workspace;
  runCommand?: (argv: string[]) => Promise<{ exitCode: number; output: string[] }>;
  cacheScope?: string;
};
export type ExtensionCommand = {
  path: string[];
  kind: "alias" | "workflow";
  tool?: string;
  summary: string;
  details?: string;
  examples?: string[];
  rules?: string[];
  inputSchema: JsonSchema;
  run: (
    input: Record<string, unknown>,
    context: ExtensionContext,
  ) => Promise<{ result: ToolResult; exitCode?: number }>;
};
export type ServiceExtensions = {
  commands: ExtensionCommand[];
  normalizeArgv?: (argv: string[]) => string[];
};
