# mcp-cli

MCP 도구 정의를 정적 코드로 생성하고, 필요한 범위만 발견할 수 있는 CLI로 실행합니다.
Bun workspaces와 Turborepo를 사용합니다. 서비스는 별도 플러그인 패키지로 추가합니다.

```text
MCP tools/list → tools.json → generated.ts (도구·입력 타입) ─┐
                                                             ├→ applyCustomizations → CLI
plugin commands (경로·설명·예시·규칙) ───────────────────────┘
```

Help, `methods`, `skill`은 생성된 파일과 플러그인만 읽습니다. 실제 명령 실행 시에만 서버에 연결합니다.
도구 이름을 추측해서 자연어 명령으로 바꾸지 않습니다. 플러그인이 명령 경로를 지정하고,
매핑하지 않은 도구는 `call <tool>`로 노출합니다.

## 시작

```bash
bun install
bun run generate demo
bun run cli --help
bun run cli demo --help
bun run cli demo message --help
bun run cli demo message echo --help
bun run cli demo message echo --text hello --count 2
bun run cli demo --json methods
bun run cli demo call demo-echo --input '{"text":"hello"}'
bun run check
```

`demo`는 저장소 안의 로컬 stdio MCP 서버입니다. 외부 계정 없이 생성과 실행을 확인할 수 있습니다.

## 패키지

`mem`의 첫 구현은 [별도 CLI 안내](apps/mem/README.md)를 따릅니다.
원문 저장, LLM 이진 요약 트리, 시작용 기억, 원문 검색과 페이지 조회를 제공합니다.

```bash
bun run mem start
bun run mem save --global '사용자의 확정한 결정'
bun run mem recall '결정'
```

| 경로               | 역할                                                           |
| ------------------ | -------------------------------------------------------------- |
| `packages/core`    | 플러그인·manifest·연결·호출 계약, 명령 매핑 적용               |
| `packages/codegen` | 도구 정의로 정적 코드 생성, 플러그인 매핑 사전 검증            |
| `packages/runtime` | 명령 탐색, help, 입력 처리, 정책 적용, 결과 출력               |
| `packages/schema`  | JSON Schema 입력 검증                                          |
| `packages/mcp`     | 공식 MCP 클라이언트를 이용한 stdio/Streamable HTTP 연결, OAuth |
| `packages/auth`    | 파일 기반 토큰 저장소와 프로세스 간 lock                       |
| `plugins/*`        | 서비스별 연결 설정, 명령 경로, 설명, 실행 전 정책              |
| `apps/cli`         | 플러그인 탐색, 생성·실행·로그인 명령                           |
| `apps/mem`         | 원문 저장, LLM 이진 요약 트리, 시작용 기억과 원문 조회         |

공통 실행기는 MCP SDK를 직접 가져오지 않습니다. 연결 구현은 SDK의 도구 정의와 결과를
공통 타입으로 변환합니다. 실행 테스트는 같은 호출 계약에 가짜 연결을 넣을 수 있습니다.

## 점진적 help

Notion CLI의 `Usage`, `Commands`, `Arguments`, `Options`, `Examples`, `Safety Rules` 구조를 참고했습니다.

- `demo --help`: 추천 명령(`Start here`), 명령 그룹, 발견 명령을 한 줄 설명과 함께 표시합니다.
- `demo message --help`: 해당 그룹의 하위 명령을 한 줄 설명과 함께 표시합니다.
- `demo message echo --help`: 해당 도구의 인자·타입·필수 여부·예시를 표시합니다.
- `demo methods message --json`: 해당 그룹의 도구 이름과 명령 경로만 표시합니다.
- `demo call --help`: 모든 도구의 MCP 이름과 첫 문장 요약을 표시합니다.
- `demo call demo-echo --help`: 같은 도구의 help를 원래 MCP 이름으로 찾습니다.
- `demo skill`: 플러그인의 서비스 사용 지침을 표시합니다.

루트 help에 모든 도구 스키마를 출력하지 않습니다.
`methods`도 스키마 대신 도구 이름·경로·요약만 출력합니다.

