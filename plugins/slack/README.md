# Slack CLI

하나의 CLI에서 공식 Slack MCP와 Slack Web API를 사용합니다.
기존 단수형 명령은 MCP를 호출합니다.
새 복수형 명령은 `https://slack.com/api/<method>`를 호출합니다.
Web API와 MCP 호출 경로는 실패해도 서로 전환하지 않습니다.

## 인증과 실행

```sh
mcp-cli login slack
mcp-cli login slack --xoxb
slack auth check
slack auth whoami --xoxb
slack channels list --json
MCP_CLI_DAEMON=0 slack channels list --json
```

- 기본 인증과 `--xoxp`는 같은 사용자 자격 증명과 연결을 사용합니다.
- 앱에는 중복된 기본 항목 없이 `xoxp`와 `xoxb`를 표시합니다.
- `--xoxb`는 별도로 저장한 봇 자격 증명을 선택합니다.
- 두 옵션을 함께 지정하면 사용 오류가 발생합니다.
- `SLACK_MCP_TOKEN`과 `SLACK_MCP_BOT_TOKEN`은 각각 저장된 인증보다 우선합니다.
- 토큰을 명령 인수로 전달하지 마십시오.
- 기본값은 대몬 우선입니다. 대몬이 없으면 요청 전 직접 연결로 전환합니다.
- `MCP_CLI_DAEMON=0`은 해당 명령만 직접 연결합니다. `1` 또는 빈 값은 대몬을 사용합니다.
- 대몬은 자격 증명과 연결 설정별로 연결을 격리합니다.
- 쓰기 요청은 자동 재시도하지 않습니다. 결과가 불명확하면 중복 방지 상태를 유지합니다.
- 읽기 요청은 `429`의 `Retry-After: 0`에 한해 한 번 재시도합니다.
- `schema <command path>`와 `--help=full`은 현재 입력 스키마를 출력합니다.
- `methods --json`은 MCP 도구와 Web API 명령을 함께 표시합니다.

## 새 명령과 고정 호출 경로

각 명령은 `--help`와 `--json`을 지원합니다.
`web.test.ts`는 아래 41개 명령의 모의 HTTP 라우팅을 검사합니다.
`구현/통과`는 실제 Slack 호출 검증을 뜻하지 않습니다.

