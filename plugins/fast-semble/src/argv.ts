import { UsageError } from "@mcp-cli/core";

const switches = new Set(["--json", "--help", "--help=full", "-h", "--allow-repeat"]);
const sourceFlags = new Set(["--input", "--input-file"]);

export const normalizeArgv = (argv: string[]): string[] => {
  let start = 0;
  while (start < argv.length) {
    const token = argv[start] ?? "";
    if (switches.has(token) || token.startsWith("--workspace=")) start++;
    else if (token === "--workspace" || token === "-w") start += 2;
    else break;
  }
  const command = argv[start];
  if (command !== "search" && command !== "find-related") return argv;
  const output = argv.slice(0, start + 1);
  const positional: string[] = [];
  let literal = false;
  let source = false;
  let repository = false;
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
    source ||= sourceFlags.has(flag);
    repository ||= flag === "--repo";
    if (switches.has(token) || token.includes("=")) continue;
    const value = argv[++i];
    if (value === undefined || value.startsWith("--"))
      throw new UsageError(`Missing value for ${flag}`);
    output.push(value);
  }
  if (source) {
    if (positional.length) throw new UsageError("Use positional arguments or --input, not both");
    return output;
  }
  const fields = command === "search" ? ["query"] : ["file-path", "line"];
  for (const field of fields) {
    const value = positional.shift();
    if (value !== undefined) output.push(`--${field}=${value}`);
  }
  if (positional.length) {
    if (repository) throw new UsageError("Use positional repositories or --repo, not both");
    if (positional.length > 1)
      throw new UsageError("Use --input with a repo array for multiple repositories");
    output.push(`--repo=${positional[0]}`);
  } else if (!repository) output.push("--repo=.");
  return output;
};
