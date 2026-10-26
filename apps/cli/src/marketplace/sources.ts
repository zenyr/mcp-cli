import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import git from "isomorphic-git";
import type { HttpClient } from "isomorphic-git";
import { UsageError } from "@mcp-cli/core";
import { Catalog, decode, type Source } from "./schema";
import { fetchBytes, httpsUrl } from "./download";
import { digest, marketRoot, type MarketContext } from "./storage";

const client = (signal: AbortSignal): HttpClient => ({
  request: async ({ url, method, headers, body }) => {
    const parts: Uint8Array[] = [];
    if (body) for await (const part of body) parts.push(part);
    const { response, bytes } = await fetchBytes(url, signal, {
      method,
      headers,
      ...(parts.length ? { body: new Blob(parts.map((part) => new Uint8Array(part))) } : {}),
    });
    return {
      url: response.url,
      method,
      statusCode: response.status,
      statusMessage: response.statusText,
      headers: Object.fromEntries(response.headers),
      body: new Blob([new Uint8Array(bytes)]).stream().values(),
    };
  },
});

export const normalizeSource = (value: string): string => {
  if (isAbsolute(value)) return pathToFileURL(value).href;
  if (value.startsWith("file:")) return pathToFileURL(fileURLToPath(value)).href;
  const url = httpsUrl(value);
  if (url.search) throw new UsageError("Catalog repository URLs cannot contain a query.");
  return url.href.replace(/\/$/, "");
};

export const loadSource = async (
  context: MarketContext,
  value: string,
  signal: AbortSignal,
): Promise<Source> => {
  const url = normalizeSource(value);
  const local = url.startsWith("file:");
  const directory = local
    ? fileURLToPath(url)
    : await mkdtemp(join(marketRoot(context), ".catalog-"));
  try {
    if (!local)
      await git.clone({
        fs,
        http: client(signal),
        dir: directory,
        url,
        depth: 1,
        singleBranch: true,
        noCheckout: true,
        noTags: true,
      });
    signal.throwIfAborted();
    const commit = await git.resolveRef({ fs, dir: directory, ref: "HEAD" });
    const { blob } = await git.readBlob({
      fs,
      dir: directory,
      oid: commit,
      filepath: "marketplace.json",
    });
    if (blob.length > 2 * 1024 * 1024) throw new UsageError("Catalog exceeds 2 MiB.");
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(blob));
    } catch {
      throw new UsageError("marketplace.json must contain valid JSON.");
    }
    const catalog = decode(Catalog, value, "marketplace.json");
    if (catalog.plugins.length > 1000) throw new UsageError("Catalog exceeds 1000 plugins.");
    const ids = new Set<string>();
    for (const plugin of catalog.plugins) {
      if (ids.has(plugin.id)) throw new UsageError(`Duplicate catalog plugin: ${plugin.id}`);
      ids.add(plugin.id);
      for (const artifact of plugin.artifacts) {
        if (local && artifact.url.startsWith("file:")) fileURLToPath(artifact.url);
        else httpsUrl(artifact.url);
      }
    }
    return { id: `repo.${digest(url).slice(0, 16)}`, url, commit, catalog };
  } finally {
    if (!local) await rm(directory, { recursive: true, force: true });
  }
};
