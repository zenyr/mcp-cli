export const paneWidth = { initial: 220, min: 140, detailMin: 320, step: 16 };

export const clampPaneWidth = (width: number, containerWidth: number) => {
  const max = Math.max(paneWidth.min, containerWidth - paneWidth.detailMin);
  return Math.round(Math.min(max, Math.max(paneWidth.min, width)));
};
