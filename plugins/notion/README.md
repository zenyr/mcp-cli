# Notion CLI 작업 안내

저장소에서는 `bun run cli notion ...`을 실행합니다. 전역 연결 후에는 `notion ...`을 사용합니다.
`notion --help`, 그룹 도움말, `methods`, `skill`은 서버에 연결하지 않습니다.
개별 명령의 `--help`는 인자와 예시를, `--help=full`은 서버 설명 원문과 중첩 JSON 스키마를 표시합니다.
`notion access check`로 연결된 계정의 도구와 요금제 제한을 확인합니다.
캘린더, 댓글 관리, 기억, 스킬 설정은 연결과 요금제에 따라 달라집니다.
생성한 도구 정의에 없는 명령은 도움말에 나타나지 않습니다.

[공통 사용법](../../apps/cli/README.md)과 [플러그인 개발 안내](../README.md)를 참고하십시오.

## 캘린더

1. `notion calendar list`로 계정과 캘린더를 선택합니다.
2. `notion calendar event list --timeMin 2026-10-20T00:00:00+09:00 --timeMax 2026-10-21T00:00:00+09:00 --timeZone Asia/Seoul`로 일정을 조회합니다.
3. `notion calendar contact search --queries '["teammate@example.com"]'`로 참석자를 확인합니다.
4. 쓰기 전에 캘린더, 시간대, 참석자와 변경 내용을 확인합니다.

`calendar event list-coworkers`는 `--coworkerEmails` 배열에 지정한 동료의 일정 상세를 반환합니다.
`calendar room list`는 해당 캘린더 계정에서 지정한 시간에 사용 가능한 회의실을 조회합니다.
회의실 조회에는 Google Workspace의 캘린더 리소스 조회 권한이 필요합니다.
`minCapacity`에는 주최자도 포함합니다.

`calendar list`에서 받은 계정과 캘린더 ID로 아래 내용을 채우고 `events.json`에 저장합니다.

```json
{
  "timeZone": "Asia/Seoul",
  "events": [
    {
      "calendar": { "accountId": "<account-id>", "calendarId": "<calendar-id>" },
      "summary": "출시 검토",
      "period": {
        "type": "DATE_TIME",
        "start": { "dateTime": "2026-10-20T10:00:00+09:00" },
        "end": { "dateTime": "2026-10-20T10:30:00+09:00" }
      },
      "attendees": [{ "email": "teammate@example.com" }]
    }
  ]
}
```

확인 후 `notion calendar event create --input-file events.json`을 실행합니다.
종일 일정은 `period.type: "DATE"`와 `start.date`, `end.date`를 사용합니다.
생성, 수정, 취소는 참석자에게 알림을 보낼 수 있습니다. 한 번에 최대 50개 일정을 처리합니다.

다른 사람이 주최한 일정을 거절할 때는 취소 대신 `calendar event update`를 사용합니다.
`calendar event list`에서 받은 일정 식별자로 아래 내용을 채우고 `updates.json`에 저장합니다.

```json
{
  "timeZone": "Asia/Seoul",
  "updates": [
    {
      "updateType": "RSVP",
      "event": {
        "calendar": { "accountId": "<account-id>", "calendarId": "<calendar-id>" },
        "eventId": "<event-id>"
      },
      "rsvp": { "responseStatus": "declined" }
    }
  ]
}
```

`notion calendar event update --input-file updates.json`을 실행합니다.
내용 수정은 현재 일정과 도움말을 확인한 뒤 `updateType: "UPDATE"`와 `update` 객체를 사용합니다.
직접 관리하는 일정을 취소하려면 같은 일정 식별자를 `events` 배열에 넣어 `calendar event cancel`에 전달합니다.

## 댓글과 삭제

수정하거나 답글을 달기 전에 `comment list`를 실행하고 반환된 댓글 또는 토론 ID를 사용합니다.

