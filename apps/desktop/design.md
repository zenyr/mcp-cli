# mcp-cli desktop 화면 설계

트레이에 상주하는 작은 관리 앱의 화면 설계입니다.
앱은 대몬의 연결 풀과 서비스 인증을 확인하고 조작합니다.
대시보드형 장식을 쓰지 않습니다. 표, 상태 점, 짧은 문장으로 구성합니다.

## 1. 범위

### MVP 기능

1. 대몬 상태, PID, 실행 시간을 표시합니다.
2. 전체 연결 수와 서비스별 연결, active/idle 상태를 표시합니다.
3. 연결을 초기화합니다. 대몬은 진행 중 요청을 기다린 뒤 연결을 닫습니다.
4. 대몬을 시작하고 종료합니다.
5. 서비스 목록과 인증 상태를 표시합니다.
6. OAuth 로그인을 외부 브라우저로 진행합니다.
7. API key를 입력하고 저장합니다.
8. 로그아웃합니다.
9. 자동 실행을 설정합니다.

### MVP 제외

- 수동 redirect URL 붙여넣기. 데스크톱은 같은 기기의 브라우저와 loopback을 사용합니다.
- 서비스별 연결 초기화. 전체 초기화만 제공합니다.
- 요청 로그, 그래프, 통계.
- 트레이 메뉴의 대몬 시작/종료. 관리 화면에서만 제공합니다.

### 앱과 대몬의 관계

- 대몬은 별도 Bun 프로세스입니다. 앱은 로컬 IPC로 대몬과 통신합니다.
- 앱을 종료해도 대몬은 계속 실행합니다.
- 창을 닫으면 창을 숨깁니다. 앱 프로세스는 트레이에 남습니다.
- CLI 명령과 출력 형식은 바꾸지 않습니다. 앱은 CLI를 대체하지 않습니다.

## 2. 정보 구조

```text
트레이
├─ 상태 줄 (비활성 항목)
├─ 관리 화면 열기
└─ 앱 종료

관리 창
├─ 대몬 바 (모든 화면 상단 고정)
├─ /connections   연결
├─ /services      서비스
└─ /settings      설정

모달
├─ OAuth 로그인 진행
├─ API key 저장
├─ 로그아웃 확인
└─ 대몬 종료 확인
```

### 라우트

TanStack Router를 code-based로 구성합니다. 데스크톱 웹뷰이므로 `createHashHistory()`를 사용합니다.

| 경로           | 화면   | 비고                       |
| -------------- | ------ | -------------------------- |
| `/`            | 없음   | `/connections`로 redirect  |
| `/connections` | 연결   | 기본 화면                  |
| `/services`    | 서비스 | 인증 상태와 로그인 조작    |
| `/settings`    | 설정   | 자동 실행, 경로, 버전 정보 |

모달은 라우트로 만들지 않습니다. 각 화면의 로컬 상태로 엽니다.
트레이에서 창을 열면 마지막 경로를 유지합니다.

## 3. 창과 레이아웃

### 치수

| 항목           | 값                                |
| -------------- | --------------------------------- |
| 기본 창 크기   | 760 × 520                         |
| 최소 창 크기   | 640 × 440                         |
| 대몬 바 높이   | 52                                |
| 사이드바 너비  | 168                               |
| 본문 패딩      | 16                                |
| 표 행 높이     | 약 36 (`verticalSpacing="xs"`)    |
| 모달 너비      | 420 (`size={420}`)                |
| 기본 글자 크기 | 13 (`fontSizes.sm`), 보조 글자 12 |

창 위치는 마지막 위치를 저장합니다. 처음 열 때는 화면 중앙에 둡니다.
현재 `tinyjs.json`의 `size`는 `880x640`입니다. 이 설계는 `760x520`을 권장합니다.

### 골격

`AppShell`을 사용합니다. `header={{ height: 52 }}`, `navbar={{ width: 168, breakpoint: 0 }}`로 지정합니다.

