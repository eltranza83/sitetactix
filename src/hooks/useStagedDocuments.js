import { useEffect, useState } from 'react';
import { APP_STORAGE_KEYS, loadStoredAppState, persistStagedItems } from '../services/appStorage';
import { DRAFT_PHOTO_FIELDS, pendingDraftPhotos, restoreDraftPhotos } from '../services/draftPhotoStore';
import {
  removeDraftById,
  removeDraftsById,
  updateDraftById,
  addDraft,
  saveDraftEdits,
  updateDraftField
} from '../services/stagedDocumentOperations';
import { normalizeScanDate, buildAutoSplits } from '../services/editFormHelpers';
import { applyPayeeMatch, loadCachedKnownSubs, persistKnownSubs } from '../services/payeeMatching';
import { fetchKnownSubs } from '../services/sheetV2';
import { compressImage, fileToBase64 } from '../services/imageFiles';
import { confirmAction } from '../services/confirmAction';
import { isAuthError } from '../services/appErrors';
import { discardDraftFiles } from '../services/invoiceUpload';
import { getDraftUploads } from '../services/invoiceSyncState';

// Known subs from the linked Sheet's Contracts tab (new layout only); the last good list is kept for offline scans
async function loadKnownSubsForProject(activeProject, googleToken) {
  const spreadsheetId = activeProject?.spreadsheetId;
  if (!spreadsheetId) return [];
  const cached = loadCachedKnownSubs(localStorage, spreadsheetId);
  if (!googleToken) return cached;
  try {
    const fresh = await fetchKnownSubs(googleToken, spreadsheetId);
    persistKnownSubs(localStorage, spreadsheetId, fresh);
    return fresh;
  } catch (err) {
    console.warn('[useStagedDocuments] Could not read Contracts for payee matching:', err);
    return cached;
  }
}

