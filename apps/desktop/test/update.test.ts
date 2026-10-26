import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replaceArtifacts } from "../scripts/replace-artifacts";

const fixture = async (
  run: (directory: string, target: string, prepared: string) => Promise<void>,
) => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-update-"));
  const target = join(directory, "current");
  const prepared = join(directory, "prepared");
  await Bun.write(target, "old");
  await Bun.write(prepared, "new");
  try {
    await run(directory, target, prepared);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test("successful replacement checks startup before removing the previous version", async () => {
  await fixture(async (directory, target, prepared) => {
    await replaceArtifacts(
      [{ target, prepared }],
      async () => {
        expect(await Bun.file(target).text()).toBe("new");
        expect((await readdir(directory)).some((name) => name.includes(".previous-"))).toBe(true);
      },
      async () => {
        throw new Error("unexpected recovery");
      },
    );
    expect(await readdir(directory)).toEqual(["current"]);
  });
});

test("startup failure stops new processes, restores every target, then restarts the previous version", async () => {
  await fixture(async (directory, target, prepared) => {
    const second = join(directory, "installed");
    const next = join(directory, "next");
    await Bun.write(second, "old installed");
    await Bun.write(next, "new installed");
    const events: string[] = [];
    await expect(
      replaceArtifacts(
        [
          { target, prepared },
          { target: second, prepared: next },
        ],
        async () => {
          throw new Error("startup failed");
        },
        async () => {
          expect(await Bun.file(target).text()).toBe("old");
          expect(await Bun.file(second).text()).toBe("old installed");
          events.push("restarted old");
        },
        async () => {
          events.push("stopped new");
        },
      ),
    ).rejects.toThrow();
    expect(events).toEqual(["stopped new", "restarted old"]);
  });
});

test("partial installation failure restores targets already replaced", async () => {
  await fixture(async (directory, target, prepared) => {
    await expect(
      replaceArtifacts(
        [
          { target, prepared },
          {
            target: join(directory, "absent"),
            prepared: join(directory, "missing"),
          },
        ],
        async () => {},
        async () => {},
      ),
    ).rejects.toThrow();
    expect(await Bun.file(target).text()).toBe("old");
    expect(await readdir(directory)).toEqual(["current"]);
  });
});

test("rollback retains both builds when the new running app cannot stop safely", async () => {
  await fixture(async (directory, target, prepared) => {
    await expect(
      replaceArtifacts(
        [{ target, prepared }],
        async () => {
          throw new Error("not ready");
        },
        async () => {
          throw new Error("must not restart");
        },
        async () => {
          throw new Error("still running");
        },
      ),
    ).rejects.toThrow("백업을 보존");
    expect(await Bun.file(target).text()).toBe("new");
    const backup = (await readdir(directory)).find((name) => name.includes(".previous-"));
    expect(backup).toBeDefined();
    expect(await Bun.file(join(directory, backup ?? "missing")).text()).toBe("old");
  });
});
