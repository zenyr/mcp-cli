import { expect, test } from "bun:test";
import { AuthRequiredError, loginCommandText, loginRequired } from "../src/index";

test("login commands name the workspace, credential slot and browser flow in CLI order", () => {
  expect(loginCommandText("svc")).toBe("mcp-cli login svc");
  expect(loginCommandText("svc", { workspace: "two" })).toBe("mcp-cli login svc -w two");
  expect(loginCommandText("svc", { workspace: "two", credential: "xoxb", browser: true })).toBe(
    "mcp-cli login svc -w two --xoxb --browser",
  );
  expect(loginCommandText("svc", { browser: true, target: "web" })).toBe(
    "mcp-cli login svc --browser --web",
  );
});

test("login-required errors end with the targeted login command", () => {
  const error = loginRequired("svc", "No credentials for svc", { workspace: "two" });
  expect(error).toBeInstanceOf(AuthRequiredError);
  expect(error.message).toBe("No credentials for svc. Run mcp-cli login svc -w two");
});
