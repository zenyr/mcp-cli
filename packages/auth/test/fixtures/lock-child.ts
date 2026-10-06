import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileTokenStore } from "../../src";

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
