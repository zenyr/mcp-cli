# Fish Audio 음성 제작 안내

전역 연결을 바꾸지 않고 저장소에서 실행합니다.

```bash
bun bin/fish-audio.ts tts '안녕하세요' --voice <voice-id> -o hello.wav --yes
printf '첫 문장.\n둘째 문장.\n' | bun bin/fish-audio.ts tts - -o hello.mp3 --yes
bun bin/fish-audio.ts script --file story.txt -o story.mp3 --estimate
bun bin/fish-audio.ts script --file story.txt -o story.mp3 --max-credits 10000 --concurrency 2 --yes
bun bin/fish-audio.ts stt --file meeting.m4a -o meeting.txt --speakers
bun bin/fish-audio.ts stt --file meeting.m4a -o meeting.json --json
bun bin/fish-audio.ts roundtrip '발음 확인 문장' --audio hello.wav --max-cer 0.1
bun bin/fish-audio.ts roundtrip '발음 확인 문장' -o check.mp3 --yes --max-cer 0.1
```

`bun run cli fish-audio ...`도 같은 구현을 실행합니다.
`tts`와 `stt`는 음성 생성과 전사 도구에 편의 입력을 제공합니다.
`script`는 생성과 병합을, `roundtrip`은 생성·전사·정규화한 문자 오류율(CER) 비교를 처리합니다.
`--fail-over`는 `--max-cer`의 별칭입니다. CER 기준을 넘으면 종료 코드 1을 반환합니다.

`--file`과 위치 인자는 함께 사용할 수 없습니다.
`tts -`는 표준 입력의 텍스트와 내부 줄바꿈을 읽습니다. `stt -`는 음성 바이트 대신 URL을 읽습니다.
로컬 음성은 `@경로`나 `--file`로 지정합니다. 실행기는 업로드 전에 파일을 읽고 해시를 계산합니다.
전사 기본값은 서버가 정합니다. `--text`는 전사 텍스트를 표준 출력에, `--speakers`는 화자 표시를 포함합니다.
`--json`은 결과를 감싼 JSON 구조를 유지합니다. TXT와 JSON 내보내기를 지원합니다.
서비스가 타임스탬프를 반환하지 않으므로 SRT와 VTT는 거부합니다.

`--estimate`와 `--dry-run`은 음성을 생성하지 않습니다.
다만 계정의 바이트 한도와 잔액을 조회하므로 연결과 인증이 필요할 수 있습니다.
`help`, `methods`, `skill`, `--skill`은 서버에 연결하지 않습니다.
`voice search --self`나 `voice search --language ko`로 목소리를 선택합니다.
`skill`에는 실제 목소리 ID를 내장하지 않습니다.

[공통 사용법](../../apps/cli/README.md)과 [플러그인 개발 안내](../README.md)를 참고하십시오.

## 예산과 재개

원고는 문단, 문장, 절과 공백에서 분할하며 문자소와 인라인 태그의 경계를 보존합니다.
요청마다 2,000자와 계정의 UTF-8 바이트 한도를 모두 지킵니다.
첫 응답에서 이후 조각에 사용할 목소리를 고정합니다. 목소리 정보가 없으면 생성을 중단합니다.
동시 실행 수는 1~4입니다.

계획은 캐시가 없는 텍스트의 UTF-8 바이트당 2크레딧을 예약합니다.
두 배 요율의 목소리와 단일 조각에도 같은 예약을 적용합니다.
각 작업자는 요청 전에 크레딧을 예약하고, 보고된 청구량으로 예약량을 대체합니다.
이는 로컬 추정치입니다. 서버의 과금 상한을 강제하지 않습니다.
`--max-credits`는 음성 생성만 포함하며 왕복 검증의 추가 전사 비용은 포함하지 않습니다.
서비스 가격이 바뀌면 추정치를 초과할 수 있습니다.
비대화형 생성에는 `--yes`가 필요합니다. 대화형 생성은 확인을 요청합니다.