## 입력과 출력

```bash
bun run cli demo message echo --text '001' --uppercase
bun run cli demo message echo --text hello --no-uppercase
bun run cli demo message echo --text hello --parent.page-id abc
bun run cli demo message echo --input '{"text":"hello","labels":["a","b"]}'
bun run cli demo message echo --input-file ./input.json
printf '{"text":"hello"}' | bun run cli demo message echo --input -
bun run cli demo message echo --text=hello --count=2
```

문자열 필드는 숫자처럼 보여도 문자열로 유지합니다. `--page-id`는 스키마의 `page_id`로 대응합니다.
객체와 배열은 JSON 값을 받습니다. 중복 플래그는 거부합니다. 배열은 JSON 배열로 지정합니다.
`--key=value`는 `--key value`와 같습니다. 값이 `--`로 시작하면 `=` 형식을 사용하십시오.
nullable 필드는 `--x null`로 `null`을 지정합니다. 문자열 필드는 `null`을 문자열로 유지합니다.
`--input-file -`은 `--input -`처럼 stdin을 읽습니다. 파일을 읽지 못하면 사용 오류를 반환합니다.
JSON 입력, 파일 입력, 개별 플래그는 혼합할 수 없습니다. `--input`을 반복하면 사용 오류를 반환합니다.
옵션 종료 표시 `--`는 지원하지 않습니다.
기본 `call <tool-name>` 경로는 도구 이름을 그대로 씁니다. 그래서 `.`나 `/`가 든 이름도 매핑 없이 동작합니다.
플러그인이 지정한 `path` 구간은 `[A-Za-z0-9_-]+` 형식이어야 합니다.
생성 코드가 없거나 오래되었으면 CLI는 상태 1로 끝나고 `mcp-cli generate <service>` 실행을 안내합니다.
플래그 형식이 전역 플래그(`--json`, `--help`, `--input`, `--input-file`)와 같은 속성은 `--input`으로만 지정합니다.
help는 이 속성을 `set via --input only`로 표시합니다. `_`는 `-`로 바꿔 비교합니다.
복잡한 `$ref`·조합 스키마의 입력은 `--input`을 사용하십시오. 전체 입력은 JSON Schema로 검증합니다.
`$schema`가 없거나 2020-12이면 2020-12 규칙을 사용합니다. draft-07 선언과 draft-07 전용 스키마는 draft-07로 검증합니다.

기본 출력은 MCP의 텍스트 블록입니다. `--json`은 MCP 결과 전체를 보존합니다.
도구가 `isError`를 반환하면 텍스트 결과를 stderr에 출력하고 종료 코드 `1`을 반환합니다. stdout은 비어 있습니다.
`--json`을 지정하면 `isError` 결과도 stdout에 JSON으로 출력합니다. 종료 코드는 `1`입니다.
CLI 사용 오류(`UsageError`)는 종료 코드 `2`, 연결·실행 오류는 `1`을 반환합니다.
알 수 없는 명령, 잘못된 플래그·값, 입력 출처 혼합, 입력 스키마 검증 실패는 사용 오류입니다.
입력 검증과 플러그인 정책이 통과한 뒤 서버에 연결합니다. 호출 종료 시 연결을 닫습니다.

## 리소스와 프롬프트

```bash
bun run cli demo resources list
bun run cli demo resources templates
bun run cli demo resources read demo://readme
bun run cli demo prompts list
bun run cli demo prompts get summarize --text hello --style short
bun run cli demo prompts get summarize --input '{"text":"hello"}' --json
```

`resources`와 `prompts`는 실행할 때 서버에서 목록과 내용을 가져옵니다. 생성 코드에는 넣지 않습니다.
두 명령은 서버에 연결합니다. `--help`와 `help resources`는 연결하지 않습니다.
목록은 서버의 `nextCursor`를 끝까지 따라가서 모든 페이지를 합칩니다.
서버가 해당 capability를 알리지 않으면 `MissingResourcesCapabilityError` 또는
`MissingPromptsCapabilityError`로 실패합니다. 빈 목록으로 대체하지 않습니다. 종료 코드는 `1`입니다.

