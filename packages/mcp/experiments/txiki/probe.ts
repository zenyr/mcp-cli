import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { Runtime } from "./runtime";
import { CallbackRejected, oauthProbe } from "./oauth";
import { serveStdio, stdioTransport } from "./stdio";

declare const BUILD_RUNTIME: "bun" | "txiki" | "auto";
const { runtime } =
  BUILD_RUNTIME === "bun" || (BUILD_RUNTIME === "auto" && typeof Bun !== "undefined")
    ? await import("./bun-runtime")
    : await import("./txiki-runtime");

const run = async (runtime: Runtime) => {
  const [command, url = "", path = ""] = runtime.args;
  if (command === "--stdio-server") return serveStdio(runtime);
  if (command === "oauth" || command === "oauth-rejected") {
    try {
      const result = await oauthProbe(runtime, url, path);
      if (command === "oauth-rejected") throw new Error("잘못된 인증 응답을 수락했습니다.");
      console.log(JSON.stringify({ runtime: runtime.name, ...result }));
    } catch (error) {
      if (command !== "oauth-rejected" || !(error instanceof CallbackRejected)) throw error;
      console.log(JSON.stringify({ runtime: runtime.name, rejected: true }));
    }
    return;
  }
  if (command !== "http" && command !== "stdio")
    throw new Error("http, oauth, oauth-rejected, stdio 중 하나를 지정하십시오.");
  const client = new Client(
    { name: "runtime-probe", version: "0.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  const transport =
    command === "http"
      ? new StreamableHTTPClientTransport(new URL(url), {
          fetch: async (input, init) => {
            const headers = new Headers(init?.headers);
            if (path) {
              const tokens: unknown = JSON.parse(await runtime.read(path));
              if (
                typeof tokens !== "object" ||
                tokens === null ||
                !("access_token" in tokens) ||
                typeof tokens.access_token !== "string"
              )
                throw new Error("저장한 토큰이 올바르지 않습니다.");
              headers.set("Authorization", `Bearer ${tokens.access_token}`);
            }
            return runtime.fetch(input, { ...init, headers });
          },
        })
      : stdioTransport(runtime);
  try {
    await client.connect(transport, { timeout: 3000 });
    const tools = await client.listTools();
    const result = await client.callTool({ name: "echo", arguments: { text: "한글🙂 HTTP" } });
    console.log(
      JSON.stringify({
        runtime: runtime.name,
        tools: tools.tools.map((tool) => tool.name),
        result,
      }),
    );
  } finally {
    await client.close();
  }
};

const deadline = setTimeout(() => runtime.exit(124), 15000);
try {
  await run(runtime);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  runtime.exit(1);
} finally {
  clearTimeout(deadline);
}
