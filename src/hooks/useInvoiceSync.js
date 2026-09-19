import { useState } from 'react';
import {
  APP_STORAGE_KEYS,
  loadStoredAppState,
  persistHistory,
  setStoredBoolean
} from '../services/appStorage';
import { STATUS_MESSAGES, getDriveErrorMessage, isAuthError } from '../services/appErrors';
import { fetchDriveFileBlob } from '../services/googleDrive';
import { syncInvoiceDocument } from '../services/invoiceUpload';
import {
  getHistoryFileId,
  shouldFlagUnprocessedUpload
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
  handleSessionExpired,
  setError,
  setSuccess
}) {
  const [uploading, setUploading] = useState(null);
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

  const handleSyncToDrive = async (id) => {
    const itemToSync = stagedItems.find(item => item.id === id);
    if (!itemToSync) return;

    setError(null);
    setUploading(id);

    try {
      const result = await syncInvoiceDocument({
        item: itemToSync,
        googleToken,
        selectedFolder,
        projects
      });

      saveHistory([...result.logs, ...history]);

      if (shouldFlagUnprocessedUpload(result)) {
        setHasUnprocessedUploads(true);
        setStoredBoolean(APP_STORAGE_KEYS.hasUnprocessedUploads, true);
      }

      setSuccess(result.successMessage);

      removeStagedItem(id);
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      console.error(err);
      if (isAuthError(err)) {
        handleSessionExpired();
      } else {
        setError(getDriveErrorMessage(err, 'save report'));
      }
    } finally {
      setUploading(null);
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
    history,
    hasUnprocessedUploads,
    triggeringSync,
    handleTriggerAppsScriptSync,
    handleSyncToDrive,
    handleViewPDF,
    handleClearHistory,
    handleDeleteHistoryItem
  };
}
