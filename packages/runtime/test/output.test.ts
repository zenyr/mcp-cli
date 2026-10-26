import { expect, test } from "bun:test";
import { parse } from "yaml";
import { formatOutput, formatResult, formatText } from "../src/output";

test("YAML preserves multiline strings, scalar types, and ambiguous strings", () => {
  const value = {
    text: "first\nsecond\n",
    noNewline: "first\nsecond",
    blankLines: "first\n\n",
    quoted: "true",
    number: "123",
    empty: "",
    items: [true, null, 12, { nested: "a: b" }],
  };
  const output = formatOutput(value);
  expect(output).toContain("text: |\n");
  expect(output).toContain("noNewline: |-\n");
  expect(parse(output)).toEqual(value);
});

test("tool text decodes JSON and leaves prose untouched", () => {
  expect(formatText('{"message":"hello\\nworld"}')).toBe("message: |-\n  hello\n  world");
  expect(formatText("plain text\n")).toBe("plain text\n");
  expect(formatText("{invalid}")).toBe("{invalid}");
});

test("JSON retains the full MCP envelope and YAML handles non-text content", () => {
  const result = { content: [{ type: "text", text: '{"ok":true}' }], isError: true };
  expect(JSON.parse(formatResult(result, true))).toEqual(result);
  expect(formatResult(result, false)).toBe("ok: true");
  expect(parse(formatResult({ content: [{ type: "image", data: "abc" }] }, false))).toEqual({
    type: "image",
    data: "abc",
  });
  expect(formatResult({ content: [], structuredContent: { ok: true } }, false)).toBe("ok: true");
});

test("final literal blocks preserve trailing spaces and blank lines with CLI newlines", () => {
  for (const text of ["a\nb ", "a\n\n", "a\n\n\n", "a\nb\n"]) {
    const output = formatOutput({ text });
    expect(parse(output)).toEqual({ text });
    expect(parse(`${output}\n`)).toEqual({ text });
  }
});
