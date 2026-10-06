import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";

export const ensurePrivateDir = async (dir: string): Promise<void> => {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
};

/** Writes a 0600 file through a temporary sibling so readers never see partial content. */
export const writeAtomic = async (path: string, text: string): Promise<void> => {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
};

const servicePattern = /^[a-z][a-z0-9-]*$/;
export const checked = (service: string): string => {
  if (!servicePattern.test(service)) throw new Error(`Invalid service name: ${service}`);
  return service;
};
