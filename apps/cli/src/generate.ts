import { mkdir, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { buildArtifacts, decodeSnapshot, isCurrent } from "@mcp-cli/codegen";
import { UsageError } from "@mcp-cli/core";
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
const readExisting = async (path: string): Promise<string | undefined> => {
  const file = Bun.file(path);
  return (await file.exists()) ? await file.text() : undefined;
};

export const generate = async (args: string[]): Promise<void> => {
  const config = options(args);
  const plugin = await loadPlugin(config.name);
  const tools = config.snapshot
    ? decodeSnapshot(await Bun.file(config.snapshot).json())
    : await (async () => {
        const session = await connect(await plugin.connection(process.env));
        try {
          return await session.listTools();
        } finally {
          await session.close();
        }
      })();
  const built = await buildArtifacts(plugin, tools);
  const output = generatedFiles(config.name);
  if (config.check) {
    const existing = {
      snapshot: await readExisting(output.snapshot),
      module: await readExisting(output.module),
    };
    if (!isCurrent(existing, built)) throw new Error(`Generated files are stale: ${config.name}`);
    console.log(`Generated files are current: ${config.name}`);
    return;
  }
  await mkdir(dirname(output.module), { recursive: true });
  const files = [
    [output.snapshot, built.snapshot],
    [output.module, built.module],
  ] as const;
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
