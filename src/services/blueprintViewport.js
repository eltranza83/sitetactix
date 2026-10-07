export function normalizeZoomScale(nextScale) {
  const numericScale = Number(nextScale);
  if (!Number.isFinite(numericScale)) {
    return 1;
  }
  return Math.min(3, Math.max(1, numericScale));
}

