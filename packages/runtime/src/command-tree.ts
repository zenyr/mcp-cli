import { RESERVED_COMMANDS, type CommandNode, type Manifest } from "@mcp-cli/core";
import { childSummary, displayCommands, help, within } from "./help";
import { compactDescription } from "./descriptions";

// Mirrors the root and group listings of `--help`, so every node reaches the same commands.
export const commandTree = (manifest: Manifest): CommandNode => {
  const commands = displayCommands(manifest);
  const node = (path: string[]): CommandNode => {
    const key = path.join(" ");
    const command = commands.find((item) => item.path.join(" ") === key);
    const extension = manifest.extensions?.find((item) => item.path.join(" ") === key);
    const children = [
      ...new Set(
        commands
          .filter((item) => item.path.length > path.length && within(item, path))
          .map((item) => item.path[path.length])
          .filter((part): part is string => Boolean(part))
          .filter((part) => path.length || !RESERVED_COMMANDS.includes(part)),
      ),
    ].sort();
    return {
      path,
      kind: !path.length
        ? "service"
        : extension?.kind === "workflow"
          ? "workflow"
          : command
            ? "command"
            : "group",
      summary: path.length ? childSummary(manifest, path) : compactDescription(manifest.summary),
      ...(command && { tool: extension ? extension.tool : command.name }),
      help: help(manifest, path),
      children: children.map((child) => node([...path, child])),
    };
  };
  return node([]);
};
