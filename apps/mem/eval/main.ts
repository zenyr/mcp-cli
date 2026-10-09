import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { SUMMARY_POLICY } from "../src/types";
import { createCompressor } from "../src/compressor";
import { loadSettings } from "../src/settings";
import { evaluate } from "./evaluation";
import { createFixture } from "./fixture";

const main = async () => {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      live: { type: "boolean", default: false },
      records: { type: "string", default: "32" },
      model: { type: "string" },
      mode: { type: "string", default: "range-only" },
      "max-calls": { type: "string", default: "80" },
      output: { type: "string" },
      "node-bytes": { type: "string" },
      thinking: { type: "string" },
    },
    strict: true,
  });
  const records = Number(values.records);
  const fixture = createFixture(records);
  const mode = values.mode;
  if (mode !== "range-only")
    throw new Error(
      "Only --mode range-only is supported. system and isolated are historical policies. Use historical commit da2151a to reproduce them.",
    );
  const maxCalls = Number(values["max-calls"]);
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 1)
    throw new Error("max-calls must be a positive integer");
  const settings = await loadSettings(join(import.meta.dir, "nonexistent-evaluation-config.json"), {
    ...process.env,
    ...(values.model === undefined ? {} : { MEM_MODEL: values.model }),
    ...(values["node-bytes"] === undefined ? {} : { MEM_NODE_BYTES: values["node-bytes"] }),
    ...(values.thinking === undefined ? {} : { MEM_THINKING: values.thinking }),
  });
  const report = values.live
    ? await evaluate({
        settings,
        compress: createCompressor(settings, process.env),
        records,
        maxCalls,
        progress: (attempt) => {
          if (attempt.ordinal % 5 === 0 || !attempt.success)
            process.stderr.write(
              `${JSON.stringify({ attempt: attempt.ordinal, success: attempt.success, durationMs: Math.round(attempt.durationMs) })}\n`,
            );
        },
      })
    : {
        status: "dry-run",
        inputPolicy: SUMMARY_POLICY,
        externalContextBytes: 0 as const,
        model: settings.model,
        nodeBytes: settings.nodeBytes,
        maxCalls,
        fixture,
        maxDepth: Math.floor(Math.log2(records)),
      };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const outputPath = values.output ?? join(tmpdir(), `mem-eval-${randomUUID()}.json`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized, { mode: 0o600 });
  process.stdout.write(
    `${JSON.stringify({
      status: report.status,
      mode,
      model: settings.model,
      records,
      outputPath,
      ...(values.live && "totals" in report ? { totals: report.totals } : {}),
    })}\n`,
  );
  if (report.status === "failed" || report.status === "budget-stopped") process.exitCode = 1;
};

if (import.meta.main) await main();
