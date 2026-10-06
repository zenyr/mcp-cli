import {
  RESERVED_COMMANDS,
  fallbackPath,
  isRecord,
  type CommandSpec,
  type Manifest,
} from "@mcp-cli/core";

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
    throw new Error(`Unknown command: ${path.join(" ")}`);
  }
  const title = [manifest.service, ...path].join(" ");
  if (path.join(" ") === "methods")
    return `Usage: ${title} [group] [--json]\n\nList baked-in tool names and command paths.`;
  if (path.join(" ") === "help") return `Usage: ${title} [command]\n\nShow help for a command.`;
  if (path.join(" ") === "skill") return `Usage: ${title}\n\nPrint the service workflow.`;
  if (path.join(" ") === "call")
    return `Usage: ${title} <tool> [options]\n\nCall a baked-in MCP tool by its exact name.\nUse ${manifest.service} methods to discover names.`;
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
        const type = Array.isArray(schema.enum) ? schema.enum.join("|") : (schema.type ?? "JSON");
        lines.push(
          `  --${key.replaceAll("_", "-")}  ${type} (${Array.isArray(required) && required.includes(key) ? "required" : "optional"})${schema.description ? ` - ${schema.description}` : ""}`,
        );
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
