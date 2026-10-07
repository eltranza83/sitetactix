import { getFirebaseAuthInstance } from './firebase.js';

export const MAX_SECURE_DOCUMENT_BYTES = 4 * 1024 * 1024;

function getExtractionError(status, payload) {
  if (payload?.error) return payload.error;
  if (status === 401) return 'Your sign-in session expired. Please sign in again.';
  if (status === 403) return 'Your account is not authorized to use the scanner.';
  if (status === 413) return 'This document is too large. Please use a file smaller than 4 MB.';
  return 'AI extraction failed. Please try again.';
}

/**
 * Reads a receipt, invoice or check through the server's /api/extract-document route.
 * The AI key only lives on the server; the browser never holds one.
 */
export async function extractDocumentData(fileOrBlob, fetchImpl = fetch) {
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
        'x-document-mime': fileOrBlob.type || 'image/jpeg'
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
    return payload.data;
  }
  throw new Error(getExtractionError(response.status, payload));
}