- `resources read <uri>`: 텍스트는 그대로 출력합니다. 바이너리는 안내 문구를 출력합니다. `--json`으로 base64를 받으십시오.
- `prompts get <name>`: 먼저 `prompts/list`에서 프롬프트의 `arguments`를 읽습니다.
  인자는 `--<name> value` 또는 `--input` JSON 객체로 지정합니다. 값은 모두 문자열입니다.
- 알 수 없는 프롬프트, 알 수 없는 인자, 누락된 필수 인자는 사용 오류(종료 코드 `2`)입니다.
- `--json`은 `resources`·`prompts` 결과를 구조화된 JSON으로 출력합니다.

플러그인 명령 경로는 `resources`나 `prompts`로 시작할 수 없습니다.

## 정적 생성

```bash
# 서버에서 도구 정의를 읽습니다.
bun run generate demo

# 저장한 정의만 사용합니다. 서버에 연결하지 않습니다.
bun run generate demo --snapshot plugins/demo/src/tools.json

# 파일을 쓰지 않고 변경 여부를 검사합니다.
bun run generate demo --snapshot plugins/demo/src/tools.json --check
```

생성 결과는 플러그인의 `src/tools.json`과 `src/generated.ts`입니다.
CLI는 플러그인 패키지의 `package.json` 위치로 출력 경로를 찾습니다.
생성 결과에는 서버에서 받은 도구 정의와 입력 타입만 들어갑니다. 생성 manifest의 `version`은 `2`입니다.
실행 시에는 `@mcp-cli/plugin-<service>/generated` export로 manifest를 읽고 `decodeManifest`로 검증합니다.
그다음 `applyCustomizations`가 플러그인의 `commands`를 적용합니다.
플러그인의 경로·설명·예시·규칙을 바꾸면 다시 생성하지 않아도 다음 실행에 반영됩니다.
`version: 1` 생성 결과는 사용 오류로 거부합니다. `mcp-cli generate <service>`로 다시 생성하십시오.
도구 이름순으로 정렬하므로 서버가 목록 순서를 바꿔도 같은 `tools.json`과 코드를 생성합니다.
서버가 도구를 하나도 반환하지 않으면 생성은 실패합니다.
명령 경로 중복, 상위·하위 명령 충돌, 예약 명령 충돌, 존재하지 않는 도구 매핑은 오류입니다.
`applyCustomizations`가 이 검사를 생성 시와 실행 시에 모두 실행합니다.
같은 플러그인을 동시에 생성하는 작업은 실행하지 마십시오.

생성 코드는 호출 함수를 내보내지 않습니다. 도구 호출은 입력 검증과 `beforeCall` 정책을 적용하는 `runService`만 거칩니다.
도구별 입력 타입(`DemoEchoInput` 등)은 타입 참조용으로 export합니다.

## 전역 명령

루트에서 `bun link`를 한 번 실행하면 `mcp-cli`와 서비스별 명령이 `~/.bun/bin`에 연결됩니다.
서비스 명령은 `mcp-cli <service>`와 같습니다. 예: `notion page get --help`.

플러그인 `package.json`의 `"mcp-cli"` 표식에 `"bin": "<name>"`을 넣으면 서비스 명령이 생깁니다.
`bun run bins`가 루트 `bin` 필드와 `bin/<name>.ts` shim을 다시 씁니다. `bun run lint`는 둘이 맞는지 검사합니다.
bin을 추가하거나 지운 뒤에는 `bun link`를 다시 실행하십시오.

## 플러그인 추가

1. `plugins/<service>`에 workspace 패키지를 만듭니다.
   `exports`의 `.`이 플러그인 모듈을 가리키게 합니다.
2. `package.json`에 `"mcp-cli": { "plugin": true, "service": "<service>" }`를 선언합니다.
   `service`를 생략하면 CLI가 플러그인 모듈을 읽어 `name`을 사용합니다.
