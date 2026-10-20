# MCP CLI 사용 안내

MCP 서버의 도구를 정적 명령으로 탐색하고 실행하는 `mcp-cli`의 사용법입니다.
명령은 저장소 루트에서 실행합니다. `mem`은 별도 CLI이며 [자체 안내](../mem/README.md)를 따릅니다.

## 독립 실행 파일

`bun run --cwd apps/cli build`로 `apps/cli/dist/mcp-cli`를 만듭니다.
이 명령은 개발자가 빌드할 때 사용합니다. 만들어진 실행 파일의 사용자는 Bun이나 소스 저장소가 필요하지 않습니다.
기본 플러그인과 도구 정의는 실행 파일에 포함됩니다. 새 도구 정의는 사용자 캐시에 저장합니다.
현재 빌드를 실행한 운영체제와 CPU용 실행 파일을 만듭니다.

## 시작

최초 실행 시 설정 폴더를 자동으로 만듭니다. 기본 위치는 `~/.config/mcp-cli`입니다.
`XDG_CONFIG_HOME`이나 `MCP_CLI_CONFIG`를 지정하면 해당 설정 파일의 상위 폴더를 만듭니다.
기존 설정 파일은 변경하지 않습니다.

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

## 점진적 도움말

- `demo --help`: 추천 명령(`Start here`), 명령 그룹, 발견 명령을 한 줄 설명과 함께 표시합니다.
- `demo message --help`: 해당 그룹의 하위 명령을 한 줄 설명과 함께 표시합니다.
- `demo message echo --help`: 해당 도구의 인자·타입·필수 여부·예시를 표시합니다.
- `demo message echo --help=full`: 서버 설명 원문과 중첩된 입력·출력 JSON Schema까지 표시합니다.
- `demo methods message --json`: 해당 그룹의 도구 이름과 명령 경로만 표시합니다.
- `demo call --help`: 모든 도구의 MCP 이름과 첫 문장 요약을 표시합니다.
- `demo call demo-echo --help`: 같은 도구의 help를 원래 MCP 이름으로 찾습니다.
- `demo skill`: 플러그인의 서비스 사용 지침을 표시합니다.

루트와 그룹 help는 하위 명령과 한 줄 요약만 표시합니다.
개별 명령의 기본 help는 서버 설명 원문을 생략하고 인자 설명을 첫 문장, 최대 160자로 줄입니다.
`methods`는 도구 이름·경로와 help와 같은 최대 80자 요약을 표시합니다.
전체 스키마와 서버 원문은 `--help=full`에서 확인합니다. 이 명령도 서버에 연결하지 않습니다.

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

## 전역 명령

루트에서 `bun link`를 한 번 실행하면 `mcp-cli`와 서비스별 명령이 `~/.bun/bin`에 연결됩니다.
서비스 명령은 `mcp-cli <service>`와 같습니다. 예: `notion page get --help`.

플러그인 `package.json`의 `"mcp-cli"` 표식에 `"bin": "<name>"`을 넣으면 서비스 명령이 생깁니다.
`bun run bins`가 루트 `bin` 필드와 `bin/<name>.ts` shim을 다시 씁니다. `bun run lint`는 둘이 맞는지 검사합니다.
bin을 추가하거나 지운 뒤에는 `bun link`를 다시 실행하십시오.

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

## 연결 대몬

```sh
bun run cli daemon start
# 다른 터미널에서 실행합니다.
MCP_CLI_DAEMON=1 bun run cli demo message echo --text hello
bun run cli daemon status
bun run cli daemon reset
bun run cli daemon stop
```

`MCP_CLI_DAEMON=1`을 지정하면 대몬 연결을 사용합니다. 출력과 종료 코드는 직접 연결과 같습니다.
지정하지 않으면 명령마다 직접 연결합니다.
대몬은 최대 32개 연결을 유지하고, 요청이 없는 연결은 60초 뒤 닫습니다.
초기화와 종료는 진행 중인 요청을 기다립니다. 실패한 도구 호출은 재시도하지 않습니다.
대몬은 인증된 로컬 IPC를 사용합니다. `MCP_CLI_DAEMON_DIR`로 절대 경로를 지정할 수 있습니다.
현재 시제품은 비정상 종료 후 남은 소유권 파일을 자동으로 복구하지 않습니다.
트레이 앱은 [데스크톱 안내](../desktop/README.md)를 참고하십시오.

## 현재 지원 범위

생성, 탐색, 입력 검증, 호출과 종료는 로컬 `demo`로 통합 검증합니다.
stdio와 Streamable HTTP 연결을 제공하지만, 실제 연결 테스트는 stdio에 한정합니다.
Notion, Linear, Slack과 Fish Audio는 실제 서버에서 생성한 정의와 명사·동사 명령 매핑을 포함합니다.
Notion, Linear와 Fish Audio는 `mcp-cli login <service>`로 저장한 OAuth 토큰을 사용합니다.
서비스별 인증 조건은 각 플러그인 안내를 참고하십시오.

기존 Notion CLI의 마크다운 명세 검사, 수정 보호와 위젯 기능은 아직 이전하지 않았습니다.
SSE 연결과 리소스·프롬프트의 CLI 코드 생성은 지원하지 않습니다.
리소스와 프롬프트는 실행 시 서버에서 조회합니다.

`NOTION_MCP_TOKEN`과 `LINEAR_MCP_TOKEN`은 저장한 토큰보다 우선합니다.
`*_MCP_URL`로 서버 URL을 바꿀 수 있습니다.
HTTP 연결은 요청마다 `authorize`에서 헤더를 받습니다.
서버가 401을 반환하면 `authorize({ refresh: true })`를 한 번 호출한 뒤 한 번만 재시도합니다.

```sh
bun run cli login notion
bun run generate notion
bun run cli notion page get --help
```

## 관련 문서

- [플러그인 작성과 정적 생성](../../plugins/README.md)
- [개발 환경과 패키지 구성](../../docs/development.md)
