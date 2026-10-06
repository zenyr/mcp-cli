# Working rules

- 한국어 응답은 존댓말로 짧은 결론부터 작성합니다.
- GitHub 작업에는 `gh`만 사용합니다.
- 같은 저장소의 Git 쓰기 작업은 직렬로 실행합니다.
- 코드 작성과 커밋 전에 `coding-rules` 스킬의 여섯 항목을 점검합니다.
- 함수 구현은 arrow function을 사용합니다. 생성 코드는 예외입니다.
- `any`, `as any`, `as unknown`, non-null assertion을 사용하지 않습니다. 생성 코드는 예외입니다.
- 타입가드는 작은 유틸 함수 또는 테스트에서 제한적으로 사용합니다.
- 파일은 350라인을 소프트캡으로 유지합니다. 생성 코드·fixture·테스트는 예외입니다.
- SDK 의존성은 연결 구현에 둡니다. 서비스 설정과 정책은 플러그인에 둡니다.
- 코드 주석은 한 문장 이내로 유지합니다.

# Verification and commits

- `bun run check`: oxlint, 코드 규칙, 타입 검사, 테스트
- `bun run format`: oxfmt 자동 포맷
- Lefthook은 커밋 전 staged 파일을 자동 포맷하고 재스테이지합니다.
- 포맷 후 lint 실패는 수정합니다. 훅을 우회하지 않습니다.
- 커밋 메시지는 `feat(scope): description`처럼 scope가 있는 Conventional Commit을 사용합니다.
- 안정화된 변경을 검증한 뒤 슬라이스별로 커밋합니다.
