export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export type Request = { id: string | number; method: string; params?: unknown };
export const isRequest = (value: unknown): value is Request =>
  isRecord(value) &&
  (typeof value.id === "number" || typeof value.id === "string") &&
  typeof value.method === "string";
export const echoInput = (
  value: unknown,
): { text: string; count: number; uppercase: boolean } | undefined => {
  if (!isRecord(value) || typeof value.text !== "string") return undefined;
  const count = value.count ?? 1;
  const uppercase = value.uppercase ?? false;
  if (
    typeof count !== "number" ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 5 ||
    typeof uppercase !== "boolean"
  )
    return undefined;
  return { text: value.text, count, uppercase };
};
