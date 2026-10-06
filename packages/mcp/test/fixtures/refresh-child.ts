import { fileTokenStore } from "@mcp-cli/auth";
import { oauthAuthorize } from "../../src";

const [dir = "", url = "", refresh = "false"] = process.argv.slice(2);
const store = fileTokenStore({ dir, lock: { timeoutMs: 20000, pollMs: 5 } });
// Pretends an hour passed so the stored token counts as expired.
const authorize = oauthAuthorize({
  service: "svc",
  url,
  store,
  now: () => Date.now() + 3600 * 1000,
});
console.log(JSON.stringify(await authorize({ refresh: refresh === "true" })));
