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

export function createManualExpenseDraft(activeProject = null, now = new Date()) {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return {
    id: `manual_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
    isNewManualDraft: true,
    metadata: {
      type: 'invoice',
      documentType: 'manual_expense',
      receiptStatus: 'no_receipt',
      provenance: 'manual_user_entry',
      vendor: '',
      description: '',
      amount: '',
      date: `${yyyy}-${mm}-${dd}`,
      checkNumber: '',
      costCategory: 'material',
      lotNumber: activeProject?.name || '',
      tradeCategory: 'Site_Prep_&_Structure',
      tradePhase: 'Foundation & Flatwork',
      payeeMatch: null
    },
    mainImageBase64: null,
    secondaryImageBase64: null,
    createdAt: now.getTime()
  };
}
