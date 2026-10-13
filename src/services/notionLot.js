import { getFirebaseAuthInstance } from './firebase.js';

/** Today's date (phone's local day) as YYYY-MM-DD. */
export function localDateString(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A subdivision as typed, tidied (extra spaces removed). */
export function cleanSubdivision(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

/** A message when the subdivision can't be used as a Notion choice, otherwise null. */
export function subdivisionProblem(value) {
  const subdivision = cleanSubdivision(value);
  if (subdivision.includes(',')) return 'The subdivision name can\'t contain a comma.';
  if (subdivision.length > 100) return 'The subdivision name is too long.';
  return null;
}

/**
 * The spelling already used in Notion when the typed name matches one ignoring case
 * ("northwood trail" → "Northwood Trail"), so the same subdivision never shows up twice.
 */
export function matchSubdivision(value, options = []) {
  const subdivision = cleanSubdivision(value);
  const existing = options.find(option => option.toLowerCase() === subdivision.toLowerCase());
  return existing || subdivision;
}

/** The request for a project's lot page: its name, subdivision, address, start date and Sheet. */
export function buildNotionLotRequest(project, details = {}, today = localDateString()) {
  const address = [details.address, details.cityStateZip]
    .map(part => String(part || '').trim())
    .filter(Boolean)
    .join(', ');
  return {
    name: String(project?.name || '').trim(),
    subdivision: cleanSubdivision(project?.subdivision),
    address,
    startDate: today,
    spreadsheetId: project?.spreadsheetId || ''
  };
}

/** The project with its Notion page remembered. */
export function linkNotionPageToProject(project, result) {
  return { ...project, notionPageId: result?.pageId || '', notionPageUrl: result?.url || '' };
}

async function postNotionLot(body, fallbackError, fetchImpl) {
  const user = getFirebaseAuthInstance()?.currentUser;
  if (!user) throw new Error('Please sign in with Google first.');

  const idToken = await user.getIdToken();
  let response;
  try {
    response = await fetchImpl('/api/notion-lot', {
      method: 'POST',
      headers: { authorization: `Bearer ${idToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Platform returned non-JSON (e.g. an HTML error page)
  }
  if (response.ok && payload) return payload;
  throw new Error(payload?.error || fallbackError);
}

/**
 * Asks the server to make the lot's page in Notion (SiteTactix → Projects) from the lot template.
 * Returns { pageId, url, existing, finishesCopied, skippedBlocks }.
 */
export async function createNotionLotPage(request, fetchImpl = fetch) {
  const result = await postNotionLot({ action: 'create', ...request }, 'The Notion page could not be made. Please try again.', fetchImpl);
  if (!result.pageId) throw new Error('The Notion page could not be made. Please try again.');
  return result;
}

/** The Subdivision choices already in Notion. */
export async function fetchSubdivisionOptions(fetchImpl = fetch) {
  const result = await postNotionLot({ action: 'subdivisions' }, 'Could not load the subdivisions from Notion.', fetchImpl);
  return Array.isArray(result.subdivisions) ? result.subdivisions : [];
}

/** Changes the Subdivision on a lot's Notion page. */
export async function updateNotionSubdivision(pageId, subdivision, fetchImpl = fetch) {
  return postNotionLot(
    { action: 'update-subdivision', pageId, subdivision: cleanSubdivision(subdivision) },
    'The Notion page could not be updated. Please try again.',
    fetchImpl
  );
}