3. `@mcp-cli/core`의 `definePlugin`으로 기본 export를 만듭니다. `name`은 `service`와 같아야 합니다.
4. `bun run generate <service>`로 정적 정의를 생성합니다.
5. `bun run cli plugins`로 발견 결과와 생성 상태를 확인합니다.

CLI 패키지에 플러그인 의존성을 추가하지 않습니다. CLI는 다음 위치에서 표시가 있는 패키지를 찾습니다.

1. 루트 `package.json`의 `workspaces` 패키지
2. CLI 위쪽 `node_modules`의 직접 항목과 scope 디렉터리 한 단계
3. 사용자 설정 파일의 `plugins` 목록

설정 파일 위치는 `$MCP_CLI_CONFIG`, 없으면 `$XDG_CONFIG_HOME/mcp-cli/config.json`입니다.
기본값은 `~/.config/mcp-cli/config.json`입니다. 항목은 패키지 이름 또는 절대·`~` 경로입니다.

```json
{ "plugins": ["@acme/mcp-cli-plugin-linear", "~/src/mcp-cli-plugin-slack"] }
```

설정 파일 오류는 사용법 오류(종료 코드 2)이며 메시지에 파일 경로가 들어갑니다.
같은 서비스 이름이 두 곳에서 발견되면 두 위치를 모두 보여 주고 실패합니다.
`help`, `generate`, `plugins`, `login`, `logout`은 서비스 이름으로 쓸 수 없습니다.

생성 파일은 패키지 디렉터리에 쓸 수 있으면 `src/generated.ts`, `src/tools.json`에 둡니다.
`node_modules` 안의 패키지처럼 쓸 수 없으면 `$XDG_CACHE_HOME/mcp-cli/<service>/`에 둡니다.
기본값은 `~/.cache/mcp-cli/<service>/`입니다. 실행 시에는 패키지 위치를 먼저 확인하고 다음으로 캐시를 확인합니다.

```typescript
import { definePlugin } from "@mcp-cli/core";

export default definePlugin({
  name: "issues",
  summary: "Issue tracking tools",
  commands: {
    "search-issues": {
      path: ["issue", "search"],
      summary: "Search issues",
      examples: ["issues issue search --query bug"],
    },
  },
  groups: { issue: "Find and inspect issues" },
  quickstart: [{ command: "issue search --query bug", summary: "Find open bugs" }],
  connection: () => ({ type: "stdio", command: "issue-mcp" }),
});
```

`commands`에서 설명, 예시, 주의사항을 보강할 수 있습니다.
`summary`를 지정하면 원래 도구 설명은 명령 help의 본문에 표시됩니다.
`groups`는 공백으로 이은 그룹 경로(`"media image"`)에 한 줄 설명을 붙입니다.
`quickstart`는 루트 help의 `Start here`에 표시할 추천 명령입니다.
없는 그룹이나 명령을 가리키는 `groups`, `quickstart` 항목은 실행 시 오류로 처리합니다.
서버가 권한에 따라 도구를 숨기면 해당 매핑에 `optional: true`를 지정하십시오.
그 도구가 없으면 매핑을 건너뛰고, 관련 `groups`와 `quickstart` 항목도 help에서 뺍니다.
`beforeCall(command, input)`은 서비스별 실행 전 검사를 넣는 위치입니다.
매핑 명령과 `call` 명령 모두 같은 검사를 거칩니다.
`connection(env)`은 실행 시에 환경변수를 읽습니다. `Promise`를 반환해도 됩니다. 인증 정보는 생성 결과에 넣지 않습니다.

## Fish Audio 음성 제작

`tts`·`stt` 편의 alias와 `script`·`roundtrip` 워크플로를 제공합니다.
긴 원고 분할, 예산 예약, 캐시 재개, 오디오 변환과 텍스트 비교는 [사용 안내](plugins/fish-audio/README.md)를 따르십시오.
기존 `speech create`, `transcription create`, `call`은 기존 MCP 인터페이스를 유지합니다.

