import { isRecord, isStringArray } from "./values";
import {
  NotGeneratedError,
  RESERVED_COMMANDS,
  fallbackPath,
  type CommandSpec,
  type Manifest,
  type ServicePlugin,
  type ToolDefinition,
} from "./index";

/** Server-derived tool definitions that codegen writes to a plugin's generated module. */
export type GeneratedManifest = {
  version: 2;
  service: string;
  tools: ToolDefinition[];
};

const invalid = (reason: string): Error => new Error(`Invalid manifest: ${reason}`);

const decodeTool = (value: unknown, index: number): ToolDefinition => {
  const label = `tools[${index}]`;
  if (!isRecord(value)) throw invalid(`${label} must be an object`);
  const { name, description, inputSchema, outputSchema } = value;
  if (typeof name !== "string" || !name) throw invalid(`${label}.name is required`);
  if (description !== undefined && typeof description !== "string")
    throw invalid(`${label}.description must be a string`);
  if (!isRecord(inputSchema)) throw invalid(`${label}.inputSchema must be an object`);
  if (outputSchema !== undefined && !isRecord(outputSchema))
    throw invalid(`${label}.outputSchema must be an object`);
  return {
    name,
    inputSchema,
    ...(description !== undefined && { description }),
    ...(outputSchema !== undefined && { outputSchema }),
  };
};

export const decodeManifest = (value: unknown): GeneratedManifest => {
  if (!isRecord(value)) throw invalid("expected an object");
  const { version, service, tools } = value;
  if (version === 1) {
    const name = typeof service === "string" && service ? service : "<service>";
    throw new NotGeneratedError(
      `Generated code for ${name} is outdated; run mcp-cli generate ${name}`,
    );
  }
  if (version !== 2) throw invalid("unsupported version");
  if (typeof service !== "string" || !service) throw invalid("service is required");
  if (!Array.isArray(tools)) throw invalid("tools must be an array");
  return { version, service, tools: tools.map(decodeTool) };
};

// Applies to customized paths only; fallback paths carry the raw MCP tool name.
const validPath = (path: unknown): path is string[] =>
  isStringArray(path) && path.length > 0 && path.every((part) => /^[a-zA-Z0-9_-]+$/.test(part));

const overlaps = (left: string[], right: string[]): boolean =>
  left.slice(0, Math.min(left.length, right.length)).every((part, i) => part === right[i]);

// Overlays plugin command metadata on generated tools and rejects stale or conflicting mappings.
export const applyCustomizations = (
  plugin: ServicePlugin,
  generated: GeneratedManifest,
): Manifest => {
  if (generated.service !== plugin.name)
    throw new Error(`Generated manifest ${generated.service} does not match plugin ${plugin.name}`);
  const names = new Set<string>();
  const paths: string[][] = [];
  const commands = generated.tools.map((tool): CommandSpec => {
    if (names.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`);
    names.add(tool.name);
    const customization =
      plugin.commands && Object.hasOwn(plugin.commands, tool.name)
        ? plugin.commands[tool.name]
        : undefined;
    const fallback = fallbackPath(tool.name);
    const path = customization?.path ?? fallback;
    if (customization !== undefined && !validPath(customization.path))
      throw new Error(`Invalid command path for ${tool.name}`);
    if (RESERVED_COMMANDS.includes(path[0] ?? "") && path.join(" ") !== fallback.join(" "))
      throw new Error(`Reserved command path: ${path.join(" ")}`);
    if (paths.some((other) => overlaps(other, path)))
      throw new Error(`Conflicting command path: ${path.join(" ")}`);
    paths.push(path);
    return {
      ...tool,
      ...customization,
      path,
      summary: customization?.summary ?? tool.description?.split(/\n/)[0] ?? tool.name,
    };
  });
  for (const name of Object.keys(plugin.commands ?? {}))
    if (!names.has(name)) throw new Error(`Plugin refers to missing tool: ${name}`);
  return { service: plugin.name, summary: plugin.summary, commands };
};
