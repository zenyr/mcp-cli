# 메모리 압축 평가

이 평가기는 합성 한국어 기록으로 실제 `summarize` 트리를 생성합니다. 기본 실행은 fixture manifest를 파일에 저장합니다. `--live`를 지정하면 모델을 호출합니다.

```sh
bun apps/mem/eval/main.ts --records 32 --model deepseek-v4.1-flash
bun apps/mem/eval/main.ts --live --records 32 --model deepseek-v4.1-flash --mode system --max-calls 80 --node-bytes 512 --output /tmp/mem-eval-system.json
bun apps/mem/eval/main.ts --live --records 32 --model deepseek-v4.1-flash --mode isolated --max-calls 80 --output /tmp/mem-eval-isolated.json
bun apps/mem/eval/main.ts --live --records 32 --model deepseek-v4.1-flash --thinking disabled --mode system --max-calls 80 --output /tmp/mem-eval-disabled.json
bun test apps/mem/test/evaluation.test.ts
```

- `system`은 실제 트리의 이전 요약 문맥을 전달합니다.
- `isolated`는 모든 압축 호출의 `context`를 빈 문자열로 바꿉니다. 이전 문맥으로 유실 사실을 다시 주입하지 않습니다.
- `--records`는 32부터 256까지 지원합니다. 기본값은 32입니다.
- `--model`을 생략하면 기존 설정 로더의 기본값과 `MEM_MODEL`을 사용합니다.
- 기본 API 주소는 기존 설정의 CPA 주소입니다. `MEM_BASE_URL`로 바꿀 수 있습니다.
- `MEM_API_KEY`는 요청 헤더에만 사용합니다. 보고서는 환경변수나 API 주소를 저장하지 않습니다.
- `--thinking enabled|disabled|default`는 지원하는 공급자의 추론 설정을 선택합니다. 기본값은 기존 설정을 유지합니다.

32개 기록의 최대 구조 깊이는 5입니다. 평가기는 깊이 0, 1, 2, 4, 5의 실제 노드를 보고합니다. 기록 수가 달라도 평가 깊이는 `floor(log2(records))`를 넘지 않습니다. 무관 기록은 기본 512바이트보다 짧습니다. 중요 기록 4개는 512바이트보다 길어서 기본 설정에서 리프 압축을 호출합니다. 짧은 부모는 두 자식의 텍스트를 그대로 유지합니다.

fixture는 production 취소와 staging 제한, E731의 만료 토큰 원인, 미확인 배포 상태, 사용자와 도구의 출처를 구분합니다. 각 사실은 기록 인덱스와 Unicode scalar 구간 `[from, to)`을 근거 주소로 보관합니다. 보고서는 원문 fixture와 노드 요약을 보관하므로 수동 검토자가 수정 관계를 확인할 수 있습니다.

호출 계측은 모든 압축 시도와 축약 재시도를 누적합니다. 예산 검사는 다음 압축 호출 전에 실행합니다. 예산 소진은 `budget-stopped`와 종료 코드 1로 보고합니다. 모델 오류는 `failed`로 보고합니다. 실패한 호출과 사용량이 불완전한 응답은 `unknownUsage`로 집계합니다. 토큰 합계는 사용량을 확인한 호출만 포함합니다. 알 수 없는 사용량을 무료 호출로 해석하지 마십시오. 지연 시간은 호출별 시간과 전체 실행 시간을 구분합니다.

`proxyChecks`는 기대 단어의 존재와 누락, 모순 후보 문구만 검사합니다. 이 검사는 의미 정확도나 오류율을 측정하지 않습니다. 부정문에도 모순 후보 문구가 나타날 수 있습니다. 원문과 `quotedText`를 함께 수동 검토하십시오. 기대 단어가 모두 있어도 취소 관계나 출처가 올바른지는 보증하지 않습니다.

이 버전은 검색 성능이나 에이전트 발견 능력을 평가하지 않습니다. 근거 주소를 이용한 oracle 접근성도 측정하지 않습니다. 모델 비교, 가격표 기반 비용 계산, 장기 품질 검증은 후속 평가 범위입니다. 같은 fixture와 설정으로 모델별 보고서를 만든 뒤 수동 검토와 사용량 비교가 필요합니다.

평가기는 사용자 XDG 경로와 분리된 임시 SQLite DB를 사용합니다. 종료 시 DB를 정리합니다.
보고서는 `--output` 경로에 저장합니다. 경로를 생략하면 임시 디렉터리에 고유 파일을 만듭니다.
stdout은 짧은 상태·사용량·파일 경로만 반환합니다. fixture와 전체 보고서는 파일에서 조회합니다.

호출의 `success`는 모델 응답의 정상 파싱을 뜻합니다. 크기 조건을 만족한 요약 노드의 게시 성공과 구분합니다.
전체 트리의 성공 여부는 보고서의 `status`와 `failure`로 확인합니다.

[실제 실행 결과](RESULTS.md)는 완료한 실행과 실패한 실행을 함께 기록합니다.
