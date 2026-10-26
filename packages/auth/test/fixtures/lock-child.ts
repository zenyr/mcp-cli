import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileTokenStore } from "../../src";
import { withLockFile } from "../../src/lock";

const [dir = "", mode = ""] = process.argv.slice(2);
const store = fileTokenStore({ dir, lock: { staleMs: 60000, timeoutMs: 20000, pollMs: 5 } });
const counter = join(dir, "counter");

if (mode === "increment")
  await store.withLock("svc", async () => {
    const value = Number(await readFile(counter, "utf8").catch(() => "0"));
    await Bun.sleep(20);
    await writeFile(counter, String(value + 1));
  });
if (mode === "hold")
  await store.withLock("svc", async () => {
    console.log("locked");
    await Bun.sleep(60000);
  });

if (mode === "file-increment" || mode === "file-hold") {
  await mkdir(dir, { recursive: true });
  await withLockFile(
    join(dir, "svc.lock"),
    { staleMs: 1, timeoutMs: 20000, pollMs: 1 },
    async () => {
      if (mode === "file-hold") {
        console.log("locked");
        await Bun.sleep(60000);
        return;
      }
      const marker = join(dir, "inside");
      const handle = await open(marker, "wx");
      try {
        const value = Number(await readFile(counter, "utf8").catch(() => "0"));
        await Bun.sleep(20);
        await writeFile(counter, String(value + 1));
      } finally {
        await handle.close();
        await rm(marker);
      }
    },
  );
}
