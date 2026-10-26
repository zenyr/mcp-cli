/// <reference types="@txikijs/types" />
import { runtimeCases } from "./suite";

let failed = 0;
for (const scenario of runtimeCases) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(scenario.run),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Test timed out")), 5000);
      }),
    ]);
    console.log(`PASS ${scenario.name}`);
  } catch (error) {
    failed += 1;
    console.error(
      `FAIL ${scenario.name}: ${error instanceof Error ? error.message : "unknown failure"}`,
    );
  } finally {
    clearTimeout(timer);
  }
}
console.log(
  JSON.stringify({ runtime: "txikijs", version: tjs.version, tests: runtimeCases.length, failed }),
);
tjs.exit(failed ? 1 : 0);
