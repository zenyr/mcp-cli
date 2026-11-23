import type { Entry, Kind, Scope, Store } from "./types";
import type { Options } from "./options";
import { fail, isRecord, output, serialize } from "./values";
export { parse } from "./options";
export type { Options } from "./options";

const id = (entry: Entry): string => `${entry.scope}/${entry.i}`;
const normalized = (text: string): string => text.normalize("NFC").toLowerCase().normalize("NFC");
const excerpt = (text: string, query: string): string[] => {
  const scalars = Array.from(text.normalize("NFC"));
  const at = normalized(text).indexOf(query);
  let units = 0;
  let index = 0;
  while (index < scalars.length && units < at) {
    units += (scalars[index] ?? "").toLowerCase().length;
    index++;
  }
  return scalars.slice(Math.max(0, index - 60), index + 180);
};
const fits = (value: unknown, limit: number, json: boolean): boolean =>
  Buffer.byteLength(serialize(value, json)) <= limit;
export const readRecord = (store: Store, scopes: Scope[], options: Options): unknown => {
  const recordId = options.text[0] ?? "";
  const slash = recordId.lastIndexOf("/");
  const scope = recordId.slice(0, slash);
  const number = recordId.slice(slash + 1);
  if (slash < 1 || !/^\d+$/.test(number) || !Number.isSafeInteger(Number(number)))
    fail("INVALID_OPTION", "Invalid record ID.");
  if (!scopes.some((item) => item.id === scope))
    fail("RECORD_UNAVAILABLE", "Record is unavailable in selected scopes.");
  const entry = store.entry(scope, Number(number));
  if (!entry) return fail("RECORD_UNAVAILABLE", "Record is unavailable in selected scopes.");
  const cursor = options.cursor ?? "0";
  if (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor)))
    fail("INVALID_OPTION", "Invalid read cursor.");
  const scalars = Array.from(entry.text);
  const offset = Number(cursor);
  if (offset > scalars.length) fail("INVALID_OPTION", "Read cursor exceeds record length.");
  const page = (end: number) => ({
    ok: true,
    recordId,
    kind: entry.kind,
    date: entry.date,
    text: scalars.slice(offset, end).join(""),
    cursor: end < scalars.length ? String(end) : null,
  });
  let low = offset;
  let high = scalars.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(page(middle), options.maxBytes, options.json)) low = middle;
    else high = middle - 1;
  }
  if (low === offset && offset < scalars.length)
    fail("OUTPUT_OVERFLOW", "Record metadata exceeds --max-bytes.");
  output(page(low), options.maxBytes, options.json);
  return page(low);
};
type Boundary = { scope: string; high: number };
const decodeCursor = (cursor: string): { boundaries: Boundary[]; skip: number; query: string } => {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return fail("INVALID_OPTION", "Invalid recall cursor.");
  }
  if (
    !isRecord(value) ||
    !Array.isArray(value.boundaries) ||
    !Number.isSafeInteger(value.skip) ||
    typeof value.skip !== "number" ||
    value.skip < 0 ||
    typeof value.query !== "string"
  )
    return fail("INVALID_OPTION", "Invalid recall cursor.");
  const boundaries = value.boundaries.map((item: unknown) => {
    if (
      !isRecord(item) ||
      typeof item.scope !== "string" ||
      typeof item.high !== "number" ||
      !Number.isSafeInteger(item.high) ||
      item.high < 0
    )
      return fail("INVALID_OPTION", "Invalid recall cursor boundary.");
    return { scope: item.scope, high: item.high };
  });
  return { boundaries, skip: value.skip, query: value.query };
};
export const recall = (store: Store, scopes: Scope[], options: Options): unknown => {
  const query = normalized(options.text[0] ?? "");
  if (!query.trim()) fail("INVALID_OPTION", "Recall query must not be empty.");
  const state = options.cursor
    ? decodeCursor(options.cursor)
    : {
        boundaries: scopes.map((scope) => ({
          scope: scope.id,
          high: (store.entries(scope.id).at(-1)?.i ?? -1) + 1,
        })),
        skip: 0,
        query,
      };
  if (
    state.query !== query ||
    state.boundaries.length !== scopes.length ||
    state.boundaries.some((item, index) => item.scope !== scopes[index]?.id)
  )
    fail("INVALID_OPTION", "Recall cursor does not match query or scopes.");
  if (
    state.boundaries.some(
      (boundary) => boundary.high > (store.entries(boundary.scope).at(-1)?.i ?? -1) + 1,
    )
  )
    fail("INVALID_OPTION", "Recall cursor exceeds scope history.");
  const hits = state.boundaries
    .flatMap((boundary) => store.entries(boundary.scope, boundary.high))
    .filter((entry) => normalized(entry.text).includes(query))
    .sort((a, b) => b.date.localeCompare(a.date) || b.i - a.i || a.scope.localeCompare(b.scope));
  if (state.skip > hits.length) fail("INVALID_OPTION", "Recall cursor exceeds result count.");
  const results: { recordId: string; kind: Kind; snippet: string }[] = [];
  const page = () => ({
    ok: true,
    results,
    cursor:
      state.skip + results.length < hits.length
        ? Buffer.from(JSON.stringify({ ...state, skip: state.skip + results.length })).toString(
            "base64url",
          )
        : null,
  });
  for (const entry of hits.slice(state.skip, state.skip + options.limit)) {
    const scalars = excerpt(entry.text, query);
    let length = Math.min(scalars.length, 240);
    results.push({
      recordId: id(entry),
      kind: entry.kind,
      snippet: scalars.slice(0, length).join(""),
    });
    while (!fits(page(), options.maxBytes, options.json) && length > 0) {
      length = Math.floor(length / 2);
      const last = results.at(-1);
      if (last) last.snippet = scalars.slice(0, length).join("");
    }
    if (!fits(page(), options.maxBytes, options.json)) {
      results.pop();
      break;
    }
  }
  if (!results.length && state.skip < hits.length)
    fail("OUTPUT_OVERFLOW", "Recall metadata exceeds --max-bytes.");
  return page();
};
