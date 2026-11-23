import { isRecord, type AuthSettingsField } from "@mcp-cli/core";
import type { AuthStatus } from "@mcp-cli/core";

type AuthView = { configuration: Record<string, unknown>; states: AuthStatus[] };

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export const parseStrings = (text: string): string[] => text.split(/[,\s]+/).filter(Boolean);

export const formatStrings = (value: unknown): string =>
  Array.isArray(value) ? value.join(", ") : "";

// Keeps the typed text while it still parses to the stored value, so delimiters survive each keystroke.
export const stringsText = (text: string, value: unknown): string =>
  same(parseStrings(text), Array.isArray(value) ? value : []) ? text : formatStrings(value);

export const syncDraft = (
  base: Record<string, unknown>,
  next: Record<string, unknown>,
  draft: Record<string, unknown>,
): Record<string, unknown> => (same(base, draft) ? next : draft);

export const authChanged = (previous: AuthView, next: AuthView): boolean =>
  !same([previous.configuration, previous.states], [next.configuration, next.states]);

export const valueAt = (record: Record<string, unknown>, path: string[]): unknown => {
  let value: unknown = record;
  for (const key of path) value = isRecord(value) ? value[key] : undefined;
  return value;
};

export const updateAt = (
  record: Record<string, unknown>,
  path: string[],
  value: unknown,
): Record<string, unknown> => {
  const [key, ...rest] = path;
  if (!key) return record;
  const previous = record[key];
  return {
    ...record,
    [key]: rest.length ? updateAt(isRecord(previous) ? previous : {}, rest, value) : value,
  };
};

export const optionsKey = (
  field: AuthSettingsField,
  configuration: Record<string, unknown>,
): string =>
  JSON.stringify(field.optionsSource?.dependencies.map((path) => valueAt(configuration, path)));

export const jsonObjectError = (value: string): boolean => {
  if (!value.trim()) return false;
  try {
    return !isRecord(JSON.parse(value));
  } catch {
    return true;
  }
};