```text
┌──────────────────────────────────────────────────────────────┐
│ ● 실행 중   PID 48213 · 2시간 14분 · 연결 3   [초기화] [종료] │  ← 대몬 바
├────────────┬─────────────────────────────────────────────────┤
│ 연결     3 │                                                 │
│ 서비스     │                 본문                            │
│ 설정       │                                                 │
│            │                                                 │
│            │                                                 │
│ v0.1.0     │                                                 │
└────────────┴─────────────────────────────────────────────────┘
```

- 사이드바는 `NavLink` 3개입니다. `연결` 오른쪽에 연결 수를 `Badge size="xs" variant="light"`로 둡니다.
- 사이드바 하단에 앱 버전을 `Text size="xs" c="dimmed"`로 둡니다.
- 아이콘은 `@tabler/icons-react`에서 16px로 사용합니다. `IconPlugConnected`, `IconKey`, `IconSettings`를 사용합니다.

## 4. 테마와 색상

`MantineProvider`에 다음 값을 지정합니다.

```ts
const theme = createTheme({
  primaryColor: "indigo",
  defaultRadius: "sm",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontFamilyMonospace: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  fontSizes: { xs: "12px", sm: "13px", md: "14px" },
  components: {
    Button: Button.extend({ defaultProps: { size: "xs" } }),
    Badge: Badge.extend({ defaultProps: { size: "sm", variant: "light", radius: "sm" } }),
    Table: Table.extend({ defaultProps: { verticalSpacing: "xs", fz: "sm" } }),
  },
});
```

- `defaultColorScheme="auto"`로 OS 밝기 설정을 따릅니다.
- 그림자, 그라데이션, 큰 카드를 쓰지 않습니다. 구획은 `Paper withBorder`와 `Divider`로 나눕니다.
- 서비스 이름, PID, 환경 변수 이름, 경로는 `Code` 또는 `ff="monospace"`로 표시합니다.

### 상태 색

| 상태                      | Mantine 색 | 용도                                 |
| ------------------------- | ---------- | ------------------------------------ |
| 실행 중, active, 로그인됨 | `teal`     | 정상 동작                            |
| idle, 중지됨, 인증 없음   | `gray`     | 동작하지 않는 정상 상태              |
| 시작 중, 종료 중, 정리 중 | `yellow`   | 전환 중                              |
| 응답 없음, 오류           | `red`      | 사용자 조치 필요                     |
| 로그인 필요               | `orange`   | 인증 조치 필요                       |
| 환경 변수 사용            | `violet`   | 저장값보다 환경 변수가 우선하는 상태 |

상태 점은 `ColorSwatch size={8}`을 사용합니다. 전환 중에는 점 대신 `Loader size={10}`을 둡니다.
색만으로 상태를 전달하지 않습니다. 점 옆에 항상 문구를 둡니다.

## 5. 대몬 바

모든 화면 상단에 고정합니다. 왼쪽은 상태, 오른쪽은 조작입니다.

### 상태별 표시

| 대몬 상태     | 왼쪽 문구                                        | 오른쪽 버튼                                  |
| ------------- | ------------------------------------------------ | -------------------------------------------- |
| `running`     | `● 실행 중` `PID 48213 · 2시간 14분 · 연결 3`    | `연결 초기화` `대몬 종료`                    |
| `draining`    | `◌ 연결 정리 중` `진행 중 요청 2개를 기다립니다` | `연결 초기화`(loading) `대몬 종료`(disabled) |
| `starting`    | `◌ 시작하는 중…`                                 | `대몬 시작`(loading)                         |
| `stopping`    | `◌ 종료하는 중…` `진행 중 요청 1개를 기다립니다` | `대몬 종료`(loading)                         |
| `stopped`     | `● 중지됨`                                       | `대몬 시작`                                  |
| `unreachable` | `● 응답 없음` `PID 48213`                        | `다시 확인` `대몬 종료`                      |

