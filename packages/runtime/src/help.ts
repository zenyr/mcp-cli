import {
  RESERVED_COMMANDS,
  UsageError,
  fallbackPath,
  isRecord,
  type CommandSpec,
  type Manifest,
} from "@mcp-cli/core";
import {
  CALL,
  HELP,
  METHODS,
  PROMPTS,
  RESOURCES,
  SKILL,
  flagForm,
  isReservedField,
} from "./reserved";
import { guardsRepeats } from "./repeat";
import { typeLabel } from "./schema";

const reservedUsage = (service: string): Map<string | undefined, string> =>
  new Map([
    [METHODS, " [group] [--json]\n\nList baked-in tool names and command paths."],
    [HELP, " [command]\n\nShow help for a command."],
    [SKILL, "\n\nPrint the service workflow."],
    [
      CALL,
      ` <tool> [options]\n\nCall a baked-in MCP tool by its exact name.\nUse ${service} ${METHODS} to discover names.`,
    ],
    [
      RESOURCES,
      ` <command> [--json]\n\nList and read MCP resources; these commands connect to the server.\n\nCommands:\n  list        List resources\n  templates   List resource URI templates\n  read <uri>  Print the contents of one resource\n\nExamples:\n  ${service} ${RESOURCES} list\n  ${service} ${RESOURCES} read <uri> --json`,
    ],
    [
      PROMPTS,
      ` <command> [--json]\n\nList and render MCP prompts; these commands connect to the server.\n\nCommands:\n  list                              List prompts and their arguments\n  get <name> [--<argument> value]   Render a prompt with string arguments\n\nPass arguments as flags or one JSON object with --input.\nUnknown and missing required arguments are usage errors.\n\nExamples:\n  ${service} ${PROMPTS} list\n  ${service} ${PROMPTS} get <name> --<argument> value`,
    ],
  ]);
const DISCOVERY: Array<[string, string]> = [
  [METHODS, "List tool names and command paths"],
  [CALL, "Call a tool by its exact MCP name"],
  [SKILL, "Print the service workflow"],
  [HELP, "Show help for a command"],
  [RESOURCES, "List and read MCP resources (connects)"],
  [PROMPTS, "List and render MCP prompts (connects)"],
];
// Keeps the first sentence so long tool descriptions fit on one listing line.
const brief = (text: string): string => {
  const sentence = text.split(/(?<=[.!?])\s|\n/)[0] ?? text;
  return sentence.length > 80 ? `${sentence.slice(0, 79)}…` : sentence;
};
const table = (rows: Array<[string, string]>): string[] => {
  const width = Math.max(0, ...rows.map(([left]) => left.length));
  return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`.trimEnd());
};
const within = (command: CommandSpec, path: string[]): boolean =>
  path.every((part, index) => command.path[index] === part);
const childSummary = (manifest: Manifest, path: string[]): string => {
  const key = path.join(" ");
  const command = manifest.commands.find((command) => command.path.join(" ") === key);
  if (command) return brief(command.summary ?? command.name);
  const count = manifest.commands.filter((command) => within(command, path)).length;
  return manifest.groups[key] ?? `${count} command${count === 1 ? "" : "s"}`;
};

const argumentLine = (key: string, schema: Record<string, unknown>, required: boolean): string => {
  const reserved = isReservedField(key);
  const name = reserved ? key : `--${flagForm(key)}`;
  const notes = [required ? "required" : "optional", ...(reserved ? ["set via --input only"] : [])];
  const description = schema.description ? ` - ${String(schema.description)}` : "";
  return `  ${name}  ${typeLabel(schema)} (${notes.join(", ")})${description}`;
};

export const findCommand = (manifest: Manifest, path: string[]): CommandSpec | undefined => {
  const key = path.join(" ");
  return (
    manifest.commands.find((command) => fallbackPath(command.name).join(" ") === key) ??
    manifest.commands.find((command) => command.path.join(" ") === key)
  );
};
export const help = (manifest: Manifest, path: string[]): string => {
  const command = findCommand(manifest, path);
  const title = [manifest.service, ...path].join(" ");
  // Resource and prompt subcommands share their group usage.
  const group = path[0] === RESOURCES || path[0] === PROMPTS || path.length === 1;
  const usage = group && !command ? reservedUsage(manifest.service).get(path[0]) : undefined;
  if (usage !== undefined) {
    const text = `Usage: ${[manifest.service, path[0]].join(" ")}${usage}`;
    if (path[0] !== CALL) return text;
    const tools = manifest.commands.map((command): [string, string] => [
      command.name,
      brief(command.summary ?? command.name),
    ]);
    return [text, "", "Tools:", ...table(tools)].join("\n");
  }
  const scoped = manifest.commands.filter((command) => within(command, path));
  if (path.length && !command && !scoped.length && !RESERVED_COMMANDS.includes(path.join(" "))) {
    throw new UsageError(`Unknown command: ${path.join(" ")}`);
  }
  const lines = [
    `Usage: ${title}${command ? " [options]" : " <command>"}`,
    "",
    command?.summary ?? manifest.groups[path.join(" ")] ?? manifest.summary,
  ];
  if (command) {
    // A summary taken from the description's first line is not repeated.
    const description = command.description ?? "";
    const summary = command.summary ?? "";
    const rest = description.startsWith(summary)
      ? description.slice(summary.length).trim()
      : description;
    if (rest) lines.push("", rest);
    if (command.details) lines.push("", command.details);
    if (command.rules?.length)
      lines.push("", "Safety Rules:", ...command.rules.map((rule) => `  - ${rule}`));
    const props = command.inputSchema.properties;
    const required = command.inputSchema.required;
    if (isRecord(props) && Object.keys(props).length) {
      lines.push("", "Arguments:");
      for (const [key, schema] of Object.entries(props)) {
        if (!isRecord(schema)) continue;
        lines.push(argumentLine(key, schema, Array.isArray(required) && required.includes(key)));
      }
    }
    lines.push(
      "",
      "Options:",
      "  --input <json|->       JSON object or piped stdin",
      "  --input-file <path>    Read JSON object from file",
      "  --<obj>.<field> value  Nested input flag",
      "  --json                Preserve the MCP result as JSON",
      "  -h, --help            Show command help",
    );
    if (guardsRepeats(command))
      lines.push("  --allow-repeat        Run even if the same input ran in the last few minutes");
    if (command.examples?.length)
      lines.push("", "Examples:", ...command.examples.map((example) => `  ${example}`));
  } else {
    const children = [
      ...new Set(
        scoped
          .map((command) => command.path[path.length])
          .filter((part): part is string => Boolean(part))
          .filter((part) => path.length || !RESERVED_COMMANDS.includes(part)),
      ),
    ].sort();
    if (!path.length && manifest.quickstart.length) {
      const entries = manifest.quickstart.map(({ command, summary }): [string, string] => [
        `${manifest.service} ${command}`,
        summary,
      ]);
      lines.push("", "Start here:", ...table(entries));
    }
    if (children.length) {
      const rows = children.map((child): [string, string] => [
        child,
        childSummary(manifest, [...path, child]),
      ]);
      lines.push("", "Commands:", ...table(rows));
    }
    if (!path.length) lines.push("", "Discovery:", ...table(DISCOVERY));
    lines.push("", `Next: ${title} <command> --help`);
  }
  return lines.join("\n");
};