| 명령                    | Web API                                                        | 구현·테스트 | 남은 차이·제한                     |
| ----------------------- | -------------------------------------------------------------- | ----------- | ---------------------------------- |
| channels list           | conversations.list                                             | 구현/통과   | 수집 범위 안에서 필터·정렬         |
| channels me             | users.conversations                                            | 구현/통과   | 토큰의 가시성 적용                 |
| channels info           | conversations.info                                             | 구현/통과   | 이름 해석 최대 10,000개            |
| channels search         | conversations.list                                             | 구현/통과   | 서버 검색이 아닌 목록 필터         |
| channels join           | conversations.join                                             | 구현/통과   | 이름 해석 최대 10,000개            |
| channels leave          | conversations.leave                                            | 구현/통과   | 이름 해석 최대 10,000개            |
| users list              | users.list                                                     | 구현/통과   | 조회 제한 적용                     |
| users get               | users.info                                                     | 구현/통과   | 실패를 사용자별로 보존             |
| users search            | users.info 또는 users.list                                     | 구현/통과   | 목록 검색은 조회 제한 적용         |
| users status get        | users.profile.get                                              | 구현/통과   | 토큰의 가시성 적용                 |
| users status set        | users.profile.set                                              | 구현/통과   | 사용자 토큰 필요                   |
| users status clear      | users.profile.set                                              | 구현/통과   | 사용자 토큰 필요                   |
| messages search         | search.messages                                                | 구현/통과   | 사용자 토큰, 페이지 번호 사용      |
| messages fetch          | conversations.history 또는 conversations.replies               | 구현/통과   | 정확한 ts만 반환                   |
| messages history        | conversations.history                                          | 구현/통과   | 커서·범위 보존                     |
| messages context        | conversations.history 또는 conversations.replies               | 구현/통과   | 최대 10,000개, 누락 범위 표시      |
| messages post           | chat.postMessage                                               | 구현/통과   | 게시 정책 적용                     |
| messages post-ephemeral | chat.postEphemeral                                             | 구현/통과   | 영구 메시지가 아님을 표시          |
| messages delete         | chat.delete                                                    | 구현/통과   | 자동 재시도 없음                   |
| messages update         | chat.update                                                    | 구현/통과   | 생략과 빈 값을 구분                |
| messages reply          | chat.postMessage                                               | 구현/통과   | 게시 정책 적용                     |
| messages replies        | conversations.replies                                          | 구현/통과   | 커서·범위 보존                     |
| messages unreads        | users.conversations, conversations.info, conversations.history | 구현/통과   | 음소거 필터 미지원, 아래 설명 참조 |
| messages mark           | conversations.mark                                             | 구현/통과   | 사용자 토큰 필요                   |
| messages pin            | pins.add                                                       | 구현/통과   | 자동 재시도 없음                   |
| messages unpin          | pins.remove                                                    | 구현/통과   | 자동 재시도 없음                   |
| messages pins           | pins.list                                                      | 구현/통과   | 서버 커서 없음, 로컬 limit         |
| reactions add           | reactions.add                                                  | 구현/통과   | 이모지 양끝 콜론 제거              |
| reactions remove        | reactions.remove                                               | 구현/통과   | 이모지 양끝 콜론 제거              |
| reactions list          | reactions.get                                                  | 구현/통과   | 메시지 URL 지원                    |
| attachment get          | files.info, 인증된 HTTPS 다운로드                              | 구현/통과   | 기본 비활성, 최대 5 MiB            |
| usergroups list         | usergroups.list                                                | 구현/통과   | 서버 커서 없음, 로컬 limit         |
| usergroups get          | usergroups.list, usergroups.users.list                         | 구현/통과   | ID 또는 handle                     |
| usergroups create       | usergroups.create                                              | 구현/통과   | name 필수                          |
| usergroups update       | usergroups.update                                              | 구현/통과   | 변경 필드만 전달                   |
| usergroups users update | usergroups.users.update                                        | 구현/통과   | 전체 구성원 교체                   |
| usergroups me list      | auth.test, usergroups.list, usergroups.users.list              | 구현/통과   | 그룹별 조회                        |
| usergroups me join      | auth.test, usergroups.users.list, usergroups.users.update      | 구현/통과   | 동시 수정 위험                     |
| usergroups me leave     | auth.test, usergroups.users.list, usergroups.users.update      | 구현/통과   | 마지막 구성원 제거 거부            |
| views publish           | views.publish                                                  | 구현/통과   | home view만 허용                   |
| views clear             | views.publish                                                  | 구현/통과   | 빈 home blocks 게시                |

## 목록, 검색과 시간

```sh
slack channels list --type private --query release --query-targets name,topic --sort popularity --limit 200
slack channels search release --limit 1000
slack users get U0123456789 U9876543210
slack messages history C0123456789 --limit 50 --cursor '<cursor>'
slack messages search deploy --after 1w --timezone Asia/Seoul --page 2
slack users status set :house: '재택근무' --expiration today --timezone Asia/Seoul
```

