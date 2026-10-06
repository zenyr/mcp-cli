import { mkdir, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createManifest, decodeTools, generateModule } from "@mcp-cli/codegen";
import { UsageError, canonicalize, isRecord, type ToolDefinition } from "@mcp-cli/core";
import { connect } from "@mcp-cli/mcp";
import { generatedFiles, loadPlugin } from "./plugins";

const usage = "Usage: mcp-cli generate <service> [--snapshot <path>] [--check]";
type GenerateOptions = { name: string; snapshot?: string; check: boolean };
const options = (args: string[]): GenerateOptions => {
  const [name, ...rest] = args;
  if (!name || name.startsWith("-")) throw new UsageError(usage);
  let snapshot: string | undefined;
  let check = false;
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--check" && !check) check = true;
    else if (flag === "--snapshot" && snapshot === undefined) {
      const path = rest[++i];
      if (!path || path.startsWith("--")) throw new UsageError("Missing snapshot path");
      snapshot = path;
    } else throw new UsageError(`Unknown or repeated generation option: ${flag}`);
  }
  return { name, snapshot, check };
};
const snapshotTools = (snapshot: unknown): unknown => {
  if (!isRecord(snapshot) || !("tools" in snapshot))
    throw new Error("Snapshot must contain a tools array");
  return snapshot.tools;
};
const byName = (a: ToolDefinition, b: ToolDefinition): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
// Sorted, key-canonical text keeps the snapshot stable when the server reorders tools.
const snapshotText = (tools: ToolDefinition[]): string =>
  JSON.stringify(canonicalize({ tools: [...tools].sort(byName) }), null, 2) + "\n";

export const generate = async (args: string[]): Promise<void> => {
  const config = options(args);
  const plugin = await loadPlugin(config.name);
  const tools = config.snapshot
    ? decodeTools(snapshotTools(await Bun.file(config.snapshot).json()))
    : await (async () => {
        const session = await connect(await plugin.connection(process.env));
        try {
          return await session.listTools();
        } finally {
          await session.close();
        }
      })();
  if (!tools.length) throw new Error(`${config.name} returned no tools; nothing to generate`);
  const output = generatedFiles(config.name);
  const files = [
    [output.snapshot, snapshotText(tools)],
    [output.module, await generateModule(createManifest(plugin, tools))],
  ] as const;
  if (config.check) {
    for (const [path, text] of files) {
      const file = Bun.file(path);
      const actual = (await file.exists()) ? await file.text() : undefined;
      // The snapshot compares as data so formatter changes to tools.json do not count as drift.
      const current =
        actual !== undefined &&
        (path === output.snapshot
          ? isDeepStrictEqual(JSON.parse(actual), JSON.parse(text))
          : actual === text);
      if (!current) throw new Error(`Generated files are stale: ${config.name}`);
    }
    console.log(`Generated files are current: ${config.name}`);
    return;
  }
  await mkdir(dirname(output.module), { recursive: true });
  for (const [path, text] of files) {
    const temporary = `${path}.${process.pid}.tmp`;
    try {
      await Bun.write(temporary, text);
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
  console.log(`Generated ${output.module}`);
};