- `연결 초기화`는 `variant="default"`입니다. 연결이 0개이면 disabled입니다.
- `대몬 종료`는 `variant="subtle" color="red"`입니다.
- `대몬 시작`은 `variant="filled"`입니다.
- PID 옆에 `CopyButton`을 두지 않습니다. PID 텍스트를 선택할 수 있게 둡니다.
- 실행 시간은 `startedAt`으로 계산합니다. 1분 단위로 갱신합니다.

### 연결 초기화

확인 모달을 띄우지 않습니다. 초기화는 진행 중 요청을 끊지 않기 때문입니다.

1. 사용자가 `연결 초기화`를 누릅니다.
2. 대몬 바가 `draining` 상태로 바뀝니다.
3. 대몬이 진행 중 요청을 기다린 뒤 모든 연결을 닫습니다.
4. 완료하면 알림을 띄웁니다. `연결 3개를 닫았습니다.`
5. 초기화 중 새 요청은 새 연결을 엽니다. 이 동작은 대몬 계약을 따릅니다.

### 대몬 종료

진행 중 요청이 있을 때만 확인 모달을 띄웁니다. 요청이 없으면 바로 종료합니다.

- 제목: `대몬을 종료할까요?`
- 본문: `진행 중 요청 2개가 끝나면 종료합니다. 종료 후 CLI 명령은 연결을 재사용하지 않습니다.`
- 버튼: `취소`, `종료` (`color="red"`)

## 6. 연결 화면 `/connections`

### 구성

```text
연결 3개 · active 1 · idle 2                       idle 연결은 60초 뒤 닫힙니다
┌──────────┬────────────┬─────────┬──────┬────────────┬──────────┐
│ 서비스   │ 자격 증명  │ 상태    │ 요청 │ 마지막 사용 │ 닫힘까지 │
├──────────┼────────────┼─────────┼──────┼────────────┼──────────┤
│ notion   │ OAuth      │ ● active│ 1    │ 방금        │ —        │
│ slack    │ xoxb       │ ● idle  │ 0    │ 12초 전     │ 48초     │
│ slack    │ 기본       │ ● idle  │ 0    │ 41초 전     │ 19초     │
└──────────┴────────────┴─────────┴──────┴────────────┴──────────┘
```

- 요약 줄은 `Group justify="space-between"`입니다. 왼쪽은 `Text size="sm" fw={500}`, 오른쪽은 `Text size="xs" c="dimmed"`입니다.
- 표는 `Table.ScrollContainer minWidth={560}` 안에 `Table highlightOnHover stickyHeader`로 둡니다.
- 정렬 순서는 서비스 이름, active 우선, 마지막 사용 최신 순입니다.
- `요청`은 진행 중 요청 수입니다. 0이면 `c="dimmed"`로 표시합니다.
- `닫힘까지`는 idle 연결에만 표시합니다. active 연결은 `—`입니다.
- `닫힘까지`는 `idleExpiresAt`으로 화면에서 1초마다 계산합니다. 이 값 때문에 IPC를 호출하지 않습니다.
- 10초 이하이면 `닫힘까지` 문구를 `c="yellow"`로 표시합니다.
- 행에 마우스를 올리면 `Tooltip`으로 연결 ID와 연 시각을 보여 줍니다. `연결 a1b2c3 · 14:02:11에 열림`

### 자격 증명 열 문구

| 조건                  | 문구        |
| --------------------- | ----------- |
| OAuth                 | `OAuth`     |
| API key 기본          | `기본`      |
| API key 보조 (`xoxb`) | `xoxb`      |
| 환경 변수 사용        | `환경 변수` |
| 인증 없음             | `—`         |

### 상태별 본문

| 상태                  | 본문                                             |
| --------------------- | ------------------------------------------------ |
| 로딩 첫 회            | `Skeleton` 3행, 높이 28                          |
| 연결 0개              | 빈 상태 블록                                     |
| 대몬 `stopped`        | 오프라인 블록                                    |
| 대몬 `unreachable`    | 오류 블록                                        |
| 조회 실패 (대몬 실행) | 표 위에 `Alert` 한 줄, 마지막 성공 데이터는 유지 |

빈 상태 블록은 `Stack align="center" gap={4} py={48}`입니다.

