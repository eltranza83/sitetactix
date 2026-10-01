import { useState } from 'react';
import {
  APP_STORAGE_KEYS,
  loadStoredAppState,
  persistHistory,
  setStoredBoolean
} from '../services/appStorage';
import { STATUS_MESSAGES, getDriveErrorMessage, isAuthError } from '../services/appErrors';
import { fetchDriveFileBlob } from '../services/googleDrive';
import { buildHistoryLogs, syncInvoiceDocument } from '../services/invoiceUpload';
import {
  getHistoryFileId,
  partitionDraftsBySyncResult
} from '../services/invoiceSyncState';
import { syncUploadedInvoicesDirectly } from '../services/directSyncService';
import { isDraftPhaseValid } from '../services/editFormHelpers';

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
  const [hasUnprocessedUploads, setHasUnprocessedUploads] = useState(() => (
    loadStoredAppState().hasUnprocessedUploads
  ));
  const [triggeringSync, setTriggeringSync] = useState(false);

  const saveHistory = (newHistory) => {
    setHistory(newHistory);
    persistHistory(newHistory);
  };

  const handleTriggerDirectSync = async () => {
    const targetFolderId = activeProject?.folderId || selectedFolder?.id;
    if (!targetFolderId) {
      setError('Please select an active project folder before syncing.');
      return;
    }
    if (!googleToken) {
      setError('Connect Google Drive to sync with your spreadsheet.');
      return;
    }
    setTriggeringSync(true);
    setError(null);
    try {
      const result = await syncUploadedInvoicesDirectly(googleToken, targetFolderId);
      const hasFailures = (result.failed || []).length > 0;
      setHasUnprocessedUploads(hasFailures);
      setStoredBoolean(APP_STORAGE_KEYS.hasUnprocessedUploads, hasFailures);

      if (hasFailures) {
        if (result.processedCount > 0) {
          setSuccess(`Synced ${result.processedCount} invoice(s). Note: ${result.failed.length} file(s) left in Uploads: ${result.failed[0].reason}`);
        } else {
          setError(`Could not sync: ${result.failed[0].fileName} - ${result.failed[0].reason}`);
        }
      } else {
        setSuccess(
          result.processedCount > 0
            ? `Synced ${result.processedCount} invoice(s) directly to your spreadsheet!`
            : 'Spreadsheet is up to date!'
        );
      }
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      console.error('Direct sync failed:', err);
      if (isAuthError(err)) {
        handleSessionExpired();
      } else {
        setError(getDriveErrorMessage(err, 'sync spreadsheet'));
      }
    } finally {
      setTriggeringSync(false);
    }
  };

  const handleOneShotSync = async (id) => {
    const itemToSync = stagedItems.find(item => item.id === id);
    if (!itemToSync) return;

    if (!isDraftPhaseValid(itemToSync.metadata)) {
      if (itemToSync.driveFileId) {
        setError("Already uploaded with an invalid phase. Delete this draft and its PDF in Invoice Uploads, then rescan.");
      } else {
        const desc = `'${itemToSync.metadata?.vendor || 'Draft'} – $${Number(itemToSync.metadata?.amount || 0).toFixed(2)}'`;
        setError(`${desc} needs a phase before it can sync.`);
      }
      return;
    }

    const targetFolderId = activeProject?.folderId || selectedFolder?.id;
    setError(null);
    setUploading(id);
    setUploadStatusText('Uploading PDF...');

    let driveUploadResult = null;
    try {
      if (itemToSync.driveFileId) {
        driveUploadResult = {
          hasDriveUpload: true,
          driveFileId: itemToSync.driveFileId,
          webViewLink: itemToSync.driveFileLink,
          logs: buildHistoryLogs(itemToSync.metadata, {
            idPrefix: itemToSync.driveFileId,
            link: itemToSync.driveFileLink
          })
        };
      } else {
        driveUploadResult = await syncInvoiceDocument({
          item: itemToSync,
          googleToken,
          selectedFolder,
          projects
        });

        if (updateStagedItem && driveUploadResult.driveFileId) {
          updateStagedItem(id, {
            driveFileId: driveUploadResult.driveFileId,
            driveFileLink: driveUploadResult.webViewLink
          });
        }
      }

      if (!driveUploadResult.hasDriveUpload) {
        saveHistory([...driveUploadResult.logs, ...history]);
        removeStagedItem(id);
        setSuccess(driveUploadResult.successMessage);
        setTimeout(() => setSuccess(null), 4000);
        return;
      }

      setUploadStatusText('Updating spreadsheet...');

      if (!targetFolderId) {
        throw new Error('Please select an active project folder before syncing.');
      }

      if (!googleToken) {
        throw new Error('Connect Google Drive to sync with your spreadsheet.');
      }

      const result = await syncUploadedInvoicesDirectly(googleToken, targetFolderId);
      const targetFileId = driveUploadResult.driveFileId || itemToSync.driveFileId;
      const targetFailure = (result.failed || []).find(f => f.fileId === targetFileId);

      if (targetFailure) {
        if (updateStagedItem) {
          updateStagedItem(id, {
            driveFileId: targetFileId,
            driveFileLink: driveUploadResult.webViewLink || itemToSync.driveFileLink,
            sheetSyncError: targetFailure.reason
          });
        }
        setHasUnprocessedUploads(true);
        setStoredBoolean(APP_STORAGE_KEYS.hasUnprocessedUploads, true);
        setError(`PDF saved to Drive, but spreadsheet sync failed: ${targetFailure.reason}. Tap to retry.`);
        return;
      }

      // Successful for this item
      saveHistory([...driveUploadResult.logs, ...history]);
      removeStagedItem(id);

      const hasOtherFailures = (result.failed || []).length > 0;
      setHasUnprocessedUploads(hasOtherFailures);
      setStoredBoolean(APP_STORAGE_KEYS.hasUnprocessedUploads, hasOtherFailures);

      if (hasOtherFailures) {
        setSuccess(`Synced directly to spreadsheet & Drive! (Note: ${result.failed.length} other file(s) in Uploads require attention)`);
      } else {
        setSuccess('Synced directly to spreadsheet & Drive!');
      }
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      console.error('One-shot sync failed:', err);
      if (isAuthError(err)) {
        handleSessionExpired();
      } else {
        if (driveUploadResult?.hasDriveUpload && updateStagedItem) {
          updateStagedItem(id, {
            driveFileId: driveUploadResult.driveFileId || itemToSync.driveFileId,
            driveFileLink: driveUploadResult.webViewLink || itemToSync.driveFileLink,
            sheetSyncError: err.message || 'Spreadsheet sync failed'
          });
          setError(`PDF saved to Drive, but spreadsheet sync failed: ${err.message}. Tap to retry.`);
        } else {
          setError(getDriveErrorMessage(err, 'sync document'));
        }
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

    const validPhaseDrafts = activeProjectDrafts.filter(item => isDraftPhaseValid(item.metadata));
    const invalidPhaseDrafts = activeProjectDrafts.filter(item => !isDraftPhaseValid(item.metadata));

    const invalidDesc = invalidPhaseDrafts.length > 0
      ? `'${invalidPhaseDrafts[0].metadata?.vendor || 'Draft'} – $${Number(invalidPhaseDrafts[0].metadata?.amount || 0).toFixed(2)}' needs a phase before it can sync.`
      : '';

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
      saveHistory([...allOfflineLogs, ...history]);
      if (typeof removeStagedItems === 'function' && successfulOfflineIds.length > 0) {
        removeStagedItems(successfulOfflineIds);
      } else {
        successfulOfflineIds.forEach(id => removeStagedItem(id));
      }
      const note = invalidPhaseDrafts.length > 0 ? ` ${invalidDesc}` : '';
      setSuccess(`Downloaded ${validPhaseDrafts.length} document(s) to device!${note}`);
      setUploading(null);
      setUploadStatusText('');
      setTimeout(() => setSuccess(null), 4000);
      return;
    }

    try {
      const allLogs = [];
      const successfulUploadIds = [];
      const uploadedDrafts = [];

      for (let i = 0; i < validPhaseDrafts.length; i++) {
        const item = validPhaseDrafts[i];
        setUploadStatusText(`Uploading PDF (${i + 1}/${validPhaseDrafts.length})...`);

        if (item.driveFileId) {
          successfulUploadIds.push(item.id);
          uploadedDrafts.push(item);
          allLogs.push(...buildHistoryLogs(item.metadata, {
            idPrefix: item.driveFileId,
            link: item.driveFileLink
          }));
        } else {
          try {
            const uploadRes = await syncInvoiceDocument({
              item,
              googleToken,
              selectedFolder,
              projects
            });
            if (uploadRes && uploadRes.hasDriveUpload && uploadRes.driveFileId) {
              const updatedItem = {
                ...item,
                driveFileId: uploadRes.driveFileId,
                driveFileLink: uploadRes.webViewLink
              };
              successfulUploadIds.push(item.id);
              uploadedDrafts.push(updatedItem);
              if (updateStagedItem) {
                updateStagedItem(item.id, {
                  driveFileId: uploadRes.driveFileId,
                  driveFileLink: uploadRes.webViewLink
                });
              }
              allLogs.push(...uploadRes.logs);
            } else {
              if (updateStagedItem) {
                updateStagedItem(item.id, {
                  sheetSyncError: 'Upload to Drive failed (no Drive file created)'
                });
              }
            }
          } catch (uploadErr) {
            console.error(`Failed to upload draft ${item.id}:`, uploadErr);
            if (updateStagedItem) {
              updateStagedItem(item.id, {
                sheetSyncError: `Upload to Drive failed: ${uploadErr.message || 'Network error'}`
              });
            }
          }
        }
      }

      if (uploadedDrafts.length === 0) {
        throw new Error('Failed to upload document PDFs to Google Drive.');
      }

      setUploadStatusText('Updating spreadsheet...');

      if (!targetFolderId) {
        throw new Error('Please select an active project folder before syncing.');
      }

      if (!googleToken) {
        throw new Error('Connect Google Drive to sync with your spreadsheet.');
      }

      const result = await syncUploadedInvoicesDirectly(googleToken, targetFolderId);

      // Partition ONLY drafts that actually uploaded to Drive
      const { successfulDrafts, failedDrafts } = partitionDraftsBySyncResult(uploadedDrafts, result.failed);

      // Save history and remove only successful drafts
      const successfulIds = successfulDrafts.map(d => d.id);
      saveHistory([...allLogs, ...history]);
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

      const hasFailures = (result.failed || []).length > 0;
      setHasUnprocessedUploads(hasFailures);
      setStoredBoolean(APP_STORAGE_KEYS.hasUnprocessedUploads, hasFailures);

      const warningNote = (result.warnings && result.warnings.length > 0)
        ? ` (Note: Master log tab could not be updated for ${result.warnings.length} invoice(s))`
        : '';

      const phaseNote = invalidPhaseDrafts.length > 0 ? ` ${invalidDesc}` : '';

      if (hasFailures) {
        if (result.processedCount > 0) {
          const docWord = result.processedCount === 1 ? 'document' : 'documents';
          setSuccess(`Synced ${result.processedCount} ${docWord}. ${result.failed.length} file(s) require attention.${warningNote}${phaseNote}`);
        } else {
          setError(`Spreadsheet sync failed for ${result.failed.length} document(s). Drafts remain safely on device to retry.`);
        }
      } else {
        const docWord = successfulIds.length === 1 ? 'document' : 'documents';
        setSuccess(`Synced ${successfulIds.length} ${docWord}.${phaseNote}`);
      }
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      console.error('Sync all failed:', err);
      if (isAuthError(err)) {
        handleSessionExpired();
      } else {
        if (updateStagedItem) {
          validPhaseDrafts.forEach(draft => {
            if (draft.driveFileId) {
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

  const handleClearHistory = () => {
    if (!window.confirm('Are you sure you want to clear all upload history? This will remove all history log entries from this device.')) return;
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
    hasUnprocessedUploads,
    triggeringSync,
    handleTriggerSync: handleTriggerDirectSync,
    handleTriggerAppsScriptSync: handleTriggerDirectSync,
    handleOneShotSync,
    handleSyncToDrive: handleOneShotSync,
    handleSyncAllDrafts,
    handleViewPDF,
    handleClearHistory,
    handleDeleteHistoryItem
  };
}
