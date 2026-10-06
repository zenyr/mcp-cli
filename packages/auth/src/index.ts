import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { isRecord, type TokenStore, type Tokens } from "@mcp-cli/core";
import { DEFAULT_LOCK_OPTIONS, hasCode, withFileLock, type LockOptions } from "./lock";

export { LockTimeoutError, type LockOptions } from "./lock";

type Env = Record<string, string | undefined>;
export type FileTokenStoreOptions = {
  /** Credentials directory; defaults to `$XDG_CONFIG_HOME/mcp-cli/credentials`. */
  dir?: string;
  env?: Env;
  home?: string;
  lock?: Partial<LockOptions>;
};

/** Stored credentials could not be decoded; the user can log in again to replace them. */
export class CredentialsFormatError extends Error {
  override name = "CredentialsFormatError";
}

export const credentialsDir = (env: Env = process.env, home = env.HOME || homedir()): string => {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && isAbsolute(xdg) ? xdg : join(home, ".config");
  return join(base, "mcp-cli", "credentials");
};

export const decodeTokens = (value: unknown, source: string): Tokens => {
  const fail = (reason: string) =>
    new CredentialsFormatError(`Invalid credentials ${source}: ${reason}`);
  if (!isRecord(value)) throw fail("expected a JSON object");
  const text = (key: string): string | undefined => {
    const field = value[key];
    if (field === undefined || typeof field === "string") return field;
    throw fail(`${key} must be a string`);
  };
  const { accessToken, expiresAt, client } = value;
  if (typeof accessToken !== "string" || !accessToken) throw fail("missing accessToken");
  if (expiresAt !== undefined && typeof expiresAt !== "number")
    throw fail("expiresAt must be a number");
  if (client !== undefined && !isRecord(client)) throw fail("client must be an object");
  return {
    accessToken,
    tokenType: text("tokenType"),
    refreshToken: text("refreshToken"),
    expiresAt,
    scope: text("scope"),
    client,
  };
};

const parseJson = (text: string, source: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    throw new CredentialsFormatError(`Invalid credentials ${source}: malformed JSON`);
  }
};

const servicePattern = /^[a-z][a-z0-9-]*$/;
const checked = (service: string): string => {
  if (!servicePattern.test(service)) throw new Error(`Invalid service name: ${service}`);
  return service;
};

/** File-backed store: one 0600 JSON file per service in a 0700 directory, replaced atomically. */
export const fileTokenStore = (options: FileTokenStoreOptions = {}): TokenStore => {
  const dir = options.dir ?? credentialsDir(options.env, options.home);
  const lock = { ...DEFAULT_LOCK_OPTIONS, ...options.lock };
  const file = (service: string) => join(dir, `${checked(service)}.json`);
  const ensureDir = async () => {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
  };
  return {
    read: async (service) => {
      const path = file(service);
      const text = await readFile(path, "utf8").catch((error: unknown) => {
        if (hasCode(error, "ENOENT")) return undefined;
        throw error;
      });
      if (text === undefined) return undefined;
      return decodeTokens(parseJson(text, path), path);
    },
    write: async (service, tokens) => {
      const path = file(service);
      await ensureDir();
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(tokens, null, 2)}\n`, {
          mode: 0o600,
          flag: "wx",
        });
        await rename(temporary, path);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
    },
    delete: async (service) => {
      await rm(file(service), { force: true });
    },
    withLock: async (service, fn) => {
      const path = join(dir, `${checked(service)}.lock`);
      await ensureDir();
      return withFileLock(path, lock, fn);
    },
  };
};