## 로컬 파일 업로드

플러그인이 `uploads`로 지정한 URL 필드는 `@경로` 값을 로컬 파일로 해석합니다.
그 밖의 필드에서는 `@`를 그대로 보냅니다. 파일 내용을 값으로 넣을 때는 `--input -`이나 `--input-file`을 쓰십시오.

```bash
fish-audio transcription create --audio-url @./meeting.m4a
fish-audio voice clone --audio-urls '["@./a.wav","@./b.wav"]' --confirm-voice-rights
```

- CLI는 서버에 연결하기 전에 파일을 모두 읽습니다. 읽지 못하면 사용 오류(종료 코드 2)입니다.
- 업로드 필드의 `format`과 `pattern` 제약은 업로드 후 실제 URL로 검사합니다.
  업로드 필드는 이 제약을 필드에 직접 둬야 합니다. `allOf`, `anyOf`, `oneOf`, `not`, `$ref`, `if`가 있으면 선언을 거부합니다.
- 플러그인의 `uploadFile(file, { callTool, putBytes })`가 업로드 위치를 정하고 툴에 넘길 URL을 반환합니다.
  플러그인은 네트워크를 직접 쓰지 않습니다. HTTP PUT은 CLI의 `putBytes` adapter가 수행합니다.
- 중복 실행 키는 업로드 URL 대신 파일 내용의 SHA-256으로 계산합니다. 거부된 호출은 업로드하지 않습니다.
- 연결이나 업로드가 실패하면 툴을 호출하지 않았으므로 같은 호출을 다시 허용합니다.
- PUT 오류 메시지에는 서명된 업로드 URL을 넣지 않습니다.

## 중복 실행 방지

`readOnlyHint`나 `idempotentHint`가 `true`가 아닌 도구는 같은 입력으로 다시 호출하면 거부합니다.
annotation이 없는 도구도 거부 대상입니다. 거부는 서버에 연결하기 전에 일어나고 종료 코드는 `3`입니다.

- 판정 키는 서비스, 도구 이름, 정규화한 입력의 SHA-256입니다.
- 이전 호출이 성공했거나 결과를 모르는 상태(타임아웃, 강제 종료)면 거부합니다. 서버가 오류를 반환했으면 허용합니다.
- 기본 기간은 5분입니다. `MCP_CLI_REPEAT_WINDOW`(초)로 바꾸고 `0`이면 끕니다.
- `--allow-repeat`는 한 번만 검사를 건너뜁니다.
- 기록은 `$XDG_STATE_HOME/mcp-cli/calls/<service>.json`(기본 `~/.local/state/...`)에 둡니다.

## 인증

플러그인은 `auth`로 인증 방식을 선언합니다. CLI가 실행 시에 자격 증명을 연결에 넣습니다.

| `auth`                                    | 동작                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| `{ type: "oauth" }`                       | `mcp-cli login <service>`로 받은 토큰을 요청마다 `Authorization`에 넣습니다         |
| `{ type: "apiKey", env: "FISH_API_KEY" }` | 환경변수나 `mcp-cli login`으로 저장한 키를 `Authorization: Bearer <key>`로 보냅니다 |
| `{ type: "none" }` 또는 생략              | 자격 증명을 넣지 않습니다                                                           |

```bash
mcp-cli login notion    # 브라우저 로그인 후 토큰 저장
mcp-cli logout notion   # 저장한 토큰 삭제
```

- `login`은 MCP 인증 사양의 순서를 따릅니다.
  protected resource metadata, authorization server metadata, 동적 클라이언트 등록, PKCE 순서입니다.
- redirect URI는 `http://127.0.0.1:<임의 포트>/callback`입니다. CLI는 인증 URL을 stderr에 출력하고 브라우저를 엽니다.
- 브라우저를 열 수 없는 환경에서는 `mcp-cli login <service> --no-browser`를 실행하십시오.
  CLI는 URL만 출력합니다. 다른 기기에서 URL을 열어 승인하십시오.
  승인 후 이동한 `127.0.0.1` 주소가 열리지 않아도 됩니다. 그 주소 전체를 터미널에 붙여 넣으면 로그인이 끝납니다.
