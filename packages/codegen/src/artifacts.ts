import { isDeepStrictEqual } from "node:util";
import { canonicalize, isRecord, type ServicePlugin, type ToolDefinition } from "@mcp-cli/core";
import { byName, createManifest, decodeTools, generateModule } from "./manifest";

export type Artifacts = { snapshot: string; module: string };
export type ExistingArtifacts = { snapshot?: string; module?: string };

export const decodeSnapshot = (snapshot: unknown): ToolDefinition[] => {
  if (!isRecord(snapshot) || !("tools" in snapshot))
    throw new Error("Snapshot must contain a tools array");
  return decodeTools(snapshot.tools);
};

// Sorted, key-canonical text keeps the snapshot stable when the server reorders tools.
const snapshotText = (tools: ToolDefinition[]): string =>
  JSON.stringify(canonicalize({ tools: [...tools].sort(byName) }), null, 2) + "\n";

export const buildArtifacts = async (
  plugin: ServicePlugin,
  tools: ToolDefinition[],
): Promise<Artifacts> => {
  if (!tools.length) throw new Error(`${plugin.name} returned no tools; nothing to generate`);
  return {
    snapshot: snapshotText(tools),
    module: await generateModule(createManifest(plugin, tools)),
  };
};

// The snapshot compares as data so formatter changes to tools.json do not count as drift.
export const isCurrent = (existing: ExistingArtifacts, built: Artifacts): boolean =>
  existing.snapshot !== undefined &&
  isDeepStrictEqual(JSON.parse(existing.snapshot), JSON.parse(built.snapshot)) &&
  existing.module === built.module;
