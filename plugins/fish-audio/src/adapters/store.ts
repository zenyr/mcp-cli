import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isRecord, type ToolResult } from "@mcp-cli/core";
import type { FishPorts, JournalEntry } from "../application/ports";
import { writeText } from "./files";

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const validResult = (value: unknown): value is ToolResult =>
  isRecord(value) && Array.isArray(value.content) && value.content.every(isRecord);
const decodeEntry = (value: unknown): JournalEntry | undefined => {
  if (!isRecord(value) || !isRecord(value.input)) return undefined;
  const input = value.input;
  if (value.status === "pending") return { status: "pending", input };
  if (!validResult(value.result)) return undefined;
  const result = value.result;
  if (value.status === "generated" || value.status === "failed")
    return { status: value.status, input, result };
  if (value.status === "ready" && typeof value.path === "string")
    return { status: "ready", input, result, path: value.path };
  return undefined;
};
export const createStore = (
  output: string | undefined,
  scope: string,
  cacheRoot = output ? `${resolve(output)}.parts` : undefined,
): Pick<FishPorts, "store" | "cachePath"> & {
  acquire: () => Promise<void>;
  release: () => Promise<void>;
} => {
  if (!cacheRoot) throw new Error("Workflow cache directory is required");
  const directory = join(resolve(cacheRoot), hash(scope));
  const cachePath = (key: string): string => join(directory, `${hash(key)}.audio`);
  const metadata = (key: string): string => join(directory, `${hash(key)}.json`);
  const locks = [
    join(directory, ".lock"),
    ...(output ? [join(`${resolve(output)}.parts`, ".lock")] : []),
  ];
  const owned: string[] = [];
  const release = async (): Promise<void> => {
    for (const lock of owned.splice(0).reverse()) await rm(lock, { recursive: true, force: true });
  };
  const allowedPath = (path: string): boolean => dirname(resolve(path)) === directory;
  return {
    cachePath,
    acquire: async () => {
      if (owned.length) throw new Error("Workflow cache lock is already acquired");
      try {
        for (const lock of locks) {
          await mkdir(dirname(lock), { recursive: true, mode: 0o700 });
          try {
            await mkdir(lock, { mode: 0o700 });
          } catch (error) {
            if (isRecord(error) && error.code === "EEXIST")
              throw new Error(
                `Workflow cache is locked: ${lock}; inspect owner.json and reconcile pending work before removing a stale lock`,
              );
            throw error;
          }
          owned.push(lock);
          await writeFile(
            join(lock, "owner.json"),
            JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
            { mode: 0o600 },
          );
        }
      } catch (error) {
        await release();
        throw error;
      }
    },
    release,
    store: {
      get: async (key) => {
        let value: unknown;
        try {
          value = JSON.parse(await readFile(metadata(key), "utf8"));
        } catch (error) {
          if (isRecord(error) && error.code === "ENOENT") return undefined;
          throw error;
        }
        const entry = decodeEntry(value);
        if (!entry) throw new Error("Invalid cache journal; reconcile before retrying");
        if (entry.status === "ready") {
          if (!allowedPath(entry.path) || entry.path !== cachePath(key))
            throw new Error("Invalid cache audio path");
          try {
            const info = await stat(entry.path);
            if (!info.isFile()) throw new Error("Cache audio must be a regular file");
            if (!info.size)
              return { status: "generated", input: entry.input, result: entry.result };
          } catch (error) {
            if (isRecord(error) && error.code === "ENOENT")
              return { status: "generated", input: entry.input, result: entry.result };
            throw error;
          }
        }
        return entry;
      },
      put: async (key, entry) => {
        if (entry.status === "ready" && (!allowedPath(entry.path) || entry.path !== cachePath(key)))
          throw new Error("Cache audio must stay inside its output and credential scope");
        await writeText(metadata(key), JSON.stringify(entry));
      },
    },
  };
};
