import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { UsageError } from "@mcp-cli/core";
import { MAX_ARCHIVE } from "./archive";
import { digest } from "./storage";
import type { Artifact } from "./schema";

export const httpsUrl = (value: string): URL => {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new UsageError("Use an HTTPS URL without credentials or fragments.");
  return url;
};

export const readLimited = async (response: Response, limit = MAX_ARCHIVE): Promise<Uint8Array> => {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new UsageError("Download exceeds the size limit.");
  }
  if (!response.body) throw new UsageError("Empty download response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new UsageError("Download exceeds the size limit.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
};

export const fetchBytes = async (
  value: string,
  signal: AbortSignal,
  init: RequestInit = {},
): Promise<{ response: Response; bytes: Uint8Array }> => {
  let url = httpsUrl(value);
  for (let hop = 0; hop < 6; hop++) {
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
    }).catch(() => {
      throw new UsageError("Download request failed or was cancelled.");
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const target = response.headers.get("location");
      await response.body?.cancel();
      if (!target) throw new UsageError("Download redirect has no location.");
      const next = httpsUrl(new URL(target, url).href);
      if (init.method === "POST" && next.origin !== url.origin)
        throw new UsageError("Git POST redirect changed origin.");
      url = next;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new UsageError(`Download failed (HTTP ${response.status}).`);
    }
    return { response, bytes: await readLimited(response) };
  }
  throw new UsageError("Too many download redirects.");
};

export const download = async (
  artifact: Artifact,
  signal: AbortSignal,
  allowFile: boolean,
): Promise<Uint8Array> => {
  let bytes: Uint8Array;
  if (allowFile && artifact.url.startsWith("file:")) {
    const file = fileURLToPath(artifact.url);
    if ((await stat(file)).size > MAX_ARCHIVE) throw new UsageError("Package exceeds 64 MiB.");
    bytes = await readFile(file);
  } else bytes = (await fetchBytes(artifact.url, signal)).bytes;
  if (digest(bytes) !== artifact.sha256)
    throw new UsageError("Package SHA-256 verification failed.");
  return bytes;
};
