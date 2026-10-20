# 플러그인 개발 안내

서비스별 연결 설정과 명령 매핑은 `plugins/<service>`에서 관리합니다.
공통 명령 사용법은 [MCP CLI 안내](../apps/cli/README.md)를 참고하십시오.

## 서비스별 안내

- [Notion](notion/README.md): 페이지, 데이터베이스, 캘린더와 댓글
- [Linear](linear/README.md): 이슈 관리와 인증
- [Slack](slack/README.md): 메시지 도구와 토큰 설정
- [Fish Audio](fish-audio/README.md): 음성 제작, 전사와 미디어 작업
- `demo`: 외부 계정 없이 사용하는 로컬 stdio MCP 서버

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
  summary: "이슈 관리 도구",
  commands: {
    "search-issues": {
      path: ["issue", "search"],
      summary: "이슈 검색",
      examples: ["issues issue search --query bug"],
    },
  },
  groups: { issue: "이슈 검색과 조회" },
  quickstart: [{ command: "issue search --query bug", summary: "열린 버그 검색" }],
  connection: () => ({ type: "stdio", command: "issue-mcp" }),
});
```

`commands`에서 설명, 예시, 주의사항을 보강할 수 있습니다.
`summary`를 지정하면 기본 help에 짧은 설명을 표시하고, 원래 도구 설명은 `--help=full` 본문에 표시합니다.
`groups`는 공백으로 이은 그룹 경로(`"media image"`)에 한 줄 설명을 붙입니다.
`quickstart`는 루트 help의 `Start here`에 표시할 추천 명령입니다.
없는 그룹이나 명령을 가리키는 `groups`, `quickstart` 항목은 실행 시 오류로 처리합니다.
서버가 권한에 따라 도구를 숨기면 해당 매핑에 `optional: true`를 지정하십시오.
그 도구가 없으면 매핑을 건너뛰고, 관련 `groups`와 `quickstart` 항목도 help에서 뺍니다.
`beforeCall(command, input)`은 서비스별 실행 전 검사를 넣는 위치입니다.
매핑 명령과 `call` 명령 모두 같은 검사를 거칩니다.
`connection(env)`은 실행 시에 환경변수를 읽습니다. `Promise`를 반환해도 됩니다. 인증 정보는 생성 결과에 넣지 않습니다.

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