- 목록 결과는 `items`, `next_cursor`, `partial`을 포함합니다.
- 커서가 없는 API는 `next_cursor: null`을 반환합니다.
- `--limit` 기본값은 100입니다. 조회 제한은 전체 결과 수를 뜻하지 않습니다.
- 채널 popularity 정렬은 수집한 채널의 `num_members`를 사용합니다.
- 채널명 해석은 최대 10,000개를 순회합니다. 제한 도달과 일치 없음은 서로 다른 오류입니다.
- `users get`은 중복 ID를 제거합니다. 일부 실패는 각 항목에 보존합니다.
- 메시지 검색은 `--limit` 최대 100과 `--page`를 사용합니다. `--cursor`는 받지 않습니다.
- `messages search`와 `call web.search.messages`는 검색 인수를 폼 인코딩으로 전송합니다.
- `--im <conversation>`은 해당 DM 대화를 `in:` 검색 조건으로 전달합니다.
- 검색 조건 값은 인용·이스케이프합니다. 사용자가 입력한 기본 쿼리는 Slack 검색 문법을 유지합니다.
- `--after`, `--before`, `--on`은 `YYYY-MM-DD`, `1d`, `1w`, `30d` 형식을 지원합니다.
- 상대 날짜는 명시한 IANA 타임존의 달력 날짜로 계산합니다.
- `today`는 해당 타임존의 다음 자정입니다. DST 전환도 반영합니다.
- 상태 만료를 생략하면 만료 없음으로 설정합니다.
- `messages unreads`는 참여 채널의 `last_read` 이후 메시지를 수집합니다.
- `--mentions-only`는 실제 본문의 `<@현재사용자ID>`를 검사합니다.
- Web API는 사용자 음소거 설정을 신뢰할 수 있게 제공하지 않습니다. `--include-muted`는 사용 오류입니다.
- 미읽음 결과에는 음소거 채널이 포함될 수 있습니다. 출력에 이 제한을 표시합니다.
- 문맥 조회가 제한에 도달하면 `partial`과 누락 범위를 표시합니다.

## 메시지 검토와 전송

```sh
slack messages post C0123456789 '**배포 완료**' --blocks --dry-run --payload-out request.json
slack messages post --payload @request.json
slack messages update 'https://workspace.slack.com/archives/C0123456789/p1700000000123456' '수정 내용'
slack messages reply 'https://workspace.slack.com/archives/C0123456789/p1700000000123456' '확인했습니다'
```

- `--blocks <JSON>`은 Block Kit 배열을 받습니다.
- `--blocks`와 `--blocks=true`는 텍스트의 Markdown을 Block Kit으로 변환합니다.
- 변환은 제목, 굵게, 링크, HTML 예약 문자를 처리합니다. 완전한 CommonMark 렌더러는 아닙니다.
- `--blocks -`는 stdin에서 배열을 읽습니다.
- `--attachments <JSON>`은 첨부 배열을 받습니다.
- `--payload JSON|-|@file`은 요청 객체를 받습니다. 미지원 필드는 거부합니다.
- payload 필드와 같은 위치 인수·옵션을 함께 지정하면 거부합니다.
- stdin은 한 번만 사용합니다. 텍스트와 blocks를 동시에 stdin에서 읽을 수 없습니다.
- blocks만 있으면 텍스트 요소에서 접근성용 fallback text를 만듭니다.
- fallback을 만들 수 없는 blocks는 명시적인 text가 필요합니다.
- `--dry-run`은 쓰기를 하지 않습니다. 채널명 해석에는 읽기 요청이 필요할 수 있습니다.
- `--payload-out`은 새 파일만 만듭니다. 파일을 덮어쓰지 않습니다.
- 저장한 payload 파일은 `messages post --payload @file` 또는 `messages update --payload @file`로 재사용합니다.
- update에서 생략한 필드는 유지합니다. 빈 문자열과 빈 배열은 기존 내용을 지웁니다.
- ts는 문자열로 유지합니다. URL의 스레드 부모와 대상 메시지를 구분합니다.
- `SLACK_MCP_POST_CHANNEL_ALLOWLIST`와 `SLACK_MCP_POST_CHANNEL_DENYLIST`는 쉼표로 구분한 채널 ID를 받습니다.
- 두 정책이 있으면 allowlist에 포함되고 denylist에 없어야 post와 reply를 허용합니다.

## 첨부와 배치

