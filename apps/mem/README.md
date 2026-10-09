# mem

`mem`은 원문과 요약 트리를 로컬 SQLite에 저장합니다. 기본 모델은 로컬 CPA의 OpenCode GO `deepseek-v4.1-flash`입니다.

```sh
bun run mem start
bun run mem save '프로젝트 결정 사항'
bun run mem save --stdin --kind talk < transcript.txt
bun run mem save --file notes.txt --receipt 550e8400-e29b-41d4-a716-446655440000
bun run mem recall '결정' --max-bytes 1024
bun run mem read '<scopeId>/0' --cursor 0
bun run mem summarize
bun run mem status
bun run mem config
```

직접 실행하려면 `bun apps/mem/src/main.ts` 뒤에 같은 인수를 사용합니다.

- `save`는 현재 Git 프로젝트에 저장합니다. Git 프로젝트 밖에서는 `--global`을 지정합니다.
- `start`, `recall`, `status`, `summarize`는 기본으로 전역과 현재 프로젝트를 선택합니다.
- `--global`과 `--project`는 함께 사용할 수 없습니다.
- `start`는 모델을 호출하지 않습니다. 미완료 요약이 있으면 `mem summarize`를 안내합니다.
- 저장 후 요약이 실패해도 원문은 남습니다. 오류의 `recordId`, `receipt`, `recoveryCommand`를 사용합니다.
- 같은 receipt와 같은 원문은 같은 레코드를 반환합니다. 다른 원문은 충돌 오류를 반환합니다.
- `recall`은 NFC 정규화와 소문자 변환으로 검색합니다. 결과는 최신순입니다.
- `recall`의 `cursor`는 같은 검색어와 범위에서 사용합니다. 새 저장은 기존 페이지에 들어오지 않습니다.
- `read`의 `cursor`는 원문의 Unicode scalar 위치입니다. 다음 페이지에 응답의 cursor를 전달합니다.
- JSON 응답 전체와 마지막 줄바꿈은 `--max-bytes`에 포함됩니다. 기본값은 8192바이트입니다.
- 성공과 오류는 stdout에 JSON 객체 하나를 출력합니다. 도움말은 일반 텍스트입니다.
- 종료 코드는 성공 0, 실행 실패 1, 옵션 오류 2입니다.

`--model`과 `--base-url`로 연결 설정을 덮어쓸 수 있습니다. 연결은 `/chat/completions`를 제공하는 HTTP 서버를 사용합니다. `MEM_API_KEY`가 있으면 Authorization 헤더로 전달합니다.

## 설정과 저장 위치

설정 파일은 `$XDG_CONFIG_HOME/mem/config.json`입니다. 변수가 없거나 상대 경로이면 `~/.config`를 사용합니다.
원문과 요약은 `$XDG_DATA_HOME/mem/memory.sqlite`에 저장합니다. 변수가 없거나 상대 경로이면 `~/.local/share`를 사용합니다.
SQLite는 WAL과 FULL 동기화를 사용합니다. 프로젝트별 원문과 글로벌 원문은 같은 파일에서 scope로 분리합니다.

```json
{
  "baseUrl": "http://127.0.0.1:8317/v1",
  "model": "deepseek-v4.1-flash",
  "nodeBytes": 512,
  "contextBytes": 8192,
  "inputBytes": 131072,
  "timeoutMs": 60000,
  "maxOutputTokens": 4096
}
```

`MEM_BASE_URL`, `MEM_MODEL`, `MEM_NODE_BYTES`는 파일 설정보다 우선합니다. `mem config`는 적용한 설정을 보여줍니다.
`MEM_MAX_OUTPUT_TOKENS`는 모델의 출력 상한을 변경합니다. 추론 토큰도 해당 상한을 사용할 수 있습니다.
출력 상한과 timeout 변경은 기존 generation을 유지하므로 중단된 작업을 재개할 수 있습니다.
API 키는 `MEM_API_KEY`로만 받습니다. CLI는 API 키를 설정 출력에 포함하지 않습니다.
이 버전은 임의 명령을 실행하는 요약 어댑터를 제공하지 않습니다.

프로젝트 ID는 Git 공통 디렉터리의 `mem-project-id` 파일에 저장합니다.
`mem.project-id` Git 설정이 있으면 그 값을 우선합니다.
연결된 worktree는 같은 프로젝트 기억을 사용합니다.
별도 clone은 자동 연결하지 않습니다.

## 요약과 복구

`save`는 원문을 먼저 기록합니다. 요약기는 긴 메시지를 압축하고 인접한 형제 요약을 부모로 병합합니다.
짧은 잎은 출처를 포함한 원문을 유지합니다. 부모 요약에는 LLM을 사용합니다.
요약기는 사용자 결정, 정정, 금지, 실패 원인을 보존하도록 지시합니다.
모델이 지시를 준수하는지는 별도 품질 평가가 필요합니다.

노드의 목표는 기본 512 UTF-8 바이트입니다. 요약기는 목표의 1.25배 이하면서 입력보다 작은 응답을 수락합니다.
길이 축소 요청은 최대 3회입니다. 계속 초과하면 원문을 유지하고 오류를 반환합니다.
요약의 설정을 바꾸면 새 generation에서 트리를 생성합니다. 기존 generation의 완성 노드는 변경하지 않습니다.

`start`는 모든 원문 구간을 덮는 요약을 출력합니다. 선택기는 응답 전체가 예산에 들어갈 때까지 형제 요약을 병합합니다.
예산을 충족하지 못하면 CLI는 `MEMORY_OVERFLOW`를 반환합니다. 일부 과거 구간을 조용히 제외하지 않습니다.
선행 요약 문맥이 `contextBytes`를 넘으면 요약도 중단합니다. 해당 예산을 늘린 뒤 `mem summarize`로 새 generation을 만드십시오.

원문 한 건의 최대 크기는 1 MiB입니다. 모델 요청은 JSON과 지침을 포함해 `inputBytes`를 검사합니다.
이 바이트 검사는 모델별 토큰 상한의 보장이 아닙니다.
`usage`는 정상 파싱한 요약 응답의 사용량을 집계합니다. 실패하거나 잘린 응답의 과금량은 알 수 없습니다.
`unmeasuredCalls`는 응답에 유효한 토큰 집계가 없었던 호출 수입니다.

세션 시작 지침이나 호스트 hook에서 `mem start`의 stdout을 문맥에 넣어야 시작 주입이 동작합니다.
이 CLI는 호스트 지침과 hook을 자동 수정하지 않습니다.

현재 버전은 CLI 첫 단계입니다. 자동 세션 hook, 엄격한 모델 token context 제한, 요약의 의미 품질 보장, V2 전체 기능과 pin은 구현하지 않습니다.

[검증 기록](VERIFICATION.md)은 자동 테스트와 실제 OpenCode GO 요약의 결과를 구분합니다.