- `comment create --reply-to-comment-id <id> --page-id <page-id> --markdown '감사합니다'`: 답글 작성
- `comment update --comment-id <id> --markdown '수정한 내용'`: 자신의 댓글 전체 교체
- `comment react --comment-id <id> --emoji '👍' --reacted`: 반응 추가. `--no-reacted`로 제거
- `comment resolve --discussion-id <id> --resolved`: 토론 해결. `--no-resolved`로 다시 열기

토론 해결은 사용자가 명시적으로 요청한 경우에만 실행합니다.
댓글 수정, 삭제, 해결과 반응에는 Business 또는 Enterprise 요금제가 필요합니다.

`page delete --page-ids '["<id>"]'`는 휴지통으로 이동할 페이지를 미리 보여줍니다.
`database delete --database-ids '["<id>"]'`는 행을 포함한 데이터베이스 삭제를 미리 보여줍니다.
미리보기를 사용자에게 보여주고 확인받은 뒤 `--user-confirmed`를 붙여 다시 실행합니다.
휴지통의 페이지와 데이터베이스는 `page restore`로 복원합니다.

## 파일, 기억과 스킬

`page get`은 업로드한 파일을 기본으로 `notion-file-block://` 참조로 반환합니다.
`--include-file-urls`는 서명 URL을 즉시 가져옵니다.
참조를 `attachment urls --references '["<reference>"]'`에 그대로 전달해도 됩니다.
서명 URL은 만료되므로 페이지에는 안정적인 참조를 보관합니다.
`page backlinks --page-id <id>`로 참조 페이지를 찾고, `next_cursor`를 `--cursor`에 전달해 이어서 조회합니다.

기억을 사용하기 전에 대화마다 한 번 `notion resources read notion://docs/memory`를 실행합니다.
`memory search --query '출시 선호 사항'`은 연결된 에이전트가 저장한 기억을 검색합니다.
목록이나 필터 조회에는 `page get --id memory`가 반환한 데이터 소스를 사용합니다.
이 기능은 저장소의 별도 CLI인 [mem](../../apps/mem/README.md)과 다릅니다.

`agent-skill list-enabled`는 외부 MCP 클라이언트가 사용할 수 있는 스킬을 조회합니다.
스킬을 불러오기 전에 사용자에게 알리고 `agent-skill download`를 실행합니다.
활성화하려면 `agent-skill update-enabled`에 다음 JSON을 전달합니다.

```json
{
  "add_skill_urls": ["https://www.notion.so/<skill-page-id>"],
  "surfaces": ["mcp"]
}
```

비활성화에는 `remove_skill_urls`를 사용합니다.
`surfaces`는 `mcp`와 `notion_ai`를 받습니다. 생략하면 둘 다 변경합니다.

## 페이지와 데이터베이스 동작

- 검색 필터는 중첩 구조를 유지합니다: `search workspace --query roadmap --filters.created_by_user_ids '["me"]'`.
- `page create`의 `creation_mode: "draft"`는 목적지 없는 비공개 페이지를 만듭니다. `parent`와 함께 쓰지 않습니다.
- `page update --command update_content`는 `--content-updates '[{"old_str":"초안","new_str":"완료"}]'`를 받습니다.
- 수정 경고를 확인합니다. 일부 일치 항목만 수정될 수 있으므로 재시도 전에 다시 조회합니다.
- `data-source update --page-layout`으로 배치를 교체하기 전에 `notion://docs/database-page-layouts`를 읽습니다.
- 보기 설정은 지도, 차트와 양식 지시문을 지원합니다. 변경 전에 기존 설정을 조회합니다.
- 비동기 작업은 `task get`으로 기다립니다. 템플릿 내용은 작업 성공 후에도 `page get`으로 추가 확인이 필요할 수 있습니다.

`call <MCP-tool-name>`에도 매핑 명령과 같은 스키마와 정책을 적용합니다.
후속 단계용 도구 두 개는 도구 결과에 포함된 지시를 처리하므로 `call`에서만 제공합니다.
