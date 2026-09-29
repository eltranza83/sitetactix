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
  getHistoryFileId
} from '../services/invoiceSyncState';
import { triggerAppsScriptSync } from '../services/secureApi';
import { syncUploadedInvoicesDirectly } from '../services/directSyncService';

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

  const handleTriggerAppsScriptSync = async () => {
    const targetFolderId = activeProject?.folderId || selectedFolder?.id;
    if (!targetFolderId) {
      setError('Please select an active project folder before syncing.');
      return;
    }
    setTriggeringSync(true);
    setError(null);
    try {
      if (googleToken) {
        const result = await syncUploadedInvoicesDirectly(googleToken, targetFolderId);
        setHasUnprocessedUploads(false);
        setStoredBoolean(APP_STORAGE_KEYS.hasUnprocessedUploads, false);
        setSuccess(
          result.processedCount > 0
            ? `Synced ${result.processedCount} invoice(s) directly to your spreadsheet!`
            : 'Spreadsheet is up to date!'
        );
      } else {
        await triggerAppsScriptSync(targetFolderId);
        setHasUnprocessedUploads(false);
        setStoredBoolean(APP_STORAGE_KEYS.hasUnprocessedUploads, false);
        setSuccess('Spreadsheet sync triggered successfully!');
      }
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      console.error('Direct sync failed, trying fallback:', err);
      try {
        await triggerAppsScriptSync(targetFolderId);
        setHasUnprocessedUploads(false);
        setStoredBoolean(APP_STORAGE_KEYS.hasUnprocessedUploads, false);
        setSuccess('Spreadsheet sync triggered!');
      } catch (fallbackErr) {
        setError(getDriveErrorMessage(fallbackErr, 'trigger spreadsheet sync'));
      }
    } finally {
      setTriggeringSync(false);
    }
  };

  const handleOneShotSync = async (id) => {
    const itemToSync = stagedItems.find(item => item.id === id);
    if (!itemToSync) return;

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

      if (googleToken) {
        try {
          await syncUploadedInvoicesDirectly(googleToken, targetFolderId);
        } catch (directErr) {
          console.warn('Direct sync failed, attempting Apps Script fallback:', directErr);
          await triggerAppsScriptSync(targetFolderId);
        }
      } else {
        await triggerAppsScriptSync(targetFolderId);
      }

      saveHistory([...driveUploadResult.logs, ...history]);
      removeStagedItem(id);
      setHasUnprocessedUploads(false);
      setStoredBoolean(APP_STORAGE_KEYS.hasUnprocessedUploads, false);
      setSuccess('Synced directly to spreadsheet & Drive!');
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

    const targetFolderId = activeProject?.folderId || selectedFolder?.id;
    if (!targetFolderId && googleToken) {
      setError('Please select an active project folder before syncing.');
      return;
    }

    setError(null);
    setUploading('all');

    // Offline / Mock mode
    if (!googleToken || !selectedFolder) {
      for (let i = 0; i < activeProjectDrafts.length; i++) {
        const item = activeProjectDrafts[i];
        setUploadStatusText(`Downloading PDF (${i + 1}/${activeProjectDrafts.length})...`);
        const result = await syncInvoiceDocument({ item, googleToken, selectedFolder, projects });
        saveHistory([...result.logs, ...history]);
        removeStagedItem(item.id);
      }
      setSuccess(`Downloaded ${activeProjectDrafts.length} document(s) to device!`);
      setUploading(null);
      setUploadStatusText('');
      setTimeout(() => setSuccess(null), 4000);
      return;
    }

    try {
      const allLogs = [];
      const successfulUploadIds = [];

      for (let i = 0; i < activeProjectDrafts.length; i++) {
        const item = activeProjectDrafts[i];
        setUploadStatusText(`Uploading PDF (${i + 1}/${activeProjectDrafts.length})...`);

        if (item.driveFileId) {
          successfulUploadIds.push(item.id);
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
            if (uploadRes.hasDriveUpload) {
              successfulUploadIds.push(item.id);
              if (updateStagedItem) {
                updateStagedItem(item.id, {
                  driveFileId: uploadRes.driveFileId,
                  driveFileLink: uploadRes.webViewLink
                });
              }
              allLogs.push(...uploadRes.logs);
            }
          } catch (uploadErr) {
            console.error(`Failed to upload draft ${item.id}:`, uploadErr);
          }
        }
      }

      if (successfulUploadIds.length === 0) {
        throw new Error('Failed to upload document PDFs to Google Drive.');
      }

      setUploadStatusText('Updating spreadsheet...');

      if (googleToken) {
        try {
          await syncUploadedInvoicesDirectly(googleToken, targetFolderId);
        } catch (directErr) {
          console.warn('Direct sync failed, attempting Apps Script fallback:', directErr);
          await triggerAppsScriptSync(targetFolderId);
        }
      } else {
        await triggerAppsScriptSync(targetFolderId);
      }

      saveHistory([...allLogs, ...history]);
      successfulUploadIds.forEach(id => removeStagedItem(id));
      setHasUnprocessedUploads(false);
      setStoredBoolean(APP_STORAGE_KEYS.hasUnprocessedUploads, false);
      setSuccess(`Successfully synced ${successfulUploadIds.length} document(s) directly to your spreadsheet!`);
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      console.error('Sync all failed:', err);
      if (isAuthError(err)) {
        handleSessionExpired();
      } else {
        if (updateStagedItem) {
          activeProjectDrafts.forEach(draft => {
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
    handleTriggerAppsScriptSync,
    handleOneShotSync,
    handleSyncToDrive: handleOneShotSync,
    handleSyncAllDrafts,
    handleViewPDF,
    handleClearHistory,
    handleDeleteHistoryItem
  };
}
