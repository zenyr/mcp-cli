import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { connect } from "node:net";
import { daemonSocket } from "./endpoint";

const hasCode = (error: unknown, code: string) =>
  error instanceof Error && "code" in error && error.code === code;

const socketIsAbsent = (directory: string): Promise<boolean> =>
  new Promise((resolve, reject) => {
    const socket = connect(daemonSocket(directory));
    socket.setTimeout(3000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("Daemon socket did not respond; preserving its state"));
    });
    socket.once("error", (error) => {
      if (hasCode(error, "ENOENT") || hasCode(error, "ECONNREFUSED")) resolve(true);
      else reject(error);
    });
  });

const recover = async (directory: string) => {
  const owner = `${directory}/owner`;
  const text = await readFile(owner, "utf8").catch((error: unknown) => {
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  });
  if (text === undefined) {
    if (!(await socketIsAbsent(directory)))
      throw new Error("Daemon socket is still active; preserving its state");
    return;
  }
  const pid = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(pid) || pid <= 0)
    throw new Error("Invalid daemon owner; preserving its state");
  try {
    process.kill(pid, 0);
    throw new Error("Daemon owner is still running; preserving its state");
  } catch (error) {
    if (!hasCode(error, "ESRCH")) throw error;
  }
  if (!(await socketIsAbsent(directory)))
    throw new Error("Daemon socket is still active; preserving its state");
  if ((await readFile(owner, "utf8")) !== text)
    throw new Error("Daemon owner changed; preserving its state");
  if (process.platform !== "win32") await rm(daemonSocket(directory), { force: true });
  await rm(`${directory}/token`, { force: true });
  await rm(owner);
};

export const prepareOwnership = async (directory: string, claim = false) => {
  if (!isAbsolute(directory)) throw new Error("Daemon directory must be absolute");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = `${directory}/.ownership-lock`;
  await mkdir(lock, { mode: 0o700 });
  try {
    await recover(directory);
    if (claim)
      await writeFile(`${directory}/owner`, String(process.pid), { flag: "wx", mode: 0o600 });
  } finally {
    await rm(lock, { recursive: true });
  }
};
