import { createHash } from "node:crypto";
import { basename } from "node:path";
import {
  UsageError,
  isRecord,
  type CommandSpec,
  type JsonSchema,
  type LocalFile,
} from "@mcp-cli/core";

const PREFIX = "@";
export type LocalFiles = Map<string, LocalFile & { digest: string }>;

const references = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).filter(
    (item): item is string => typeof item === "string" && item.startsWith(PREFIX),
  );

const mapField = (value: unknown, replace: (reference: string) => string): unknown =>
  Array.isArray(value)
    ? value.map((item) => mapField(item, replace))
    : typeof value === "string" && value.startsWith(PREFIX)
      ? replace(value)
      : value;

const mapUploads = (
  command: CommandSpec,
  input: Record<string, unknown>,
  replace: (reference: string) => string,
): Record<string, unknown> => {
  const output = { ...input };
  for (const field of command.uploads ?? [])
    if (Object.hasOwn(output, field)) output[field] = mapField(output[field], replace);
  return output;
};

// Reads every `@path` in the command's upload fields before anything touches the network.
export const readLocalFiles = async (
  command: CommandSpec,
  input: Record<string, unknown>,
  readBytes: (path: string) => Promise<Uint8Array>,
): Promise<LocalFiles> => {
  const files: LocalFiles = new Map();
  for (const field of command.uploads ?? [])
    for (const reference of references(input[field])) {
      const path = reference.slice(PREFIX.length);
      if (!path) throw new UsageError(`Missing file path after @ in --${field}`);
      if (files.has(reference)) continue;
      const bytes = await readBytes(path).catch(() => {
        throw new UsageError(`Cannot read file for --${field}: ${path}`);
      });
      const digest = createHash("sha256").update(bytes).digest("hex");
      files.set(reference, { path, name: basename(path), bytes, digest });
    }
  return files;
};

// Repeat keys follow file contents, because every upload produces a new URL.
export const withDigests = (
  command: CommandSpec,
  input: Record<string, unknown>,
  files: LocalFiles,
): Record<string, unknown> =>
  mapUploads(command, input, (reference) => `@sha256:${files.get(reference)?.digest ?? ""}`);

export const uploadLocalFiles = async (
  command: CommandSpec,
  input: Record<string, unknown>,
  files: LocalFiles,
  upload: (file: LocalFile) => Promise<string>,
): Promise<Record<string, unknown>> => {
  const urls = new Map<string, string>();
  for (const [reference, file] of files) urls.set(reference, await upload(file));
  return mapUploads(command, input, (reference) => urls.get(reference) ?? reference);
};

const withoutUrlRules = (schema: unknown): unknown => {
  if (!isRecord(schema)) return schema;
  const { format: _format, pattern: _pattern, ...rest } = schema;
  return isRecord(rest.items) ? { ...rest, items: withoutUrlRules(rest.items) } : rest;
};

// `@path` cannot satisfy URL format or pattern rules until upload, so pre-checks skip only those.
export const preUploadSchema = (command: CommandSpec): JsonSchema => {
  const properties = command.inputSchema.properties;
  if (!command.uploads?.length || !isRecord(properties)) return command.inputSchema;
  const relaxed = { ...properties };
  for (const field of command.uploads) relaxed[field] = withoutUrlRules(relaxed[field]);
  return { ...command.inputSchema, properties: relaxed };
};
