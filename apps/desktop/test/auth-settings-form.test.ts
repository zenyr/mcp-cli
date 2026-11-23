import { expect, test } from "bun:test";
import {
  authChanged,
  formatStrings,
  parseStrings,
  stringsText,
  syncDraft,
} from "../src/auth-settings-form";

const typeEachKey = (input: string, start: string[] = []) => {
  let value: unknown = start;
  let text = formatStrings(start);
  for (const key of input) {
    text = stringsText(text, value) + key;
    value = parseStrings(text);
  }
  return { shown: stringsText(text, value), value };
};

test("typing a strings field key by key keeps commas and spaces", () => {
  expect(typeEachKey("chat:write, users:read")).toEqual({
    shown: "chat:write, users:read",
    value: ["chat:write", "users:read"],
  });
  expect(typeEachKey(" im:history", ["chat:write"]).value).toEqual(["chat:write", "im:history"]);
});

test("strings text round-trips through parse and format", () => {
  expect(parseStrings(formatStrings(["a:b", "c"]))).toEqual(["a:b", "c"]);
  expect(parseStrings("a:b,\n c ,, ")).toEqual(["a:b", "c"]);
  expect(formatStrings(undefined)).toBe("");
  expect(stringsText("a, ", ["x"])).toBe("x");
});

test("an external configuration replaces the draft only when the form is clean", () => {
  const base = { mcp: { clientId: "old" } };
  const next = { mcp: { clientId: "new" } };
  expect(syncDraft(base, next, { mcp: { clientId: "old" } })).toEqual(next);
  const typed = { mcp: { clientId: "typed" } };
  expect(syncDraft(base, next, typed)).toBe(typed);
});

test("verify and login state resets only when configuration or states change", () => {
  const auth = {
    configuration: { mcp: { clientId: "a" } },
    states: [{ target: "mcp", state: "missing" as const, detail: "" }],
  };
  expect(authChanged(auth, structuredClone(auth))).toBe(false);
  expect(
    authChanged(auth, {
      ...auth,
      states: [{ target: "mcp", state: "stored" as const, detail: "" }],
    }),
  ).toBe(true);
  expect(authChanged(auth, { ...auth, configuration: { mcp: { clientId: "b" } } })).toBe(true);
});

test("model options stay valid for manual model edits but reset when connection fields change", async () => {
  const { optionsKey } = await import("../src/auth-settings-form");
  const field = {
    path: ["model"],
    label: "Model",
    type: "text" as const,
    optionsSource: { label: "Load", dependencies: [["baseUrl"], ["headers"], ["apiKey"]] },
  };
  const base = { baseUrl: "https://example.invalid", headers: "{}", apiKey: "", model: "" };
  expect(optionsKey(field, { ...base, model: "manual-model" })).toBe(optionsKey(field, base));
  for (const patch of [{ baseUrl: "other" }, { headers: '{"X-Key":"x"}' }, { apiKey: "new" }])
    expect(optionsKey(field, { ...base, ...patch })).not.toBe(optionsKey(field, base));
});

test("JSON headers retain editable text and reject non-object JSON", async () => {
  const { jsonObjectError } = await import("../src/auth-settings-form");
  for (const text of ["", "{}", '{"X-Header":"value"}']) expect(jsonObjectError(text)).toBe(false);
  for (const text of ["{", "[]", "null", '"text"']) expect(jsonObjectError(text)).toBe(true);
});
