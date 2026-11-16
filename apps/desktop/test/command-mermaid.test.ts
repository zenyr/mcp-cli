import { expect, test } from "bun:test";
import { render } from "pele";
import type { CommandCatalog, CommandNode } from "@mcp-cli/core";
import { commandMermaid } from "../src/command-mermaid";

const node = (path: string[], kind: CommandNode["kind"], children: CommandNode[] = []) => ({
  path,
  kind,
  summary: path.join(" "),
  help: "",
  children,
});
const catalog: CommandCatalog = {
  service: "demo",
  origin: "static",
  discovery: false,
  root: node([], "service", [
    node(["chat"], "group", [
      node(["chat", "post"], "command"),
      node(["chat", 'say "hi"'], "command"),
    ]),
    node(["flow"], "workflow"),
  ]),
};

test("command diagram renders every node with pele and maps ids back to paths", () => {
  const diagram = commandMermaid(catalog);
  const result = render(diagram.source);
  for (const id of diagram.paths.keys()) expect(result.svg).toContain(`data-id="${id}"`);
  expect([...diagram.paths.values()]).toContainEqual(["chat", "post"]);
  expect(result.svg).toContain("say &quot;hi&quot;");
});

test("group view keeps groups and counts their commands", () => {
  const diagram = commandMermaid(catalog, true);
  expect([...diagram.paths.values()]).toEqual([[], ["chat"]]);
  expect(diagram.source).toContain("chat · 2");
  expect(render(diagram.source).svg).toContain("chat · 2");
});
