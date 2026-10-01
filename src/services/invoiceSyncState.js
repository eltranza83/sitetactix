export function shouldFlagUnprocessedUpload(syncResult) {
  return Boolean(syncResult?.hasDriveUpload);
}

export function getHistoryFileId(item) {
  return String(item?.id || '').split('_split_')[0];
}

/**
 * Partitions drafts into successfully synced drafts and failed drafts.
 * A draft is considered failed if its driveFileId is present in failedItems.
 *
 * @param {Array<Object>} drafts - Staged draft items
 * @param {Array<{ fileId: string, fileName?: string, reason: string }>} failedItems - Failures from syncUploadedInvoicesDirectly
 * @returns {{ successfulDrafts: Array<Object>, failedDrafts: Array<{ draft: Object, reason: string }> }}
 */
export function partitionDraftsBySyncResult(drafts, failedItems = []) {
  const failedMap = new Map((failedItems || []).map(f => [String(f.fileId), f.reason]));
  const successfulDrafts = [];
  const failedDrafts = [];

  for (const draft of (drafts || [])) {
    const fileId = draft?.driveFileId ? String(draft.driveFileId) : null;
    if (fileId && failedMap.has(fileId)) {
      failedDrafts.push({
        draft,
        reason: failedMap.get(fileId)
      });
    } else {
      successfulDrafts.push(draft);
    }
  }

  return { successfulDrafts, failedDrafts };
}

