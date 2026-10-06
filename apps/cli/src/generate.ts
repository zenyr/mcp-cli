import { mkdir, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createManifest, decodeTools, generateModule } from "@mcp-cli/codegen";
import { connect } from "@mcp-cli/mcp";
import { generatedPath, loadPlugin } from "./plugins";

type GenerateOptions = { name: string; snapshot?: string; check: boolean };
const options = (args: string[]): GenerateOptions => {
  const [name, ...rest] = args;
  if (!name || name.startsWith("-"))
    throw new Error("Usage: mcp-cli generate <service> [--snapshot <path>] [--check]");
  let snapshot: string | undefined;
  let check = false;
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--check" && !check) check = true;
    else if (flag === "--snapshot" && snapshot === undefined) {
      const path = rest[++i];
      if (!path || path.startsWith("--")) throw new Error("Missing snapshot path");
      snapshot = path;
    } else throw new Error(`Unknown or repeated generation option: ${flag}`);
  }
  return { name, snapshot, check };
};
const snapshotTools = (snapshot: unknown): unknown => {
  if (snapshot === null || typeof snapshot !== "object" || !("tools" in snapshot)) {
    throw new Error("Snapshot must contain a tools array");
  }
  return snapshot.tools;
};
export const generate = async (args: string[]): Promise<void> => {
  const config = options(args);
  const plugin = await loadPlugin(config.name);
  const tools = config.snapshot
    ? decodeTools(snapshotTools(await Bun.file(config.snapshot).json()))
    : await (async () => {
        const session = await connect(plugin.connection(process.env));
        try {
          return await session.listTools();
        } finally {
          await session.close();
        }
      })();
  const manifest = createManifest(plugin, tools);
  const output = generatedPath(config.name);
  const code = await generateModule(manifest);
  const snapshotPath = output.replace(/generated\.ts$/, "tools.json");
  const snapshotText = JSON.stringify({ tools }, null, 2) + "\n";
  const files = [
    [snapshotPath, snapshotText],
    [output, code],
  ] as const;
  if (config.check) {
    for (const [path, text] of files) {
      if (!(await Bun.file(path).exists()))
        throw new Error(`Generated files are stale: ${config.name}`);
      const actual = await Bun.file(path).text();
      const matches =
        path === snapshotPath
          ? isDeepStrictEqual(JSON.parse(actual), JSON.parse(text))
          : actual === text;
      if (!matches) throw new Error(`Generated files are stale: ${config.name}`);
    }
    console.log(`Generated files are current: ${config.name}`);
    return;
  }
  await mkdir(dirname(output), { recursive: true });
  for (const [path, text] of files) {
    const temporary = `${path}.${process.pid}.tmp`;
    try {
      await Bun.write(temporary, text);
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
  console.log(`Generated ${output}`);
};
