import { UsageError } from "@mcp-cli/core";
import type { DiscoveredPlugin, Registry } from "./discovery";
import { existingFiles } from "./plugins";

export const pluginsUsage = "Usage: mcp-cli plugins";

const table = (rows: string[][]): string => {
  const widths = rows[0]?.map((_, column) =>
    Math.max(...rows.map((row) => row[column]?.length ?? 0)),
  );
  return rows
    .map((row) =>
      row
        .map((cell, column) => cell.padEnd(widths?.[column] ?? 0))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
};

// Lists each discovered service with its source, generated-code location and package path.
export const listPlugins = async (registry: Registry, args: string[]): Promise<string> => {
  if (args.length === 1 && ["--help", "-h"].includes(args[0] ?? "")) return pluginsUsage;
  if (args.length) throw new UsageError(`${pluginsUsage}\nUnexpected argument: ${args[0]}`);
  if (!registry.plugins.length && !registry.shadowed.length) return "No plugins found";
  const row = async (plugin: DiscoveredPlugin, source: string): Promise<string[]> => {
    const files = await existingFiles(registry, plugin);
    const generated = files
      ? `generated (${files.location})`
      : plugin.bundled
        ? "generated (bundled)"
        : "not generated";
    return [plugin.service, source, generated, plugin.packageName, plugin.dir];
  };
  const rows = await Promise.all([
    ...registry.plugins.map((plugin) => row(plugin, plugin.source)),
    // A managed install owns these services, so commands never load these packages.
    ...registry.shadowed.map((plugin) => row(plugin, `${plugin.source} (shadowed)`)),
  ]);
  return table([["SERVICE", "SOURCE", "GENERATED", "PACKAGE", "PATH"], ...rows]);
};
