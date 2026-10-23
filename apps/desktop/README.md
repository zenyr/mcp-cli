# MCP CLI 데스크톱 앱

React, TanStack Router, TanStack Query, Mantine UI와 tinyjs를 사용합니다.
화면 설계는 [design.md](./design.md)에 있습니다.

## 앱 사용

빌드된 `dist/MCP CLI.app`을 응용 프로그램 폴더에 복사한 뒤 실행합니다.
Bun, Node, tinyjs 설치나 소스 저장소가 필요하지 않습니다.
최초 실행 시 서비스 화면이 열립니다. 사용할 서비스의 로그인 버튼을 누르십시오.
API 키 방식의 서비스는 해당 서비스에서 발급받은 키를 입력합니다.

앱은 CLI와 기본 플러그인의 도구 정의를 포함합니다. 설정 폴더는 자동으로 만듭니다.
트레이의 `관리 화면 열기`로 화면을 다시 열 수 있습니다.
CLI 실행 경로를 지정하지 않아도 됩니다. 별도 CLI가 필요할 때만 설정의 `고급 설정`을 사용합니다.
`기본 명령 사용`은 직접 지정한 실행 명령을 해제합니다.

현재 로컬 macOS 빌드는 임시 서명을 사용합니다. 공개 다운로드 배포에는 개발자 서명과 공증이 별도로 필요합니다.

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
bun run cli demo message echo --text hello
```

개발 실행은 빌드한 Bun과 소스 CLI 경로를 사용합니다.
네이티브 빌드는 Bun 런타임이 포함된 CLI를 앱에 넣고 앱 내부의 상대 위치로 찾습니다.
빌드한 앱은 소스 저장소를 옮기거나 제거해도 실행할 수 있습니다.

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

CLI는 기본으로 대몬을 사용합니다. `MCP_CLI_DAEMON=1`을 따로 지정할 필요가 없습니다.
직접 연결은 `MCP_CLI_DAEMON=0`으로 선택합니다.
대몬이 꺼져 있으면 도구 요청을 보내기 전에 직접 연결로 전환합니다.
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
대몬이 비정상 종료해도 다음 시작이나 앱 업데이트에서 남은 상태를 복구합니다.
기록된 PID가 없고 소켓 연결도 불가능한 경우에만 소유권·토큰·소켓을 정리합니다.
PID가 살아 있거나 소켓이 응답하거나 소유권을 확인할 수 없으면 상태를 보존하고 중단합니다.
동시 복구와 시작은 잠금으로 보호하며, 남은 잠금을 자동으로 삭제하지 않습니다.

## 빌드와 검증

```sh
bun run check
cd apps/desktop
bun run build
bun run native:build
```

`bun run native:build`는 별도 작업 폴더에 빌드한 뒤 결과물을 교체합니다.
macOS에서는 서명 검증이 끝날 때까지 기존 `dist`와 실행 중인 앱을 유지합니다.
실행 중인 같은 앱 ID의 `.app`이 있으면 해당 설치 경로도 갱신합니다.

- 새 요청을 차단하고 진행 중인 앱 요청을 기다립니다. 미완료 로그인은 취소합니다.
- 대몬은 진행 중인 요청을 마무리한 뒤 종료합니다.
- 앱과 대몬이 종료된 것을 확인한 뒤 기존 결과물을 백업하고 교체합니다.
- 실행 중이던 앱과 대몬만 다시 시작합니다. 꺼져 있던 앱은 실행하지 않습니다.
- 재시작한 대몬은 빌드 프로세스와 분리하여 빌드 종료 후에도 유지합니다.
- 실행 중인 앱의 식별자 확인에 실패하면 교체를 중단합니다.
- 새 앱의 초기화 확인에 실패하면 새 프로세스를 종료하고 이전 결과물을 복원합니다.
- 새 앱을 안전하게 종료하지 못하면 덮어쓰지 않고 백업을 남깁니다.
- 종료 대기는 최대 10분이며 강제 종료하지 않습니다. 시작 확인은 최대 30초입니다.

업데이트 종료 기능이 없는 구 버전은 실행 중인 CLI 요청을 기다리고 대몬을 종료한 뒤 macOS의 정상 종료 요청을 사용합니다.
동시에 두 빌드를 실행하면 두 번째 빌드는 거부합니다.
빌드가 강제로 중단되어 `.native-build.lock`이 남았다면 실행 중인 빌드가 없는지 확인한 뒤 잠금 디렉터리를 삭제하십시오.

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

내장 CLI를 사용하는 배포 빌드는 다음 환경에서 추가 검증할 수 있습니다.
개발용 CLI 경로를 지정하지 않고 실행합니다.

```sh
MCP_CLI_DESKTOP_ENTRY= \
MCP_CLI_DESKTOP_BUN= \
MCP_CLI_DAEMON_DIR="$(mktemp -d /tmp/mcp-packaged-XXXXXX)" \
TINYJS_HTML="$PWD/apps/desktop/test/packaged-smoke.html" \
apps/desktop/dist/mcp-desktop
```

이 검증은 CLI 기본 경로, 고급 설정 초기화, 내장 서비스와 대몬을 검사합니다.
기존 앱 설정과도 분리하려면 HOME과 XDG 경로를 별도 임시 폴더로 지정하십시오.

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
끄면 새 효과음 재생을 차단합니다.

- 시작음은 새 대몬 PID를 확인했을 때 한 번 재생합니다.
- 앱을 열었을 때 이미 실행 중인 대몬은 시작음을 내지 않습니다.
- 호버음과 클릭음은 활성 버튼과 링크에만 적용합니다.
- 같은 버튼 안의 하위 요소 이동은 호버음을 다시 내지 않습니다.
- 호버음은 180ms 간격으로 제한합니다.
- 클릭음과 완료·오류음은 이전 효과음이 끝나기를 기다리지 않고 재생합니다.
- 작업 완료와 실패는 완료음과 오류음을 재생합니다.
- 상태 조회의 실패는 오류음을 내지 않습니다.

네이티브 효과음 검증은 `test/sound-smoke.html`을 `TINYJS_HTML`로 지정해 실행합니다.
검증은 기존 효과음 설정을 읽고, 완료 후 같은 값으로 복원합니다.

### 서비스 아이콘

서비스 목록은 앱에 포함한 SVG를 사용합니다. Slack의 `xoxp`와 `xoxb`는 개인·봇 배지를 표시합니다.

- Fish Audio: [공식 홈페이지](https://fish.audio)의 내비게이션 SVG
- Linear: [공식 favicon](https://linear.app/static/favicon.svg)
- Notion: [공식 개발자 문서](https://developers.notion.com)의 [로고](https://mintcdn.com/notion-demo/5YdhSbldE14t5Rna/logo/light.svg)에서 심볼 추출
- Slack: [공식 심볼](https://a.slack-edge.com/9cc0056/marketing/img/nav/logo.svg)
- demo: 기존 MCP CLI 앱 아이콘

인증이 있으면 더보기 메뉴에서 키 변경, 다시 로그인, 로그아웃을 선택합니다.
환경 변수만 사용하는 자격 증명에는 로그아웃을 표시하지 않습니다.
