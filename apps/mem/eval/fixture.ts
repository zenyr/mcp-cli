import type { Kind } from "../src/types";

export type FixtureRecord = { label: string; kind: Kind; text: string };
export type Fact = {
  id: string;
  evidence: { i: number; from: number; to: number }[];
  expected: string[];
  contradictoryCandidates: string[];
};

export const createFixture = (count = 32) => {
  if (!Number.isSafeInteger(count) || count < 32 || count > 256)
    throw new Error("records must be an integer from 32 to 256");
  const records: FixtureRecord[] = Array.from({ length: count }, (_, i) => ({
    label: `irrelevant-${i.toString().padStart(3, "0")}`,
    kind: "note",
    text: `무관 기록 ${i}: 회의실 번호를 확인했습니다.`,
  }));
  records[0] = {
    label: "original-production-plan",
    kind: "user",
    text: "원래 계획은 production 배포 준비입니다. 아직 실행하지 않았습니다.",
  };
  const critical = [
    {
      i: 2,
      kind: "user",
      label: "cancel-production",
      text: "[CANCEL] 기존 production 배포 계획을 취소합니다. staging에서만 검증하십시오. production 금지. 이 지시가 이전 production 계획을 대체합니다.",
    },
    {
      i: 9,
      kind: "tool",
      label: "expired-token",
      text: "[E731] 도구 진단 결과 E731 원인은 만료된 토큰입니다. 네트워크 장애가 아닙니다. 토큰 갱신이 필요합니다.",
    },
    {
      i: 18,
      kind: "tool",
      label: "deployment-unconfirmed",
      text: "[UNCONFIRMED] 배포 요청은 접수됐지만 완료 여부는 확인되지 않았습니다. 배포 성공으로 기록하지 마십시오. 완료 로그가 없습니다.",
    },
    {
      i: 27,
      kind: "user",
      label: "user-vs-tool",
      text: "[SOURCE] 사용자는 staging 검증을 요청했습니다. 도구가 보고한 접수 상태는 사용자 승인이나 배포 성공을 의미하지 않습니다. 사용자 지시와 도구 보고를 구분하십시오.",
    },
  ] satisfies { i: number; kind: Kind; label: string; text: string }[];
  const facts: Fact[] = critical.map((item) => {
    const text = `${item.text} ${"이 기록의 출처와 상태를 보존하십시오. ".repeat(12)}${item.text}`;
    records[item.i] = { kind: item.kind, label: item.label, text };
    return {
      id: item.label,
      evidence: [{ i: item.i, from: 0, to: [...text].length }],
      expected:
        item.i === 2
          ? ["staging", "production", "취소"]
          : item.i === 9
            ? ["E731", "토큰", "만료"]
            : item.i === 18
              ? ["확인", "완료"]
              : ["사용자", "도구"],
      contradictoryCandidates:
        item.i === 2
          ? ["production 배포 성공", "production만 배포"]
          : item.i === 9
            ? ["원인은 네트워크"]
            : item.i === 18
              ? ["배포 성공", "배포 완료"]
              : ["사용자가 배포 성공을 보고"],
    };
  });
  return { records, facts };
};

export const proxyCheck = (text: string, facts: Fact[]) =>
  facts.map((fact) => ({
    fact: fact.id,
    present: fact.expected.filter((marker) => text.includes(marker)),
    missing: fact.expected.filter((marker) => !text.includes(marker)),
    contradictoryCandidates: fact.contradictoryCandidates.filter((marker) => text.includes(marker)),
  }));
