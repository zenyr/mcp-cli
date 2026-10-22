# Slack 확장 검증 기록

검증일: 2026-10-22. 환경: macOS.
현재 mcp-cli 워크트리에서 구현과 검증을 수행했습니다.
다른 기기의 저장소나 외부 slack-cli 소스는 사용하지 않았습니다.

## 완료한 검사

| 검사                                                                | 결과                                               |
| ------------------------------------------------------------------- | -------------------------------------------------- |
| `bun run check`                                                     | 통과: lint, 코드 규칙, 전체 타입 검사, 전체 테스트 |
| `bun run --filter @mcp-cli/cli build`                               | 통과                                               |
| `bun run --filter @mcp-cli/desktop native:build`                    | 통과                                               |
| `codesign --verify --deep --strict 'apps/desktop/dist/MCP CLI.app'` | 통과: ad-hoc 서명                                  |
| 빌드한 CLI의 methods JSON·schema·dry-run JSON                       | 통과: 임시 설정 디렉터리 사용                      |
| 빌드한 CLI의 꺼진 대몬 선택                                         | 실패 반환 확인: 직접 연결 우회 없음                |
| `git diff --check`                                                  | 통과                                               |

## 테스트 근거

- `plugins/slack/test/web.test.ts`: 41개 업무 명령 라우팅, 요청 필드, help·schema, 페이지 순회, 필터, payload 재사용, URL·ts, 날짜·DST, 배치 부분 실패.
- 같은 테스트는 기존 8개 MCP 도구의 이름과 입력 보존을 확인합니다.
- 같은 테스트는 기본 인증과 `--xoxp`의 중복 방지 키 공유를 확인합니다.
- `plugins/slack/test/slack.test.ts`: 인증 설정과 제한된 MCP 도구 목록의 호환성.
- Slack 플러그인 테스트 합계: 56개 통과, 0개 실패.
- `packages/mcp/test/web-api.test.ts`: 429, 실제 HTTP 타임아웃, 쓰기 재시도 금지, 다운로드 호스트·리다이렉트·크기·권한.
- `apps/cli/test/auth.test.ts`: 임시 인증 저장소와 환경 변수 우선순위, 명시적 사용자 토큰 선택.
- `apps/cli/test/daemon.test.ts`: 모의 HTTP 서버에서 직접·대몬 결과 일치, 토큰별 연결 격리, 대몬 종료 후 거부.
- 기존 runtime 테스트는 쓰기 중복 방지와 불명확한 전송 상태 보존을 확인합니다.

## 권한 때문에 발생하는 제한

- Slack은 토큰의 scopes, 멤버십, 워크스페이스 정책으로 접근을 제한합니다.
- 사용자 상태 변경, 메시지 검색, 읽음 표시는 사용자 토큰이 필요합니다.
- 권한 오류의 `error`, `needed`, `provided`를 그대로 보존합니다.
- 비공개 채널은 토큰으로 볼 수 있는 목록에서만 해석합니다.
- Web API 권한과 MCP 도구 노출 권한은 별개입니다.
- 실제 계정에 대한 권한 검증과 MCP 스키마 갱신은 수행하지 않았습니다.

## 구현 범위의 제한

- 채널명 해석과 메시지 문맥 조회에는 10,000개 수집 상한이 있습니다.
- 상한으로 탐색이 끝나지 않으면 불완전한 결과 또는 별도 오류를 표시합니다.
- 음소거 상태를 확인할 공개 API가 없어 `--include-muted`를 거부합니다.
- 미읽음 결과는 수집한 범위만 나타냅니다. 전체 미읽음 개수로 표시하지 않습니다.
- Markdown 변환은 제목·강조·취소선·링크·인용·코드·예약 문자를 처리합니다.
- 완전한 CommonMark 레이아웃과 모든 Block Kit 의미 검증은 제공하지 않습니다.
- Block Kit의 배열 수, 주요 텍스트 길이, fields·actions 수를 로컬에서 검사합니다.
- Slack 서버가 나머지 API 제약을 검증합니다.
- 사용자 그룹의 가입·탈퇴는 읽기와 쓰기 사이의 동시 수정을 잠그지 못합니다.
- 바이너리 다운로드는 base64를 사용합니다. 텍스트 다운로드는 UTF-8을 사용합니다.
- `.app`은 ad-hoc 서명입니다. Developer ID 서명과 notarization은 수행하지 않았습니다.

## 코드 규칙 점검

- sentinel: clean. 오류 분기는 코드·타입·상태를 사용합니다.
- boundaries: clean. HTTP·인증 주입은 연결 계층, Slack 정책은 플러그인에 둡니다.
- boy scout: clean. 환경 변수가 있으면 저장된 인증을 읽지 않도록 수정했습니다.
- file size: clean. 새 구현 파일은 각각 350라인 미만입니다.
- parity: clean. 같은 Web API 연결 구현을 직접 실행과 대몬에서 사용합니다.
- comments: clean. 새 주석은 한 문장 이내입니다.

실제 Slack 메시지를 전송·수정·삭제하지 않았습니다.
실제 토큰을 fixture, 명령 인수, 로그에 넣지 않았습니다.
41개 명령별 상태와 호출 경로는 [README](README.md)에 있습니다.