로그인, 텍스트와 생성 옵션이 같으면 `$XDG_CACHE_HOME/mcp-cli/fish-audio/`를 재사용합니다.
기본 경로는 `~/.cache/mcp-cli/fish-audio/`입니다. 출력 경로가 달라도 응답과 음성 파일을 재사용합니다.
인증 식별자로 캐시를 분리하며 토큰은 캐시에 저장하지 않습니다.
OAuth 갱신은 기존 구분을 유지하고, 새 로그인은 새 구분을 만듭니다.

- `pending`: 호출을 시작했지만 응답을 영구 저장하지 못했습니다. 일반 중복 실행 기간이 지나도 자동 재시도를 막습니다.
- `generated`: 응답을 영구 저장했습니다. 유료 호출 없이 다운로드나 파일 내보내기를 재개합니다.
- `ready`: 음성 파일을 영구 저장했습니다. 변환과 병합에 재사용합니다. 파일이 없으면 저장한 응답을 사용합니다.
- `failed`: 서버가 `isError`를 반환했거나 요청 전송이 시작되지 않았음을 확인했습니다. 명시적인 서버 오류는 같은 실행 정책으로 한 번 재시도합니다. 전송 전 실패는 호출자에게 반환하며 재시도할 수 있습니다.

완료된 파일은 보관합니다. 이전 버전 호환용 `--keep-parts`를 받지만 조각은 항상 보관합니다.
생성 옵션은 캐시 키에 포함합니다. 전사 기록에는 로컬 파일 해시와 모델도 포함하므로 파일 쓰기 실패를 재개할 수 있습니다.
HTTPS URL은 원격 입력을 식별합니다. 내용이 바뀌면 다른 URL이나 새 출력 캐시를 명시적으로 사용합니다.

업로드 위치 요청을 포함한 모든 원격 호출에 기존 중복 실행 방지를 적용합니다.
`--allow-repeat`는 작업 기록을 지우지 않습니다.
중복 방지를 우회하려고 `pending` 기록을 삭제하지 마십시오. 추가 유료 요청 전에 서비스 결과를 확인합니다.

캐시 범위 잠금과 출력별 잠금은 같은 로그인이나 목적지를 쓰는 동시 프로세스를 거부합니다.
한 작업 안의 원고 처리 작업자는 병렬 실행할 수 있습니다.
SIGINT와 SIGTERM은 새 작업을 중단하고 진행 중 요청이 끝난 뒤 연결을 닫습니다. 두 번째 신호는 즉시 종료합니다.
강제 종료 뒤에는 캐시 잠금과 `<output>.parts/.lock/owner.json`이 남을 수 있습니다. 오류에 잠금 경로를 표시합니다.
수동으로 잠금을 지우기 전에 소유 프로세스 종료와 미확정 요청의 처리 상태를 확인합니다.
손상된 기록은 실행을 막습니다. 파일은 임시 파일 쓰기, fsync, rename 순서로 저장합니다.
다운로드나 ffmpeg 실패 시 기존 목적지 파일을 보존합니다.

출력 확장자로 MP3, WAV, OGG, FLAC, M4A, AAC와 WebM을 선택합니다.
연결 구현은 음성 바이트를 검사하고 변환이나 병합이 필요하면 ffmpeg를 실행합니다.
여러 조각을 생성하기 전에 ffmpeg를 설치하십시오.
저장한 URL이 만료되어도 유료 생성을 자동으로 다시 실행하지 않습니다.

## 파일과 미디어 상태

그룹 도움말로 명령을 선택합니다. `--help`는 간단한 사용법을, `--help=full`은 중첩 입력의 역할과 서버 명세 전체를 표시합니다.
다음 명령 전에 `account workspaces`로 작업 공간을 선택합니다.

```bash
fish-audio asset collection list --workspace-id <workspace-id> --all
fish-audio asset list --workspace-id <workspace-id> --collection-id <collection-id>
fish-audio asset list --workspace-id <workspace-id> --search portrait --kinds '["image"]'
fish-audio asset get --workspace-id <workspace-id> --asset-id <asset-id>
```

