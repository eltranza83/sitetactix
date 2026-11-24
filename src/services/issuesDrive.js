import {
  buildJsonBlob,
  ensureXRayFolder,
  findFileInFolder,
  findOrCreateFolder,
  readVaultFile,
  updateFileContent,
  uploadFileToDrive
} from './googleDrive.js';
import { dataUrlToBlob } from './imageFiles.js';

const ISSUE_PHOTOS_FOLDER_NAME = 'Issue Photos';
const ISSUES_CONFIG_FILE = 'issues_data.json';
const ISSUES_CONFIG_MIME_TYPE = 'application/json';
const LEGACY_PHOTO_KEY_PREFIX = 'jobscan_photo_';

/**
 * Queues async sync tasks sequentially so rapid consecutive punch-list edits
 * never race reading and writing `issues_data.json` in Drive.
 */
export function createSerialSyncRunner() {
  let chain = Promise.resolve();
  return (fn) => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };
}

/**
 * Removes old write-only `jobscan_photo_*` entries from localStorage so phones recover that space.
 */
export function removeLegacyCachedIssuePhotos(storage) {
  if (!storage) return 0;
  const keysToRemove = new Set();
  try {
    if (typeof storage.length === 'number' && typeof storage.key === 'function') {
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (key && key.startsWith(LEGACY_PHOTO_KEY_PREFIX)) keysToRemove.add(key);
      }
    }
    for (const key of Object.keys(storage)) {
      if (key.startsWith(LEGACY_PHOTO_KEY_PREFIX)) keysToRemove.add(key);
    }
    for (const key of keysToRemove) {
      storage.removeItem(key);
    }
  } catch {
    // Ignore storage enumeration errors
  }
  return keysToRemove.size;
}

/**
 * Uploads any offline base64 defect or proof photos in the queue to Google Drive before merging.
 * Calls `onProgress(queue)` after each uploaded photo so progress is kept if a later upload fails.
 * Throws if any photo upload fails so raw base64 is never written into `issues_data.json` in Drive.
 */
export async function uploadQueuedIssuePhotos(
  accessToken,
  projectFolderId,
  queue,
  { onProgress, uploadDefect = uploadIssuePhoto, uploadProof = uploadIssueProofPhoto } = {}
) {
  for (const op of (Array.isArray(queue) ? queue : [])) {
    if ((op.type === 'CREATE' || op.type === 'UPDATE') && op.payload?.photoBase64) {
      if (!op.payload.photoUrl) {
        const blob = dataUrlToBlob(op.payload.photoBase64);
        const fileObj = new File([blob], 'offline_issue_photo.jpg', { type: blob.type || 'image/jpeg' });
        const uploadResult = await uploadDefect(accessToken, projectFolderId, fileObj);
        op.payload.photoUrl = uploadResult.url;
        op.payload.photoFileId = uploadResult.id;
      }
      delete op.payload.photoBase64;
      onProgress?.(queue);
    }

    if ((op.type === 'CREATE' || op.type === 'UPDATE') && op.payload?.proofPhotoBase64) {
      if (!op.payload.proofPhotoUrl) {
        const blob = dataUrlToBlob(op.payload.proofPhotoBase64);
        const fileObj = new File([blob], 'offline_proof_photo.jpg', { type: blob.type || 'image/jpeg' });
        const uploadResult = await uploadProof(accessToken, projectFolderId, fileObj);
        op.payload.proofPhotoUrl = uploadResult.url;
        op.payload.proofPhotoFileId = uploadResult.id;
      }
      op.payload.proofPhotoBase64 = null;
      onProgress?.(queue);
    }
  }
}

/**
 * Removes only the operations that were part of the completed sync batch, keeping any new
 * operation that was queued while the Drive sync was in flight.
 */
export function filterRemainingOfflineQueue(currentQueue = [], syncedQueue = []) {
  const opKey = (op) => `${op?.type}_${op?.id}_${op?.timestamp}`;
  const syncedKeys = new Set((syncedQueue || []).map(opKey));
  return (currentQueue || []).filter(op => !syncedKeys.has(opKey(op)));
}



async function ensureIssuePhotosFolder(accessToken, xRayFolderId) {
  return await findOrCreateFolder(accessToken, ISSUE_PHOTOS_FOLDER_NAME, xRayFolderId);
}

export async function loadIssuesVault(accessToken, projectFolderId) {
  const xRayFolderId = await ensureXRayFolder(accessToken, projectFolderId);
  const configJsonFile = await findFileInFolder(accessToken, xRayFolderId, ISSUES_CONFIG_FILE);

  if (!configJsonFile) {
    return {
      issuesDataFileId: null,
      issues: [],
      contacts: {}
    };
  }

  // A failed read (no signal, Google error, expired sign-in) must never look like an empty punch list:
  // the next save would write only the new item over every saved one. Let the error through instead.
  const data = await readVaultFile(accessToken, configJsonFile.id, 'punch list');
  return {
    issuesDataFileId: configJsonFile.id,
    issues: data?.issues || [],
    contacts: data?.contacts || {}
  };
}

