import { UsageError } from "@mcp-cli/core";
import { specs, type WebSpec } from "./web-specs";
import type { Input } from "./web-common";

export const splitCommand = (source: string): string[] => {
  const words: string[] = [];
  let word = "",
    quote = "",
    escaped = false,
    started = false;
  for (const char of source) {
    if (escaped) {
      word += char;
      escaped = false;
      started = true;
    } else if (char === "\\" && quote !== "'") {
      escaped = true;
      started = true;
    } else if (quote) {
      if (char === quote) quote = "";
      else word += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) words.push(word);
      word = "";
      started = false;
    } else {
      word += char;
      started = true;
    }
  }
  if (escaped || quote) throw new UsageError("Unterminated quote or escape in batch command");
  if (started) words.push(word);
  return words;
};
export const normalizeArgv = (argv: string[]): string[] => {
  const globals = new Set([
    "--xoxb",
    "--xoxp",
    "--json",
    "--allow-repeat",
    "--help",
    "-h",
    "--help=full",
  ]);
  const global: string[] = [];
  const words = [...argv];
  while (words[0]) {
    const arg = words[0];
    if (globals.has(arg) || arg.startsWith("--workspace=")) global.push(words.shift() ?? "");
    else if (arg === "-w" || arg === "--workspace") {
      global.push(words.shift() ?? "");
      if (words[0] && !words[0].startsWith("-")) global.push(words.shift() ?? "");
    } else break;
  }
  const entry = [...specs]
    .sort((a, b) => b.path.length - a.path.length)
    .find((item) => item.path.split(" ").every((part, index) => words[index] === part));
  if (!entry) return argv;
  const tail = words.slice(entry.path.split(" ").length);
  const args: string[] = [];
  const flags: string[] = [];
  const fields = new Map(
    entry.options
      .split(" ")
      .map((field) => [field.split(":")[0] ?? "", field.split(":")[1] ?? ""] as const),
  );
  let literal = false;
  for (let index = 0; index < tail.length; index++) {
    const arg = tail[index] ?? "";
    if (arg === "--") {
      literal = true;
      continue;
    }
    if (!literal && (arg === "-w" || arg === "--workspace" || arg.startsWith("--workspace="))) {
      global.push(arg);
      if (!arg.includes("=") && tail[index + 1] && !tail[index + 1]?.startsWith("-"))
        global.push(tail[++index] ?? "");
      continue;
    }
    if (!literal && globals.has(arg)) {
      global.push(arg);
      continue;
    }
    if (!literal && arg.startsWith("--")) {
      flags.push(arg);
      if (arg.includes("=")) continue;
      const key = arg.slice(2);
      const next = tail[index + 1];
      if (key === "blocks" && (next === undefined || next.startsWith("--"))) flags.push("true");
      else if (fields.get(key) === "b") {
        if (next === "true" || next === "false") {
          flags.push(next);
          index++;
        }
      } else if (next !== undefined) {
        flags.push(next);
        index++;
      }
    } else args.push(arg);
  }
  return [
    ...entry.path.split(" "),
    ...global,
    ...(args.length ? ["--args", JSON.stringify(args)] : []),
    ...flags,
  ];
};
export const positional = (entry: WebSpec, input: Input): Input => {
  const values = Array.isArray(input.args)
    ? input.args.filter((value): value is string => typeof value === "string")
    : [];
  const result = { ...input };
  delete result.args;
  const fields = [...entry.args];
  if (entry.path === "messages update" && values[0]?.startsWith("https:")) fields.splice(1, 1);
  if (
    entry.path.startsWith("reactions ") &&
    values[0]?.startsWith("https:") &&
    entry.path !== "reactions list"
  )
    fields.splice(1, 1);
  let index = 0;
  for (const field of fields) {
    const key = field.replace(/\?|\.\.\./g, "");
    const value = field.endsWith("...") ? values.slice(index) : values[index];
    if ((value === undefined || (Array.isArray(value) && !value.length)) && !field.endsWith("?"))
      throw new UsageError(`Missing positional argument: ${key}`);
    if (value !== undefined) {
      if (result[key] !== undefined)
        throw new UsageError(`Conflicting positional argument and option: ${key}`);
      result[key] = value;
    }
    index = field.endsWith("...") ? values.length : index + 1;
  }
  if (values.length > index) throw new UsageError("Too many positional arguments");
  return result;
};
