import { isRecord, type ToolResult } from "@mcp-cli/core";
import { extname } from "node:path";

export type AudioFormat = "mp3" | "wav" | "ogg" | "flac" | "mp4" | "aac" | "webm";
const extensions: Record<string, AudioFormat> = {
  mp3: "mp3",
  wav: "wav",
  wave: "wav",
  ogg: "ogg",
  oga: "ogg",
  opus: "ogg",
  flac: "flac",
  m4a: "mp4",
  mp4: "mp4",
  aac: "aac",
  webm: "webm",
};
export const formatForPath = (path: string): AudioFormat | undefined =>
  extensions[extname(path).slice(1).toLowerCase()];
export const sniffAudio = (bytes: Uint8Array): AudioFormat | undefined => {
  const ascii = (start: number, text: string): boolean =>
    [...text].every((char, i) => bytes[start + i] === char.charCodeAt(0));
  if (ascii(0, "RIFF") && ascii(8, "WAVE")) return "wav";
  if (ascii(0, "OggS")) return "ogg";
  if (ascii(0, "fLaC")) return "flac";
  if (ascii(4, "ftyp")) return "mp4";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    return "webm";
  if (ascii(0, "ID3")) return "mp3";
  if (bytes[0] === 0xff && bytes[1] !== undefined) {
    if ((bytes[1] & 0xf6) === 0xf0) return "aac";
    if ((bytes[1] & 0xe0) === 0xe0) return "mp3";
  }
  return undefined;
};
type Source = { bytes: Uint8Array } | { url: string };
const decode = (value: string): Source => {
  const clean = value.replace(/\s/g, "");
  if (!clean || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) throw new Error("Invalid base64 audio");
  return { bytes: Uint8Array.from(atob(clean), (char) => char.charCodeAt(0)) };
};
const sourceString = (value: unknown): Source | undefined => {
  if (typeof value !== "string") return undefined;
  if (/^https:\/\/\S+$/.test(value)) return { url: value };
  const match = value.match(/^data:[^,]*;base64,(.*)$/s);
  return match?.[1] ? decode(match[1]) : undefined;
};
const sourceObject = (value: unknown, depth = 0): Source | undefined => {
  if (!isRecord(value) || depth > 4) return undefined;
  for (const key of [
    "audio_url",
    "url",
    "file_url",
    "audio",
    "audio_base64",
    "audio_data",
    "data",
    "base64",
  ]) {
    const field = value[key];
    const source = sourceString(field);
    if (source) return source;
    if (
      ["audio", "audio_base64", "audio_data", "data", "base64"].includes(key) &&
      typeof field === "string"
    )
      return decode(field);
  }
  return sourceObject(value.data, depth + 1) ?? sourceObject(value.result, depth + 1);
};
export const audioSource = (result: ToolResult): Source => {
  if (result.isError) throw new Error("Cannot save a failed audio result");
  for (const block of result.content) {
    if (block.type === "audio" && typeof block.data === "string") return decode(block.data);
    if (
      block.type === "resource" &&
      isRecord(block.resource) &&
      typeof block.resource.blob === "string"
    )
      return decode(block.resource.blob);
  }
  const structured = sourceObject(result.structuredContent);
  if (structured) return structured;
  for (const block of result.content) {
    if (typeof block.text !== "string") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(block.text);
    } catch {
      parsed = undefined;
    }
    const source = sourceObject(parsed) ?? sourceString(parsed) ?? sourceString(block.text);
    if (source) return source;
    const match = block.text.match(/https:\/\/[^\s"'<>)]+/);
    if (match) return { url: match[0].replace(/[.,;:!?]+$/, "") };
  }
  throw new Error("Tool result contains no audio URL or audio data");
};
