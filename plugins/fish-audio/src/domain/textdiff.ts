const tokens = (text: string): string[] => {
  const clean = text
    .normalize("NFC")
    .replace(/\[[^\][\n]*\]|<\|speaker:\d+\|>/g, "")
    .toLowerCase();
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(clean)]
    .map((item) => item.segment)
    .filter((item) => !/^[\p{P}\p{S}\s]+$/u.test(item));
};
/** Computes exact CER with two rows instead of a quadratic alignment matrix. */
export const characterErrorRate = (expected: string, heard: string): number => {
  const a = tokens(expected);
  const b = tokens(heard);
  const short = a.length < b.length ? a : b;
  const long = a.length < b.length ? b : a;
  let previous = Uint32Array.from({ length: short.length + 1 }, (_, i) => i);
  let current = new Uint32Array(short.length + 1);
  for (let i = 1; i <= long.length; i++) {
    current[0] = i;
    for (let j = 1; j <= short.length; j++) {
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (long[i - 1] === short[j - 1] ? 0 : 1),
      );
    }
    [previous, current] = [current, previous];
  }
  return a.length ? (previous[short.length] ?? 0) / a.length : b.length ? 1 : 0;
};
