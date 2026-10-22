import { UsageError } from "@mcp-cli/core";
import { text, type Input } from "./web-common";
const formatter = (zone: string): Intl.DateTimeFormat => {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new UsageError(`Invalid timezone: ${zone}`);
  }
};
const parts = (time: number, zone: string): Record<string, number> =>
  Object.fromEntries(
    formatter(zone)
      .formatToParts(time)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
const day = (time: number, zone: string): string => {
  const p = parts(time, zone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
};
export const searchDate = (value: string, zone: string, now = Date.now()): string => {
  const relative = /^(\d+)([dw])$/.exec(value);
  if (relative) {
    if (!zone) throw new UsageError("Relative dates require --timezone");
    const local = day(now, zone);
    const date = new Date(`${local}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - Number(relative[1]) * (relative[2] === "w" ? 7 : 1));
    return date.toISOString().slice(0, 10);
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw new UsageError("Date must be YYYY-MM-DD or a relative period such as 1d or 1w");
  if (zone) formatter(zone);
  return value;
};
export const expiration = (value: string, zone: string, now = Date.now()): number => {
  if (!value) return 0;
  const durations: Record<string, number> = { "30m": 1800, "1h": 3600, "2h": 7200, "4h": 14400 };
  if (durations[value]) return Math.floor(now / 1000) + (durations[value] ?? 0);
  if (/^\d+$/.test(value) && Number.isSafeInteger(Number(value))) return Number(value);
  if (value !== "today") throw new UsageError("Invalid status expiration");
  if (!zone) throw new UsageError("today requires --timezone");
  const local = parts(now, zone);
  const target = new Date(Date.UTC(local.year ?? 0, (local.month ?? 1) - 1, (local.day ?? 1) + 1));
  let guess = target.getTime();
  for (let index = 0; index < 5; index++) {
    const p = parts(guess, zone);
    const actual = Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day, p.hour, p.minute, p.second);
    const delta = target.getTime() - actual;
    guess += delta;
    if (!delta) return Math.floor(guess / 1000);
  }
  throw new UsageError("Cannot resolve next midnight in this timezone");
};
const quote = (value: string): string => {
  if ([...value].some((char) => char.charCodeAt(0) < 32))
    throw new UsageError("Search filter contains control characters");
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
};
export const searchQuery = (input: Input): string => {
  const query = [text(input, "query")];
  for (const [key, operator] of [
    ["channel", "in"],
    ["im", "in"],
    ["with", "with"],
    ["user", "from"],
    ["during", "during"],
  ]) {
    if (key && operator && text(input, key)) query.push(`${operator}:${quote(text(input, key))}`);
  }
  for (const key of ["after", "before", "on"])
    if (text(input, key))
      query.push(`${key}:${searchDate(text(input, key), text(input, "timezone"))}`);
  if (input.threads === true) query.push("is:thread");
  return query.join(" ");
};
