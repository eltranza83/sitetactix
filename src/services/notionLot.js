import { getFirebaseAuthInstance } from './firebase.js';

/** Today's date (phone's local day) as YYYY-MM-DD. */
export function localDateString(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The request for a project's lot page: its name, address, start date and Sheet. */
export function buildNotionLotRequest(project, details = {}, today = localDateString()) {
  const address = [details.address, details.cityStateZip]
    .map(part => String(part || '').trim())
    .filter(Boolean)
    .join(', ');
  return {
    name: String(project?.name || '').trim(),
    address,
    startDate: today,
    spreadsheetId: project?.spreadsheetId || ''
  };
}

/** The project with its Notion page remembered. */
export function linkNotionPageToProject(project, result) {
  return { ...project, notionPageId: result?.pageId || '', notionPageUrl: result?.url || '' };
}

/**
 * Asks the server to make the lot's page in Notion (SiteTactix → Projects) from the lot template.
 * Returns { pageId, url, existing, finishesCopied, skippedBlocks }.
 */
export async function createNotionLotPage(request, fetchImpl = fetch) {
  const user = getFirebaseAuthInstance()?.currentUser;
  if (!user) throw new Error('Please sign in with Google first.');

  const idToken = await user.getIdToken();
  let response;
  try {
    response = await fetchImpl('/api/notion-lot', {
      method: 'POST',
      headers: { authorization: `Bearer ${idToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(request)
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
  if (response.ok && payload?.pageId) return payload;
  throw new Error(payload?.error || 'The Notion page could not be made. Please try again.');
}
