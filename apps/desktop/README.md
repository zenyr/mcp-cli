# MCP CLI 데스크톱 시제품

React, TanStack Router, TanStack Query, Mantine UI와 tinyjs를 사용합니다.
화면 설계는 [design.md](./design.md)에 있습니다.

## 개발 실행

저장소 루트에서 실행하십시오.

```sh
bun install
MCP_CLI_DESKTOP_ENTRY="$PWD/apps/cli/src/main.ts" \
MCP_CLI_DESKTOP_BUN="$(command -v bun)" \
bun run --cwd apps/desktop desktop
```

트레이에서 `관리 화면 열기`를 선택하십시오.
앱에서 대몬을 시작한 뒤 터미널에서 실행하십시오.

```sh
MCP_CLI_DAEMON=1 bun run cli demo message echo --text hello
```

앱의 `설정` 화면에서 CLI 실행 명령을 변경할 수 있습니다.
실행 파일과 인수를 각각 한 줄에 입력하십시오.
개발 환경에서는 Bun의 절대 경로와 `apps/cli/src/main.ts`의 절대 경로를 입력하십시오.
빌드한 앱은 빌드에 사용한 Bun과 저장소 CLI의 절대 경로를 기본값으로 포함합니다.
앱을 더블클릭해도 전역 설치된 이전 CLI를 사용하지 않습니다.
이 프로토타입을 실행할 때는 빌드한 저장소 경로를 유지하십시오.
CLI 바이너리를 앱에 번들하지 않습니다.

## 기능

- 트레이 상주, 창 닫기 시 숨김, 앱 종료와 대몬 종료 분리
- 대몬 시작, 상태 조회, 연결 초기화, 종료
- 연결과 진행 중 요청 수, 자격 증명 선택, 유휴 종료 시간 표시
- 서비스별 OAuth 로그인, API key 저장, 로그아웃
- 앱 자동 실행과 대몬 자동 시작 설정

인증은 기존 CLI의 파일 저장소를 공유합니다.
OS Keychain으로 옮기는 기능은 포함하지 않습니다.
환경 변수 상태는 앱이 실행한 CLI의 환경을 표시합니다.
터미널의 환경 변수는 명령마다 별도로 전달합니다.
OAuth 로그인은 외부 브라우저를 사용합니다.
API key는 stdin으로 전달하며 실행 인수에 넣지 않습니다.

## 연결 계약

대몬 사용은 `MCP_CLI_DAEMON=1`로 선택합니다.
이 설정 없이 CLI를 실행하면 기존 직접 연결을 사용합니다.
대몬 사용을 선택했는데 대몬이 꺼져 있으면 명령은 실패합니다.
도구 호출을 자동으로 재시도하지 않습니다.
대몬은 서비스, 자격 증명, 인증 식별자, 연결 설정, 환경 변수, 작업 경로로 풀을 격리합니다.
연결 수는 최대 32개이고 유휴 종료 시간은 60초입니다.
CLI 실행 중에는 IPC 연결로 lease를 유지합니다.
CLI 종료 또는 IPC 연결 종료 뒤 유휴 타이머를 시작합니다.
초기화와 종료는 진행 중 요청을 기다립니다.
초기화 중 새 요청도 초기화 완료를 기다립니다.
인증 변경은 모든 풀 연결을 초기화합니다.

IPC는 macOS/Linux에서 Unix socket을 사용합니다.
Windows에서는 named pipe를 사용합니다.
각 요청은 대몬 전용 bearer token을 사용합니다.
POSIX에서는 디렉터리 권한을 0700, token과 socket 권한을 0600으로 설정합니다.
`MCP_CLI_DAEMON_DIR`로 절대 경로를 지정할 수 있습니다.
대몬이 비정상 종료해서 `owner`가 남으면 시작은 실패합니다.
현재 버전은 기존 대몬의 상태 파일을 자동으로 삭제하지 않습니다.

## 빌드와 검증

```sh
bun run check
cd apps/desktop
bun run build
bun run native:build
```

`tinyjs build`는 실행한 OS의 앱을 만듭니다.
macOS 결과물은 `dist/MCP CLI.app`입니다.
배포 서명과 공증은 별도 설정이 필요합니다.
Windows/Linux는 해당 OS에서 빌드하고 실행 검증해야 합니다.

네이티브 smoke 검증은 저장소 루트에서 실행하십시오.
기존 대몬과 격리하려면 새 임시 디렉터리를 사용하십시오.

```sh
MCP_CLI_DESKTOP_ENTRY="$PWD/apps/cli/src/main.ts" \
MCP_CLI_DESKTOP_BUN="$(command -v bun)" \
MCP_CLI_DAEMON_DIR="$(mktemp -d /tmp/mcp-native-XXXXXX)" \
TINYJS_HTML="$PWD/apps/desktop/test/smoke.html" \
apps/desktop/dist/mcp-desktop
```

검증 페이지는 설정, 서비스 검색, 대몬 시작, 조회, 초기화, 종료를 확인합니다.
완료하면 `MCP SMOKE PASS`를 출력하고 앱을 종료합니다.

## 아이콘

원본은 `assets/mcp-cli.svg`입니다.
`>`를 반시계 방향으로 45도 돌려 MCP 심볼의 좌측 하단에 배치했습니다.
두 요소는 같은 대각선 중심축을 사용합니다.
메인 아이콘은 초록색 MCP 심볼과 구릿빛 `>`를 사용합니다.
`scripts/icons.ts`가 SVG에서 1024px 앱 PNG와 48px 트레이 PNG를 생성합니다.
이미지 생성 모델은 사용하지 않습니다.

macOS 메뉴 막대는 단색 template 아이콘을 사용합니다.
Windows와 Linux 트레이는 투톤을 유지합니다.
대몬 실행 중에는 전체 심볼을 100% 불투명도로 표시합니다.
대몬에 연결하지 못하면 MCP 심볼만 50% 투명도로 표시합니다.
`>`는 두 상태에서 100% 불투명도를 유지합니다.
앱은 PNG를 캐시에 저장하므로 현재 작업 경로에 의존하지 않습니다.

MCP 심볼은 [공식 저장소의 favicon](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/favicon.svg)을 사용했습니다.

## 효과음

선택한 조합은 시작 B, 호버 B, 클릭 B, 완료 A, 오류 A입니다.
효과음은 로컬 WAV이며 실행 중 외부 API를 호출하지 않습니다.
설정의 `효과음` 토글은 즉시 저장하며 기본값은 켜짐입니다.
끄면 미리듣기와 대기 중인 재생도 차단합니다.

- 시작음은 새 대몬 PID를 확인했을 때 한 번 재생합니다.
- 앱을 열었을 때 이미 실행 중인 대몬은 시작음을 내지 않습니다.
- 호버음과 클릭음은 활성 버튼과 링크에만 적용합니다.
- 같은 버튼 안의 하위 요소 이동은 호버음을 다시 내지 않습니다.
- 호버음은 180ms 간격으로 제한합니다.
- 작업 완료와 실패는 완료음과 오류음을 재생합니다.
- 상태 조회의 실패는 오류음을 내지 않습니다.
- 미리듣기 버튼에는 별도 호버음과 클릭음을 붙이지 않습니다.

네이티브 효과음 검증은 `test/sound-smoke.html`을 `TINYJS_HTML`로 지정해 실행합니다.
검증은 기존 효과음 설정을 읽고, 완료 후 같은 값으로 복원합니다.
