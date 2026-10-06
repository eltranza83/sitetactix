/**
 * Turns a project name like "Lot 3B" into the stable ID used to key project data.
 */
export function toCanonicalProjectId(rawIdOrName = '') {
  if (!rawIdOrName || typeof rawIdOrName !== 'string') return 'default';
  const str = rawIdOrName.trim();
  if (str.toLowerCase() === 'master' || str.toLowerCase() === 'purchasing_master') return 'master';

  // Match lot pattern e.g. "Lot 55", "Lot-55", "lot 3", "Lot 3B"
  const lotMatch = str.match(/^lot[\s_-]*([0-9]+[a-zA-Z]?)$/i);
  if (lotMatch) {
    return `lot_${lotMatch[1].toLowerCase()}`;
  }

  // Slugify generic string
  return str.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'default';
}
