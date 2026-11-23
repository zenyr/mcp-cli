import { expect, test } from "bun:test";
import { requestErrorMessage } from "../src/request-error";

test("request failures always have readable text", () => {
  for (const error of [new Error(), { message: " " }, null, undefined, {}])
    expect(requestErrorMessage(error)).toContain("Request failed");
  expect(requestErrorMessage({ message: "Invalid API URL" })).toBe("Invalid API URL");
  expect(requestErrorMessage("Network unavailable")).toBe("Network unavailable");
});
