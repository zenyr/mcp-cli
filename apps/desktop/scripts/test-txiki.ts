import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isRecord } from "@mcp-cli/core";
import { runtimeCases } from "../runtime-tests/suite";

const desktop = fileURLToPath(new URL("../", import.meta.url));
const executable = async () => {
  if (process.env.TJS_BIN) {
    if (!(await Bun.file(process.env.TJS_BIN).exists()))
      throw new Error("TJS_BIN does not point to an existing TxikiJS executable.");
    return process.env.TJS_BIN;
  }
  const direct = Bun.which("tjs");
  if (direct) return direct;
  const tinyjs = Bun.which("tinyjs");
  if (tinyjs) {
    const bundled = join(
      dirname(await realpath(tinyjs)),
      "bin",
      process.platform === "win32" ? "tjs.exe" : "tjs",
    );
    if (await Bun.file(bundled).exists()) return bundled;
  }
  throw new Error("TxikiJS was not found. Install tinyjs or set TJS_BIN to its executable.");
};

const tjs = await executable();
console.log(
  `TxikiJS runtime: ${tjs} (sha256 ${new Bun.CryptoHasher("sha256").update(await Bun.file(tjs).arrayBuffer()).digest("hex")})`,
);
const execute = async (args: string[]) => {
  const child = Bun.spawn(args, { cwd: desktop, stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, 30000);
  try {
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    process.stdout.write(stdout);
    process.stderr.write(stderr);
    if (timedOut || status !== 0)
      throw new Error(
        `TxikiJS test command failed${timedOut ? " (timeout)" : ` (exit ${status})`}.`,
      );
    return stdout;
  } finally {
    clearTimeout(timer);
  }
};
const directory = await mkdtemp(join(tmpdir(), "mcp-desktop-tests-"));
try {
  const output = join(directory, "runtime-tests.js");
  const build = await Bun.build({
    entrypoints: [join(desktop, "runtime-tests/txiki-entry.ts")],
    target: "browser",
    outdir: directory,
    naming: "runtime-tests.js",
  });
  if (!build.success)
    throw new AggregateError(build.logs, "Could not bundle the shared runtime tests.");
  const binary = join(
    directory,
    process.platform === "win32" ? "runtime-tests.exe" : "runtime-tests",
  );
  await execute([tjs, "compile", output, binary]);
  const stdout = await execute([binary]);
  let summary: unknown;
  try {
    summary = JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
  } catch {
    throw new Error("TxikiJS did not return a test summary.");
  }
  if (
    !isRecord(summary) ||
    summary.runtime !== "txikijs" ||
    summary.tests !== runtimeCases.length ||
    summary.failed !== 0
  )
    throw new Error("TxikiJS did not execute the complete shared test suite.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
