import { access, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { canonicalize, decodeManifest, UsageError } from "@mcp-cli/core";
import {
  PackageManifest,
  decode,
  selectArtifact,
  type CatalogPlugin,
  type Artifact,
} from "./schema";
import { extract, makeExecutable, safePath, unpack } from "./archive";
import { download, httpsUrl } from "./download";
import { marketRoot, objectPath, type MarketContext } from "./storage";

const metadata = ({
  id,
  service,
  name,
  description,
  version,
  permissions,
}: CatalogPlugin | PackageManifest) => ({ id, service, name, description, version, permissions });
export const packageManifest = (files: Map<string, Uint8Array>): PackageManifest => {
  const json = files.get("plugin.json");
  const tools = files.get("manifest.json");
  if (!json || !tools) throw new UsageError("Package requires plugin.json and manifest.json.");
  const manifest = decode(
    PackageManifest,
    JSON.parse(new TextDecoder().decode(json)),
    "plugin.json",
  );
  const generated = decodeManifest(JSON.parse(new TextDecoder().decode(tools)));
  if (generated.service !== manifest.service)
    throw new UsageError("Manifest service does not match the plugin.");
  const implementation = manifest.implementation;
  if (implementation.type === "module" || implementation.server.type === "stdio") {
    if (!manifest.permissions.localCode)
      throw new UsageError("Executable plugins must declare localCode permission.");
    const entry = safePath(
      implementation.type === "module"
        ? implementation.entry
        : implementation.server.type === "stdio"
          ? implementation.server.entry
          : "",
    );
    if (!files.has(entry)) throw new UsageError(`Package entry does not exist: ${entry}`);
  } else {
    const url = httpsUrl(implementation.server.url);
    if (!manifest.permissions.network.includes(url.hostname))
      throw new UsageError("MCP host is missing from declared network destinations.");
  }
  return manifest;
};

const storeFiles = async (
  context: MarketContext,
  artifact: Artifact,
  files: Map<string, Uint8Array>,
) => {
  const destination = objectPath(context, artifact.sha256);
  if (
    await access(destination).then(
      () => true,
      () => false,
    )
  )
    return destination;
  await mkdir(join(marketRoot(context), "objects"), { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(join(marketRoot(context), "objects", ".install-"));
  try {
    await extract(files, temporary);
    await rename(temporary, destination);
    return destination;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
};

export const prepareRuntime = async (
  context: MarketContext,
  manifest: PackageManifest,
  signal: AbortSignal,
  allowFile: boolean,
): Promise<{ sha256: string; executable: string } | undefined> => {
  const impl = manifest.implementation;
  if (
    impl.type === "mcp" &&
    impl.server.type === "stdio" &&
    typeof impl.server.runtime === "object"
  ) {
    const requirements = impl.server.runtime;
    const downloadArtifact = selectArtifact(requirements.artifacts);
    const runtimeFiles = unpack(await download(downloadArtifact, signal, allowFile));
    const entry = safePath(requirements.executable);
    if (!runtimeFiles.has(entry)) throw new UsageError("Managed runtime executable is missing.");
    const runtimeDirectory = await storeFiles(context, downloadArtifact, runtimeFiles);
    await makeExecutable(runtimeDirectory, entry);
    return { sha256: downloadArtifact.sha256, executable: entry };
  }
  return undefined;
};

export const installPackage = async (
  context: MarketContext,
  plugin: CatalogPlugin,
  signal: AbortSignal,
  allowFile: boolean,
) => {
  const artifact = selectArtifact(plugin.artifacts);
  const bytes = await download(artifact, signal, allowFile);
  const files = unpack(bytes);
  const manifest = packageManifest(files);
  if (
    JSON.stringify(canonicalize(metadata(manifest))) !==
    JSON.stringify(canonicalize(metadata(plugin)))
  )
    throw new UsageError("Package identity or permissions differ from the catalog.");
  const runtime = await prepareRuntime(context, manifest, signal, allowFile);
  const impl = manifest.implementation;
  const directory = await storeFiles(context, artifact, files);
  if (impl.type === "mcp" && impl.server.type === "stdio" && impl.server.runtime === "native")
    await makeExecutable(directory, impl.server.entry);
  return { artifact, manifest, runtime };
};

export const readInstalledManifest = async (directory: string) =>
  decodeManifest(JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")));
