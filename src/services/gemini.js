import { getFirebaseAuthInstance } from './firebase.js';

export const MAX_SECURE_DOCUMENT_BYTES = 4 * 1024 * 1024;

function getExtractionError(status, payload) {
  if (payload?.error) return payload.error;
  if (status === 401) return 'Your sign-in session expired. Please sign in again.';
  if (status === 403) return 'Your account is not authorized to use the scanner.';
  if (status === 413) return 'This document is too large. Please use a file smaller than 4 MB.';
  return 'AI extraction failed. Please try again.';
}

async function postDocumentExtraction(fileOrBlob, extraHeaders = {}, fetchImpl = fetch) {
  if (!fileOrBlob || fileOrBlob.size === 0) {
    throw new Error('The selected document is empty.');
  }
  if (fileOrBlob.size > MAX_SECURE_DOCUMENT_BYTES) {
    throw new Error('This document is too large. Please use a file smaller than 4 MB.');
  }

  const user = getFirebaseAuthInstance()?.currentUser;
  if (!user) {
    throw new Error('Please sign in with Google to scan documents.');
  }

  const idToken = await user.getIdToken();
  let response;
  try {
    response = await fetchImpl('/api/extract-document', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${idToken}`,
        'content-type': 'application/octet-stream',
        'x-document-mime': fileOrBlob.type || 'image/jpeg',
        ...extraHeaders
      },
      body: fileOrBlob
    });
  } catch {
    throw new Error('Could not reach the scan service. Check your connection and try again.');
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Platform returned non-JSON (e.g. an HTML error page)
  }

  if (response.ok && payload?.data) {
    return { data: payload.data, readByBackupAi: payload.readByBackupAi === true };
  }
  throw new Error(getExtractionError(response.status, payload));
}

/**
 * Reads a receipt, invoice or check through the server's /api/extract-document route.
 * The AI key only lives on the server; the browser never holds one.
 * Returns { data, readByBackupAi } (true when Google's main model was busy and the backup read it).
 */
export async function extractDocumentData(fileOrBlob, fetchImpl = fetch) {
  return postDocumentExtraction(fileOrBlob, {}, fetchImpl);
}

/**
 * Reads a subcontractor PDF quote or photo of a written estimate through /api/extract-document
 * in quote mode ('x-document-mode': 'quote').
 */
export async function extractQuoteData(fileOrBlob, fetchImpl = fetch) {
  return postDocumentExtraction(fileOrBlob, { 'x-document-mode': 'quote' }, fetchImpl);
}

function getLocalIsoDate(now = new Date()) {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatKnownSubsHeader(knownSubs = []) {
  return (Array.isArray(knownSubs) ? knownSubs : [])
    .map(s => (typeof s === 'string' ? s : [s?.sub, s?.company].filter(Boolean).join(' / ')))
    .filter(Boolean)
    .slice(0, 25)
    .join(', ')
    .slice(0, 500);
}

/**
 * Extracts a structured no-receipt expense draft from a spoken audio clip.
 */
export async function extractVoiceExpenseData(
  audioBlob,
  { localDate = getLocalIsoDate(), activeProjectName = '', knownSubs = [] } = {},
  fetchImpl = fetch
) {
  const rawMime = String(audioBlob?.type || 'audio/webm').split(';')[0].trim().toLowerCase() || 'audio/webm';
  return postDocumentExtraction(
    audioBlob,
    {
      'x-document-mode': 'voice-expense',
      'x-document-mime': rawMime,
      'x-local-date': localDate,
      'x-active-project': encodeURIComponent(String(activeProjectName || '').slice(0, 80)),
      'x-known-subs': encodeURIComponent(formatKnownSubsHeader(knownSubs))
    },
    fetchImpl
  );
}

/**
 * Translates punch list title, description, category, and phase into clear construction Spanish.
 */
export async function translatePunchPacketToSpanish(
  { title = '', description = '', categoryLabel = '', tradePhase = '' } = {},
  fetchImpl = fetch
) {
  const user = getFirebaseAuthInstance()?.currentUser;
  if (!user) {
    throw new Error('Please sign in with Google to translate punch packets.');
  }

  const idToken = await user.getIdToken();
  let response;
  try {
    response = await fetchImpl('/api/extract-document', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${idToken}`,
        'content-type': 'application/json',
        'x-document-mode': 'translate-punch'
      },
      body: JSON.stringify({ title, description, categoryLabel, tradePhase })
    });
  } catch {
    throw new Error('Could not reach the translation service. Check your connection and try again.');
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON response
  }

  if (response.ok && payload?.data) {
    return payload.data;
  }
  throw new Error(getExtractionError(response.status, payload));
}
