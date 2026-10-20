# 개발 안내

명령은 저장소 루트에서 실행합니다. Bun workspaces와 Turborepo를 사용합니다.

## 설치와 검증

```sh
bun install
bun run check
bun run format
```

`bun run check`는 린트, 코드 규칙, 타입 검사와 테스트를 실행합니다.
데스크톱 빌드는 [별도 안내](../apps/desktop/README.md)를 따릅니다.

## 패키지 구성

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

`apps/cli`와 `apps/mem`은 독립 실행 진입점입니다. `apps/desktop`은 MCP CLI의 연결 대몬을 관리합니다.
`mem`은 MCP CLI의 하위 명령이나 플러그인이 아닙니다.

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
