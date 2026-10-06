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
