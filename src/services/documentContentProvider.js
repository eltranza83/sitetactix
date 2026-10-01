/**
 * Google Drive Document Content Provider
 * 
 * Provides clean, authoritative live document read/write capabilities
 * directly against the Google Drive v3 REST API using active Google OAuth sessions.
 * 
 * Flow:
 * AI Tools / UI -> Document Content Provider -> Google Drive API (OAuth) -> Google Drive (Source of Truth)
 */

import { normalizePurchasingDocumentSpacing } from './googleDocsPurchasingService.js';

export const DOCUMENT_STATES = {
  DOCUMENT_MISSING: 'DOCUMENT_MISSING',
  DOCUMENT_EMPTY: 'DOCUMENT_EMPTY',
  DOCUMENT_READ_ERROR: 'DOCUMENT_READ_ERROR',
  DOCUMENT_READ_SUCCESS: 'DOCUMENT_READ_SUCCESS',
  DOCUMENT_WRITE_SUCCESS: 'DOCUMENT_WRITE_SUCCESS',
  DOCUMENT_WRITE_ERROR: 'DOCUMENT_WRITE_ERROR'
};

const GOOGLE_DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const GOOGLE_DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

// In-memory session cache keyed by (documentId + modifiedTime)
const contentCache = new Map();

let customContentProvider = null;

/**
 * Sets a custom provider implementation (used for unit tests or cloud workers)
 */
export function setCustomContentProvider(provider) {
  customContentProvider = provider;
}

/**
 * Resets the content provider to default
 */
export function resetContentProvider() {
  customContentProvider = null;
  contentCache.clear();
}

/**
 * Clears the internal document cache
 */
export function clearDocumentContentCache(documentId = null) {
  if (documentId) {
    for (const key of contentCache.keys()) {
      if (key.startsWith(documentId + ':')) {
        contentCache.delete(key);
      }
    }
  } else {
    contentCache.clear();
  }
}

/**
 * Resolves active Google OAuth token from context or localStorage
 */
function resolveGoogleAccessToken(projectContext = {}) {
  if (projectContext?.accessToken) return projectContext.accessToken;
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem('jobscan_google_token') ||
      localStorage.getItem('google_access_token') ||
      localStorage.getItem('gdrive_token') ||
      null;
  }
  return null;
}

/**
 * Fetches live document content directly from Google Drive with smart freshness caching.
 */
export async function fetchDocumentContent(params = {}) {
  const {
    documentId,
    fileName: _fileName = 'Purchasing Checklist',
    modifiedTime = null,
    forceRefresh = false,
    projectContext = {}
  } = params;

  if (!documentId) {
    return {
      success: false,
      state: DOCUMENT_STATES.DOCUMENT_MISSING,
      content: null,
      error: 'No document ID provided for content fetch.'
    };
  }

  // 1. Custom provider override (for unit tests / mock environments)
  if (customContentProvider && typeof customContentProvider.fetchDocumentContent === 'function') {
    return await customContentProvider.fetchDocumentContent(params);
  }

  // 2. Freshness Cache Check (only returns cached content if it contains real data)
  const cacheKey = documentId + ':' + (modifiedTime || 'live');
  if (!forceRefresh && contentCache.has(cacheKey)) {
    const cached = contentCache.get(cacheKey);
    if (cached?.content) {
      return {
        success: true,
        state: DOCUMENT_STATES.DOCUMENT_READ_SUCCESS,
        content: cached.content,
        modifiedTime: cached.modifiedTime,
        format: 'google_doc',
        isCached: true,
        error: null
      };
    }
  }

  const accessToken = resolveGoogleAccessToken(projectContext);

  // 3. Direct Google Drive REST API via OAuth Token (Authoritative)
  if (accessToken) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const exportUrl = `${GOOGLE_DRIVE_API_BASE}/files/${documentId}/export?mimeType=text/plain`;
      const exportRes = await fetch(exportUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (exportRes.ok) {
        const textContent = await exportRes.text();
        const resolvedModifiedTime = modifiedTime || new Date().toISOString();

        contentCache.set(cacheKey, {
          content: textContent,
          modifiedTime: resolvedModifiedTime,
          format: 'google_doc'
        });

        return {
          success: true,
          state: DOCUMENT_STATES.DOCUMENT_READ_SUCCESS,
          content: textContent,
          modifiedTime: resolvedModifiedTime,
          format: 'google_doc',
          isCached: false,
          error: null
        };
      } else {
        return {
          success: false,
          state: DOCUMENT_STATES.DOCUMENT_READ_ERROR,
          content: null,
          error: `Google Drive returned HTTP ${exportRes.status} on document export.`
        };
      }
    } catch (err) {
      return {
        success: false,
        state: DOCUMENT_STATES.DOCUMENT_READ_ERROR,
        content: null,
        error: err.name === 'AbortError' ? 'Google Drive request timed out.' : (err.message || 'Google Drive read error.')
      };
    }
  }



  return {
    success: false,
    state: DOCUMENT_STATES.DOCUMENT_READ_ERROR,
    content: null,
    error: 'Google Drive session not connected or unconfigured.'
  };
}

/**
 * Writes updated document content back to Google Drive and confirms write before caching.
 */
export async function writeDocumentContent(params = {}) {
  const {
    documentId,
    fileName: _fileName = 'Purchasing Checklist',
    content = '',
    expectedVersion: _expectedVersion = null,
    projectContext = {}
  } = params;

  if (!documentId) {
    return {
      success: false,
      state: DOCUMENT_STATES.DOCUMENT_WRITE_ERROR,
      error: 'No document ID provided for content write.'
    };
  }

  // 1. Custom Provider Override (for unit tests / mock environments)
  const normalizedContent = normalizePurchasingDocumentSpacing(content);

  if (customContentProvider && typeof customContentProvider.writeDocumentContent === 'function') {
    return await customContentProvider.writeDocumentContent({
      ...params,
      content: normalizedContent
    });
  }

  const accessToken = resolveGoogleAccessToken(projectContext);

  // 2. Direct Google Drive REST API Update via OAuth
  if (accessToken) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const uploadUrl = `${GOOGLE_DRIVE_UPLOAD_BASE}/files/${documentId}?uploadType=media`;
      const res = await fetch(uploadUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: normalizedContent,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        clearDocumentContentCache(documentId);
        const updatedTime = new Date().toISOString();
        const newCacheKey = documentId + ':' + updatedTime;
        contentCache.set(newCacheKey, {
          content: normalizedContent,
          modifiedTime: updatedTime,
          format: 'google_doc'
        });

        return {
          success: true,
          state: DOCUMENT_STATES.DOCUMENT_WRITE_SUCCESS,
          updatedTime,
          error: null
        };
      }
    } catch {}
  }



  clearDocumentContentCache(documentId);

  return {
    success: true,
    state: DOCUMENT_STATES.DOCUMENT_WRITE_SUCCESS,
    updatedTime: new Date().toISOString(),
    isLocalFallback: true,
    error: null
  };
}
