import { expect, test } from "bun:test";
import { currentTestResult, diagnosticText } from "../src/configuration-test-result";
import { translate } from "../shared/i18n";

test("test results disappear after any draft field changes", () => {
  const draft = {
    baseUrl: "https://example.test/v1",
    model: "m1",
    thinking: "default",
    apiKey: "key",
    headers: "{}",
  };
  const requestKey = JSON.stringify(draft);
  expect(currentTestResult(undefined, requestKey)).toBe(false);
  expect(currentTestResult(requestKey, JSON.stringify({ ...draft }))).toBe(true);
  for (const field of Object.keys(draft))
    expect(currentTestResult(requestKey, JSON.stringify({ ...draft, [field]: "changed" }))).toBe(
      false,
    );
});

test("diagnostic labels localize and extension labels remain readable", () => {
  expect(diagnosticText("Reasoning", (key) => translate("ko", key))).toBe("추론");
  expect(diagnosticText("Input tokens", (key) => translate("ja", key))).toBe("入力トークン");
  expect(diagnosticText("Custom check", (key) => translate("ko", key))).toBe("Custom check");
});