- 제목: `열린 연결이 없습니다.`
- 설명: `CLI 명령을 실행하면 대몬이 연결을 엽니다. idle 연결은 60초 뒤 닫힙니다.`
- 예시: `Code`로 `mcp-cli notion search --query 회의록`을 표시합니다.

오프라인 블록은 같은 배치를 사용합니다.

- 제목: `대몬이 실행 중이 아닙니다.`
- 설명: `CLI 명령은 동작하지만 매번 새로 연결합니다.`
- 버튼: `대몬 시작`

오류 블록은 `Alert color="red" variant="light"`입니다.

- 제목: `대몬이 응답하지 않습니다.`
- 본문: `PID 48213 프로세스가 남아 있습니다. 다시 확인하거나 대몬을 종료하십시오.`
- 버튼: `다시 확인`, `대몬 종료`

조회 실패 `Alert`는 `연결 목록을 가져오지 못했습니다. 2초 뒤 다시 시도합니다.`입니다.

## 7. 서비스 화면 `/services`

### 구성

서비스마다 자격 증명 단위로 행을 만듭니다. slack은 기본 키와 `xoxb` 키 두 행입니다.

```text
┌───────────┬─────────┬──────────────────┬──────┬──────────────┐
│ 서비스    │ 방식    │ 상태             │ 연결 │              │
├───────────┼─────────┼──────────────────┼──────┼──────────────┤
│ demo      │ 없음    │ ● 인증 없음      │ 0    │              │
│ fish-audio│ OAuth   │ ● 로그인 필요    │ 0    │ [로그인]     │
│ linear    │ OAuth   │ ● 환경 변수 사용 │ 1    │              │
│ notion    │ OAuth   │ ● 로그인됨       │ 1    │ [⋯]          │
│ slack     │ API key │ ● 로그인됨       │ 2    │ [⋯]          │
│   └ xoxb  │ API key │ ● 로그인 필요    │ 0    │ [키 저장]    │
└───────────┴─────────┴──────────────────┴──────┴──────────────┘
```

- 표 상단에 `Text size="xs" c="dimmed"`로 안내를 둡니다. `환경 변수가 설정되어 있으면 저장한 자격 증명보다 우선합니다.`
- 보조 자격 증명 행은 서비스 이름 대신 `└ xoxb`를 `pl="md"`로 들여 씁니다.
- `방식`은 `Badge variant="outline" color="gray"`입니다.
- `상태`는 상태 점과 문구입니다. 4절의 색을 따릅니다.
- `연결`은 해당 자격 증명의 연결 수입니다. `연결` 화면과 같은 쿼리를 사용합니다.
- 마지막 열의 너비는 120입니다. 버튼은 오른쪽 정렬합니다.

### 상태와 동작

| 상태             | 조건                         | 행 동작                                                     |
| ---------------- | ---------------------------- | ----------------------------------------------------------- |
| `인증 없음`      | `auth.type === "none"`       | 없음                                                        |
| `로그인 필요`    | 저장값과 환경 변수가 없음    | OAuth `로그인`, API key `키 저장`                           |
| `로그인됨`       | 저장값이 있음                | `Menu`: `다시 로그인`/`키 바꾸기`, `로그아웃`               |
| `환경 변수 사용` | 대몬 환경에 해당 변수가 있음 | 없음. `Tooltip`: `LINEAR_MCP_TOKEN 환경 변수를 사용합니다.` |
| `로그인 중`      | OAuth 시도가 진행 중         | `로그인` 버튼 loading                                       |
| `만료됨`         | refresh에 실패한 OAuth 토큰  | `다시 로그인` 버튼 (`color="orange"`)                       |

- `Menu`의 대상은 `ActionIcon variant="subtle"`과 `IconDots` 16px입니다.
- 환경 변수 상태는 앱 프로세스가 아닌 대몬 프로세스의 환경을 기준으로 합니다. GUI 앱은 셸 환경 변수를 받지 못할 수 있기 때문입니다.
- `만료됨`을 대몬이 구분하지 못하면 MVP에서는 `로그인됨`으로 표시합니다.

