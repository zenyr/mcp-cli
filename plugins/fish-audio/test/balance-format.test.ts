import { expect, test } from "bun:test";
import { formatBalanceResult } from "../src/balance-format";
import { localIso, nextMonthlyRefill } from "../src/domain/refill";

const at = (iso: string): Date => new Date(iso);

test("next refill repeats the cycle end's UTC day and time", () => {
  const end = at("2027-10-10T15:43:26Z");
  expect(nextMonthlyRefill(end, at("2026-11-17T00:00:00Z"))?.toISOString()).toBe(
    "2026-12-10T15:43:26.000Z",
  );
  expect(nextMonthlyRefill(end, at("2026-11-10T15:00:00Z"))?.toISOString()).toBe(
    "2026-11-10T15:43:26.000Z",
  );
  expect(nextMonthlyRefill(end, at("2026-12-31T00:00:00Z"))?.toISOString()).toBe(
    "2027-01-10T15:43:26.000Z",
  );
});

test("next refill clamps to short months and never passes the cycle end", () => {
  const end = at("2027-03-31T00:00:00Z");
  expect(nextMonthlyRefill(end, at("2027-02-01T00:00:00Z"))?.toISOString()).toBe(
    "2027-02-28T00:00:00.000Z",
  );
  expect(nextMonthlyRefill(end, at("2027-03-01T00:00:00Z"))?.toISOString()).toBe(
    "2027-03-31T00:00:00.000Z",
  );
  expect(nextMonthlyRefill(end, at("2027-03-31T00:00:00Z"))).toBeUndefined();
  expect(nextMonthlyRefill(at("invalid"), at("2027-03-01T00:00:00Z"))).toBeUndefined();
});

test("local ISO keeps the instant and states its offset", () => {
  const date = at("2026-12-10T15:43:26Z");
  const text = localIso(date);
  expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  expect(new Date(text).getTime()).toBe(date.getTime());
});

test("balance output appends a labeled estimate and leaves other results alone", () => {
  const hostFormat = () => "plan: plus";
  const now = at("2026-11-17T00:00:00Z");
  const balance = {
    content: [],
    structuredContent: { plan: "plus", package_cycle_ends_at: "2027-10-10T15:43:26+00:00" },
  };
  const text = formatBalanceResult(balance, hostFormat, now) ?? "";
  expect(text).toStartWith("plan: plus\nestimated_next_refill: ");
  expect(text).toContain(`${localIso(at("2026-12-10T15:43:26Z"))} # estimate:`);
  expect(formatBalanceResult({ ...balance, isError: true }, hostFormat, now)).toBeUndefined();
  expect(
    formatBalanceResult({ content: [], structuredContent: { plan: "plus" } }, hostFormat, now),
  ).toBeUndefined();
  expect(
    formatBalanceResult(
      { content: [], structuredContent: { package_cycle_ends_at: "2026-01-01T00:00:00Z" } },
      hostFormat,
      now,
    ),
  ).toBeUndefined();
});