- `MCP_CLI_NO_BROWSER=1`, SSH 세션, `DISPLAY`가 없는 Linux에서는 브라우저를 자동으로 열지 않습니다.
- `login`은 `state`를 검사합니다. 5분 안에 응답이 없으면 실패합니다.
- `oauth`의 `clientId`를 지정하면 동적 등록을 건너뜁니다. `scopes`, `clientName`, `redirectPort`도 지정할 수 있습니다.
- `apiKey`의 `header`를 지정하면 scheme 없이 키만 보냅니다. `scheme`으로 접두어를 지정할 수 있습니다.
- `apiKey` 서비스의 `mcp-cli login <service>`는 키를 숨김 입력으로 받거나 파이프의 표준 입력에서 읽어 저장합니다.
  환경변수가 있으면 저장한 키보다 우선합니다. `mcp-cli logout <service>`가 저장한 키를 지웁니다.
- `apiKey.alternates`는 같은 서비스의 다른 키를 선언합니다. 실행할 때 `--<flag>`로 고르고,
  로그인과 로그아웃에도 같은 플래그를 붙입니다. 예: Slack의 `--xoxb`(`SLACK_MCP_BOT_TOKEN`).
  stdio 연결에는 같은 이름의 환경변수로 키를 전달합니다.
- 토큰은 `$XDG_CONFIG_HOME/mcp-cli/credentials/<service>.json`에 저장합니다. `XDG_CONFIG_HOME`이 없으면 `~/.config`를 씁니다.
  디렉터리 권한은 `0700`, 파일 권한은 `0600`입니다. 임시 파일에 쓴 뒤 rename으로 교체합니다.
- 만료 60초 전부터 또는 서버가 401을 반환하면 refresh token으로 갱신합니다.
  갱신은 `<service>.lock`에 건 커널 `flock` 안에서 실행합니다. 여러 프로세스가 동시에 실행해도 갱신 요청은 한 번입니다.
  잠금을 잡은 프로세스가 비정상 종료하면 커널이 잠금을 바로 해제합니다. lock 파일은 지우지 않고 남겨 둡니다.
  `flock`이 없는 플랫폼은 heartbeat lock 파일을 씁니다. 15초 동안 갱신되지 않은 lock을 회수합니다.
- 자격 증명이 없거나 refresh token이 거부되면 CLI는 `mcp-cli login <service>` 실행을 안내하고 상태 1로 끝납니다.
- 다른 서버 URL에서 발급한 토큰은 보내지 않습니다. URL을 바꾸면 다시 로그인하십시오.
- 연결이 `authorize`를 직접 제공하면 CLI는 저장한 토큰을 쓰지 않습니다.
  Notion은 `NOTION_MCP_TOKEN`이 있으면 이 값을 우선합니다.
- `logout`은 로컬 파일만 삭제합니다. 서버의 토큰 폐기(revocation)는 요청하지 않습니다.

MCP SDK의 OAuth 함수는 `packages/mcp`만 사용합니다. 저장소는 `packages/auth`가, 계약 타입은 `packages/core`가 제공합니다.

## 현재 범위

- 생성·발견·입력 검증·호출·종료까지 `demo`로 통합 검증합니다.
- stdio와 Streamable HTTP 연결을 제공합니다. 현재 실제 연결 테스트는 stdio에 한정합니다.
- Notion, Linear, Slack, Fish Audio 플러그인은 실제 서버에서 생성한 정의와 명사-동사 명령 매핑을 포함합니다.
- Notion·Linear·Fish Audio는 `mcp-cli login <service>`로 저장한 OAuth 토큰으로 생성하고 호출합니다.
- Slack 서버는 DCR을 지원하지 않습니다. 내부 앱의 사용자 토큰(`xoxp`)을 `mcp-cli login slack`으로 저장하거나
  `SLACK_MCP_TOKEN`에 넣으십시오. 봇 토큰(`xoxb`)은 `mcp-cli login slack --xoxb`로 저장하고 명령에 `--xoxb`를 붙입니다.
  앱 설정의 Agents & AI Apps(`app-assistant`)에서 MCP 접근을 켜야 합니다.
  Slack은 토큰의 User Token Scope에 맞는 툴만 제공합니다. scope를 바꾸면 다시 생성하십시오.
