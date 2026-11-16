import { COMMANDS, type CommandNode, type Manifest } from "@mcp-cli/core";
import { childSummary, displayCommands, help, within } from "./help";
import { compactDescription } from "./descriptions";

// Mirrors `--help` listings, and keeps uncustomized tools under a trailing `call` group.
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
          .filter((part): part is string => Boolean(part)),
      ),
    ].sort((left, right) =>
      !path.length && (left === COMMANDS.call || right === COMMANDS.call)
        ? Number(left === COMMANDS.call) - Number(right === COMMANDS.call)
        : left.localeCompare(right),
    );
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