export async function saveIssuesVault(accessToken, projectFolderId, fileId, config) {
  const xRayFolderId = await ensureXRayFolder(accessToken, projectFolderId);
  const blob = buildJsonBlob(config);

  if (fileId) {
    await updateFileContent(accessToken, fileId, blob, ISSUES_CONFIG_MIME_TYPE);
    return fileId;
  }

  // Create new config file if it didn't exist
  const uploadedConfig = await uploadFileToDrive(
    accessToken,
    xRayFolderId,
    ISSUES_CONFIG_FILE,
    ISSUES_CONFIG_MIME_TYPE,
    blob
  );
  return uploadedConfig.id;
}

export async function uploadIssuePhoto(accessToken, projectFolderId, file) {
  const xRayFolderId = await ensureXRayFolder(accessToken, projectFolderId);
  const photosFolderId = await ensureIssuePhotosFolder(accessToken, xRayFolderId);

  const extension = file.name.split('.').pop();
  const issuePhotoName = `Issue_Photo_${Date.now()}.${extension}`;
  
  // Upload the file to Drive (retains project-restricted folder permissions)
  const imgUpload = await uploadFileToDrive(accessToken, photosFolderId, issuePhotoName, file.type, file);

  return {
    id: imgUpload.id,
    url: imgUpload.webViewLink
  };
}

export async function uploadIssueProofPhoto(accessToken, projectFolderId, file) {
  const xRayFolderId = await ensureXRayFolder(accessToken, projectFolderId);
  const photosFolderId = await ensureIssuePhotosFolder(accessToken, xRayFolderId);

  const extension = file.name.split('.').pop();
  const proofPhotoName = `Issue_Proof_${Date.now()}.${extension}`;

  // Upload the file to Drive (retains project-restricted folder permissions)
  const imgUpload = await uploadFileToDrive(accessToken, photosFolderId, proofPhotoName, file.type, file);

  return {
    id: imgUpload.id,
    url: imgUpload.webViewLink
  };
}

/**
 * Deduplicates and sorts activity history events (append-only by convention).
 */
export function mergeActivityHistories(historyA = [], historyB = []) {
  const combined = [...(historyA || []), ...(historyB || [])];
  const seen = new Set();
  const merged = [];

  for (const item of combined) {
    if (!item) continue;
    const key = item.id || `${item.action}_${item.timestamp}_${item.note || ''}_${item.details || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }

  return merged.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

/**
 * Merges remote issues list with offline operations queue.
 * Handles CREATE, UPDATE, UPDATE_STATUS, and SOFT_DELETE operations in chronological order.
 * Ensures backward compatibility with legacy issues missing activityHistory.
 */
export function mergeIssues(remoteIssues, offlineOperations) {
  const merged = [...(remoteIssues || [])].map(issue => ({
    ...issue,
    activityHistory: Array.isArray(issue.activityHistory) ? issue.activityHistory : []
  }));
  const sortedOps = [...(offlineOperations || [])].sort((a, b) => a.timestamp - b.timestamp);

  sortedOps.forEach(op => {
    const { type, id, payload, timestamp } = op;
    const isoTimestamp = new Date(timestamp).toISOString();

    if (type === 'CREATE') {
      const existingIdx = merged.findIndex(i => i.id === id);
      const newIssue = {
        id,
        ...payload,
        activityHistory: Array.isArray(payload?.activityHistory) ? payload.activityHistory : [],
        createdAt: payload?.createdAt || isoTimestamp,
        updatedAt: isoTimestamp,
        deletedAt: null
      };
      if (existingIdx > -1) {
        merged[existingIdx] = newIssue;
      } else {
        merged.push(newIssue);
      }
    } else if (type === 'UPDATE') {
      const existingIdx = merged.findIndex(i => i.id === id);
      if (existingIdx > -1) {
        const existing = merged[existingIdx];
        const mergedHistory = mergeActivityHistories(existing.activityHistory, payload?.activityHistory);

        merged[existingIdx] = {
          ...existing,
          ...payload,
          activityHistory: mergedHistory,
          updatedAt: isoTimestamp
        };
      }
    } else if (type === 'UPDATE_STATUS') {
      const existingIdx = merged.findIndex(i => i.id === id);
      if (existingIdx > -1) {
        merged[existingIdx] = {
          ...merged[existingIdx],
          status: payload.status,
          updatedAt: isoTimestamp
        };
      }
    } else if (type === 'SOFT_DELETE') {
      const existingIdx = merged.findIndex(i => i.id === id);
      if (existingIdx > -1) {
        merged[existingIdx] = {
          ...merged[existingIdx],
          deletedAt: isoTimestamp,
          updatedAt: isoTimestamp
        };
      }
    }
  });

  return merged;
}
