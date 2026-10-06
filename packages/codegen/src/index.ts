import { compile } from "json-schema-to-typescript";
import type { Manifest, ServicePlugin, ToolDefinition } from "@mcp-cli/core";

import { canonicalize, isCompilerSchema, isRecord, validateSchema } from "./schema";

export const decodeTools = (value: unknown): ToolDefinition[] => {
  if (!Array.isArray(value)) throw new Error("Tools must be an array");
  return value.map((tool: unknown) => {
    if (
      !isRecord(tool) ||
      typeof tool.name !== "string" ||
      !tool.name.trim() ||
      !isRecord(tool.inputSchema) ||
      tool.inputSchema.type !== "object"
    ) {
      throw new Error("Tools require a name and an object input schema");
    }
    if (tool.description !== undefined && typeof tool.description !== "string")
      throw new Error("Invalid tool description");
    validateSchema(tool.inputSchema);
    if (tool.outputSchema !== undefined) {
      if (!isRecord(tool.outputSchema) || tool.outputSchema.type !== "object")
        throw new Error("Invalid tool output schema");
      validateSchema(tool.outputSchema);
    }
    return {
      name: tool.name,
      inputSchema: tool.inputSchema,
      ...(typeof tool.description === "string" && { description: tool.description }),
      ...(isRecord(tool.outputSchema) && { outputSchema: tool.outputSchema }),
    };
  });
};

const reserved = new Set(["help", "methods", "call", "skill"]);
export const createManifest = (plugin: ServicePlugin, tools: unknown): Manifest => {
  const names = new Set<string>();
  const paths: string[][] = [];
  const commands = decodeTools(tools)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((tool) => {
      if (names.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`);
      names.add(tool.name);
      const customization =
        plugin.commands && Object.hasOwn(plugin.commands, tool.name)
          ? plugin.commands[tool.name]
          : undefined;
      const path = customization?.path ?? ["call", tool.name];
      if (!path.length || path.some((part) => !/^[a-zA-Z0-9_-]+$/.test(part))) {
        throw new Error(`Invalid command path for ${tool.name}`);
      }
      if (
        reserved.has(path[0] ?? "") &&
        !(path.length === 2 && path[0] === "call" && path[1] === tool.name)
      ) {
        throw new Error(`Reserved command path: ${path.join(" ")}`);
      }
      if (
        paths.some((other) =>
          other.slice(0, Math.min(other.length, path.length)).every((part, i) => part === path[i]),
        )
      ) {
        throw new Error(`Conflicting command path: ${path.join(" ")}`);
      }
      paths.push(path);
      return {
        ...tool,
        ...customization,
        path,
        summary: customization?.summary ?? tool.description?.split(/\n/)[0] ?? tool.name,
      };
    });
  for (const name of Object.keys(plugin.commands ?? {})) {
    if (!names.has(name)) throw new Error(`Plugin refers to missing tool: ${name}`);
  }
  return { version: 1, service: plugin.name, summary: plugin.summary, commands };
};

export const generateModule = async (manifest: Manifest): Promise<string> => {
  const types: string[] = [];
  const methods: string[] = [];
  for (const [index, command] of manifest.commands.entries()) {
    const name = `Tool${index}Input`;
    const schema = canonicalize(command.inputSchema);
    if (!isCompilerSchema(schema)) throw new Error("Invalid compiler schema");
    types.push(await compile(schema, name, { bannerComment: "", format: false }));
    methods.push(
      `    [${JSON.stringify(command.name)}]: (input: ${name}) => call(${JSON.stringify(command.name)}, { ...input }),`,
    );
  }
  return [
    'import type { Manifest, ToolCaller } from "@mcp-cli/core";',
    `export const manifest = ${JSON.stringify(canonicalize(manifest), null, 2)} satisfies Manifest;`,
    ...types,
    "export function createClient(call: ToolCaller) {",
    "  return {",
    ...methods,
    "  };",
    "}",
    "",
  ].join("\n");
};
