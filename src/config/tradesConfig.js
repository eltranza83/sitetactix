/**
 * Dashboard ordering and titles for the Google Sheet trade sections.
 */

export function getCategorySortRank(name = '') {
  const clean = String(name || '').toLowerCase();
  if (clean.includes('paperwork') || clean.includes('permit')) return 1;
  if (clean.includes('site prep') || clean.includes('structure') || clean.includes('foundation')) return 2;
  if (clean.includes('framing') || clean.includes('lumber')) return 3;
  if (clean.includes('mechanical') || clean.includes('utility') || clean.includes('utilities')) return 4;
  if (clean.includes('interior finish') || (clean.includes('finish') && !clean.includes('paint') && !clean.includes('hardware'))) return 5;
  if (clean.includes('paint') || clean.includes('tile')) return 6;
  if (clean.includes('hardware') || clean.includes('fixture')) return 7;
  if (clean.includes('exterior') || clean.includes('yard')) return 8;
  if (clean.includes('overhead') || clean.includes('bill')) return 9;
  return 99;
}

export function formatCategoryTitle(name = '') {
  const raw = String(name || '').trim();
  if (raw.toUpperCase() === 'PAINT TILE') {
    return 'PAINT & TILE';
  }
  return raw;
}
