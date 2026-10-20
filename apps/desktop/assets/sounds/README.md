# UI 효과음

다섯 효과음은 결과를 재현할 수 있는 로컬 모달 합성으로 제작했습니다.
Fish Audio 생성, 외부 샘플과 API 호출을 사용하지 않습니다.
모든 파일은 모노 48 kHz, 부호 있는 16비트 PCM WAV이며 양 끝은 무음입니다.

| 이벤트         | 선택한 후보 | 파일            |
| -------------- | ----------- | --------------- |
| 대몬 준비 완료 | 시작 B      | `start-b.wav`   |
| 호버           | 호버 B      | `hover-b.wav`   |
| 클릭           | 클릭 B      | `click-b.wav`   |
| 완료           | 완료 A      | `success-a.wav` |
| 오류           | 오류 A      | `error-a.wav`   |

`apps/desktop`에서 `bun scripts/sounds.ts`를 실행하면 WAV와 내장 효과음 데이터를 다시 생성합니다.
선택한 합성 설정은 `scripts/sound-recipes.ts`, PCM 합성은 `scripts/sound-synthesis.ts`에서 관리합니다.
