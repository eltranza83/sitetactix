/**
 * Matching a scanned payee to a known sub from the Sheet's Contracts tab.
 *
 * Plain, deterministic name normalization (no intent routing): a payee matches a Contracts row when,
 * ignoring case, punctuation, word order and business suffixes (LLC, Inc, Co, ...), it is the same name
 * as the row's Sub or Company, or differs from it by a single typo in a long name.
 * Generational suffixes (Jr, Sr, II, III) are kept: "Enrique Vallejo Jr" is treated as a different
 * person from "Enrique Vallejo" and is not matched automatically (the owner can still pick him from the list).
 * When a payee matches rows that resolve to different subs, nothing is matched.
 */

const BUSINESS_SUFFIXES = new Set([
  'llc', 'inc', 'incorporated', 'co', 'corp', 'corporation', 'company', 'ltd', 'limited',
  'lp', 'llp', 'pllc', 'pc', 'the', 'and'
]);

/** Lowercase words with punctuation and business suffixes removed. */
export function nameTokens(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[.,'’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter(word => !BUSINESS_SUFFIXES.has(word));
}

/** Order-free comparable form of a name ("Vallejo Electric, LLC" -> "electric vallejo"). */
export function normalizePayeeName(value) {
  return [...nameTokens(value)].sort().join(' ');
}

function editDistanceAtMostOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function namesMatch(payee, candidate) {
  const left = normalizePayeeName(payee);
  const right = normalizePayeeName(candidate);
  if (!left || !right) return false;
  if (left === right) return true;
  // One missing, extra or wrong letter in a long name ("Vallejo Electrc"); never for short names
  const plainLeft = nameTokens(payee).join(' ');
  const plainRight = nameTokens(candidate).join(' ');
  return plainLeft.length >= 8 && plainRight.length >= 8 && editDistanceAtMostOne(plainLeft, plainRight);
}

/** The name written on the Sheet for a known sub: its Company when present, else the Sub's name. */
export function knownSubPayeeName(knownSub) {
  return String(knownSub?.company || '').trim() || String(knownSub?.sub || '').trim();
}

/**
 * The known sub a payee belongs to, or null.
 * Returns { name, sub, company, matchedOn: 'sub' | 'company' }.
 */
export function matchPayeeToKnownSubs(payee, knownSubs) {
  if (!String(payee || '').trim() || !Array.isArray(knownSubs)) return null;
  const hits = [];
  knownSubs.forEach(known => {
    if (!known) return;
    let matchedOn = null;
    if (known.company && namesMatch(payee, known.company)) matchedOn = 'company';
    else if (known.sub && namesMatch(payee, known.sub)) matchedOn = 'sub';
    if (matchedOn) hits.push({ known, matchedOn });
  });
  if (hits.length === 0) return null;

  const names = new Set(hits.map(h => knownSubPayeeName(h.known).toLowerCase()));
  if (names.size > 1) return null;

  const { known, matchedOn } = hits[0];
  return {
    name: knownSubPayeeName(known),
    sub: String(known.sub || '').trim(),
    company: String(known.company || '').trim(),
    matchedOn
  };
}

/**
 * Scan result with the payee replaced by the matching known sub's name, marked as auto-matched.
 * Unchanged when nothing matches.
 */
export function applyPayeeMatch(metadata, knownSubs) {
  if (!metadata) return metadata;
  const match = matchPayeeToKnownSubs(metadata.vendor, knownSubs);
  if (!match) return metadata;
  return {
    ...metadata,
    vendor: match.name,
    payeeMatch: {
      auto: true,
      original: String(metadata.vendor || '').trim(),
      sub: match.sub,
      company: match.company
    }
  };
}

const KNOWN_SUBS_KEY_PREFIX = 'sitetactix_known_subs_';

export function loadCachedKnownSubs(storage, spreadsheetId) {
  if (!storage || !spreadsheetId) return [];
  try {
    const parsed = JSON.parse(storage.getItem(`${KNOWN_SUBS_KEY_PREFIX}${spreadsheetId}`) || '[]');
    return Array.isArray(parsed) ? parsed.filter(k => k && (k.sub || k.company)) : [];
  } catch {
    return [];
  }
}

export function persistKnownSubs(storage, spreadsheetId, knownSubs) {
  if (!storage || !spreadsheetId) return;
  try {
    storage.setItem(`${KNOWN_SUBS_KEY_PREFIX}${spreadsheetId}`, JSON.stringify(Array.isArray(knownSubs) ? knownSubs : []));
  } catch {
    // Storage full or blocked: matching still works for this scan
  }
}
