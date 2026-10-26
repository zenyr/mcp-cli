import { gunzipSync, gzipSync } from "node:zlib";
import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { UsageError } from "@mcp-cli/core";

export const MAX_ARCHIVE = 64 * 1024 * 1024;
export const MAX_EXPANDED = 256 * 1024 * 1024;
export const safePath = (path: string): string => {
  if (
    !path ||
    path.length > 240 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes(":") ||
    [...path].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new UsageError(`Unsafe package path: ${JSON.stringify(path)}`);
  return path;
};
const string = (header: Uint8Array, offset: number, length: number): string =>
  new TextDecoder().decode(header.subarray(offset, offset + length)).split("\0")[0] ?? "";
const octal = (header: Uint8Array, offset: number, length: number): number => {
  const text = string(header, offset, length).trim();
  if (!/^[0-7]+$/.test(text)) throw new UsageError("Invalid tar header.");
  return Number.parseInt(text, 8);
};

export const unpack = (compressed: Uint8Array): Map<string, Uint8Array> => {
  if (compressed.byteLength > MAX_ARCHIVE) throw new UsageError("Package exceeds 64 MiB.");
  const bytes =
    compressed[0] === 0x1f && compressed[1] === 0x8b
      ? gunzipSync(compressed, { maxOutputLength: MAX_EXPANDED })
      : compressed;
  if (bytes.byteLength > MAX_EXPANDED) throw new UsageError("Expanded package exceeds 256 MiB.");
  const files = new Map<string, Uint8Array>();
  const names = new Set<string>();
  let count = 0;
  for (let offset = 0; offset < bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.length !== 512) throw new UsageError("Truncated tar header.");
    if (header.every((byte) => byte === 0)) {
      if (bytes.subarray(offset).some((byte) => byte !== 0))
        throw new UsageError("Unexpected tar trailer.");
      break;
    }
    if (++count > 10000) throw new UsageError("Package contains too many entries.");
    const checksum = header.reduce(
      (sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
      0,
    );
    if (octal(header, 148, 8) !== checksum) throw new UsageError("Invalid tar checksum.");
    const prefix = string(header, 345, 155);
    const type = header[156];
    const raw = `${prefix ? `${prefix}/` : ""}${string(header, 0, 100)}`;
    const path = safePath(type === 53 ? raw.replace(/\/$/, "") : raw);
    if (type !== 0 && type !== 48 && type !== 53)
      throw new UsageError("Only regular files and directories are allowed in packages.");
    if (names.has(path)) throw new UsageError(`Duplicate archive entry: ${path}`);
    names.add(path);
    const size = octal(header, 124, 12);
    offset += 512;
    if (offset + size > bytes.length) throw new UsageError("Truncated tar entry.");
    if (type === 53 && size !== 0) throw new UsageError("Invalid directory entry.");
    if (type !== 53) files.set(path, bytes.subarray(offset, offset + size));
    offset += Math.ceil(size / 512) * 512;
    if (offset > bytes.length) throw new UsageError("Truncated tar padding.");
  }
  if (!files.size) throw new UsageError("Package contains no files.");
  return files;
};

export const extract = async (files: Map<string, Uint8Array>, directory: string): Promise<void> => {
  for (const [path, bytes] of files) {
    const target = join(directory, safePath(path));
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
  }
};
export const makeExecutable = async (directory: string, path: string): Promise<string> => {
  const file = join(directory, safePath(path));
  await chmod(file, 0o700);
  return file;
};

export const packDirectory = async (directory: string): Promise<Uint8Array> => {
  const root = resolve(directory);
  const files: Record<string, Uint8Array> = Object.create(null);
  let size = 0;
  const walk = async (relative: string): Promise<void> => {
    const entries = await readdir(join(root, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const path = safePath(relative ? `${relative}/${entry.name}` : entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        const bytes = await readFile(join(root, path));
        size += bytes.length;
        if (size > MAX_EXPANDED || Object.keys(files).length >= 10000)
          throw new UsageError("Package exceeds size or file count limits.");
        files[path] = bytes;
      } else throw new UsageError(`Package cannot contain symlinks or special files: ${path}`);
    }
  };
  await walk("");
  const tar = await new Bun.Archive(files).bytes();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = octal(header, 124, 12);
    header.set(new TextEncoder().encode("00000000000\0"), 136);
    header.fill(32, 148, 156);
    const sum = header.reduce((total, byte) => total + byte, 0);
    header.set(new TextEncoder().encode(`${sum.toString(8).padStart(6, "0")}\0 `), 148);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  const bytes = gzipSync(tar, { level: 9 });
  unpack(bytes);
  return bytes;
};
