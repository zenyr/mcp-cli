import { test } from "bun:test";
import { runtimeCases } from "../runtime-tests/suite";

for (const scenario of runtimeCases) test(`runtime parity: ${scenario.name}`, scenario.run);