export function useStagedDocuments({ activeProject, googleToken = null, setError, setSuccess, onSessionExpired = null }) {
  const [stagedItems, setStagedItems] = useState(() => loadStoredAppState().stagedItems);
  const [animateBadge, setAnimateBadge] = useState(false);
  const [prevStagedCount, setPrevStagedCount] = useState(0);
  const [editingItemId, setEditingItemId] = useState(null);

  useEffect(() => {
    if (stagedItems.length > prevStagedCount) {
      setAnimateBadge(true);
      const timer = setTimeout(() => setAnimateBadge(false), 500);
      setPrevStagedCount(stagedItems.length);
      return () => clearTimeout(timer);
    }
    setPrevStagedCount(stagedItems?.length || 0);
  }, [stagedItems.length, prevStagedCount]);

  // Drafts changed in another tab: show them here too, with their photos loaded back from the large storage
  useEffect(() => {
    const handleStagedUpdate = async (event) => {
      if (event?.key && event.key !== APP_STORAGE_KEYS.stagedItems) return;
      const freshState = loadStoredAppState();
      const freshDrafts = Array.isArray(freshState.stagedItems) ? freshState.stagedItems : [];
      setStagedItems(await restoreDraftPhotos(freshDrafts));
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', handleStagedUpdate);
      return () => window.removeEventListener('storage', handleStagedUpdate);
    }
  }, []);

  const saveStagedItems = (updater) => {
    setStagedItems(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try {
        persistStagedItems(next);
      } catch (err) {
        console.error('LocalStorage quota error:', err);
        setError('Storage full! Draft saved in memory, but please sync items to free up browser space.');
      }
      return next;
    });
  };

  // On opening the app: put each draft's photo back from the large storage, and move photos of older
  // drafts (saved before v1.14.13, photo inside the small storage) out to the large one
  useEffect(() => {
    let active = true;
    restoreDraftPhotos(loadStoredAppState().stagedItems).then(restored => {
      if (!active) return;
      const byId = new Map(restored.map(draft => [draft.id, draft]));
      saveStagedItems(prev => prev.map(draft => {
        const back = byId.get(draft.id);
        if (!back || pendingDraftPhotos(draft).length === 0) return draft;
        const next = { ...draft };
        delete next.storedPhotos;
        for (const field of DRAFT_PHOTO_FIELDS) {
          if (!next[field] && back[field]) next[field] = back[field];
        }
        if (back.storedPhotos) next.storedPhotos = back.storedPhotos;
        if (back.missingPhotos) next.missingPhotos = back.missingPhotos;
        return next;
      }));
    });
    return () => { active = false; };
  }, []);

  const handleDataExtracted = async (scanItem) => {
    setError(null);
    try {
      let mainImageBase64 = null;
      if (scanItem.mainImage) {
        // The scan already read the full-size photo; the copy kept in the draft only needs to be sharp enough for the PDF
        const isImage = String(scanItem.mainImage.type || '').startsWith('image/');
        const storedImage = isImage ? await compressImage(scanItem.mainImage, 1800, 1800) : scanItem.mainImage;
        mainImageBase64 = await fileToBase64(storedImage);
      }

      // A payee that is a known sub is written the same way every time (the Contracts Company, else the Sub)
      const knownSubs = await loadKnownSubsForProject(activeProject, googleToken);
      const draftMetadata = {
        ...applyPayeeMatch(scanItem.metadata || {}, knownSubs),
        date: normalizeScanDate(scanItem.metadata?.date) || scanItem.metadata?.date || '',
        lotNumber: activeProject ? activeProject.name : ''
      };
      // Items from different trades (plumbing + electrical + tile...) start out already split
      const autoSplits = buildAutoSplits(draftMetadata);
      if (autoSplits) draftMetadata.splits = autoSplits;

      const newDraft = {
        id: `draft_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        metadata: draftMetadata,
        mainImageBase64,
        secondaryImageBase64: null,
        // Shown on the draft card (not saved to Drive or the Sheet): Google's backup model read it
        ...(scanItem.readByBackupAi ? { readByBackupAi: true } : {}),
        createdAt: Date.now()
      };

      saveStagedItems(prev => addDraft(prev, newDraft));
      setSuccess('Check/Invoice scanned and saved to Drafts!');
    } catch (err) {
      console.error(err);
      setError(`Failed to save scanned item to drafts: ${err.message}`);
    }
  };

  const handleSaveStagedEdits = (updatedItem) => {
    saveStagedItems(prev => saveDraftEdits(prev, editingItemId, updatedItem));
    setEditingItemId(null);
    setSuccess('Draft updated successfully!');
  };

  const handleDeleteStaged = async (id) => {
    const item = stagedItems.find(candidate => candidate.id === id);
    if (!item) return;

    const description = item.metadata?.description ? `"${item.metadata.description}"` : '';
    const inDrive = Object.keys(getDraftUploads(item)).length > 0;
    const driveNote = !inDrive ? ''
      : googleToken
        ? 'Its PDF waiting in Drive is removed too, so it is not added to the Sheet later.'
        : 'Its PDF is still waiting in Drive (Invoice Uploads). Delete it there too, or the next sync adds it to the Sheet.';
    if (!(await confirmAction({
      title: 'Discard this draft?',
      message: [description, driveNote].filter(Boolean).join('\n\n'),
      confirmLabel: 'Delete'
    }))) return;

    if (inDrive && googleToken) {
      try {
        await discardDraftFiles(googleToken, item);
      } catch (err) {
        // The PDF is still waiting in Drive: keep the draft, or the next sync would add a deleted receipt
        if (isAuthError(err)) {
          onSessionExpired?.();
        } else {
          setError(`Draft kept: its PDF could not be removed from Drive (${err?.message || 'no connection'}). Try again with signal.`);
        }
        return;
      }
    }
    removeStagedItem(item.id);
    setSuccess('Draft discarded successfully!');
  };

  const removeStagedItem = (id) => {
    saveStagedItems(prev => removeDraftById(prev, id));
  };

  const removeStagedItems = (ids) => {
    saveStagedItems(prev => removeDraftsById(prev, ids));
  };

  const handleUpdateDraftField = (id, field, value) => {
    saveStagedItems(prev => updateDraftField(prev, id, field, value));
  };

  const updateStagedItem = (id, updates) => {
    saveStagedItems(prev => updateDraftById(prev, id, updates));
  };

  return {
    stagedItems,
    animateBadge,
    editingItemId,
    setEditingItemId,
    handleDataExtracted,
    handleSaveStagedEdits,
    handleDeleteStaged,
    handleUpdateDraftField,
    updateStagedItem,
    removeStagedItem,
    removeStagedItems
  };
}
