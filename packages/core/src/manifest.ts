import { credentialSwitches } from "./auth";
import { isRecord, isStringArray } from "./values";
import {
  COMMANDS,
  NotGeneratedError,
  RESERVED_COMMANDS,
  fallbackPath,
  type CommandSpec,
  type Manifest,
  type ServicePlugin,
  type ToolAnnotations,
  type ToolDefinition,
} from "./index";

/** Server-derived tool definitions that codegen writes to a plugin's generated module. */
export type GeneratedManifest = {
  version: 2;
  service: string;
  tools: ToolDefinition[];
};

const invalid = (reason: string): Error => new Error(`Invalid manifest: ${reason}`);

const HINTS = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const;

// Keeps the known MCP hints and drops unknown or mistyped fields instead of failing.
export const decodeAnnotations = (value: unknown): ToolAnnotations | undefined => {
  if (!isRecord(value)) return undefined;
  const annotations: ToolAnnotations = {};
  if (typeof value.title === "string") annotations.title = value.title;
  for (const hint of HINTS) {
    const flag = value[hint];
    if (typeof flag === "boolean") annotations[hint] = flag;
  }
  return Object.keys(annotations).length ? annotations : undefined;
};

const decodeTool = (value: unknown, index: number): ToolDefinition => {
  const label = `tools[${index}]`;
  if (!isRecord(value)) throw invalid(`${label} must be an object`);
  const { name, description, inputSchema, outputSchema } = value;
  const annotations = decodeAnnotations(value.annotations);
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
    ...(annotations && { annotations }),
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

const COMPOSITION = ["allOf", "anyOf", "oneOf", "not", "$ref", "if"];
// Upload fields keep URL rules directly on the field so they can be deferred until after upload.
const direct = (schema: Record<string, unknown>): boolean =>
  COMPOSITION.every((keyword) => !Object.hasOwn(schema, keyword));

// Rejects reserved roots and prefixes shared with paths already claimed by other tools.
const claimPath = (path: string[], fallback: string[], claimed: string[][]): void => {
  if (RESERVED_COMMANDS.includes(path[0] ?? "") && path.join(" ") !== fallback.join(" "))
    throw new Error(`Reserved command path: ${path.join(" ")}`);
  if (claimed.some((other) => overlaps(other, path)))
    throw new Error(`Conflicting command path: ${path.join(" ")}`);
  claimed.push(path);
};

const uploadable = (tool: ToolDefinition, field: string): boolean => {
  const properties = tool.inputSchema.properties;
  const schema =
    isRecord(properties) && Object.hasOwn(properties, field) ? properties[field] : undefined;
  if (!isRecord(schema)) return false;
  if (schema.type === "string") return direct(schema);
  return (
    schema.type === "array" &&
    direct(schema) &&
    isRecord(schema.items) &&
    schema.items.type === "string" &&
    direct(schema.items)
  );
};

const containsGroup = (paths: string[][], group: string): boolean => {
  const prefix = group.split(" ");
  return paths.some((path) => path.length > prefix.length && overlaps(path, prefix));
};
const reaches = (paths: string[][], head: string[]): boolean =>
  head.length > 0 && paths.some((path) => path.length >= head.length && overlaps(path, head));
// A quickstart command's path is every word before its first flag.
const commandHead = (command: string): string[] => {
  const words = command.split(" ").filter(Boolean);
  const end = words.findIndex((word) => word.startsWith("-"));
  return end < 0 ? words : words.slice(0, end);
};

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
    claimPath(path, fallback, paths);
    for (const field of customization?.uploads ?? []) {
      if (!plugin.uploadFile) throw new Error(`${tool.name} declares uploads without uploadFile`);
      if (!uploadable(tool, field)) throw new Error(`Invalid upload field ${tool.name}.${field}`);
    }
    return {
      ...tool,
      ...customization,
      path,
      summary: customization?.summary ?? tool.description?.split(/\n/)[0] ?? tool.name,
    };
  });
  // Optional mappings may be absent when the server filters tools, e.g. by token scope.
  const absent: string[][] = [];
  const absentNames = new Set<string>();
  for (const [name, customization] of Object.entries(plugin.commands ?? {})) {
    if (names.has(name)) continue;
    if (!customization.optional && !plugin.discovery)
      throw new Error(`Plugin refers to missing tool: ${name}`);
    if (!validPath(customization.path)) throw new Error(`Invalid command path for ${name}`);
    claimPath(customization.path, fallbackPath(name), [...paths, ...absent]);
    absent.push(customization.path);
    absentNames.add(name);
  }
  for (const command of plugin.apiCommands ?? []) {
    if (names.has(command.name)) throw invalid(`Duplicate tool: ${command.name}`);
    claimPath(command.path, fallbackPath(command.name), [...paths, ...absent]);
    names.add(command.name);
    paths.push(command.path);
    commands.push(command);
  }
  const extensions = plugin.extensions?.commands ?? [];
  for (const extension of extensions) {
    if (!validPath(extension.path)) throw new Error("Invalid extension command path");
    claimPath(extension.path, [], [...paths, ...absent]);
    paths.push(extension.path);
    if (extension.kind === "alias" && (!extension.tool || !names.has(extension.tool)))
      throw new Error(`Alias refers to missing tool: ${extension.tool}`);
  }
  const declared = [...paths, ...absent];
  const groups: Record<string, string> = {};
  for (const [group, summary] of Object.entries(plugin.groups ?? {})) {
    if (!containsGroup(declared, group))
      throw new Error(`Plugin describes missing command group: ${group}`);
    if (containsGroup(paths, group)) groups[group] = summary;
  }
  const quickstart = (plugin.quickstart ?? []).filter(({ command }) => {
    const head = commandHead(command);
    const [first = "", tool] = head;
    if (first === COMMANDS.call && tool !== undefined) {
      if (!names.has(tool) && !absentNames.has(tool))
        throw new Error(`Quickstart refers to missing command: ${command}`);
      return names.has(tool);
    }
    if (RESERVED_COMMANDS.includes(first)) return true;
    if (!reaches(declared, head))
      throw new Error(`Quickstart refers to missing command: ${command}`);
    return reaches(paths, head);
  });
  return {
    service: plugin.name,
    summary: plugin.summary,
    commands,
    groups,
    quickstart,
    credentials: credentialSwitches(plugin.auth),
    ...(extensions.length ? { extensions } : {}),
  };
};
