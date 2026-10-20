import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { isRecord } from "@mcp-cli/core";
import { startHttpFixture } from "../../test/fixtures/http";
import { startFakeAuthServer } from "../../test/fixtures/oauth";

const check: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--stdio-only")) throw new Error("허용한 옵션: --stdio-only");
const stdioOnly = args.includes("--stdio-only");
const tjs = process.env.TJS_BIN || Bun.which("tjs") || join(homedir(), ".tinyjs", "bin", "tjs");
if (!(await Bun.file(tjs).exists()))
  throw new Error("TJS_BIN에 txiki.js 실행 파일의 경로를 지정하십시오.");
const directory = await mkdtemp(join(tmpdir(), "mcp-runtime-probe-"));
const entry = join(import.meta.dir, "probe.ts");
const execute = async (args: string[], env = process.env) => {
  const child = Bun.spawn(args, { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill("SIGKILL"), 20000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0)
      throw new Error(`실행 실패 (${code}, ${args.slice(1).join(" ")}): ${stderr} ${stdout}`);
    return stdout.trim();
  } finally {
    clearTimeout(timer);
  }
};
const http = startHttpFixture([], () => true);
const auth = startFakeAuthServer();
const authenticated = startHttpFixture(
  ["authorization"],
  (headers) => headers.get("authorization") === `Bearer ${auth.current().access}`,
);
type CaseResult = { name: string; passed: boolean; error?: string };
const outputs: Array<{ runtime: string; bytes: number; cases: CaseResult[] }> = [];
const echo = (value: Record<string, unknown>, expected: string) => {
  check(Array.isArray(value.tools) && value.tools.includes("echo"), "도구 목록 조회 실패");
  check(isRecord(value.result) && Array.isArray(value.result.content), "도구 응답 오류");
  check(
    value.result.content.some((item) => isRecord(item) && item.text === expected),
    "도구 호출 결과 불일치",
  );
};
try {
  for (const name of ["bun", "bun-auto", "txiki"] as const) {
    const binary = join(directory, `probe-${name}`);
    const define = `BUILD_RUNTIME=${JSON.stringify(name === "bun-auto" ? "auto" : name)}`;
    if (name !== "txiki") {
      await execute([
        process.execPath,
        "build",
        entry,
        "--compile",
        "--outfile",
        binary,
        "--define",
        define,
      ]);
    } else {
      const script = `${binary}.js`;
      await execute([
        process.execPath,
        "build",
        entry,
        "--target=browser",
        "--outfile",
        script,
        "--define",
        define,
      ]);
      const bundled = await Bun.file(script).text();
      check(
        !bundled.includes('from "node:') && !bundled.includes("Bun.spawn"),
        "txiki 결과에 Bun 구현이 남았습니다.",
      );
      await execute([tjs, "compile", script, binary]);
    }
    const env = { ...process.env, PATH: directory };
    const run = async (...args: string[]) => {
      console.error(`[${name}] ${args[0]}`);
      const output = await execute([binary, ...args], env);
      check(!/access-\d|refresh-\d/.test(output), "표준 출력에 토큰이 포함됐습니다.");
      const result: unknown = JSON.parse(output);
      check(isRecord(result), "검증 결과가 객체가 아닙니다.");
      check(
        result.runtime === (name === "bun-auto" ? "bun" : name),
        "선택한 런타임이 일치하지 않습니다.",
      );
      return result;
    };
    const cases: CaseResult[] = [];
    const scenario = async (name: string, run: () => Promise<void>) => {
      try {
        await run();
        cases.push({ name, passed: true });
      } catch (error) {
        cases.push({
          name,
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };
    if (!stdioOnly) {
      await scenario("http", async () => echo(await run("http", http.url), "한글🙂 HTTP"));
      const credentials = join(directory, `${name}-tokens.json`);
      await scenario("oauth", async () => {
        auth.redirect = {};
        const before = auth.refreshCount();
        const oauth = await run("oauth", auth.resource, credentials);
        check(
          oauth.callback === true && oauth.persisted === true && oauth.rotated === true,
          "OAuth 저장·갱신 실패",
        );
        check(auth.refreshCount() === before + 1, "OAuth 갱신 요청 수 불일치");
        check(
          auth.registrations.at(-1)?.token_endpoint_auth_method === "none",
          "공개 클라이언트 등록 실패",
        );
        check(
          auth.authorizeRequests.at(-1)?.get("code_challenge_method") === "S256",
          "PKCE 검증 누락",
        );
        if (process.platform !== "win32")
          check(((await stat(credentials)).mode & 0o777) === 0o600, "토큰 파일 권한 오류");
        echo(await run("http", authenticated.url, credentials), "한글🙂 HTTP");
      });
      for (const redirect of [{ state: "forged" }, { error: "access_denied" }]) {
        const reason = Object.keys(redirect)[0];
        await scenario(`oauth-rejected-${reason}`, async () => {
          auth.redirect = redirect;
          const untouched = join(directory, `${name}-${reason}.json`);
          check(
            (await run("oauth-rejected", auth.resource, untouched)).rejected === true,
            "잘못된 인증 응답을 수락했습니다.",
          );
          check(!(await Bun.file(untouched).exists()), "거부한 인증의 토큰을 저장했습니다.");
        });
      }
    }
    await scenario("stdio", async () => echo(await run("stdio"), "한글🙂 stdio"));
    outputs.push({ runtime: name, bytes: (await stat(binary)).size, cases });
  }
  const passed = outputs.every((output) => output.cases.every((item) => item.passed));
  console.log(JSON.stringify({ passed, pathContainsBun: false, results: outputs }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  await Promise.all([http.stop(), auth.stop(), authenticated.stop()]);
  await rm(directory, { recursive: true, force: true });
}