### 상태별 본문

- 로딩 첫 회: `Skeleton` 5행.
- 대몬 `stopped`: 서비스 목록과 인증 상태는 표시합니다. `연결` 열은 `—`입니다. 로그인과 로그아웃은 대몬 없이 동작해야 합니다. 대몬이 없으면 앱이 저장소를 직접 다루는지는 9절의 계약 항목을 따릅니다.
- 목록 조회 실패: `Alert color="red"` `서비스 목록을 가져오지 못했습니다.` 버튼 `다시 시도`.

## 8. 인증 모달

### OAuth 로그인

`로그인`을 누르면 브라우저를 열고 모달을 띄웁니다. `Modal size={420} closeOnClickOutside={false}`입니다.

진행 중:

- 제목: `notion 로그인`
- 본문 1: `브라우저에서 로그인을 마치십시오. 완료하면 이 창이 자동으로 닫힙니다.`
- 본문 2 (`Text size="xs" c="dimmed"`): `브라우저가 열리지 않으면 아래 주소를 여십시오.`
- 주소: `TextInput readOnly` + 오른쪽 `CopyButton`. 버튼 문구 `복사` → `복사함`.
- 하단: 왼쪽 `Loader size="xs"` + `기다리는 중…`, 오른쪽 `브라우저 다시 열기`, `취소`.

성공:

- 모달을 닫습니다.
- 알림: `notion에 로그인했습니다.` (`color="teal"`)
- 기존 notion 연결은 대몬이 초기화합니다. 진행 중 요청은 기다립니다.

실패:

- 모달 안에 `Alert color="red"`를 표시합니다. 제목 `로그인하지 못했습니다.` 본문은 대몬 오류 메시지 원문입니다.
- 버튼: `다시 시도`, `닫기`.

시간 초과 (5분):

- `Alert color="yellow"` `5분 안에 로그인을 마치지 않았습니다.` 버튼 `다시 시도`, `닫기`.

취소:

- 대몬에 시도 취소를 요청합니다. 모달을 닫습니다. 알림은 띄우지 않습니다.

### API key 저장

`Modal size={420}`입니다. 자격 증명 행마다 따로 엽니다.

- 제목: `slack 키 저장` 또는 `slack xoxb 키 저장`
- 입력: `PasswordInput label="SLACK_MCP_TOKEN" data-autofocus`
- 설명: `mcp-cli 자격 증명 저장소에 저장합니다. 저장한 값은 다시 표시하지 않습니다.`
- 환경 변수가 있으면 `Alert color="violet" variant="light"`를 추가합니다. `SLACK_MCP_TOKEN 환경 변수가 설정되어 있습니다. 저장해도 환경 변수가 우선합니다.`
- 버튼: `취소`, `저장`. 입력이 공백이면 `저장`은 disabled입니다.
- Enter로 저장합니다.
- 성공 알림: `slack 키를 저장했습니다.`
- 실패: 입력 아래 `error` prop으로 대몬 오류 메시지를 표시합니다.
- 저장 후 입력 상태를 비웁니다. 키 값을 쿼리 캐시나 로그에 남기지 않습니다.

### 로그아웃 확인

`@mantine/modals`의 `openConfirmModal`을 사용합니다.

- 제목: `notion에서 로그아웃할까요?`
- 본문: `저장된 자격 증명을 삭제합니다. 열린 notion 연결은 진행 중 요청을 마친 뒤 닫힙니다.`
- 버튼: `취소`, `로그아웃` (`color="red"`)
- 성공 알림: `notion에서 로그아웃했습니다.`
- 저장값이 없었으면 알림: `notion에 저장된 자격 증명이 없습니다.`

## 9. 설정 화면 `/settings`

`Stack gap="lg" maw={520}`입니다. 구획은 `Text size="xs" fw={600} c="dimmed" tt="uppercase"` 제목과 `Divider`로 나눕니다.

### 자동 실행

