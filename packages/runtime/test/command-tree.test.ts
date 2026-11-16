import { expect, test } from "bun:test";
import { applyCustomizations, type CommandNode, type ServicePlugin } from "@mcp-cli/core";
import { commandTree, help } from "../src";
import { commands, manifest } from "./fixtures/manifest";

const plugin: ServicePlugin = {
  name: "demo",
  summary: "Demo service",
  commands,
  connection: () => {
    throw new Error("Not connected");
  },
  extensions: {
    commands: [
      {
        path: ["flow", "run"],
        kind: "workflow",
        summary: "Run workflow",
        inputSchema: { type: "object" },
        run: async () => ({ result: { content: [] } }),
      },
    ],
  },
};
const flatten = (node: CommandNode): CommandNode[] => [node, ...node.children.flatMap(flatten)];

test("command tree reaches every command with the same text as --help", () => {
  const resolved = applyCustomizations(plugin, manifest);
  const nodes = flatten(commandTree(resolved));
  expect(nodes[0]).toMatchObject({ path: [], kind: "service", summary: "Demo service" });
  for (const node of nodes) expect(node.help).toBe(help(resolved, node.path));
  const leaves = nodes.filter((node) => !node.children.length).map((node) => node.path.join(" "));
  expect(leaves.sort()).toEqual(
    [...resolved.commands.map((command) => command.path.join(" ")), "flow run"].sort(),
  );
  expect(nodes.find((node) => node.path.join(" ") === "flow run")?.kind).toBe("workflow");
  expect(nodes.find((node) => node.path.join(" ") === "flow")?.kind).toBe("group");
});
