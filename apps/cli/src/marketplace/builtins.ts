import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Catalog, decode, type Source } from "./schema";
import { safePath } from "./archive";
import { standalone } from "./commands";
import { readOptional, digest } from "./storage";

export const installedCatalogDirectory = (
  executable: string,
  platform = process.platform,
): string =>
  platform === "darwin" && basename(dirname(executable)) === "MacOS"
    ? join(dirname(executable), "../Resources", `${basename(executable)}.plugins`)
    : `${executable}.plugins`;

export const builtinDirectory = (): string =>
  standalone()
    ? installedCatalogDirectory(process.execPath)
    : fileURLToPath(new URL("../../dist/mcp-cli.plugins", import.meta.url));

export const builtins = async (): Promise<Source | undefined> => {
  const directory = builtinDirectory();
  const text = await readOptional(join(directory, "marketplace.json"));
  if (text === undefined) return undefined;
  const catalog = decode(Catalog, JSON.parse(text), "bundled catalog");
  return {
    id: "builtin",
    url: "builtin",
    commit: digest(text),
    catalog: decode(
      Catalog,
      {
        ...catalog,
        plugins: catalog.plugins.map((plugin) => ({
          ...plugin,
          artifacts: plugin.artifacts.map((artifact) => ({
            ...artifact,
            url: pathToFileURL(join(directory, safePath(artifact.url))).href,
          })),
        })),
      },
      "bundled catalog",
    ),
  };
};
