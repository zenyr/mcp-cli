export type JsonSchema = Record<string, unknown>;
/** MCP behavior hints; servers may omit them, and they are advisory rather than guarantees. */
export type ToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};
export type ToolDefinition = {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: ToolAnnotations;
};
export type CommandCustomization = {
  path: string[];
  summary?: string;
  details?: string;
  examples?: string[];
  rules?: string[];
  /** Input fields (string or string array) whose `@path` values are uploaded through `uploadFile`. */
  uploads?: string[];
  /** The server may omit this tool, for example when token scopes hide it. */
  optional?: boolean;
};
export type CommandSpec = CommandCustomization & ToolDefinition;
/** A recommended command line, relative to the service name, shown first in root help. */
export type QuickstartEntry = { command: string; summary: string };
/** Commands resolved from generated tools and the plugin's customizations at run time. */
export type Manifest = {
  service: string;
  summary: string;
  commands: CommandSpec[];
  groups: Record<string, string>;
  quickstart: QuickstartEntry[];
  /** Credential switches such as `--xoxb` that pick an alternate key for one run. */
  credentials: import("./auth").ApiKeyAlternate[];
};
export type ToolResult = {
  content: Array<Record<string, unknown>>;
  structuredContent?: unknown;
  isError?: boolean;
};
export type ToolCaller = (name: string, input: Record<string, unknown>) => Promise<ToolResult>;
export type ToolSession = import("./session").CatalogSession & {
  listTools(): Promise<ToolDefinition[]>;
  callTool: ToolCaller;
  close(): Promise<void>;
};
/** `refresh` is true once after the server rejects a request with 401. */
export type AuthorizeRequest = { refresh: boolean };
export type Authorize = (request: AuthorizeRequest) => Promise<Record<string, string>>;
export type Connection =
  | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { type: "http"; url: string; headers?: Record<string, string>; authorize?: Authorize };
export type ServicePlugin = {
  name: string;
  summary: string;
  commands?: Record<string, CommandCustomization>;
  /** One-line descriptions keyed by a space-joined command group path such as "media image". */
  groups?: Record<string, string>;
  quickstart?: QuickstartEntry[];
  skill?: string;
  auth?: import("./auth").AuthSpec;
  connection(env: Record<string, string | undefined>): Connection | Promise<Connection>;
  beforeCall?: (command: CommandSpec, input: Record<string, unknown>) => Promise<void>;
  /** Uploads one local file through the given ports and returns the URL the tool should receive. */
  uploadFile?: (file: LocalFile, context: UploadContext) => Promise<string>;
};
/** A local file named as `@path` in an upload field. */
export type LocalFile = { path: string; name: string; bytes: Uint8Array };
/** Ports an upload policy may use: tool calls on the open session and a raw byte transfer. */
export type UploadContext = {
  callTool: ToolCaller;
  putBytes(url: string, bytes: Uint8Array): Promise<void>;
};
const flagName = /^[a-z][a-z0-9-]*$/;
export const definePlugin = (plugin: ServicePlugin): ServicePlugin => {
  if (!flagName.test(plugin.name)) throw new Error("Invalid service name");
  const flags = credentialSwitches(plugin.auth).map((alternate) => alternate.flag);
  for (const flag of flags)
    if (!flagName.test(flag) || RESERVED_FLAGS.includes(flag) || flag.startsWith("no-"))
      throw new Error(`Invalid credential flag: --${flag}`);
  if (new Set(flags).size !== flags.length) throw new Error("Duplicate credential flag");
  return plugin;
};
export { canonicalize, isRecord, isStringArray } from "./values";
export {
  applyCustomizations,
  decodeAnnotations,
  decodeManifest,
  type GeneratedManifest,
} from "./manifest";
import { credentialSwitches } from "./auth";
export {
  AuthRequiredError,
  credentialName,
  credentialSwitches,
  loginRequired,
  type ApiKeyAlternate,
  type ApiKeySpec,
  type AuthSpec,
  type OAuthSpec,
  type TokenStore,
  type Tokens,
} from "./auth";
export type * from "./session";
export type CallStatus = "pending" | "ok" | "error";
export type CallRecord = { tool: string; at: number; status: CallStatus; attempt: string };
/** Remembers recent non-idempotent calls so an identical retry inside the window can be refused. */
export type RepeatGuard = {
  /** Returns the earlier pending or successful record for `key`, or records this attempt as pending. */
  begin(
    service: string,
    key: string,
    tool: string,
    attempt: string,
  ): Promise<CallRecord | undefined>;
  /** Settles `key` only while it still belongs to `attempt`, so a late call cannot overwrite a newer one. */
  finish(
    service: string,
    key: string,
    attempt: string,
    status: Exclude<CallStatus, "pending">,
  ): Promise<void>;
};
/** An identical non-idempotent call already ran inside the repeat window; the CLI exits with status 3. */
export class RepeatedCallError extends Error {
  override name = "RepeatedCallError";
}
/** Invalid command-line usage; the CLI exits with status 2. */
export class UsageError extends Error {
  override name = "UsageError";
}
/** Generated code for a service is missing or outdated; the CLI exits with status 1. */
export class NotGeneratedError extends Error {
  override name = "NotGeneratedError";
}
export const COMMANDS = {
  help: "help",
  methods: "methods",
  call: "call",
  skill: "skill",
  resources: "resources",
  prompts: "prompts",
} as const;
export const FLAGS = {
  json: "json",
  help: "help",
  input: "input",
  inputFile: "input-file",
  allowRepeat: "allow-repeat",
} as const;
export const RESERVED_COMMANDS: readonly string[] = Object.values(COMMANDS);
export const RESERVED_FLAGS: readonly string[] = Object.values(FLAGS);
export const fallbackPath = (toolName: string): string[] => [COMMANDS.call, toolName];