컬렉션에는 폴더, 아바타와 스타일이 들어갑니다. `asset list`는 파일을 반환합니다.
파일 목록을 이어서 조회하려면 같은 필터와 이전 `next_cursor`를 `--cursor`에 전달합니다.
`asset get`은 원본 `object_key`와 임시 다운로드 URL을 반환합니다.
호환되는 생성 입력에는 썸네일 URL 대신 원본 객체 키를 사용합니다.

`asset save`는 완료된 업로드(`--object-key`)나 성공한 생성(`--source-task-id`)을 보관합니다.
다시 저장하면 기존 위치를 반환합니다. 이동과 이름 변경에는 `asset update`를 사용합니다.
`collection_id`를 생략하면 위치를 유지합니다. 최상위로 이동하려면 JSON null을 전달합니다.

```bash
fish-audio asset update --input '{"workspace_id":"<workspace-id>","asset_id":"<asset-id>","collection_id":null}'
```

`--collection-id null`은 문자열 `"null"`을 보냅니다. 실제 null은 `--input`으로 지정합니다.
`asset folder create`는 폴더를, `asset avatar create`는 준비된 이미지 하나에서 아바타를 만듭니다.
아바타 입력은 `object_key`, `source_task_id`, `portrait_asset_id` 중 하나를 선택합니다.
`default_voice_id`는 선택 사항입니다.
생성 명령에는 UUID 형식의 `request_id`가 필요합니다. 응답을 잃으면 같은 입력과 ID로 복구합니다.
보관된 인물 사진을 아바타로 이동하려면 `--move-existing`을 명시적으로 승인해야 합니다.
아바타 생성은 미디어를 생성하지 않습니다.
인물 사진을 나중에 바꾸려면 `asset update`로 이미지를 컬렉션에 옮기고 `asset collection update`를 실행합니다.
컬렉션 명령은 컬렉션 삭제나 스타일 생성을 제공하지 않습니다.

생성을 추정하기 전에 `media model get`으로 모델의 입력 역할과 기능을 선택합니다.
`inputs` 배열은 `{ "role": "...", "object_key": "..." }` 항목을 받습니다.
`--input-object-key`는 단일 입력의 축약형입니다. 영상 생성은 `--operation`으로 기능도 선택합니다.
먼저 비용을 추정한 뒤 같은 생성 입력과 반환된 가격 값을 제출합니다.

```bash
fish-audio media job status --generation-id <generation-id>
fish-audio media job status --generation-ids '["<generation-id-1>","<generation-id-2>"]'
```

ID 하나 또는 최대 20개를 지정합니다.
상태 조회는 공급자의 처리 상태와 크레딧을 맞출 수 있습니다. 반환된 `poll_after_seconds` 뒤에 다시 조회합니다.
후속 묶음에는 진행 중인 ID만 남깁니다.
완료 응답에 결과가 포함되므로 `media job result`를 별도로 호출할 필요가 없습니다.

## 기존 독립 CLI에서 이전

기존 독립 저장소와 전역 PATH를 유지합니다.
`bun bin/fish-audio.ts`나 `bun run cli fish-audio`로 명령을 시험합니다.
필요하면 기존 `mcp-cli login fish-audio` 인증을 사용합니다. 독립 프로젝트의 자격 증명 파일을 복사하지 않습니다.

`speech create`, `transcription create`, `call <tool>`은 기존 스키마, 플래그, MCP JSON 출력과 종료 코드를 유지합니다.
위치 인자 음성 입력은 `tts`나 `stt`를 사용합니다.
독립 CLI의 `auth login`, `tools`, `schema`, `parity`는 mcp-cli 명령이 아닙니다.
대신 `mcp-cli login fish-audio`, `methods`, 명령 도움말과 기존 생성 절차를 사용합니다.

테스트는 가짜 도구 연결과 로컬 음성 데이터를 사용합니다. ffmpeg가 있으면 변환도 검증합니다.
이 통합에서 실제 원격 음성 품질, 현재 과금과 전체 원격 스키마의 일치 여부는 검증하지 않았습니다.
