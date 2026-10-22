import { useState } from 'react';
import { loadStoredAppState, persistHistory } from '../services/appStorage';
import { STATUS_MESSAGES, getDriveErrorMessage, isAuthError } from '../services/appErrors';
import { fetchDriveFileBlob } from '../services/googleDrive';
import { syncInvoiceDocument } from '../services/invoiceUpload';
import {
  draftSyncFailure,
  foldersToSync,
  getDraftUploads,
  getHistoryFileId,
  partitionDraftsBySyncResult
} from '../services/invoiceSyncState';
import { syncUploadedInvoicesForFolders } from '../services/directSyncService';
import { draftSyncProblem } from '../services/editFormHelpers';
import { fetchTransactionRows, parseTransactions } from '../services/sheetV2';
import { checkSyncedEntries, describeSheetMatch, findReceiptInSheet } from '../services/dailyCheck';
import { confirmAction } from '../services/confirmAction';

/** Reads the Sheet back and marks each synced entry as recorded or not. Never throws (entries stay unchecked). */
async function checkAgainstSheet(googleToken, spreadsheetId, logs) {
  if (!googleToken || !spreadsheetId) return logs;
  try {
    return checkSyncedEntries(logs, await fetchTransactionRows(googleToken, spreadsheetId));
  } catch (err) {
    console.warn('[useInvoiceSync] Could not check the Sheet after sync:', err?.message || err);
    return logs;
  }
}

/** Checks each synced entry against the Sheet of the lot it went to (a split can go to another house). */
async function checkAgainstSheets(googleToken, spreadsheetByFolder, logs) {
  const groups = new Map();
  (logs || []).forEach((log, index) => {
    const folderId = log.folderId || '';
    if (!groups.has(folderId)) groups.set(folderId, []);
    groups.get(folderId).push(index);
  });
  const checked = [...(logs || [])];
  for (const [folderId, indexes] of groups) {
    const result = await checkAgainstSheet(googleToken, spreadsheetByFolder?.[folderId], indexes.map(i => logs[i]));
    indexes.forEach((logIndex, i) => { checked[logIndex] = result[i]; });
  }
  return checked;
}

/**
 * Drafts that look already recorded in the Sheet (same payee, date and total). Read once per sync.
 * If the Sheet cannot be read, nothing is flagged and the sync goes on (the check after sync still runs).
 */
async function findAlreadyInSheet(googleToken, spreadsheetId, drafts) {
  if (!googleToken || !spreadsheetId || !drafts.length) return [];
  try {
    const transactions = parseTransactions(await fetchTransactionRows(googleToken, spreadsheetId));
    return drafts
      .map(item => ({ item, match: findReceiptInSheet(item.metadata, transactions, item.id) }))
      .filter(entry => entry.match);
  } catch (err) {
    console.warn('[useInvoiceSync] Could not check for duplicates before sync:', err?.message || err);
    return [];
  }
}

/** A short warning when any synced entry did not land in the Sheet as expected (null when all good). */
function checkWarning(logs) {
  const bad = (logs || []).filter(l => l.check && l.check.status !== 'ok');
  if (bad.length === 0) return null;
  const first = bad[0];
  return `Synced, but ${bad.length === 1 ? '1 entry' : `${bad.length} entries`} did not land right in the Sheet (${first.vendor || 'entry'}: ${first.check.problems[0]}). See History.`;
}

function writePdfLoadingState(newWindow) {
  if (!newWindow) return;

  newWindow.document.write(`
    <div style="
      font-family: system-ui, -apple-system, sans-serif;
      color: #fafafa;
      background: #0a0a0a;
      height: 100vh;
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 16px;
    ">
      <div style="
        width: 28px;
        height: 28px;
        border: 3px solid rgba(241, 215, 167, 0.2);
        border-top-color: #F1D7A7;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      "></div>
      <span style="font-size: 0.95rem; font-weight: 500; letter-spacing: 0.02em;">${STATUS_MESSAGES.retrievingPdf}</span>
      <style>
        @keyframes spin { to { transform: rotate(360deg); } }
      </style>
    </div>
  `);
}

// Short note when the Sheet's phase sections could not add rows after a sync (the sync itself still succeeded)
function growthNoteFor(result) {
  return result?.growthNote ? ` Note: ${result.growthNote}` : '';
}

// The linked Sheet only applies when syncing the active project's own folder
function linkedSheetFor(project, folderId) {
  return project?.folderId === folderId ? (project?.spreadsheetId || null) : null;
}

// Each lot folder with its project's linked Sheet (null: the Sheet is found in the folder)
function sheetFolders(folderIds, activeProject, projects) {
  return folderIds.map(folderId => {
    const project = activeProject?.folderId === folderId
      ? activeProject
      : (projects || []).find(p => p?.folderId === folderId);
    return { folderId, spreadsheetId: project?.spreadsheetId || null };
  });
}

