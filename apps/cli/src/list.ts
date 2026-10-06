import { UsageError } from "@mcp-cli/core";
import type { Registry } from "./discovery";
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
  if (!registry.plugins.length) return "No plugins found";
  const rows = await Promise.all(
    registry.plugins.map(async (plugin) => {
      const files = await existingFiles(registry, plugin);
      const generated = files ? `generated (${files.location})` : "not generated";
      return [plugin.service, plugin.source, generated, plugin.packageName, plugin.dir];
    }),
  );
  return table([["SERVICE", "SOURCE", "GENERATED", "PACKAGE", "PATH"], ...rows]);
};
