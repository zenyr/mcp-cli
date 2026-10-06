import {
  RESERVED_COMMANDS,
  UsageError,
  fallbackPath,
  isRecord,
  type CommandSpec,
  type Manifest,
} from "@mcp-cli/core";
import { CALL, HELP, METHODS, SKILL, flagForm, isReservedField } from "./reserved";
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
  ]);
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
  const scoped = manifest.commands.filter((command) =>
    path.every((part, index) => command.path[index] === part),
  );
  if (path.length && !command && !scoped.length && !RESERVED_COMMANDS.includes(path.join(" "))) {
    throw new UsageError(`Unknown command: ${path.join(" ")}`);
  }
  const title = [manifest.service, ...path].join(" ");
  const usage = path.length === 1 ? reservedUsage(manifest.service).get(path[0]) : undefined;
  if (usage !== undefined) return `Usage: ${title}${usage}`;
  const lines = [
    `Usage: ${title}${command ? " [options]" : " <command>"}`,
    "",
    command?.summary ?? manifest.summary,
  ];
  if (command) {
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
    if (command.examples?.length)
      lines.push("", "Examples:", ...command.examples.map((example) => `  ${example}`));
  } else {
    const children = [
      ...new Set(
        scoped
          .map((command) => command.path[path.length])
          .filter((part): part is string => Boolean(part)),
      ),
    ];
    if (!path.length) children.push(...RESERVED_COMMANDS);
    lines.push(
      "",
      "Commands:",
      ...[...new Set(children)].sort().map((child) => `  ${child}`),
      "",
      `Next: ${title} <command> --help`,
    );
  }
  return lines.join("\n");
};
