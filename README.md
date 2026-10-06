# mcp-to-cli

MCP 도구 정의를 정적 코드로 생성하고, 필요한 범위만 발견할 수 있는 CLI로 실행합니다.
Bun workspaces와 Turborepo를 사용합니다. 서비스는 별도 플러그인 패키지로 추가합니다.

```text
MCP tools/list → tools.json → generated.ts → CLI
                                  ├─ 명령 경로와 help
                                  └─ 타입이 있는 호출 함수
```

Help, `methods`, `skill`은 생성된 파일만 읽습니다. 실제 명령 실행 시에만 서버에 연결합니다.
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

| 경로               | 역할                                                    |
| ------------------ | ------------------------------------------------------- |
| `packages/core`    | 서비스 플러그인, 명령 정의, 연결·호출 계약              |
| `packages/codegen` | 도구 정의와 플러그인 매핑을 합쳐 정적 코드 생성         |
| `packages/runtime` | 명령 탐색, help, 입력 처리, 정책 적용, 결과 출력        |
| `packages/schema`  | JSON Schema 입력 검증                                   |
| `packages/mcp`     | 공식 MCP 클라이언트를 이용한 stdio/Streamable HTTP 연결 |
| `plugins/*`        | 서비스별 연결 설정, 명령 경로, 설명, 실행 전 정책       |
| `apps/cli`         | 플러그인 등록과 생성·실행 명령                          |

공통 실행기는 MCP SDK를 직접 가져오지 않습니다. 연결 구현은 SDK의 도구 정의와 결과를
공통 타입으로 변환합니다. 실행 테스트는 같은 호출 계약에 가짜 연결을 넣을 수 있습니다.

## 점진적 help

Notion CLI의 `Usage`, `Commands`, `Arguments`, `Options`, `Examples`, `Safety Rules` 구조를 참고했습니다.

- `demo --help`: 명령 그룹과 발견 명령만 표시합니다.
- `demo message --help`: 해당 그룹의 하위 명령만 표시합니다.
- `demo message echo --help`: 해당 도구의 인자·타입·필수 여부·예시를 표시합니다.
- `demo methods message --json`: 해당 그룹의 도구 이름과 명령 경로만 표시합니다.
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
```

문자열 필드는 숫자처럼 보여도 문자열로 유지합니다. `--page-id`는 스키마의 `page_id`로 대응합니다.
객체와 배열은 JSON 값을 받습니다. 중복 플래그는 거부합니다. 배열은 JSON 배열로 지정합니다.
JSON 입력, 파일 입력, 개별 플래그는 혼합할 수 없습니다.
복잡한 `$ref`·조합 스키마의 입력은 `--input`을 사용하십시오. 전체 입력은 JSON Schema로 검증합니다.

기본 출력은 MCP의 텍스트 블록입니다. `--json`은 MCP 결과 전체를 보존합니다.
도구가 `isError`를 반환하면 결과를 출력하고 종료 코드 `1`을 반환합니다.
입력 검증과 플러그인 정책이 통과한 뒤 서버에 연결합니다. 호출 종료 시 연결을 닫습니다.

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
도구 이름순으로 정렬하므로 서버가 목록 순서를 바꿔도 같은 코드를 생성합니다.
명령 경로 중복, 상위·하위 명령 충돌, 예약 명령 충돌, 존재하지 않는 도구 매핑은 생성 오류입니다.
같은 플러그인을 동시에 생성하는 작업은 실행하지 마십시오.

생성된 `createClient(call)`은 도구별 입력 타입을 제공합니다.
이는 저수준 호출용입니다. CLI 입력 검증과 `beforeCall` 정책은 `runService`에서 적용합니다.

## 플러그인 추가

1. `plugins/<service>`에 workspace 패키지를 만듭니다.
2. `@mcp-to-cli/core`의 `definePlugin`으로 기본 export를 만듭니다.
3. `apps/cli/package.json`에 플러그인 의존성을 추가합니다.
4. `apps/cli/src/plugins.ts`에 lazy import를 등록합니다.
5. `bun run generate <service>`로 정적 정의를 생성합니다.

```typescript
import { definePlugin } from "@mcp-to-cli/core";

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
  connection: () => ({ type: "stdio", command: "issue-mcp" }),
});
```

`commands`에서 설명, 예시, 주의사항을 보강할 수 있습니다.
`beforeCall(command, input)`은 서비스별 실행 전 검사를 넣는 위치입니다.
매핑 명령과 `call` 명령 모두 같은 검사를 거칩니다.
`connection(env)`은 실행 시에 환경변수를 읽습니다. 인증 정보는 생성 결과에 넣지 않습니다.

## 현재 범위

- 생성·발견·입력 검증·호출·종료까지 `demo`로 통합 검증합니다.
- stdio와 Streamable HTTP 연결을 제공합니다. 현재 실제 연결 테스트는 stdio에 한정합니다.
- Notion 플러그인은 `fetch get`, `search run` 매핑과 HTTP 연결 설정의 출발점입니다.
- Notion 정의는 아직 생성하지 않았습니다. 기존 CLI의 OAuth 저장소, refresh lock, markdown spec 검사,
  수정 보호, widget 기능도 아직 이전하지 않았습니다.
- OAuth 로그인과 SSE, MCP resources/prompts의 CLI 생성은 아직 지원하지 않습니다.
- Linear·Slack 서비스 플러그인은 아직 이전하지 않았습니다.

Notion 서버를 생성하려면 `NOTION_MCP_TOKEN`으로 서버가 받아들이는 Bearer 인증을 제공해야 합니다.
`NOTION_MCP_URL`로 URL을 바꿀 수 있습니다. 이 프레임워크는 브라우저 로그인을 자동 실행하지 않습니다.

```bash
bun run generate notion
bun run cli notion fetch get --help
```

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
