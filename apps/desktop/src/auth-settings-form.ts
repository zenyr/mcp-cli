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
