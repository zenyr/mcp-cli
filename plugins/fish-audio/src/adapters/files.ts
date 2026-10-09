import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, extname } from "node:path";
import type { ToolResult } from "@mcp-cli/core";
import { audioSource, formatForPath, sniffAudio } from "./audio";

export const atomicWrite = async (
  path: string,
  write: (temporary: string) => Promise<unknown>,
): Promise<void> => {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${crypto.randomUUID()}.tmp${extname(path)}`;
  try {
    await write(temporary);
    const file = await open(temporary, "r");
    try {
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await rm(temporary, { force: true });
  }
};
export const writeText = (path: string, text: string): Promise<void> =>
  atomicWrite(path, (temporary) => writeFile(temporary, text, { mode: 0o600 }));
export const ensureConverter = async (): Promise<void> => {
  if (!Bun.which("ffmpeg")) throw new Error("Audio conversion and joining require ffmpeg");
};
const ffmpeg = async (args: string[]): Promise<void> => {
  await ensureConverter();
  const child = Bun.spawn(
    ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args],
    { stdout: "ignore", stderr: "pipe" },
  );
  const stderr = await new Response(child.stderr).text();
  if ((await child.exited) !== 0) throw new Error(`ffmpeg failed: ${stderr.trim()}`);
};
const writeAudio = async (bytes: Uint8Array, path: string): Promise<void> => {
  if (!bytes.length) throw new Error("Audio data is empty");
  const actual = sniffAudio(bytes);
  const expected = formatForPath(path);
  if (!actual) throw new Error("Cannot identify the audio format");
  if (!expected || expected === actual)
    return atomicWrite(path, (temporary) => writeFile(temporary, bytes, { mode: 0o600 }));
  await ensureConverter();
  await atomicWrite(path, async (temporary) => {
    const input = `${temporary}.input.${actual}`;
    try {
      await writeFile(input, bytes, { mode: 0o600 });
      await ffmpeg(["-i", input, temporary]);
    } finally {
      await rm(input, { force: true });
    }
  });
};
export const saveAudio = async (result: ToolResult, path: string): Promise<string> => {
  const source = audioSource(result);
  let bytes: Uint8Array;
  if ("bytes" in source) bytes = source.bytes;
  else {
    const response = await fetch(source.url, {
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`Audio download failed (HTTP ${response.status})`);
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  await writeAudio(bytes, path);
  return path;
};
export const copyAudio = async (source: string, destination: string): Promise<void> =>
  writeAudio(new Uint8Array(await readFile(source)), destination);
export const joinAudio = async (paths: string[], path: string): Promise<void> => {
  if (!paths.length) throw new Error("Cannot join an empty audio list");
  await ensureConverter();
  await atomicWrite(path, async (temporary) => {
    const args = paths.flatMap((part) => ["-i", part]);
    const streams = paths.map((_, i) => `[${i}:a:0]`).join("");
    const output = formatForPath(path) ? [] : ["-f", "mp3"];
    await ffmpeg([
      ...args,
      "-filter_complex",
      `${streams}concat=n=${paths.length}:v=0:a=1[out]`,
      "-map",
      "[out]",
      ...output,
      temporary,
    ]);
  });
};
