import { useState, useEffect } from 'react';
import { fetchDriveFileBlob } from '../services/googleDrive.js';

// Downloaded photos kept in memory so reopening an album does not download them again.
// Capped (oldest dropped first) so a long day of browsing photos cannot fill the phone's memory.
const MAX_CACHED_BYTES = 40 * 1024 * 1024;
const MAX_CACHED_PHOTOS = 60;
const rawBlobCache = new Map();
let cachedBytes = 0;

export function getCachedDriveBlob(fileId) {
  const blob = rawBlobCache.get(fileId);
  if (blob) {
    // Most recently used goes to the back of the line
    rawBlobCache.delete(fileId);
    rawBlobCache.set(fileId, blob);
  }
  return blob;
}

export function setCachedDriveBlob(fileId, blob) {
  if (rawBlobCache.has(fileId)) {
    cachedBytes -= rawBlobCache.get(fileId)?.size || 0;
    rawBlobCache.delete(fileId);
  }
  rawBlobCache.set(fileId, blob);
  cachedBytes += blob?.size || 0;
  while (rawBlobCache.size > 1 && (cachedBytes > MAX_CACHED_BYTES || rawBlobCache.size > MAX_CACHED_PHOTOS)) {
    const [oldestId, oldestBlob] = rawBlobCache.entries().next().value;
    rawBlobCache.delete(oldestId);
    cachedBytes -= oldestBlob?.size || 0;
  }
}

// At most a few photo downloads at once, so a full album does not choke a weak signal
const MAX_PARALLEL_DOWNLOADS = 3;
let activeDownloads = 0;
const waitingDownloads = [];

async function downloadWithLimit(googleToken, fileId) {
  if (activeDownloads >= MAX_PARALLEL_DOWNLOADS) {
    await new Promise(resolve => waitingDownloads.push(resolve));
  }
  activeDownloads++;
  try {
    return await fetchDriveFileBlob(googleToken, fileId);
  } finally {
    activeDownloads--;
    waitingDownloads.shift()?.();
  }
}

export function extractDriveFileId(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

/**
 * A Drive photo loaded with the user's Google sign-in (works for private files). Returns a local
 * blob: address, never a drive.google.com one (the app's security rules block those).
 * With enabled false nothing downloads yet (e.g. until the photo scrolls into view).
 */
export function useAuthenticatedDriveImage({ googleToken, fileId, url, base64, enabled = true }) {
  const [objectUrl, setObjectUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // If base64 or a local blob/data URL is already supplied, use it directly without network call
  const directSrc = base64 || (url && (url.startsWith('data:') || url.startsWith('blob:')) ? url : null);
  const resolvedFileId = fileId || extractDriveFileId(url);

  useEffect(() => {
    if (directSrc || !enabled || !resolvedFileId || !googleToken) {
      setObjectUrl(null);
      return;
    }

    let active = true;
    let localUrl = null;
    setError(null);

    const loadBlob = async () => {
      let blob = getCachedDriveBlob(resolvedFileId);
      if (!blob) {
        setLoading(true);
        try {
          blob = await downloadWithLimit(googleToken, resolvedFileId);
          setCachedDriveBlob(resolvedFileId, blob);
        } catch (err) {
          if (active) {
            console.warn('[useAuthenticatedDriveImage] Failed to load Drive image blob:', err);
            setError(err);
          }
          return;
        } finally {
          if (active) setLoading(false);
        }
      }

      if (active && blob) {
        localUrl = URL.createObjectURL(blob);
        setObjectUrl(localUrl);
      }
    };

    loadBlob();

    return () => {
      active = false;
      if (localUrl) {
        URL.revokeObjectURL(localUrl);
      }
    };
  }, [googleToken, resolvedFileId, directSrc, enabled]);

  return {
    src: directSrc || objectUrl || null,
    loading,
    error
  };
}