export function useInvoiceSync({
  activeProject,
  googleToken,
  selectedFolder,
  projects,
  stagedItems,
  removeStagedItem,
  removeStagedItems,
  updateStagedItem,
  handleSessionExpired,
  setError,
  setSuccess
}) {
  const [uploading, setUploading] = useState(null);
  const [uploadStatusText, setUploadStatusText] = useState('');
  const [history, setHistory] = useState(() => loadStoredAppState().history);

  const saveHistory = (newHistory) => {
    setHistory(newHistory);
    persistHistory(newHistory);
  };

  // Adds entries on top of the latest History (a sync can take a while; never use a stale list)
  const addToHistory = (logs) => {
    setHistory(prev => {
      const next = [...logs, ...(prev || [])];
      persistHistory(next);
      return next;
    });
  };

  // Saves on the draft which receipt files are already in Drive, right after each one uploads
  const rememberUploads = (id, uploads) => {
    if (!updateStagedItem) return;
    const first = Object.values(uploads)[0];
    updateStagedItem(id, {
      uploads,
      driveFileId: first?.fileId || null,
      driveFileLink: first?.link || null
    });
  };

  const handleOneShotSync = async (id) => {
    const itemToSync = stagedItems.find(item => item.id === id);
    if (!itemToSync) return;

    const syncProblem = draftSyncProblem(itemToSync.metadata);
    if (syncProblem) {
      setError(syncProblem);
      return;
    }

    const targetFolderId = activeProject?.folderId || selectedFolder?.id;
    setError(null);
    setUploading(id);

    setUploadStatusText('Checking for duplicates...');
    const [duplicate] = await findAlreadyInSheet(googleToken, linkedSheetFor(activeProject, targetFolderId), [itemToSync]);
    if (duplicate && !(await confirmAction({
      title: 'Already in the Sheet?',
      message: `${describeSheetMatch(duplicate.match)}\n\nIf this is the same receipt, cancel and delete the draft.`,
      confirmLabel: 'Sync anyway'
    }))) {
      setUploading(null);
      setUploadStatusText('');
      setError(`Not synced: ${describeSheetMatch(duplicate.match)} Delete the draft if it is the same receipt.`);
      return;
    }

    setUploadStatusText('Uploading PDF...');

    let uploadedAny = Object.keys(getDraftUploads(itemToSync)).length > 0;
    try {
      const driveUploadResult = await syncInvoiceDocument({
        item: itemToSync,
        googleToken,
        selectedFolder,
        projects,
        onUploaded: (uploads) => {
          uploadedAny = true;
          rememberUploads(id, uploads);
        }
      });

      if (!driveUploadResult.hasDriveUpload) {
        addToHistory(driveUploadResult.logs);
        removeStagedItem(id);
        setSuccess(driveUploadResult.successMessage);
        return;
      }

      // Every lot this receipt went to gets its Sheet updated now (splits can go to other houses)
      setUploadStatusText('Updating spreadsheet...');
      const syncedDraft = { ...itemToSync, uploads: driveUploadResult.uploads };
      const result = await syncUploadedInvoicesForFolders(
        googleToken,
        sheetFolders(foldersToSync([syncedDraft]), activeProject, projects)
      );
      const failure = draftSyncFailure(syncedDraft, result.failed, result.folderErrors);

      if (failure) {
        if (updateStagedItem) updateStagedItem(id, { sheetSyncError: failure });
        setError(`PDF saved to Drive, but spreadsheet sync failed: ${failure}. Tap to retry.`);
        return;
      }

      // Every split made it: read each Sheet back to confirm the rows really landed
      setUploadStatusText('Checking the spreadsheet...');
      const checkedLogs = await checkAgainstSheets(googleToken, result.spreadsheetByFolder, driveUploadResult.logs);
      addToHistory(checkedLogs);
      removeStagedItem(id);
      const oneShotWarning = checkWarning(checkedLogs);

      const hasOtherFailures = result.failed.length > 0;

      if (oneShotWarning) {
        setError(oneShotWarning);
        return;
      }
      if (hasOtherFailures) {
        setSuccess(`Synced directly to spreadsheet & Drive! (Note: ${result.failed.length} other file(s) in Uploads require attention)${growthNoteFor(result)}`);
      } else {
        setSuccess(`Synced directly to spreadsheet & Drive!${growthNoteFor(result)}`);
      }
    } catch (err) {
      console.error('One-shot sync failed:', err);
      if (isAuthError(err)) {
        handleSessionExpired();
      } else if (uploadedAny && updateStagedItem) {
        // Files already in Drive stay recorded on the draft, so Retry finishes the job without duplicates
        updateStagedItem(id, { sheetSyncError: err.message || 'Sync did not finish' });
        setError(`Sync did not finish: ${err.message}. Tap to retry.`);
      } else {
        setError(getDriveErrorMessage(err, 'sync document'));
      }
    } finally {
      setUploading(null);
      setUploadStatusText('');
    }
  };

  const handleSyncAllDrafts = async () => {
    const activeProjectDrafts = (stagedItems || []).filter(item => {
      const lot = (item.metadata?.lotNumber || '').trim().toLowerCase();
      const projName = (activeProject?.name || '').trim().toLowerCase();
      return !lot || lot === projName;
    });

    if (activeProjectDrafts.length === 0) {
      setError(`No drafts found for ${activeProject?.name || 'current project'}.`);
      return;
    }

    // Drafts that cannot sync yet (no phase, or splits that do not add up) stay in Drafts
    const validPhaseDrafts = activeProjectDrafts.filter(item => !draftSyncProblem(item.metadata));
    const invalidPhaseDrafts = activeProjectDrafts.filter(item => draftSyncProblem(item.metadata));

    const invalidDesc = invalidPhaseDrafts.length > 0 ? draftSyncProblem(invalidPhaseDrafts[0].metadata) : '';

    if (validPhaseDrafts.length === 0) {
      setError(invalidDesc || 'No valid drafts found to sync.');
      return;
    }

    const targetFolderId = activeProject?.folderId || selectedFolder?.id;
    if (!targetFolderId && googleToken) {
      setError('Please select an active project folder before syncing.');
      return;
    }

    setError(null);
    setUploading('all');

    setUploadStatusText('Checking for duplicates...');
    const duplicates = await findAlreadyInSheet(googleToken, linkedSheetFor(activeProject, targetFolderId), validPhaseDrafts);
    if (duplicates.length > 0) {
      const lines = duplicates.slice(0, 5).map(d => `• ${describeSheetMatch(d.match)}`);
      if (duplicates.length > 5) lines.push(`• and ${duplicates.length - 5} more`);
      const heading = duplicates.length === 1 ? '1 draft looks already synced:' : `${duplicates.length} drafts look already synced:`;
      if (!(await confirmAction({
        title: 'Already in the Sheet?',
        message: `${heading}\n${lines.join('\n')}\n\nCancel syncs nothing, so you can delete those drafts first.`,
        confirmLabel: 'Sync everything anyway'
      }))) {
        setUploading(null);
        setUploadStatusText('');
        setError(`Nothing synced. ${heading} delete those drafts if they are the same receipts, then Sync All again.`);
        return;
      }
    }

    // Offline / Mock mode
    if (!googleToken || !selectedFolder) {
      const allOfflineLogs = [];
      const successfulOfflineIds = [];
      for (let i = 0; i < validPhaseDrafts.length; i++) {
        const item = validPhaseDrafts[i];
        setUploadStatusText(`Downloading PDF (${i + 1}/${validPhaseDrafts.length})...`);
        const result = await syncInvoiceDocument({ item, googleToken, selectedFolder, projects });
        allOfflineLogs.push(...result.logs);
        successfulOfflineIds.push(item.id);
      }
      addToHistory(allOfflineLogs);
      if (typeof removeStagedItems === 'function' && successfulOfflineIds.length > 0) {
        removeStagedItems(successfulOfflineIds);
      } else {
        successfulOfflineIds.forEach(id => removeStagedItem(id));
      }
      const note = invalidPhaseDrafts.length > 0 ? ` ${invalidDesc}` : '';
      setSuccess(`Downloaded ${validPhaseDrafts.length} document(s) to device!${note}`);
      setUploading(null);
      setUploadStatusText('');
      return;
    }

    const draftsWithUploads = new Set(
      validPhaseDrafts.filter(item => Object.keys(getDraftUploads(item)).length > 0).map(item => item.id)
    );
    try {
      const allLogs = [];
      const uploadedDrafts = [];

      for (let i = 0; i < validPhaseDrafts.length; i++) {
        const item = validPhaseDrafts[i];
        setUploadStatusText(`Uploading PDF (${i + 1}/${validPhaseDrafts.length})...`);

        try {
          const uploadRes = await syncInvoiceDocument({
            item,
            googleToken,
            selectedFolder,
            projects,
            onUploaded: (uploads) => {
              draftsWithUploads.add(item.id);
              rememberUploads(item.id, uploads);
            }
          });
          uploadedDrafts.push({ ...item, uploads: uploadRes.uploads });
          allLogs.push(...uploadRes.logs);
        } catch (uploadErr) {
          if (isAuthError(uploadErr)) throw uploadErr;
          console.error(`Failed to upload draft ${item.id}:`, uploadErr);
          if (updateStagedItem) {
            updateStagedItem(item.id, {
              sheetSyncError: `Upload to Drive failed: ${uploadErr.message || 'Network error'}`
            });
          }
        }
      }

      if (uploadedDrafts.length === 0) {
        throw new Error('Failed to upload document PDFs to Google Drive.');
      }

      // Every lot these receipts went to gets its Sheet updated (splits can go to other houses)
      setUploadStatusText('Updating spreadsheet...');
      const result = await syncUploadedInvoicesForFolders(
        googleToken,
        sheetFolders(foldersToSync(uploadedDrafts), activeProject, projects)
      );

      // A draft only leaves Drafts when every one of its splits made it into its Sheet
      const { successfulDrafts, failedDrafts } = partitionDraftsBySyncResult(uploadedDrafts, result.failed, result.folderErrors);

      const successfulIds = successfulDrafts.map(d => d.id);
      // History gets only the drafts that really synced (failed ones stay in Drafts), checked against each Sheet
      const successfulLogs = allLogs.filter(log => !log.draftId || successfulIds.includes(log.draftId));
      setUploadStatusText('Checking the spreadsheet...');
      const checkedLogs = await checkAgainstSheets(googleToken, result.spreadsheetByFolder, successfulLogs);
      addToHistory(checkedLogs);
      const syncAllWarning = checkWarning(checkedLogs);
      if (typeof removeStagedItems === 'function' && successfulIds.length > 0) {
        removeStagedItems(successfulIds);
      } else {
        successfulIds.forEach(id => removeStagedItem(id));
      }

      // Keep failed drafts and update their error message
      if (updateStagedItem) {
        failedDrafts.forEach(({ draft, reason }) => {
          updateStagedItem(draft.id, { sheetSyncError: reason });
        });
      }

      const hasFailures = result.failed.length > 0 || failedDrafts.length > 0;

      const phaseNote = invalidPhaseDrafts.length > 0 ? ` ${invalidDesc}` : '';

      if (syncAllWarning) {
        setError(syncAllWarning);
      } else if (hasFailures) {
        const attention = Math.max(failedDrafts.length, result.failed.length);
        if (successfulIds.length > 0) {
          const docWord = successfulIds.length === 1 ? 'document' : 'documents';
          setSuccess(`Synced ${successfulIds.length} ${docWord}. ${attention} file(s) require attention.${phaseNote}${growthNoteFor(result)}`);
        } else {
          setError(`Spreadsheet sync failed for ${attention} document(s). Drafts remain safely on device to retry.`);
        }
      } else {
        const docWord = successfulIds.length === 1 ? 'document' : 'documents';
        setSuccess(`Synced ${successfulIds.length} ${docWord}.${phaseNote}${growthNoteFor(result)}`);
      }
    } catch (err) {
      console.error('Sync all failed:', err);
      if (isAuthError(err)) {
        handleSessionExpired();
      } else {
        if (updateStagedItem) {
          validPhaseDrafts.forEach(draft => {
            if (draftsWithUploads.has(draft.id)) {
              updateStagedItem(draft.id, { sheetSyncError: err.message || 'Spreadsheet sync failed' });
            }
          });
        }
        setError(`Spreadsheet sync failed: ${err.message}. Drafts remain safely on device to retry.`);
      }
    } finally {
      setUploading(null);
      setUploadStatusText('');
    }
  };

  const handleViewPDF = async (item) => {
    if (!item.link) return;

    const newWindow = window.open('about:blank', '_blank');
    writePdfLoadingState(newWindow);

    if (googleToken) {
      try {
        const fileId = getHistoryFileId(item);
        const blob = await fetchDriveFileBlob(googleToken, fileId);
        const fileURL = URL.createObjectURL(blob);
        if (newWindow) {
          newWindow.location.href = fileURL;
        } else {
          window.open(fileURL, '_blank');
        }
        setTimeout(() => {
          try {
            URL.revokeObjectURL(fileURL);
          } catch {}
        }, 60000);
        return;
      } catch (err) {
        console.error('Failed to view PDF via API, falling back to web link:', err);
        if (isAuthError(err)) {
          handleSessionExpired();
        }
      }
    }

    if (newWindow) {
      newWindow.location.href = item.link;
    } else {
      window.open(item.link, '_blank');
    }
  };

  const handleClearHistory = async () => {
    if (!(await confirmAction({
      title: 'Clear all History?',
      message: 'This removes every History entry from this device. Nothing changes in the Sheet or Drive.',
      confirmLabel: 'Clear History'
    }))) return;
    saveHistory([]);
  };

  const handleDeleteHistoryItem = (id) => {
    const nextHistory = (history || []).filter(item => item.id !== id);
    saveHistory(nextHistory);
  };

  return {
    uploading,
    uploadStatusText,
    history,
    handleOneShotSync,
    handleSyncAllDrafts,
    handleViewPDF,
    handleClearHistory,
    handleDeleteHistoryItem
  };
}
