import { useEffect, useState } from 'react';
import { loadStoredAppState, persistStagedItems } from '../services/appStorage';

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

  const saveStagedItems = (updatedDrafts) => {
    setStagedItems(updatedDrafts);
    persistStagedItems(updatedDrafts);
  };

  const handleDataExtracted = async (scanItem) => {
    setError(null);
    try {
      let mainImageBase64 = null;
      if (scanItem.mainImage) {
        mainImageBase64 = await fileToBase64(scanItem.mainImage);
      }

      const newDraft = {
        id: `draft_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        metadata: {
          ...scanItem.metadata,
          lotNumber: activeProject ? activeProject.name : ''
        },
        mainImageBase64,
        secondaryImageBase64: null,
        createdAt: Date.now(),
        timerDuration: 60 * 60 * 1000
      };

      const updatedDrafts = [newDraft, ...stagedItems];
      setStagedItems(updatedDrafts);

      try {
        persistStagedItems(updatedDrafts);
      } catch (err) {
        console.error('LocalStorage quota error:', err);
        setError('Storage full! Draft saved in memory, but please sync items to free up browser space.');
      }

      setSuccess('Check/Invoice scanned and saved to Drafts!');
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      console.error(err);
      setError(`Failed to save scanned item to drafts: ${err.message}`);
    }
  };

  const handleSaveStagedEdits = (updatedItem) => {
    const updatedDrafts = stagedItems.map(item => {
      if (item.id === editingItemId) {
        return {
          ...item,
          metadata: updatedItem.metadata,
          mainImageBase64: updatedItem.mainImageBase64,
          secondaryImageBase64: updatedItem.secondaryImageBase64
        };
      }
      return item;
    });
    saveStagedItems(updatedDrafts);
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
    const updatedDrafts = stagedItems.filter(item => item.id !== id);
    saveStagedItems(updatedDrafts);
  };

  const confirmDeleteDraft = () => {
    if (!draftToDelete) return;
    removeStagedItem(draftToDelete.id);
    setDraftToDelete(null);
    setSuccess('Draft discarded successfully!');
    setTimeout(() => setSuccess(null), 2500);
  };

  const handleAdjustTimer = (id, additionalMinutes) => {
    const updatedDrafts = stagedItems.map(item => {
      if (item.id === id) {
        return {
          ...item,
          timerDuration: item.timerDuration + (additionalMinutes * 60 * 1000)
        };
      }
      return item;
    });
    saveStagedItems(updatedDrafts);
  };

  const handleResetTimer = (id) => {
    const updatedDrafts = stagedItems.map(item => {
      if (item.id === id) {
        return {
          ...item,
          createdAt: Date.now(),
          timerDuration: 60 * 60 * 1000
        };
      }
      return item;
    });
    saveStagedItems(updatedDrafts);
  };

  const handleUpdateDraftField = (id, field, value) => {
    const updatedDrafts = stagedItems.map(item => {
      if (item.id === id) {
        return {
          ...item,
          metadata: {
            ...item.metadata,
            [field]: value
          }
        };
      }
      return item;
    });
    saveStagedItems(updatedDrafts);
  };

  const updateStagedItem = (id, updates) => {
    const updatedDrafts = stagedItems.map(item => {
      if (item.id === id) {
        return {
          ...item,
          ...updates
        };
      }
      return item;
    });
    saveStagedItems(updatedDrafts);
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
    removeStagedItem
  };
}
