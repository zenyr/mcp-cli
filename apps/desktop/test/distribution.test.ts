import { describe, expect, test } from "bun:test";
import { chmod, copyFile, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const helper = fileURLToPath(new URL("../distribution/Allow MCP CLI.command", import.meta.url));
const run = async (args: string[], home?: string, input?: string) => {
  const child = Bun.spawn(args, {
    env: { ...process.env, ...(home ? { HOME: home } : {}) },
    stdin: input === undefined ? "ignore" : new Blob([input]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
};

describe.skipIf(process.platform !== "darwin")("distribution consent helper", () => {
  const fixture = async (callback: (home: string, app: string) => Promise<void>) => {
    const home = await mkdtemp(join(tmpdir(), "mcp-distribution-test-"));
    const app = join(home, "Applications/MCP CLI.app");
    try {
      await mkdir(join(app, "Contents/MacOS"), { recursive: true });
      await copyFile("/usr/bin/true", join(app, "Contents/MacOS/test"));
      await chmod(join(app, "Contents/MacOS/test"), 0o755);
      await writeFile(
        join(app, "Contents/Info.plist"),
        `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>app.mcp-cli.desktop</string>
<key>CFBundleExecutable</key><string>test</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>`,
      );
      expect((await run(["/usr/bin/codesign", "--force", "--sign", "-", app])).code).toBe(0);
      expect(
        (await run(["/usr/bin/xattr", "-w", "com.apple.quarantine", "0081;test", app])).code,
      ).toBe(0);
      await callback(home, app);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  };

  test("cancellation preserves quarantine", () =>
    fixture(async (home, app) => {
      expect((await run(["/bin/bash", helper, app], home, "\n")).code).toBe(0);
      expect((await run(["/usr/bin/xattr", "-p", "com.apple.quarantine", app])).code).toBe(0);
    }));

  test("explicit consent removes quarantine", () =>
    fixture(async (home, app) => {
      const executable = join(app, "Contents/MacOS/test");
      expect(
        (await run(["/usr/bin/xattr", "-w", "com.apple.quarantine", "0081;test", executable])).code,
      ).toBe(0);
      expect((await run(["/bin/bash", helper, app], home, "ALLOW\n")).code).toBe(0);
      expect((await run(["/usr/bin/xattr", "-p", "com.apple.quarantine", app])).code).not.toBe(0);
      expect(
        (await run(["/usr/bin/xattr", "-p", "com.apple.quarantine", executable])).code,
      ).not.toBe(0);
    }));

  test("rejects a symlink without changing its target", () =>
    fixture(async (home, app) => {
      const original = join(home, "original.app");
      await rename(app, original);
      await symlink(original, app);
      expect((await run(["/bin/bash", helper, app], home, "ALLOW\n")).code).not.toBe(0);
      expect((await run(["/usr/bin/xattr", "-p", "com.apple.quarantine", original])).code).toBe(0);
    }));

  test("rejects a changed bundle before consent", () =>
    fixture(async (home, app) => {
      await writeFile(join(app, "Contents/Info.plist"), "invalid");
      expect((await run(["/bin/bash", helper, app], home, "ALLOW\n")).code).not.toBe(0);
      expect((await run(["/usr/bin/xattr", "-p", "com.apple.quarantine", app])).code).toBe(0);
    }));
});