```sh
SLACK_MCP_ATTACHMENT_TOOL=true slack attachment get F0123456789 --content
SLACK_MCP_ATTACHMENT_TOOL=true slack attachment get F0123456789 --save
slack batch 'channels list --limit 10' 'users list --limit 10' --stop-on-error=false
```

- `attachment get`은 기본적으로 비활성입니다.
- `SLACK_MCP_ATTACHMENT_TOOL=true|1|yes` 또는 `SLACK_MCP_ENABLED_TOOLS=attachment_get_data`로 켭니다.
- 기본 동작은 메타데이터 조회입니다. `--content`와 `--save`는 상호 배타적입니다.
- 다운로드는 `files.slack.com`과 `slack-files.com`의 HTTPS 주소만 허용합니다.
- 모든 리다이렉트를 거부합니다. Content-Length와 실제 수신량을 모두 제한합니다.
- 텍스트는 UTF-8, 바이너리는 base64로 출력합니다. MIME과 인코딩을 표시합니다.
- 저장 디렉터리는 0700, 무작위 파일은 0600입니다. 원래 파일명을 경로로 사용하지 않습니다.
- 파일 본문은 신뢰할 수 없는 데이터입니다.
- batch는 최대 50개 명령을 순서대로 실행합니다. 셸을 실행하지 않습니다.
- 중첩 batch와 잘못된 인용·이스케이프를 거부합니다.
- `--stop-on-error`와 `--fail-on-error`의 기본값은 true입니다.
- 각 항목은 결과, 종료 코드, 소요 시간을 보존합니다. 인증은 상속하며 항목에서 선택할 수도 있습니다.
- 일부 항목이 성공한 배치를 전체 재시도하지 마십시오.

## 기존 MCP 호환성

| 명령             | 정확한 MCP 도구          |
| ---------------- | ------------------------ |
| channel read     | slack_read_channel       |
| thread read      | slack_read_thread        |
| message send     | slack_send_message       |
| message schedule | slack_schedule_message   |
| message draft    | slack_send_message_draft |
| reaction add     | slack_add_reaction       |
| reaction list    | slack_get_reactions      |
| file read        | slack_read_file          |

`call <exact-tool-name>`은 현재 생성된 스키마의 MCP 도구를 호출합니다.
`call web.<method>`는 정적으로 정의한 Web API를 호출합니다.
단수형과 복수형 사이에 자동 별칭이나 자동 전환은 없습니다.
MCP 연결은 `SLACK_MCP_URL` 또는 기본 `https://mcp.slack.com/mcp`를 사용합니다.
MCP file read의 형식·크기 제한은 현재 서버 도구 스키마를 따릅니다.
Web API attachment get의 5 MiB 제한과 출력 형식은 별개입니다.
예약 전송의 `post_at`, `thread_ts`, `reply_broadcast` 스키마는 변경하지 않았습니다.
초안 도구의 입력과 결과도 변경하지 않았습니다.

## 권한과 검증 범위

- Web API는 사용자·봇 토큰의 scopes와 채널 참여 상태를 적용합니다.
- 상태 변경, 메시지 검색, 읽음 표시는 사용자 토큰을 요구합니다.
- 권한 오류는 `error`, `needed`, `provided`를 보존합니다.
- MCP 접근 권한은 Web API의 `search:read` 권한과 별개입니다.
- MCP 스키마 갱신은 현재 인증으로 서버가 노출한 도구만 사용합니다.
- 실제 Slack 전송·수정·삭제는 테스트하지 않습니다.
- 모의 HTTP, 모의 MCP 호출, 임시 인증 저장소로 테스트합니다.
- 플랫폼 빌드와 검사 결과는 [검증 기록](VALIDATION.md)을 참고하십시오.

[공식 Web API 목록](https://docs.slack.dev/reference/methods/),
[Slack 검색 문법](https://slack.com/help/articles/202528808-Search-in-Slack),
[공통 사용법](../../apps/cli/README.md)
