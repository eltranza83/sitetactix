import {
  ensureAppSubfolder,
  findFileInFolder,
  findOrCreateFolder,
  getFileContent,
  updateFileContent,
  uploadFileToDrive
} from './googleDrive.js';

const X_RAY_FOLDER_NAME = 'X-Ray Photos';
const ISSUE_PHOTOS_FOLDER_NAME = 'Issue Photos';
const ISSUES_CONFIG_FILE = 'issues_data.json';
const ISSUES_CONFIG_MIME_TYPE = 'application/json';

function buildJsonBlob(data) {
  return new Blob([JSON.stringify(data, null, 2)], { type: ISSUES_CONFIG_MIME_TYPE });
}

async function ensureXRayFolder(accessToken, projectFolderId) {
  return await ensureAppSubfolder(accessToken, projectFolderId, X_RAY_FOLDER_NAME);
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

  try {
    const data = await getFileContent(accessToken, configJsonFile.id);
    return {
      issuesDataFileId: configJsonFile.id,
      issues: data?.issues || [],
      contacts: data?.contacts || {}
    };
  } catch (err) {
    console.error('Failed to parse issues_data.json content:', err);
    return {
      issuesDataFileId: configJsonFile.id,
      issues: [],
      contacts: {}
    };
  }
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
