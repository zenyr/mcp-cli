import type { CommandCatalog, CommandNode } from "@mcp-cli/core";

export type CommandDiagramSource = { source: string; paths: Map<string, string[]> };

const PREFIX: Record<CommandNode["kind"], string> = {
  service: "s",
  group: "g",
  command: "c",
  workflow: "w",
};
const leaves = (node: CommandNode): number =>
  node.children.length ? node.children.reduce((total, child) => total + leaves(child), 0) : 1;
const quote = (text: string) => `"${text.replaceAll('"', "#quot;")}"`;
const shape = (node: CommandNode, text: string): string => {
  const label = quote(text);
  if (node.kind === "service") return `([${label}])`;
  if (node.kind === "group") return `(${label})`;
  if (node.kind === "workflow") return `{{${label}}}`;
  return `[${label}]`;
};

// Node ids carry a kind prefix so CSS can color groups, commands and workflows apart.
export const commandMermaid = (
  catalog: CommandCatalog,
  groupsOnly = false,
): CommandDiagramSource => {
  const lines = ["flowchart LR"];
  const paths = new Map<string, string[]>();
  const visit = (node: CommandNode, parent?: string): void => {
    const id = `${PREFIX[node.kind]}${paths.size}`;
    paths.set(id, node.path);
    const name = node.path.at(-1) ?? catalog.service;
    const text = groupsOnly && node.kind === "group" ? `${name} · ${leaves(node)}` : name;
    lines.push(`  ${id}${shape(node, text)}`);
    if (parent) lines.push(`  ${parent} --> ${id}`);
    for (const child of node.children) if (!groupsOnly || child.children.length) visit(child, id);
  };
  visit(catalog.root);
  return { source: lines.join("\n"), paths };
};
