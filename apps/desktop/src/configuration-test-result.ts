import type { MessageKey } from "../shared/i18n";

const labels: Partial<Record<string, MessageKey>> = {
  Model: "모델",
  Reasoning: "추론",
  "Input tokens": "입력 토큰",
  "Output tokens": "출력 토큰",
  "System prompt sent": "전송한 시스템 프롬프트",
  "The response alone cannot confirm whether the server applied the Reasoning option.":
    "서버의 Reasoning 옵션 적용 여부는 응답만으로 확인할 수 없습니다.",
};

export const diagnosticText = (value: string, translate: (key: MessageKey) => string): string => {
  const key = labels[value];
  return key ? translate(key) : value;
};

export const currentTestResult = (requestKey: string | undefined, currentKey: string): boolean =>
  requestKey !== undefined && requestKey === currentKey;