| 항목                       | 컴포넌트 | 기본값 | 설명 문구                                       |
| -------------------------- | -------- | ------ | ----------------------------------------------- |
| `로그인할 때 앱 실행`      | `Switch` | 꺼짐   | `OS에 로그인하면 앱을 트레이로 시작합니다.`     |
| `앱을 시작할 때 대몬 시작` | `Switch` | 켜짐   | `대몬이 꺼져 있으면 앱이 시작할 때 실행합니다.` |

- `Switch`는 누르는 즉시 저장합니다. 저장 중에는 `disabled`입니다.
- 실패하면 값을 되돌리고 알림을 띄웁니다. `자동 실행 설정을 바꾸지 못했습니다.`
- 로그인 시 실행은 창을 열지 않습니다. 트레이에만 나타납니다.

### 정보

`Table` 2열, 헤더 없음, `fz="xs"`입니다.

| 항목      | 값 예시                                         |
| --------- | ----------------------------------------------- |
| 앱 버전   | `0.1.0`                                         |
| 대몬 버전 | `0.1.0` 또는 `—`                                |
| IPC 주소  | `~/.mcp-cli/daemon.sock` (Windows는 named pipe) |
| idle TTL  | `60초`                                          |

IPC 주소 오른쪽에 `CopyButton`을 둡니다.
앱과 대몬 버전이 다르면 대몬 버전을 `c="red"`로 표시합니다. 대몬 바 아래에 `Alert`를 둡니다. `대몬 버전(0.1.0)이 앱 버전(0.2.0)과 다릅니다. 대몬을 재시작하십시오.`

## 10. 트레이

### 메뉴

```text
● 대몬 실행 중 · 연결 3        (비활성)
────────────────
관리 화면 열기
────────────────
앱 종료
```

상태 줄 문구:

| 대몬 상태     | 문구                    |
| ------------- | ----------------------- |
| `running`     | `대몬 실행 중 · 연결 3` |
| `draining`    | `연결 정리 중`          |
| `starting`    | `대몬 시작 중`          |
| `stopping`    | `대몬 종료 중`          |
| `stopped`     | `대몬 중지됨`           |
| `unreachable` | `대몬 응답 없음`        |

- `앱 종료` 아래에 설명 줄을 두지 않습니다. 대신 첫 종료 때 한 번만 알림을 띄웁니다. `앱을 종료했습니다. 대몬은 계속 실행합니다.`
- 앱 종료는 확인을 묻지 않습니다. 대몬과 진행 중 요청에 영향이 없기 때문입니다.

### 아이콘

아이콘 3종을 준비합니다. macOS는 template image를 사용하므로 색이 아닌 모양으로 구분합니다.

| 상태                              | 모양                   |
| --------------------------------- | ---------------------- |
| `running`, `draining`             | 채운 원 안의 플러그    |
| `stopped`, `starting`, `stopping` | 윤곽선 플러그          |
| `unreachable`                     | 윤곽선 플러그 + 느낌표 |

툴팁은 `mcp-cli · 대몬 실행 중 · 연결 3`입니다.

### OS별 동작

| OS      | 왼쪽 클릭      | 오른쪽 클릭 | 비고                                      |
| ------- | -------------- | ----------- | ----------------------------------------- |
| macOS   | 메뉴 열기      | 메뉴 열기   | Dock 아이콘 없음 (accessory 앱)           |
| Windows | 관리 화면 열기 | 메뉴 열기   |                                           |
| Linux   | 메뉴 열기      | 메뉴 열기   | AppIndicator는 클릭 이벤트가 없을 수 있음 |

### 창 닫기

- 닫기 버튼, `Cmd+W`, `Ctrl+W`는 창을 숨깁니다.
- Windows와 Linux는 첫 숨김 때 한 번만 OS 알림을 띄웁니다. `mcp-cli가 트레이에서 계속 실행합니다.`
- macOS의 `Cmd+Q`는 앱을 종료합니다. 대몬은 종료하지 않습니다.

## 11. 데이터 계약 (UI가 필요로 하는 값)

UI는 아래 모양의 값을 IPC에서 받는다고 가정합니다. 필드 이름은 구현에서 바꿔도 됩니다.

