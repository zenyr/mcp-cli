import { expect, test } from "bun:test";
import { InputValidationError, SchemaCompileError, validateInput } from "../src";

const textSchema = {
  type: "object",
  properties: { text: { type: "string" }, count: { type: "integer" } },
  required: ["text"],
};
const caught = (run: () => void): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
};

test("valid input passes", () => {
  expect(() => validateInput(textSchema, { text: "hi", count: 2 })).not.toThrow();
});

test("invalid input throws InputValidationError with structured issues", () => {
  const error = caught(() => validateInput(textSchema, { count: "x" }));
  expect(error).toBeInstanceOf(InputValidationError);
  expect(error).not.toBeInstanceOf(SchemaCompileError);
  expect(error).toHaveProperty("issues", [
    { path: "", message: "must have required property 'text'" },
    { path: "/count", message: "must be integer" },
  ]);
  expect(error).toHaveProperty("message", expect.stringContaining("Invalid input: input must"));
});

test("validator ignores inherited required input fields", () => {
  const input = Object.create({ text: "inherited" });
  expect(() => validateInput(textSchema, input)).toThrow(InputValidationError);
});

test("a schema that fails to compile throws SchemaCompileError", () => {
  const error = caught(() => validateInput({ type: "no-such-type" }, {}));
  expect(error).toBeInstanceOf(SchemaCompileError);
  expect(error).not.toBeInstanceOf(InputValidationError);
  expect(error).toHaveProperty("cause", expect.any(Error));
});

test("compiled validators are cached per schema object", () => {
  const schema: Record<string, unknown> = { type: "object", required: ["a"] };
  validateInput(schema, { a: 1 });
  schema.required = ["b"];
  expect(() => validateInput(schema, { a: 1 })).not.toThrow();
  expect(() => validateInput({ ...schema }, { a: 1 })).toThrow(InputValidationError);
});

test("2020-12 schemas compile and use 2020-12 keywords", () => {
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: { pair: { type: "array", prefixItems: [{ type: "string" }], items: false } },
    $defs: { unused: { type: "string" } },
  };
  expect(() => validateInput(schema, { pair: ["a"] })).not.toThrow();
  expect(() => validateInput(schema, { pair: ["a", "b"] })).toThrow(InputValidationError);
});

test("undeclared schemas use 2020-12 and still accept draft-07 tuple items", () => {
  const modern = { type: "object", properties: { pair: { prefixItems: [{ type: "string" }] } } };
  expect(() => validateInput(modern, { pair: [1] })).toThrow(InputValidationError);
  const legacy = { type: "object", properties: { pair: { items: [{ type: "string" }] } } };
  expect(() => validateInput(legacy, { pair: [1] })).toThrow(InputValidationError);
});

test("draft-07 schemas keep draft-07 semantics", () => {
  const schema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: { pair: { items: [{ type: "string" }], additionalItems: false } },
  };
  expect(() => validateInput(schema, { pair: ["a"] })).not.toThrow();
  expect(() => validateInput(schema, { pair: ["a", "b"] })).toThrow(InputValidationError);
});
