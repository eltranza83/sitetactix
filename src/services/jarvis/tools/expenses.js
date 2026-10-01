import { setPendingAction } from '../pending.js';
import { TRADE_SECTIONS_CONFIG } from '../../editFormHelpers.js';
import { loadStoredAppState, persistStagedItems } from '../../appStorage.js';

// Find category key for a canonical phase name
export function findCategoryForPhase(phaseName = '') {
  if (!phaseName) return null;
  const pLower = phaseName.toLowerCase().trim();
  for (const [catKey, catVal] of Object.entries(TRADE_SECTIONS_CONFIG)) {
    for (const p of catVal.phases) {
      if (p.toLowerCase() === pLower) {
        return { category: catKey, phase: p };
      }
    }
  }
  // Fallback fuzzy
  for (const [catKey, catVal] of Object.entries(TRADE_SECTIONS_CONFIG)) {
    for (const p of catVal.phases) {
      if (p.toLowerCase().includes(pLower) || pLower.includes(p.toLowerCase())) {
        return { category: catKey, phase: p };
      }
    }
  }
  return null;
}

export function getAllCanonicalPhases() {
  const phases = [];
  for (const catVal of Object.values(TRADE_SECTIONS_CONFIG)) {
    phases.push(...catVal.phases);
  }
  return phases;
}

function getLocalTodayDate() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function stage_expense(args, context = {}) {
  const vendor = String(args.vendor || '').trim();
  const amount = Number(args.amount);
  const costType = String(args.costType || 'material').toLowerCase() === 'labor' ? 'labor' : 'material';
  const description = String(args.description || `Expense at ${vendor}`).trim();
  const checkNumber = String(args.checkNumber || '').trim();
  const date = String(args.date || getLocalTodayDate()).trim();
  const activeLot = context.projectName || context.projectId || 'Active Project';

  if (!vendor || isNaN(amount) || amount <= 0) {
    return {
      ok: false,
      error: 'invalid_arguments',
      message: 'Vendor name and a valid dollar amount are required to draft an expense.'
    };
  }

  // Validate trade phase
  let matched = findCategoryForPhase(args.phase);
  if (!matched && !args.phase) {
    // Default fallback for general receipts: Extra Costs & Misc
    matched = { category: 'Project_Overhead_&_Bills', phase: 'Extra Costs & Misc' };
  } else if (!matched) {
    return {
      ok: false,
      needs: 'phase',
      options: getAllCanonicalPhases(),
      message: `I couldn't find a trade phase matching "${args.phase}". Which phase should this expense be categorized under?`
    };
  }

  const { category: tradeCategory, phase: tradePhase } = matched;

  // Build the staged draft creator callback
  const executeCallback = async () => {
    const currentApp = loadStoredAppState();
    const existingStaged = Array.isArray(currentApp.stagedItems) ? currentApp.stagedItems : [];

    const newDraftId = `draft_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newDraft = {
      id: newDraftId,
      metadata: {
        type: checkNumber ? 'check' : 'manual_expense',
        vendor: vendor,
        payee: vendor,
        amount: amount,
        date: date,
        lotNumber: activeLot,
        costCategory: costType,
        tradeCategory: tradeCategory,
        tradePhase: tradePhase,
        description: description,
        checkNumber: checkNumber,
        documentType: checkNumber ? 'check' : 'manual_expense',
        receiptStatus: 'no_receipt',
        provenance: 'jarvis_voice_stage',
        notes: `Drafted by Jarvis (${costType}): ${description}`,
        splits: null
      },
      mainImageBase64: null,
      secondaryImageBase64: null,
      createdAt: Date.now(),
      timerDuration: 60 * 60 * 1000
    };

    const updatedDrafts = [newDraft, ...existingStaged];
    persistStagedItems(updatedDrafts);

    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('staged-items-updated', {
        detail: { count: updatedDrafts.length, newDraft }
      }));
    }

    return {
      success: true,
      draftId: newDraftId,
      draftCount: updatedDrafts.length,
      message: `Created draft for $${amount.toFixed(2)} at ${vendor} (${tradePhase}) in your Drafts queue.`
    };
  };

  // Register pending action for explicit user confirmation
  setPendingAction({
    type: 'stage_expense',
    projectId: context.projectId,
    preview: {
      vendor,
      amount,
      costType,
      tradeCategory,
      tradePhase,
      description,
      date,
      checkNumber
    },
    executeCallback
  });

  return {
    ok: true,
    requiresConfirmation: true,
    preview: {
      vendor,
      amount: `$${amount.toFixed(2)}`,
      date,
      costType,
      phase: tradePhase,
      description
    },
    message: `I have prepared a draft for $${amount.toFixed(2)} at ${vendor} under ${tradePhase} (${description}). Should I stage this in your Drafts?`
  };
}
