export function getHistoryFileId(item) {
  return String(item?.id || '').split('_split_')[0];
}

/**
 * The Drive files a draft already has, keyed 'main' (one receipt) or by split number.
 * Drafts saved before per-split tracking only kept one driveFileId (the first split with an amount).
 */
export function getDraftUploads(draft) {
  if (draft?.uploads && typeof draft.uploads === 'object') return draft.uploads;
  if (!draft?.driveFileId) return {};
  const splits = draft.metadata?.splits;
  const key = Array.isArray(splits) && splits.length > 0
    ? String(splits.findIndex(split => (parseFloat(split?.amount) || 0) !== 0))
    : 'main';
  return { [key]: { fileId: draft.driveFileId, link: draft.driveFileLink || null, folderId: null } };
}

/** Project folders whose Sheets need a sync for these drafts (a split can go to another lot). */
export function foldersToSync(drafts) {
  const folderIds = new Set();
  for (const draft of (drafts || [])) {
    Object.values(getDraftUploads(draft)).forEach(upload => {
      if (upload?.folderId) folderIds.add(upload.folderId);
    });
  }
  return [...folderIds];
}

/** Why a draft did not fully sync (null when every one of its files made it into its Sheet). */
export function draftSyncFailure(draft, failedItems = [], folderErrors = {}) {
  const failedMap = new Map((failedItems || []).map(f => [String(f.fileId), f.reason]));
  for (const upload of Object.values(getDraftUploads(draft))) {
    if (upload?.fileId && failedMap.has(String(upload.fileId))) return failedMap.get(String(upload.fileId));
    if (upload?.folderId && folderErrors?.[upload.folderId]) return folderErrors[upload.folderId];
  }
  return null;
}

/**
 * Partitions drafts into successfully synced drafts and failed drafts.
 * A draft fails when any of its files (any split) failed, or its lot's Sheet could not sync at all.
 *
 * @param {Array<Object>} drafts - Staged draft items
 * @param {Array<{ fileId: string, fileName?: string, reason: string }>} failedItems - Failures from syncUploadedInvoicesDirectly
 * @param {Object<string, string>} folderErrors - Project folder id -> why its Sheet sync failed
 * @returns {{ successfulDrafts: Array<Object>, failedDrafts: Array<{ draft: Object, reason: string }> }}
 */
export function partitionDraftsBySyncResult(drafts, failedItems = [], folderErrors = {}) {
  const successfulDrafts = [];
  const failedDrafts = [];

  for (const draft of (drafts || [])) {
    const reason = draftSyncFailure(draft, failedItems, folderErrors);
    if (reason) {
      failedDrafts.push({ draft, reason });
    } else {
      successfulDrafts.push(draft);
    }
  }

  return { successfulDrafts, failedDrafts };
}
