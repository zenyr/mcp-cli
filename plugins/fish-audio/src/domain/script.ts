export type ChunkLimits = { maxChars: number; maxBytes: number };

const encoder = new TextEncoder();
export const utf8Bytes = (text: string) => encoder.encode(text).length;
const chars = (text: string) => [...text].length;

/** Inline audio tags such as `[pause]`; never split. */
const TAG = /\[[^\][\n]+\]/g;
/** Cut points, coarsest first: paragraphs, sentences, clauses, whitespace. */
const LEVELS = [/\n[ \t]*\n\s*/g, /[.!?…。！？]+["'”’)\]」』]*\s+/g, /[,;，、；]\s*/g, /\s+/g];

export const normalizeScript = (text: string): string => {
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
};

/** Splits losslessly at sentence boundaries while preserving tags and graphemes. */
export const splitScript = (text: string, limits: ChunkLimits): string[] => {
  if (![limits.maxChars, limits.maxBytes].every((value) => Number.isInteger(value) && value > 0))
    throw new Error("Chunk limits must be positive integers.");
  const fits = (piece: string) =>
    chars(piece) <= limits.maxChars && utf8Bytes(piece) <= limits.maxBytes;
  const normalized = normalizeScript(text);
  const tags = [...normalized.matchAll(TAG)].map(
    (match) => [match.index, match.index + match[0].length] as const,
  );
  const inTag = (offset: number) => tags.some(([start, end]) => offset > start && offset < end);

  const cut = (start: number, end: number, level: number): Array<[number, number]> => {
    const piece = normalized.slice(start, end);
    if (fits(piece)) return [[start, end]];
    if (!LEVELS[level]) return atoms(start, end);
    const points = [...piece.matchAll(LEVELS[level] ?? /$^/g)]
      .map((match) => start + match.index + match[0].length)
      .filter((point) => point < end && !inTag(point));
    const bounds = [start, ...points, end];
    const units = bounds
      .slice(1)
      .flatMap((stop, index) => cut(bounds[index] ?? start, stop, level + 1));
    return merge(units);
  };
  const atoms = (start: number, end: number): Array<[number, number]> => {
    const units: Array<[number, number]> = [];
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    for (const { index } of segmenter.segment(normalized.slice(start, end))) {
      const offset = start + index;
      if (inTag(offset)) continue;
      const tag = tags.find(([tagStart]) => tagStart === offset);
      units.push([offset, tag ? tag[1] : offset]);
    }
    const ranges = units.map(
      ([from], index) => [from, units[index + 1]?.[0] ?? end] as [number, number],
    );
    for (const [from, to] of ranges) {
      if (!fits(normalized.slice(from, to)))
        throw new Error(`Script piece at offset ${from} exceeds the per-call limit on its own.`);
    }
    return merge(ranges);
  };
  const merge = (units: Array<[number, number]>): Array<[number, number]> => {
    const merged: Array<[number, number]> = [];
    for (const unit of units) {
      const last = merged.at(-1);
      if (last && fits(normalized.slice(last[0], unit[1]))) last[1] = unit[1];
      else merged.push([...unit]);
    }
    return merged;
  };

  if (!normalized.trim()) return [];
  return cut(0, normalized.length, 0).map(([start, end]) => normalized.slice(start, end));
};

/** Keeps whitespace attached to spoken chunks. */
export const scriptChunks = (text: string, limits: ChunkLimits): string[] => {
  return splitScript(text, limits).filter((piece) => Boolean(piece.trim()));
};
