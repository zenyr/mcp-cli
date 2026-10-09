export const soundKinds = ["start", "hover", "click", "success", "error"] as const;
export type SoundKind = (typeof soundKinds)[number];
export const soundDescriptions: Record<
  SoundKind,
  { id: string; title: string; name: string; description: string; durationMs: number }
> = {
  start: {
    id: "start-b",
    title: "시작",
    name: "소프트 오픈",
    description: "새 대몬이 시작했을 때",
    durationMs: 160,
  },
  hover: {
    id: "hover-b",
    title: "호버",
    name: "소프트 틱",
    description: "버튼과 링크에 올릴 때",
    durationMs: 75,
  },
  click: {
    id: "click-b",
    title: "클릭",
    name: "단단한 톡",
    description: "버튼과 링크를 누를 때",
    durationMs: 95,
  },
  success: {
    id: "success-a",
    title: "완료",
    name: "투명한 확인",
    description: "작업을 마쳤을 때",
    durationMs: 200,
  },
  error: {
    id: "error-a",
    title: "오류",
    name: "낮은 듀오",
    description: "작업이 실패했을 때",
    durationMs: 180,
  },
};
export const isSoundKind = (value: unknown): value is SoundKind =>
  typeof value === "string" && soundKinds.some((kind) => kind === value);