```ts
type DaemonState = "running" | "draining" | "starting" | "stopping" | "stopped" | "unreachable";

type DaemonStatus = {
  state: DaemonState;
  pid?: number;
  startedAt?: string; // ISO
  version?: string;
  address: string; // 소켓 경로 또는 named pipe
  idleTtlMs: number; // 60000
  inFlight: number; // draining, stopping 문구에 사용
};

type PooledConnection = {
  id: string;
  service: string;
  credential?: string; // "xoxb" 같은 보조 자격 증명, 기본은 undefined
  state: "active" | "idle";
  inFlight: number;
  openedAt: string;
  lastUsedAt: string;
  idleExpiresAt?: string; // idle일 때만
};

type CredentialStatus = "none" | "signedOut" | "signedIn" | "envOverride" | "expired";

type ServiceCredential = {
  service: string;
  credential?: string;
  auth: "oauth" | "apiKey" | "none";
  env?: string; // API key 변수 이름 또는 토큰 override 변수 이름
  status: CredentialStatus;
};

type LoginAttempt = {
  id: string;
  url: string;
  state: "waiting" | "succeeded" | "failed" | "timedOut" | "cancelled";
  error?: string;
};
```

구현자가 확인할 대몬 계약:

1. 대몬이 꺼져 있을 때 CLI가 직접 연결하는지 확인하십시오. 오프라인 블록 설명 문구가 이 동작에 의존합니다.
2. 대몬 종료가 진행 중 요청을 기다리는지 확인하십시오. 종료 확인 모달 문구가 이 동작에 의존합니다.
3. 로그인, 키 저장, 로그아웃 뒤 해당 자격 증명의 연결을 초기화하십시오. 그러지 않으면 풀이 이전 자격 증명을 재사용합니다.
4. 대몬이 꺼져 있을 때 인증 조작의 처리 주체를 정하십시오. 앱 프로세스가 `@mcp-cli/auth` 저장소를 직접 다루는 방식을 권장합니다.
5. OAuth 시도는 대몬 또는 앱 프로세스 한 곳에서만 진행하십시오. loopback 포트(fish-audio `18923`)가 겹치면 안 됩니다.

## 12. 쿼리와 갱신 정책

### 쿼리 키

```ts
const keys = {
  status: ["daemon", "status"] as const,
  connections: ["daemon", "connections"] as const,
  services: ["services"] as const,
  login: (id: string) => ["auth", "login", id] as const,
  settings: ["settings"] as const,
};
```

### 쿼리 옵션

| 쿼리          | `refetchInterval` (창 표시) | 창 숨김 | `staleTime` | `retry` |
| ------------- | --------------------------- | ------- | ----------- | ------- |
| `status`      | 2000                        | 중지    | 1000        | `false` |
| `connections` | 2000, `stopped`이면 `false` | 중지    | 1000        | 1       |
| `services`    | 없음                        | 중지    | 30000       | 1       |
| `login(id)`   | 1000, 종료 상태면 `false`   | 계속    | 0           | `false` |
| `settings`    | 없음                        | 중지    | `Infinity`  | 1       |

- `QueryClient` 기본값은 `refetchOnWindowFocus: true`, `refetchIntervalInBackground: false`입니다.
- 창 숨김은 웹뷰의 `visibilitychange`로 판단합니다. 숨김 동안 `focusManager.setFocused(false)`를 호출합니다.
- 창을 다시 열면 `status`, `connections`, `services`를 즉시 다시 가져옵니다.
- `status` 조회가 연결 거부로 실패하면 오류가 아닌 `{ state: "stopped" }`로 변환합니다. 그래서 `retry: false`입니다.
- `status`가 `starting`, `stopping`, `draining`이면 `refetchInterval`을 500으로 줄입니다.
- 대몬이 IPC 이벤트 구독을 제공하면 이벤트로 `setQueryData`를 호출합니다. 이때 `refetchInterval`은 15000으로 늘려 안전망으로만 사용합니다.
- 트레이 상태는 앱 네이티브 쪽이 별도로 5초마다 조회합니다. 웹뷰가 숨겨져도 트레이는 갱신합니다.

