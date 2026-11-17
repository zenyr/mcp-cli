import { UsageError } from "@mcp-cli/core";

const switches = new Set(["--json", "--help", "--help=full", "-h", "--allow-repeat"]);
const sourceFlags = new Set(["--input", "--input-file"]);
const chats = new Set(["ask", "reason", "research"]);

// Turns positional words into the tool's question field so `pplx ask what is MCP` works unquoted.
const questionFlag = (command: string, text: string): string =>
  chats.has(command)
    ? `--messages=${JSON.stringify([{ role: "user", content: text }])}`
    : `--query=${text}`;

export const normalizeArgv = (argv: string[]): string[] => {
  let start = 0;
  while (start < argv.length) {
    const token = argv[start] ?? "";
    if (switches.has(token) || token.startsWith("--workspace=")) start++;
    else if (token === "--workspace" || token === "-w") start += 2;
    else break;
  }
  const command = argv[start];
  if (command === undefined || (command !== "search" && !chats.has(command))) return argv;
  const output = argv.slice(0, start + 1);
  const positional: string[] = [];
  let literal = false;
  let explicit = false;
  for (let i = start + 1; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    if (!literal && token === "--") {
      literal = true;
      continue;
    }
    if (literal || !token.startsWith("-") || token === "-") {
      positional.push(token);
      continue;
    }
    output.push(token);
    const flag = token.split("=")[0] ?? token;
    explicit ||= sourceFlags.has(flag) || flag === "--messages" || flag === "--query";
    if (switches.has(token) || token.includes("=")) continue;
    const value = argv[++i];
    if (value === undefined || value.startsWith("--"))
      throw new UsageError(`Missing value for ${flag}`);
    output.push(value);
  }
  if (!positional.length) return output;
  if (explicit) throw new UsageError("Use a positional question or an input flag, not both");
  return [...output, questionFlag(command, positional.join(" "))];
};
