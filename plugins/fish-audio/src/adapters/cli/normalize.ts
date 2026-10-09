import { isRecord, UsageError } from "@mcp-cli/core";
import { workflowSchema, type WorkflowName } from "./schema";
const workflowName = (value: string | undefined): WorkflowName | undefined =>
  value === "tts" || value === "stt" || value === "script" || value === "roundtrip"
    ? value
    : undefined;
const aliases: Record<string, string> = {
  "-o": "--output",
  "-y": "--yes",
  "--voice": "--voice-id",
  "--fail-over": "--max-cer",
};
const globalSwitches = new Set(["--json", "--help", "-h", "--allow-repeat"]);
export const normalizeArgv = (argv: string[]): string[] => {
  if (argv.length === 1 && argv[0] === "--skill") return ["skill"];
  const commandIndex = argv.findIndex((arg) => !globalSwitches.has(arg));
  const name = workflowName(argv[commandIndex]);
  if (!name) return argv;
  const properties = workflowSchema(name).properties;
  if (!isRecord(properties)) throw new Error("Workflow schema has no properties");
  const output = [...argv.slice(0, commandIndex), name];
  let positional = false;
  let literal = false;
  for (let i = commandIndex + 1; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    if (!literal && token === "--") {
      literal = true;
      continue;
    }
    if (literal || !token.startsWith("-") || token === "-") {
      if (positional) throw new UsageError("Pass only one positional value");
      positional = true;
      output.push(`${name === "stt" ? "--audio-url" : "--text"}=${token}`);
      continue;
    }
    const separator = token.indexOf("=");
    const key = separator < 0 ? token : token.slice(0, separator);
    const flag = aliases[key] ?? key;
    const inline = separator < 0 ? undefined : token.slice(separator + 1);
    if (globalSwitches.has(flag)) {
      output.push(token);
      continue;
    }
    if (flag === "--input" || flag === "--input-file") {
      const value = inline ?? argv[++i];
      if (value === undefined) throw new UsageError(`Missing value for ${flag}`);
      output.push(`${flag}=${value}`);
      continue;
    }
    const field = flag.slice(2).replaceAll("-", "_");
    const schema = properties[field.startsWith("no_") ? field.slice(3) : field];
    if (!flag.startsWith("--") || !isRecord(schema)) throw new UsageError(`Unknown option: ${key}`);
    if (schema.type === "boolean" && inline === undefined) {
      const next = argv[i + 1];
      if (next === "true" || next === "false") {
        output.push(flag, next);
        i++;
      } else output.push(flag);
      continue;
    }
    const value = inline ?? argv[++i];
    if (value === undefined || (inline === undefined && value.startsWith("--")))
      throw new UsageError(`Missing value for ${key}`);
    output.push(`${flag}=${value}`);
  }
  return output;
};
