import { useEffect, useState } from 'react';
import { loadStoredAppState, persistStagedItems } from '../services/appStorage';
import {
  removeDraftById,
  removeDraftsById,
  updateDraftById,
  addDraft,
  saveDraftEdits,
  adjustDraftTimer,
  resetDraftTimer,
  updateDraftField
} from '../services/stagedDocumentOperations';
import { normalizeScanDate, buildAutoSplits, compressImage } from '../services/editFormHelpers';

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

export function useStagedDocuments({ activeProject, setError, setSuccess }) {
  const [stagedItems, setStagedItems] = useState(() => loadStoredAppState().stagedItems);
  const [animateBadge, setAnimateBadge] = useState(false);
  const [prevStagedCount, setPrevStagedCount] = useState(0);
  const [editingItemId, setEditingItemId] = useState(null);
  const [draftToDelete, setDraftToDelete] = useState(null);

  useEffect(() => {
    if (stagedItems.length > prevStagedCount) {
      setAnimateBadge(true);
      const timer = setTimeout(() => setAnimateBadge(false), 500);
      setPrevStagedCount(stagedItems.length);
      return () => clearTimeout(timer);
    }
    setPrevStagedCount(stagedItems?.length || 0);
  }, [stagedItems.length, prevStagedCount]);

  // Live synchronization listener: Immediately reflects new staged drafts across tabs and from AI tool calls
  useEffect(() => {
    const handleStagedUpdate = () => {
      const freshState = loadStoredAppState();
      const freshDrafts = Array.isArray(freshState.stagedItems) ? freshState.stagedItems : [];
      setStagedItems(freshDrafts);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('staged-items-updated', handleStagedUpdate);
      window.addEventListener('storage', handleStagedUpdate);
      return () => {
        window.removeEventListener('staged-items-updated', handleStagedUpdate);
        window.removeEventListener('storage', handleStagedUpdate);
      };
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

      const draftMetadata = {
        ...scanItem.metadata,
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
        createdAt: Date.now(),
        timerDuration: 60 * 60 * 1000
      };

      saveStagedItems(prev => addDraft(prev, newDraft));
      setSuccess('Check/Invoice scanned and saved to Drafts!');
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      console.error(err);
      setError(`Failed to save scanned item to drafts: ${err.message}`);
    }
  };

  const handleSaveStagedEdits = (updatedItem) => {
    saveStagedItems(prev => saveDraftEdits(prev, editingItemId, updatedItem));
    setEditingItemId(null);
    setSuccess('Draft updated successfully!');
    setTimeout(() => setSuccess(null), 3000);
  };

  const handleDeleteStaged = (id) => {
    const item = stagedItems.find(candidate => candidate.id === id);
    if (item) {
      setDraftToDelete(item);
    }
  };

  const removeStagedItem = (id) => {
    saveStagedItems(prev => removeDraftById(prev, id));
  };

  const removeStagedItems = (ids) => {
    saveStagedItems(prev => removeDraftsById(prev, ids));
  };

  const confirmDeleteDraft = () => {
    if (!draftToDelete) return;
    removeStagedItem(draftToDelete.id);
    setDraftToDelete(null);
    setSuccess('Draft discarded successfully!');
    setTimeout(() => setSuccess(null), 2500);
  };

  const handleAdjustTimer = (id, additionalMinutes) => {
    saveStagedItems(prev => adjustDraftTimer(prev, id, additionalMinutes));
  };

  const handleResetTimer = (id) => {
    saveStagedItems(prev => resetDraftTimer(prev, id));
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
    draftToDelete,
    setDraftToDelete,
    handleDataExtracted,
    handleSaveStagedEdits,
    handleDeleteStaged,
    confirmDeleteDraft,
    handleAdjustTimer,
    handleResetTimer,
    handleUpdateDraftField,
    updateStagedItem,
    removeStagedItem,
    removeStagedItems
  };
}
