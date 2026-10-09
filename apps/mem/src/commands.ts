import type { Entry, Kind, Scope, Store } from "./types";
import { fail, isRecord, output, positive } from "./values";

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
]);
const allowed: Record<string, string[]> = {
  start: [],
  save: ["--receipt", "--file", "--stdin", "--kind"],
  summarize: [],
  recall: ["--cursor", "--limit"],
  read: ["--cursor"],
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
    else if (arg === "--kind") {
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
  } else if (command === "read" || command === "recall") {
    if (result.text.length !== 1) fail("INVALID_OPTION", `${command} requires one argument.`);
  } else if (result.text.length) fail("INVALID_OPTION", "Unexpected positional argument.");
  return result;
};
const id = (entry: Entry): string => `${entry.scope}/${entry.i}`;
const normalized = (text: string): string => text.normalize("NFC").toLowerCase().normalize("NFC");
const excerpt = (text: string, query: string): string[] => {
  const scalars = Array.from(text.normalize("NFC"));
  const at = normalized(text).indexOf(query);
  let units = 0;
  let index = 0;
  while (index < scalars.length && units < at) {
    units += (scalars[index] ?? "").toLowerCase().length;
    index++;
  }
  return scalars.slice(Math.max(0, index - 60), index + 180);
};
const fits = (value: unknown, limit: number): boolean =>
  Buffer.byteLength(`${JSON.stringify(value)}\n`) <= limit;
export const readRecord = (store: Store, scopes: Scope[], options: Options): unknown => {
  const recordId = options.text[0] ?? "";
  const slash = recordId.lastIndexOf("/");
  const scope = recordId.slice(0, slash);
  const number = recordId.slice(slash + 1);
  if (slash < 1 || !/^\d+$/.test(number) || !Number.isSafeInteger(Number(number)))
    fail("INVALID_OPTION", "Invalid record ID.");
  if (!scopes.some((item) => item.id === scope))
    fail("RECORD_UNAVAILABLE", "Record is unavailable in selected scopes.");
  const entry = store.entries(scope).find((item) => item.i === Number(number));
  if (!entry) return fail("RECORD_UNAVAILABLE", "Record is unavailable in selected scopes.");
  const cursor = options.cursor ?? "0";
  if (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor)))
    fail("INVALID_OPTION", "Invalid read cursor.");
  const scalars = Array.from(entry.text);
  const offset = Number(cursor);
  if (offset > scalars.length) fail("INVALID_OPTION", "Read cursor exceeds record length.");
  const page = (end: number) => ({
    ok: true,
    recordId,
    kind: entry.kind,
    date: entry.date,
    text: scalars.slice(offset, end).join(""),
    cursor: end < scalars.length ? String(end) : null,
  });
  let low = offset;
  let high = scalars.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(page(middle), options.maxBytes)) low = middle;
    else high = middle - 1;
  }
  if (low === offset && offset < scalars.length)
    fail("OUTPUT_OVERFLOW", "Record metadata exceeds --max-bytes.");
  output(page(low), options.maxBytes);
  return page(low);
};
type Boundary = { scope: string; high: number };
const decodeCursor = (cursor: string): { boundaries: Boundary[]; skip: number; query: string } => {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return fail("INVALID_OPTION", "Invalid recall cursor.");
  }
  if (
    !isRecord(value) ||
    !Array.isArray(value.boundaries) ||
    !Number.isSafeInteger(value.skip) ||
    typeof value.skip !== "number" ||
    value.skip < 0 ||
    typeof value.query !== "string"
  )
    return fail("INVALID_OPTION", "Invalid recall cursor.");
  const boundaries = value.boundaries.map((item: unknown) => {
    if (
      !isRecord(item) ||
      typeof item.scope !== "string" ||
      typeof item.high !== "number" ||
      !Number.isSafeInteger(item.high) ||
      item.high < 0
    )
      return fail("INVALID_OPTION", "Invalid recall cursor boundary.");
    return { scope: item.scope, high: item.high };
  });
  return { boundaries, skip: value.skip, query: value.query };
};
export const recall = (store: Store, scopes: Scope[], options: Options): unknown => {
  const query = normalized(options.text[0] ?? "");
  if (!query.trim()) fail("INVALID_OPTION", "Recall query must not be empty.");
  const state = options.cursor
    ? decodeCursor(options.cursor)
    : {
        boundaries: scopes.map((scope) => ({
          scope: scope.id,
          high: (store.entries(scope.id).at(-1)?.i ?? -1) + 1,
        })),
        skip: 0,
        query,
      };
  if (
    state.query !== query ||
    state.boundaries.length !== scopes.length ||
    state.boundaries.some((item, index) => item.scope !== scopes[index]?.id)
  )
    fail("INVALID_OPTION", "Recall cursor does not match query or scopes.");
  if (
    state.boundaries.some(
      (boundary) => boundary.high > (store.entries(boundary.scope).at(-1)?.i ?? -1) + 1,
    )
  )
    fail("INVALID_OPTION", "Recall cursor exceeds scope history.");
  const hits = state.boundaries
    .flatMap((boundary) => store.entries(boundary.scope, boundary.high))
    .filter((entry) => normalized(entry.text).includes(query))
    .sort((a, b) => b.date.localeCompare(a.date) || b.i - a.i || a.scope.localeCompare(b.scope));
  if (state.skip > hits.length) fail("INVALID_OPTION", "Recall cursor exceeds result count.");
  const results: { recordId: string; kind: Kind; snippet: string }[] = [];
  const page = () => ({
    ok: true,
    results,
    cursor:
      state.skip + results.length < hits.length
        ? Buffer.from(JSON.stringify({ ...state, skip: state.skip + results.length })).toString(
            "base64url",
          )
        : null,
  });
  for (const entry of hits.slice(state.skip, state.skip + options.limit)) {
    const scalars = excerpt(entry.text, query);
    let length = Math.min(scalars.length, 240);
    results.push({
      recordId: id(entry),
      kind: entry.kind,
      snippet: scalars.slice(0, length).join(""),
    });
    while (!fits(page(), options.maxBytes) && length > 0) {
      length = Math.floor(length / 2);
      const last = results.at(-1);
      if (last) last.snippet = scalars.slice(0, length).join("");
    }
    if (!fits(page(), options.maxBytes)) {
      results.pop();
      break;
    }
  }
  if (!results.length && state.skip < hits.length)
    fail("OUTPUT_OVERFLOW", "Recall metadata exceeds --max-bytes.");
  return page();
};
