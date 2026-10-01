/**
 * Pure functions for draft document operations.
 * Used by useStagedDocuments with React functional state updaters
 * to avoid stale render closure overwrites during rapid sequential updates.
 */

export function removeDraftById(drafts, id) {
  if (!Array.isArray(drafts)) return [];
  return drafts.filter(item => item.id !== id);
}

export function removeDraftsById(drafts, ids) {
  if (!Array.isArray(drafts)) return [];
  const idSet = new Set(Array.isArray(ids) ? ids : [ids]);
  return drafts.filter(item => !idSet.has(item.id));
}

export function updateDraftById(drafts, id, updates) {
  if (!Array.isArray(drafts)) return [];
  return drafts.map(item => {
    if (item.id === id) {
      return { ...item, ...updates };
    }
    return item;
  });
}

export function addDraft(drafts, newDraft) {
  const current = Array.isArray(drafts) ? drafts : [];
  return [newDraft, ...current];
}

export function saveDraftEdits(drafts, editingItemId, updatedItem) {
  if (!Array.isArray(drafts)) return [];
  return drafts.map(item => {
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
}

export function adjustDraftTimer(drafts, id, additionalMinutes) {
  if (!Array.isArray(drafts)) return [];
  return drafts.map(item => {
    if (item.id === id) {
      return {
        ...item,
        timerDuration: (item.timerDuration || 0) + (additionalMinutes * 60 * 1000)
      };
    }
    return item;
  });
}

export function resetDraftTimer(drafts, id) {
  if (!Array.isArray(drafts)) return [];
  return drafts.map(item => {
    if (item.id === id) {
      return {
        ...item,
        createdAt: Date.now(),
        timerDuration: 60 * 60 * 1000
      };
    }
    return item;
  });
}

export function updateDraftField(drafts, id, field, value) {
  if (!Array.isArray(drafts)) return [];
  return drafts.map(item => {
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
}