### 뮤테이션 후 처리

| 뮤테이션    | 화면 즉시 반영              | 완료 후 무효화                    | 시간 제한        |
| ----------- | --------------------------- | --------------------------------- | ---------------- |
| 대몬 시작   | `status.state = "starting"` | `status`, `connections`           | 10초             |
| 대몬 종료   | `status.state = "stopping"` | `status`, `connections`           | 없음 (요청 대기) |
| 연결 초기화 | `status.state = "draining"` | `status`, `connections`           | 없음 (요청 대기) |
| OAuth 시작  | 행 버튼 loading, 모달 열기  | 성공 시 `services`, `connections` | 5분              |
| 키 저장     | 모달 버튼 loading           | `services`, `connections`         | 10초             |
| 로그아웃    | 행 버튼 loading             | `services`, `connections`         | 10초             |
| 설정 변경   | `Switch` 값 즉시 변경       | 실패 시 이전 값으로 되돌림        | 10초             |

- 대몬 시작이 10초를 넘으면 알림을 띄웁니다. `대몬이 10초 안에 시작하지 않았습니다.` 상태는 다음 조회 결과를 따릅니다.
- 알림은 `@mantine/notifications`를 사용합니다. 위치는 `bottom-right`, `autoClose={3000}`, 오류는 `autoClose={6000}`입니다.

## 13. 키보드

| 키                     | 동작                                        |
| ---------------------- | ------------------------------------------- |
| `Cmd/Ctrl+1`, `2`, `3` | 연결, 서비스, 설정 이동                     |
| `Cmd/Ctrl+R`           | 현재 화면 쿼리 다시 조회                    |
| `Cmd/Ctrl+W`           | 창 숨김                                     |
| `Esc`                  | 모달 닫기 (OAuth 진행 중에는 `취소`와 같음) |

`@mantine/hooks`의 `useHotkeys`로 등록합니다.

## 14. 시간 표기

- 상대 시간은 `Intl.RelativeTimeFormat("ko", { numeric: "auto" })`를 사용합니다. 5초 미만은 `방금`입니다.
- 실행 시간은 `2시간 14분`, `3분`, `1일 4시간` 형식입니다. 초는 표시하지 않습니다.
- 닫힘까지는 `48초` 형식입니다. 0 이하이면 `닫는 중`입니다.

## 15. 파일 구성 제안

각 파일은 350라인 이하로 유지합니다. 문구는 `copy.ts` 한 곳에 모읍니다.

현재 스캐폴드의 `src/main.tsx`, `src/App.tsx`를 진입점으로 유지합니다. 아래 경로는 `src/` 기준입니다.

추가 의존성이 필요합니다.

- `@mantine/notifications`: 완료·오류 알림
- `@mantine/modals`: 로그아웃, 대몬 종료 확인

```text
apps/desktop/src/
├─ main.tsx              MantineProvider, QueryClientProvider, RouterProvider
├─ theme.ts              4절 테마
├─ router.tsx            라우트 정의, hash history
├─ copy.ts               화면 문구
├─ ipc.ts                IPC 클라이언트와 11절 타입
├─ queries.ts            쿼리 키, useQuery·useMutation 훅
├─ time.ts               14절 시간 표기
├─ shell/
│  ├─ app-shell.tsx      AppShell, 사이드바
│  └─ daemon-bar.tsx     5절
├─ connections/
│  ├─ connections-page.tsx
│  └─ connection-states.tsx  빈 상태, 오프라인, 오류 블록
├─ services/
│  ├─ services-page.tsx
│  ├─ oauth-modal.tsx
│  └─ api-key-modal.tsx
└─ settings/
   └─ settings-page.tsx
```

컴포넌트는 arrow function으로 작성합니다. `any`, non-null assertion을 사용하지 않습니다.
IPC 응답의 상태 문자열은 작은 타입가드 함수 한 곳에서 좁힙니다.
