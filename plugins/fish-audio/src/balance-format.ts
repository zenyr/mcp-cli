import { isRecord, type ToolResult } from "@mcp-cli/core";
import { localIso, nextMonthlyRefill } from "./domain/refill";

const cycleEnd = (result: ToolResult): string | undefined => {
  const payload = result.structuredContent;
  if (!isRecord(payload) || typeof payload.package_cycle_ends_at !== "string") return undefined;
  return payload.package_cycle_ends_at;
};

/** Appends an estimated next credit refill to `account balance` text output. */
export const formatBalanceResult = (
  result: ToolResult,
  hostFormat: (result: ToolResult) => string,
  now = new Date(),
): string | undefined => {
  const end = result.isError ? undefined : cycleEnd(result);
  const refill = end === undefined ? undefined : nextMonthlyRefill(new Date(end), now);
  if (!refill) return undefined;
  return `${hostFormat(result)}\nestimated_next_refill: ${localIso(refill)} # estimate: assumes a monthly refill on the package_cycle_ends_at day; Fish does not report it`;
};
