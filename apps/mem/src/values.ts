export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const fail = (
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): never => {
  throw Object.assign(new Error(message), { code, details });
};

export const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return fail("INVALID_JSON", "Invalid JSON.");
  }
};

export const bytes = (text: string): number => Buffer.byteLength(text, "utf8");
export const flat = (text: string): string => text.replace(/[\r\n]+/g, " ");
export const nodeKey = (part: { l: number; i: number }): string => `${part.l}:${part.i}`;
export const start = (part: { l: number; i: number }): number => part.i * 2 ** part.l;
export const end = (part: { l: number; i: number }): number => start(part) + 2 ** part.l;
export const positive = (value: string | number, name: string, maximum = 1_048_576): number => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum)
    return fail("INVALID_OPTION", `${name} must be an integer between 1 and ${maximum}.`);
  return number;
};

export const output = (value: unknown, limit: number): string => {
  const text = `${JSON.stringify(value)}\n`;
  if (bytes(text) > limit)
    return fail("OUTPUT_OVERFLOW", "Response exceeds --max-bytes.", { limit });
  return text;
};
