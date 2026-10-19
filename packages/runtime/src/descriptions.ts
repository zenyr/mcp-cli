// Discovery summaries share one sentence and a bounded width across every surface.
export const compactDescription = (text: string, limit = 80): string => {
  const sentence = (text.split(/(?<=[.!?])\s|\n/)[0] ?? text).replace(/\s+/g, " ").trim();
  return sentence.length > limit ? `${sentence.slice(0, limit - 1)}…` : sentence;
};
