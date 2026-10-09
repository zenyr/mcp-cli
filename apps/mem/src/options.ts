import type { Kind } from "./types";
import { fail, positive } from "./values";

export type Options = {
  command: string;
  text: string[];
  selection?: "global" | "project";
  maxBytes: number;
  limit: number;
  cursor?: string;
  receipt?: string;
  file?: string;
  stdin: boolean;
  kind: Kind;
  model?: string;
  baseUrl?: string;
  count?: number;
  generation?: string;
  key?: string;
  from?: number;
  to?: number;
  expectedRevision?: number;
};
const valued = new Set([
  "--max-bytes",
  "--limit",
  "--cursor",
  "--receipt",
  "--file",
  "--kind",
  "--model",
  "--base-url",
  "--count",
  "--generation",
  "--key",
  "--from",
  "--to",
  "--expected-revision",
]);
const allowed: Record<string, string[]> = {
  start: [],
  save: ["--receipt", "--file", "--stdin", "--kind"],
  summarize: [],
  recall: ["--cursor", "--limit"],
  read: ["--cursor"],
  zoom: ["--count", "--generation", "--cursor"],
  pin: ["--key", "--from", "--to", "--expected-revision", "--receipt"],
  unpin: ["--expected-revision", "--receipt"],
  pins: ["--key"],
  status: [],
  config: [],
};
export const parse = (argv: string[]): Options => {
  const command = argv[0] ?? "--help";
  const result: Options = {
    command,
    text: [],
    maxBytes: 8192,
    limit: 20,
    stdin: false,
    kind: "note",
  };
  if (["--help", "-h", "help"].includes(command)) return result;
  const flags = allowed[command];
  if (!flags) return fail("INVALID_OPTION", "Unknown command.");
  const seen = new Set<string>();
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (!arg.startsWith("--")) {
      result.text.push(arg);
      continue;
    }
    if (seen.has(arg)) fail("INVALID_OPTION", `Repeated option: ${arg}`);
    seen.add(arg);
    if (!["--global", "--project", "--max-bytes", "--model", "--base-url", ...flags].includes(arg))
      fail("INVALID_OPTION", `Unknown option: ${arg}`);
    if (arg === "--global" || arg === "--project") {
      if (result.selection)
        fail("INVALID_OPTION", "--global and --project are mutually exclusive.");
      result.selection = arg === "--global" ? "global" : "project";
      continue;
    }
    if (arg === "--stdin") {
      result.stdin = true;
      continue;
    }
    const value = argv[++index];
    if (!valued.has(arg) || value === undefined || value.startsWith("--"))
      fail("INVALID_OPTION", `${arg} requires a value.`);
    if (arg === "--max-bytes") {
      result.maxBytes = positive(value, arg, 20480);
      if (result.maxBytes < 512) fail("INVALID_OPTION", "--max-bytes must be at least 512.");
    } else if (arg === "--limit") result.limit = positive(value, arg, 1000);
    else if (arg === "--cursor") result.cursor = value;
    else if (arg === "--receipt") {
      if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value))
        fail("INVALID_OPTION", "--receipt must be a UUID.");
      result.receipt = value;
    } else if (arg === "--file") result.file = value;
    else if (arg === "--model") result.model = value;
    else if (arg === "--base-url") result.baseUrl = value;
    else if (arg === "--generation") result.generation = value;
    else if (arg === "--key") result.key = value;
    else if (arg === "--count") result.count = positive(value, arg, Number.MAX_SAFE_INTEGER);
    else if (["--from", "--to", "--expected-revision"].includes(arg)) {
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
        fail("INVALID_OPTION", `${arg} must be a nonnegative safe integer.`);
      if (arg === "--from") result.from = Number(value);
      else if (arg === "--to") result.to = Number(value);
      else result.expectedRevision = Number(value);
    } else if (arg === "--kind") {
      if (!["user", "talk", "tool", "echo", "note"].includes(value))
        fail("INVALID_OPTION", "Invalid --kind.");
      result.kind = value as Kind;
    }
  }
  if (command === "save") {
    if (
      Number(result.stdin) + Number(result.file !== undefined) + Number(result.text.length > 0) !==
      1
    )
      fail("INVALID_OPTION", "save requires exactly one source: text, --file, or --stdin.");
  } else if (["read", "recall", "zoom", "pin", "unpin"].includes(command)) {
    if (result.text.length !== 1) fail("INVALID_OPTION", `${command} requires one argument.`);
  } else if (result.text.length) fail("INVALID_OPTION", "Unexpected positional argument.");
  if (command === "zoom" && (result.count === undefined || result.generation === undefined))
    fail("INVALID_OPTION", "zoom requires --count and --generation.");
  if (
    ["pin", "unpin"].includes(command) &&
    (result.expectedRevision === undefined || !result.receipt)
  )
    fail("INVALID_OPTION", `${command} requires --expected-revision and --receipt.`);
  if (command === "pin" && (!result.key || result.from === undefined || result.to === undefined))
    fail("INVALID_OPTION", "pin requires --key, --from and --to.");
  return result;
};
