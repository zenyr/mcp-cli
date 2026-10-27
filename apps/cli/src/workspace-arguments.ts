import { UsageError } from "@mcp-cli/core";

export const extractWorkspace = (argv: string[]): { args: string[]; workspace?: string } => {
  const args: string[] = [];
  let workspace: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    if (arg !== "-w" && arg !== "--workspace" && !arg.startsWith("--workspace=")) {
      args.push(arg);
      continue;
    }
    if (workspace !== undefined) throw new UsageError("Use --workspace only once");
    const value = arg.startsWith("--workspace=") ? arg.slice(12) : argv[++index];
    if (!value || value.startsWith("-")) throw new UsageError("Missing value for --workspace");
    workspace = value;
  }
  return { args, workspace };
};

export const leadingArguments = (argv: string[]): { command?: string; args: string[] } => {
  const flags: string[] = [];
  let index = 0;
  while (index < argv.length) {
    const arg = argv[index] ?? "";
    if (arg === "--json" || arg.startsWith("--workspace=")) flags.push(arg);
    else if (arg === "-w" || arg === "--workspace") {
      const value = argv[++index];
      if (!value || value.startsWith("-")) throw new UsageError("Missing value for --workspace");
      flags.push(arg, value);
    } else break;
    index++;
  }
  return { command: argv[index], args: [...argv.slice(index + 1), ...flags] };
};