- 기존 Notion CLI의 markdown spec 검사, 수정 보호, widget 기능은 아직 이전하지 않았습니다.
- SSE, MCP resources/prompts의 CLI 생성은 아직 지원하지 않습니다.

`NOTION_MCP_TOKEN`, `LINEAR_MCP_TOKEN`은 저장한 토큰보다 우선합니다. `*_MCP_URL`로 URL을 바꿀 수 있습니다.
HTTP 연결은 요청마다 `authorize`에서 헤더를 받습니다.
서버가 401을 반환하면 `authorize({ refresh: true })`를 한 번 호출하고 한 번만 재시도합니다.

```bash
bun run cli login notion
bun run generate notion
bun run cli login slack
bun run generate slack
bun run cli notion page get --help
```

## 워크트리

새 워크트리에서는 아래 두 명령으로 개발 환경을 준비합니다. T3 Code 워크트리 생성 스크립트에 등록하면 자동으로 실행됩니다.

```bash
bun i
bun scripts/worktree.ts init
```

- `init`은 bun 버전과 `node_modules`를 확인하고, git hook이 없으면 설치합니다.
  전역 `mcp-cli` 링크가 이 워크트리를 가리키면 경고합니다.
- `clean`은 `node_modules`, `.turbo`, `dist`처럼 git이 무시하는 산출물만 지웁니다.
  전역 링크가 이 워크트리를 가리키면 `bun unlink`도 실행합니다.
- `clean`은 메인 체크아웃에서는 `--force` 없이 실행되지 않습니다. `--dry-run`은 지울 대상만 출력합니다.
- 워크트리에서는 `bun link`를 실행하지 마십시오. 전역 명령이 워크트리를 가리키게 됩니다.

## 커밋 품질 검사

`bun install`의 `prepare`에서 Lefthook을 설치합니다.
커밋 전에는 staged 파일에 oxfmt를 자동 적용하고 변경 파일을 다시 stage합니다.
그다음 oxlint와 코드 규칙 검사를 실행합니다.
포맷 차이만으로 커밋을 멈추지 않습니다. 린트 오류는 수정해야 합니다.

- 커밋 메시지에는 scope가 필요합니다. 예: `feat(runtime): add progressive help`.
- 함수 구현은 arrow function만 허용합니다.
- `any`, `as unknown`, non-null assertion은 금지합니다.
- 생성 코드는 문법 제한과 수동 포맷에서 제외합니다.
- 일반 소스는 350라인 초과 시 경고합니다. 테스트와 fixture는 예외입니다.
- `bun run check`는 품질 도구 자체의 테스트도 실행합니다.

## Desktop prototype and connection daemon

`apps/desktop` provides a tinyjs tray app with React, TanStack Router, TanStack Query, and Mantine UI.
See [desktop setup](apps/desktop/README.md) for development, native builds, and authentication controls.

```sh
bun run cli daemon start
# In another terminal:
MCP_CLI_DAEMON=1 bun run cli demo message echo --text hello
bun run cli daemon status
bun run cli daemon reset
bun run cli daemon stop
```

Daemon mode is opt-in and preserves command output and exit codes.
Without `MCP_CLI_DAEMON=1`, commands keep using direct connections.
The daemon keeps at most 32 connections and closes each after 60 seconds without requests.
Reset and shutdown wait for active requests, and failed tool calls are not retried.
The daemon uses authenticated local IPC and accepts an absolute `MCP_CLI_DAEMON_DIR` override.
The current prototype does not automatically recover ownership files after a crash.
