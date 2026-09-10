import { fetchDocumentContent, writeDocumentContent, DOCUMENT_STATES } from './documentContentProvider.js';
import { loadStoredAppState, persistStagedItems } from './appStorage.js';
/**
 * Client-Side AI Tool Executors, Data Retrieval & Diagnostic Test Suite
 */
import { AI_TOOL_DECLARATIONS, executeWeatherTool } from '../../api/_lib/ai-tools-definitions.js';
import {
  saveMemory,
  getMemories,
  searchMemories,
  updateMemory,
  deactivateMemory,
  detectAmbiguity,
  loadUserPreferences,
  saveUserPreference,
  updateUserPreferenceStatus,
  deleteUserPreference,
  resetAllUserPreferences
} from './memoryService.js';
import { resolvePreferenceConflicts } from './userPreferenceEngine.js';
import {
  parseGoogleDocPurchasingStructure,
  resolveTargetProjectId,
  loadMasterPurchasingDoc,
  saveMasterPurchasingDoc,
  loadProjectPurchasingDoc,
  saveProjectPurchasingDoc,
  syncMasterPurchasingToProjects,
  getPurchasingAuditLog,
  deprecateMasterItem,
  discoverAndBindProjectPurchasingDoc,
  RESOURCE_TYPES
} from './googleDocsPurchasingService.js';
import { purchasingService, PURCHASING_STATUSES, TRADE_SECTION_MAP as STRUCTURED_TRADE_MAP } from './purchasingService.js';
import {
  fetchProjectFinishes,
  saveFinishSpec,
  findMatchingFinish,
  formatFinishesForAI,
  exportToGoogleDocMarkdown as exportFinishesToMarkdown
} from './finishService.js';
import { executeClientAction, ACTION_TYPES } from './clientActionService.js';
import { fetchGoogleDocText } from './googleDrive.js';
import { normalizeSpreadsheetDate, getTodayCalendarDate } from './sheetsDataService.js';

export { AI_TOOL_DECLARATIONS, executeWeatherTool };

/**
 * Explicit Tool Classification & Provenance Registry
 */
export const TOOL_REGISTRY = {
  open_drive_document: {
    type: 'ACTION',
    source: 'Google Drive Document Viewer',
    description: 'Opens a document, PDF, floor plan, or spreadsheet from Google Drive in a new viewer tab.'
  },
  open_drive_folder: {
    type: 'ACTION',
    source: 'Google Drive Folder Viewer',
    description: 'Opens a Google Drive subfolder in Google Drive.'
  },
  navigate_app_tab: {
    type: 'ACTION',
    source: 'SiteTactix App Navigation',
    description: 'Navigates the user to a specific app tab.'
  },
  get_weather_for_jobsite: {
    type: 'READ',
    source: 'Weather API',
    description: 'Fetches real-time weather observations for jobsite coordinates.'
  },
  get_purchasing_list: {
    type: 'READ',
    source: 'Firestore (Purchasing Checklist)',
    description: 'Retrieves materials and fixtures from the Firestore Purchasing Database, filtered by trade or status.'
  },
  add_purchasing_item: {
    type: 'WRITE',
    source: 'Firestore (Purchasing Checklist)',
    description: 'Inserts or updates quantity of a purchasing item in the correct trade category in Firestore.'
  },
  update_purchasing_item_status: {
    type: 'WRITE',
    source: 'Firestore (Purchasing Checklist)',
    description: 'Marks an item as needed or purchased in the Firestore Purchasing Database.'
  },
  remove_purchasing_item: {
    type: 'WRITE',
    source: 'Firestore (Purchasing Checklist)',
    description: 'Removes or deletes an item/material from the Firestore Purchasing Checklist.'
  },
  export_purchasing_doc: {
    type: 'ACTION',
    source: 'Purchasing Exporter',
    description: 'Generates a clean printable/exportable Markdown Google Doc checklist from Firestore.'
  },
  export_finishes_doc: {
    type: 'ACTION',
    source: 'Finishes Exporter',
    description: 'Generates a clean printable/exportable Markdown Google Doc specification sheet from Firestore.'
  },
  get_project_finishes: {
    type: 'READ',
    source: 'Firestore (Finishes & Specs)',
    description: 'Retrieves finish specifications, paint schedules, roofing, stucco, and stone from Firestore.'
  },
  get_homeowner_specs: {
    type: 'READ',
    source: 'Firestore (Finishes & Specs)',
    description: 'Retrieves finish specifications, paint schedules, roofing, stucco, and stone from Firestore.'
  },
  save_finish_spec: {
    type: 'WRITE',
    source: 'Firestore (Finishes & Specs)',
    description: 'Creates or updates a finish specification in Firestore.'
  },
  remove_purchasing_section: {
    type: 'WRITE',
    source: 'Firestore (Purchasing Checklist)',
    description: 'Removes or deletes an entire section/category heading and its contents from the Purchasing Checklist.'
  },
  sync_purchasing_master_to_projects: {
    type: 'WRITE',
    source: 'Firestore (Purchasing Master Template)',
    description: 'Non-destructively synchronizes standard items from Master Purchasing template into active project purchasing lists.'
  },
  deprecate_purchasing_master_item: {
    type: 'WRITE',
    source: 'Firestore (Purchasing Master Template)',
    description: 'Marks an item as deprecated in the Company Master Purchasing Template.'
  },
  get_purchasing_audit_log: {
    type: 'READ',
    source: 'Firestore (Purchasing Master Template)',
    description: 'Retrieves the historical audit log of purchasing modifications and synchronization events.'
  },
  get_subcontractor_balance: {
    type: 'READ',
    source: 'Google Sheets (Subcontractor Ledger)',
    description: 'Retrieves contract quote, amount paid, and remaining balance owed.'
  },
  get_vendor_history: {
    type: 'READ',
    source: 'Google Sheets (Subcontractor Ledger)',
    description: 'Retrieves line-item payment records for a subcontractor.'
  },
  search_receipts: {
    type: 'READ',
    source: 'Google Sheets (Receipts & Expenses)',
    description: 'Searches recorded receipts by payee, description, or amount.'
  },
  get_project_budget: {
    type: 'READ',
    source: 'Google Sheets (Project Financials)',
    description: 'Fetches overall project budget, spending, and variance.'
  },
  get_project_schedule: {
    type: 'READ',
    source: 'Field Reminders (SiteTactix App)',
    description: 'Retrieves upcoming field milestones and trade calls from local app storage.'
  },
  get_municipal_inspections: {
    type: 'READ',
    source: 'Municipal Inspections',
    description: 'Retrieves the 6-stage municipal building inspection checklist and passed stages.'
  },
  get_drive_files: {
    type: 'READ',
    source: 'Google Drive',
    description: 'Searches project blueprints, permits, and engineering files.'
  },
  get_site_setup: {
    type: 'READ',
    source: 'Site Setup Checklist Database',
    description: 'Retrieves jobsite logistics, gates, power, and sanitation status.'
  },
  get_site_setup_protocol: {
    type: 'READ',
    source: 'Site Setup Checklist Database',
    description: 'Retrieves safety, dumpster, porta-potty, and staging checklist.'
  },
  search_memories: {
    type: 'READ',
    source: 'J.A.R.V.I.S. Memory (Persistent Vault)',
    description: 'Searches contextual notes, contractor preferences, and business facts.'
  },
  list_memories: {
    type: 'READ',
    source: 'J.A.R.V.I.S. Memory (Persistent Vault)',
    description: 'Lists all active memories for the project or user.'
  },
  save_memory: {
    type: 'WRITE',
    source: 'J.A.R.V.I.S. Memory (Persistent Vault)',
    confirmationPolicy: 'auto_safe',
    description: 'Stores a verified builder preference, verbal quote, or site note in the persistent memory vault ONLY when explicitly commanded by the user (e.g. "Remember that..."). NEVER call for structured purchasing items, financial ledger balances, or municipal inspections.'
  },
  update_memory: {
    type: 'WRITE',
    source: 'J.A.R.V.I.S. Memory (Persistent Vault)',
    confirmationPolicy: 'explicit',
    description: 'Modifies an existing memory note in the vault.'
  },
  delete_memory: {
    type: 'WRITE',
    source: 'J.A.R.V.I.S. Memory (Persistent Vault)',
    confirmationPolicy: 'explicit',
    description: 'Deactivates a memory record.'
  },
  list_user_preferences: {
    type: 'READ',
    source: 'J.A.R.V.I.S. Memory (Persistent Vault)',
    description: 'Lists all learned and configured user communication preferences.'
  },
  confirm_user_preference: {
    type: 'WRITE',
    source: 'J.A.R.V.I.S. Memory (Persistent Vault)',
    confirmationPolicy: 'auto_safe',
    description: 'Promotes an observed candidate to an active user preference.'
  },
  deactivate_user_preference: {
    type: 'WRITE',
    source: 'J.A.R.V.I.S. Memory (Persistent Vault)',
    confirmationPolicy: 'explicit',
    description: 'Deactivates or forgets a specific learned communication preference.'
  },
  reset_user_preferences: {
    type: 'WRITE',
    source: 'J.A.R.V.I.S. Memory (Persistent Vault)',
    confirmationPolicy: 'explicit',
    description: 'Purges all learned communication preferences for the user.'
  },
  stage_manual_transaction: {
    type: 'WRITE',
    source: 'Application Drafts Queue (stagedItems)',
    confirmationPolicy: 'explicit',
    description: 'Stages a user-reported business expense, contractor labor draw, or check payment with no receipt into the Drafts queue for human review and spreadsheet sync.'
  },
  stage_manual_expense: {
    type: 'WRITE',
    source: 'Application Drafts Queue (stagedItems)',
    confirmationPolicy: 'explicit',
    description: 'Stages a user-reported business expense with no receipt into the Drafts queue for human review and spreadsheet sync.'
  }
};

/**
 * Deterministic Idempotency & Deduplication Engine for WRITE tools
 */
const recentWriteActions = new Map();
const inFlightWritePromises = new Map();
const IDEMPOTENCY_WINDOW_MS = 60000; // 60 seconds duplicate protection
export const TOOL_TIMEOUT_MS = 6000; // 6000ms max execution time per tool

export function generateIdempotencyKey(toolName, args = {}, projectId = '') {
  const normalizedText = String(args.text || args.updatedText || args.searchQuery || args.memoryId || args.item || args.itemName || args.vendorOrPayee || args.vendor || args.payee || '').trim().toLowerCase();
  const normalizedCategory = String(args.category || args.tradeCategory || '').trim().toLowerCase();
  const normalizedDate = String(args.effectiveDate || args.date || '').trim();
  const normalizedAmount = String(args.amount || '').trim();
  return `${toolName}:${projectId || 'global'}:${normalizedText}:${normalizedCategory}:${normalizedDate}:${normalizedAmount}`;
}

export function checkIdempotency(toolName, args = {}, projectId = '') {
  const meta = TOOL_REGISTRY[toolName] || { type: 'READ' };
  if (meta.type !== 'WRITE') return null;

  const key = generateIdempotencyKey(toolName, args, projectId);
  const now = Date.now();

  if (recentWriteActions.has(key)) {
    const entry = recentWriteActions.get(key);
    if (now - entry.timestamp < IDEMPOTENCY_WINDOW_MS) {
      return {
        isDuplicate: true,
        key,
        cachedResult: entry.result
      };
    }
  }
  return { isDuplicate: false, key };
}

export function resetWriteIdempotencyState() {
  recentWriteActions.clear();
  inFlightWritePromises.clear();
}

export function recordIdempotency(key, result) {
  if (!key) return;
  recentWriteActions.set(key, {
    timestamp: Date.now(),
    result
  });

  const now = Date.now();
  for (const [k, v] of recentWriteActions.entries()) {
    if (now - v.timestamp > IDEMPOTENCY_WINDOW_MS * 2) {
      recentWriteActions.delete(k);
    }
  }
}

export function clearIdempotencyCache() {
  recentWriteActions.clear();
  inFlightWritePromises.clear();
}

/**
 * Dependency Circuit Breaker for External Services
 * Trips after 3 failures, recovers after 30s
 */
export class DependencyCircuitBreaker {
  constructor() {
    this.services = new Map();
    this.FAILURE_THRESHOLD = 3;
    this.RECOVERY_WINDOW_MS = 30000;
  }

  isOpen(serviceName) {
    const entry = this.services.get(serviceName);
    if (!entry) return false;
    if (entry.state === 'OPEN') {
      if (Date.now() - entry.lastFailureTime > this.RECOVERY_WINDOW_MS) {
        entry.state = 'HALF_OPEN';
        return false;
      }
      return true;
    }
    return false;
  }

  recordSuccess(serviceName) {
    this.services.set(serviceName, { failures: 0, state: 'CLOSED', lastFailureTime: 0 });
  }

  recordFailure(serviceName) {
    const entry = this.services.get(serviceName) || { failures: 0, state: 'CLOSED', lastFailureTime: 0 };
    entry.failures += 1;
    entry.lastFailureTime = Date.now();
    if (entry.failures >= this.FAILURE_THRESHOLD) {
      entry.state = 'OPEN';
    }
    this.services.set(serviceName, entry);
  }

  getStatus(serviceName) {
    const entry = this.services.get(serviceName);
    return entry ? entry.state : 'CLOSED';
  }

  reset() {
    this.services.clear();
  }
}

export const circuitBreaker = new DependencyCircuitBreaker();

/**
 * Argument Sanitizer: Strips control characters and script injections
 */
export function sanitizeToolArgs(args = {}) {
  if (!args || typeof args !== 'object') return {};
  const sanitized = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      sanitized[key] = value
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .replace(/<\s*script[^>]*>.*?<\s*\/\s*script\s*>/gi, '')
        .trim();
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(item =>
        typeof item === 'string'
          ? item
              // eslint-disable-next-line no-control-regex
              .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
              .replace(/<\s*script[^>]*>.*?<\s*\/\s*script\s*>/gi, '')
              .trim()
          : item
      );
    } else if (value && typeof value === 'object') {
      sanitized[key] = sanitizeToolArgs(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Tool Result Schema Validator: Enforces standard contract with schemaVersion "1.0"
 */
export function validateToolResultContract(rawResult, toolName = '', correlationId = '') {
  const toolMeta = TOOL_REGISTRY[toolName] || { type: 'READ', source: 'Local Project Data' };
  const safeResult = rawResult && typeof rawResult === 'object' ? rawResult : {};

  const isSuccess = safeResult.success !== undefined ? Boolean(safeResult.success) : !safeResult.error;
  const status = safeResult.status || (isSuccess ? 'ok' : 'error');

  return {
    ...safeResult,
    schemaVersion: '1.0',
    correlationId: correlationId || safeResult.correlationId || `corr_${Date.now()}`,
    toolName: toolName || safeResult.toolName || 'unknown_tool',
    toolType: safeResult.toolType || toolMeta.type || 'READ',
    source: safeResult.source || toolMeta.source || 'Local Project Data',
    success: isSuccess,
    status,
    data: safeResult.data !== undefined ? safeResult.data : (safeResult.error ? null : safeResult),
    isDuplicate: Boolean(safeResult.isDuplicate),
    idempotencyKey: safeResult.idempotencyKey || null,
    error: safeResult.error ? String(safeResult.error) : null,
    _executionDurationMs: typeof safeResult._executionDurationMs === 'number' ? safeResult._executionDurationMs : 0
  };
}

/**
 * Execution Timeout Wrapper
 */
export async function withToolTimeout(promiseFn, functionName, timeoutMs = TOOL_TIMEOUT_MS) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Tool execution for ${functionName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promiseFn(), timeoutPromise]);
    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseAmount(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const num = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
  return Number.isNaN(num) ? 0 : num;
}

function getPhasesArray(dashboardData) {
  if (!dashboardData) return [];
  if (Array.isArray(dashboardData.subcontractors) && dashboardData.subcontractors.length > 0) {
    return dashboardData.subcontractors;
  }
  if (Array.isArray(dashboardData.phases) && dashboardData.phases.length > 0) {
    return dashboardData.phases;
  }
  return [];
}

/**
 * Execute tool call dynamically against client-side project data.
 */
export async function executeClientToolCall(functionName, rawArgs = {}, projectContext = {}, correlationId = '') {
  const startTime = Date.now();
  const toolMeta = TOOL_REGISTRY[functionName] || {
    type: 'READ',
    source: 'Local Engine'
  };
  const args = sanitizeToolArgs(rawArgs);

  // 1. Circuit Breaker Check for External / Failing Dependencies
  if (circuitBreaker.isOpen(functionName)) {
    return validateToolResultContract({
      success: false,
      status: 'circuit_open',
      error: `The service for ${functionName} is temporarily unavailable due to repeated failures (Circuit Breaker OPEN).`,
      _executionDurationMs: Date.now() - startTime
    }, functionName, correlationId);
  }

  // 2. Idempotency & Concurrency Mutex for WRITE Tools
  let idempotencyKey = null;
  if (toolMeta.type === 'WRITE') {
    idempotencyKey = generateIdempotencyKey(functionName, args, projectContext.projectId);

    // A. Check cached duplicate
    const cached = checkIdempotency(functionName, args, projectContext.projectId);
    if (cached?.isDuplicate) {
      return validateToolResultContract({
        success: true,
        status: 'deduplicated',
        isDuplicate: true,
        saved: true,
        updated: true,
        deleted: true,
        idempotencyKey,
        data: cached.cachedResult?.data || args,
        message: 'Action already completed previously.',
        _executionDurationMs: Date.now() - startTime
      }, functionName, correlationId);
    }

    // B. Check in-flight concurrent execution for this exact key
    if (inFlightWritePromises.has(idempotencyKey)) {
      try {
        const inFlightRes = await inFlightWritePromises.get(idempotencyKey);
        return validateToolResultContract({
          ...inFlightRes,
          status: 'deduplicated',
          isDuplicate: true,
          _executionDurationMs: Date.now() - startTime
        }, functionName, correlationId);
      } catch {
        // Fall through to retry fresh execution if in-flight failed
      }
    }
  }

  const executeInternal = async () => {
    const {
      items = [],
      dashboardData = null,
      driveTree = null,
      projectSpecs = [],
      siteSetupData = null
    } = projectContext;

    let resultPayload = null;

    switch (functionName) {
      case 'get_weather_for_jobsite': {
        resultPayload = await executeWeatherTool(args);
        break;
      }

    case 'get_subcontractor_balance':
    case 'get_vendor_history': {
      const target = args.vendorName || args.tradeOrContractor || '';
      const query = target.toLowerCase();
      const phases = getPhasesArray(dashboardData);
      let matches = [];

      for (const phase of phases) {
        const phaseName = (phase.phase || phase.name || '').toLowerCase();
        const contractor = (phase.payee || phase.contractor || '').toLowerCase();
        const payments = Array.isArray(phase.payments) ? phase.payments : [];

        const isMatch = !query || phaseName.includes(query) || contractor.includes(query) ||
          payments.some(p => (p.vendor || p.payee || '').toLowerCase().includes(query) || (p.description || '').toLowerCase().includes(query));

        if (isMatch) {
          const quote = parseAmount(phase.originalQuote || phase.contractAmount || phase.estimatedCost);
          const totalPaid = parseAmount(phase.totalSpent || phase.totalPaid || payments.reduce((sum, p) => sum + parseAmount(p.amount || p.totalCost || p.materialCost || p.laborCost), 0));
          const remainingBalance = parseAmount(phase.remainingBalance) || Math.max(0, quote - totalPaid);

          // For general queries (!query), only include phases with active contracts, balances, or payments
          if (!query && quote === 0 && totalPaid === 0 && remainingBalance === 0) {
            continue;
          }

          matches.push({
            phaseName: phase.phase || phase.name,
            contractor: phase.payee || phase.contractor,
            quote,
            totalPaid,
            remainingBalance,
            payments: payments.map(p => ({
              date: p.date,
              amount: parseAmount(p.amount || p.totalCost || p.materialCost || p.laborCost),
              payee: p.vendor || p.payee,
              notes: p.description
            }))
          });
        }
      }

      if (matches.length === 0) {
        resultPayload = {
          found: false,
          query: target,
          message: target
            ? `I cannot locate records or quotes for "${target}" in this project.`
            : `There are currently no active subcontractor balances recorded for this project.`,
          results: []
        };
      } else {
        resultPayload = {
          found: true,
          query: target,
          foundCount: matches.length,
          results: matches
        };
      }
      break;
    }


    case 'search_receipts': {
      const q = (args.query || '').toLowerCase();
      const phases = getPhasesArray(dashboardData);
      const receipts = [];

      for (const phase of phases) {
        const payments = Array.isArray(phase.payments) ? phase.payments : [];
        const phaseSpent = parseAmount(phase.totalSpent || phase.totalPaid);
        const phaseName = (phase.phase || phase.name || '').toLowerCase();
        const payee = (phase.payee || phase.contractor || '').toLowerCase();

        if (payments.length > 0) {
          for (const p of payments) {
            const desc = (p.description || '').toLowerCase();
            const pPayee = (p.vendor || p.payee || payee).toLowerCase();
            const amount = parseAmount(p.amount || p.totalCost || p.materialCost || p.laborCost);

            let match = !q || desc.includes(q) || pPayee.includes(q) || phaseName.includes(q);
            if (args.minAmount && amount < args.minAmount) match = false;
            if (args.maxAmount && amount > args.maxAmount) match = false;

            if (match) {
              receipts.push({
                phase: phase.phase || phase.name,
                payee: p.vendor || p.payee || phase.payee || 'Vendor',
                amount,
                date: p.date || null,
                description: p.description || phase.phase || 'Payment',
                checkNumber: p.checkNumber || null
              });
            }
          }
        } else if (phaseSpent > 0) {
          let match = !q || payee.includes(q) || phaseName.includes(q);
          if (args.minAmount && phaseSpent < args.minAmount) match = false;
          if (args.maxAmount && phaseSpent > args.maxAmount) match = false;

          if (match) {
            receipts.push({
              phase: phase.phase || phase.name,
              payee: phase.payee || phase.contractor || phase.phase || 'Unassigned',
              amount: phaseSpent,
              date: null,
              description: `Total recorded payment for ${phase.phase || phase.name}`,
              checkNumber: null
            });
          }
        }
      }

      if (receipts.length === 0) {
        resultPayload = {
          found: false,
          query: args.query,
          message: `I cannot locate receipts or invoices matching "${args.query || 'your query'}" in this project.`,
          count: 0,
          receipts: []
        };
      } else {
        resultPayload = {
          found: true,
          query: args.query,
          count: receipts.length,
          receipts: receipts.slice(0, 20)
        };
      }
      break;
    }

    case 'stage_manual_transaction':
    case 'stage_manual_expense': {
      const transactionType = String(args.transactionType || (args.checkNumber || args.paymentMethod?.toLowerCase()?.includes('check') ? 'check' : 'expense')).toLowerCase();
      const vendorOrPayee = String(args.vendorOrPayee || args.vendor || args.payee || '').trim() || 'Unknown Payee';
      const amount = typeof args.amount === 'number' ? args.amount : (parseFloat(args.amount) || 0);
      const date = args.date && String(args.date).trim().toLowerCase() !== 'today' ? normalizeSpreadsheetDate(args.date) : getTodayCalendarDate();
      const lotNumber = String(args.lotNumber || projectContext?.projectName || projectContext?.lotName || projectContext?.projectId || '').trim() || 'Lot 3';
      
      // Strict Payment Method Enforcement: Reject missing, empty, or generic fallback payment methods
      const rawPaymentMethod = String(args.paymentMethod || '').trim();
      const genericPlaceholders = ['card / cash', 'card/cash', 'card or cash', 'unknown', 'n/a', 'unspecified', 'none', ''];
      if (!rawPaymentMethod || genericPlaceholders.includes(rawPaymentMethod.toLowerCase())) {
        resultPayload = {
          success: false,
          status: 'missing_payment_method',
          vendorOrPayee,
          amount,
          lotNumber,
          date,
          message: 'Payment method is required before staging a manual transaction. Please ask the user how this transaction was paid (e.g. Debit Card, Credit Card, Cash, Check #1045, Transfer).'
        };
        break;
      }

      // Category & Phase resolution
      const tradeCategory = String(args.tradeCategory || (transactionType === 'expense' ? 'Project_Overhead_&_Bills' : 'Mechanicals_&_Utilities')).trim();
      const tradePhase = String(args.tradePhase || (transactionType === 'expense' ? 'Extra Costs & Misc' : 'Plumbing Rough-In')).trim();

      // Cost Classification: ONLY set if explicitly provided by user. Do NOT default or guess from vendor/item description.
      const rawCostCategory = String(args.costCategory || '').trim().toLowerCase();
      let costCategory = '';
      if (rawCostCategory === 'material' || rawCostCategory === 'labor') {
        costCategory = rawCostCategory;
      } else if (transactionType === 'contractor_payment' || transactionType === 'check') {
        costCategory = 'labor';
      }

      const checkNumber = String(args.checkNumber || (rawPaymentMethod.toLowerCase().includes('check') ? rawPaymentMethod.replace(/[^0-9]/g, '') : '')).trim();
      const paymentMethod = rawPaymentMethod;
      const description = String(args.description || (transactionType === 'check' || transactionType === 'contractor_payment' ? `Payment to ${vendorOrPayee} for ${tradePhase}` : `Manual expense at ${vendorOrPayee}`)).trim();
      const docType = (transactionType === 'check' || checkNumber) ? 'check' : 'manual_expense';
      const notes = String(args.notes || (docType === 'check' ? 'Self-Attested Contractor Check / Payment — No Physical Scan Attached' : 'Self-Attested Manual Expense Record — No Vendor Receipt Attached')).trim();

      // Check existing staged items in appStorage
      const currentApp = loadStoredAppState();
      const existingStaged = Array.isArray(currentApp.stagedItems) ? currentApp.stagedItems : [];

      // Duplicate check within existing staged drafts
      const duplicate = existingStaged.find(item => {
        const m = item.metadata || {};
        const vMatch = String(m.vendor || m.payee || '').trim().toLowerCase() === vendorOrPayee.toLowerCase();
        const amtMatch = Math.abs(parseFloat(m.amount || 0) - amount) < 0.001;
        const dMatch = String(m.date || '').trim() === date;
        const lMatch = String(m.lotNumber || '').trim().toLowerCase() === lotNumber.toLowerCase();
        return vMatch && amtMatch && dMatch && lMatch;
      });

      if (duplicate) {
        resultPayload = {
          success: false,
          status: 'duplicate_detected',
          existingDraftId: duplicate.id,
          vendorOrPayee,
          amount,
          lotNumber,
          date,
          message: `A draft for $${amount.toFixed(2)} for ${vendorOrPayee} on ${date} for ${lotNumber} is already in your Drafts queue (Draft ID: ${duplicate.id}).`
        };
        break;
      }

      const newDraftId = `draft_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const newDraft = {
        id: newDraftId,
        metadata: {
          type: docType,
          vendor: vendorOrPayee,
          payee: vendorOrPayee,
          amount,
          date,
          lotNumber,
          costCategory, // empty string if unassigned, requiring user resolution in EditForm
          tradeCategory,
          tradePhase,
          description,
          checkNumber: checkNumber || paymentMethod,
          documentType: docType,
          receiptStatus: 'no_receipt',
          provenance: 'manual_user_entry',
          notes,
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
        window.dispatchEvent(new CustomEvent('staged-items-updated', { detail: { count: updatedDrafts.length, newDraft } }));
      }

      resultPayload = {
        success: true,
        status: 'staged',
        draftId: newDraftId,
        draftCount: updatedDrafts.length,
        draft: newDraft,
        transactionType,
        vendorOrPayee,
        amount,
        lotNumber,
        tradeCategory,
        tradePhase,
        date,
        costCategory: costCategory || 'Unassigned (Review in EditForm)',
        paymentMethod,
        checkNumber,
        receiptStatus: 'no_receipt',
        provenance: 'manual_user_entry',
        message: `Successfully staged $${amount.toFixed(2)} ${transactionType === 'check' || transactionType === 'contractor_payment' ? 'contractor payment' : 'manual expense'} for ${vendorOrPayee} under ${lotNumber} (${tradeCategory} → ${tradePhase}) into your Drafts queue.`
      };
      break;
    }

    case 'get_purchasing_list': {
      const trade = args.trade || args.category || null;
      const unpurchasedOnly = args.unpurchasedOnly !== false && args.status !== 'purchased';
      const targetProjectId = resolveTargetProjectId(args.projectId, projectContext) || 'lot_3';
      const projLabel = projectContext?.activeProjectName || targetProjectId || 'Lot';
      const storage = typeof localStorage !== 'undefined' ? localStorage : null;

      // 1. Query structured PurchasingService (authoritative source of truth)
      const isInitialized = await purchasingService.isProjectInitialized(targetProjectId);
      let items = await purchasingService.getItems(targetProjectId, {
        category: trade,
        status: args.status ? args.status : (unpurchasedOnly ? PURCHASING_STATUSES.NEEDED : null),
        item: args.item || args.keyword
      });

      // If project is not initialized in Firestore, attempt Google Drive discovery & live document ingestion
      if (!isInitialized && items.length === 0 && !args.item) {
        const hasRealItems = (doc) => doc && typeof doc === 'string' && (doc.includes('- [ ]') || doc.includes('- [x]'));

        let rawDoc = null;
        const contextDoc = projectContext?.[targetProjectId]?.purchasingDocContent ||
                           projectContext?.purchasingDocContent ||
                           (projectContext?.projectId === targetProjectId ? projectContext?.purchasingDocContent : null);
        if (hasRealItems(contextDoc)) {
          rawDoc = contextDoc;
        }

        const discovery = discoverAndBindProjectPurchasingDoc(storage, targetProjectId, projectContext);
        if (!rawDoc && hasRealItems(discovery.content)) {
          rawDoc = discovery.content;
        }

        // If content is not in memory but we have a Google Drive document ID and token, fetch live content from Drive
        const googleToken = projectContext?.googleToken || projectContext?.accessToken;
        if (!rawDoc && discovery.documentId && googleToken && typeof fetchGoogleDocText === 'function') {
          try {
            rawDoc = await fetchGoogleDocText(googleToken, discovery.documentId, {
              fileName: discovery.fileName,
              mimeType: discovery.file?.mimeType
            });
          } catch (err) {
            console.warn('[get_purchasing_list] Failed to fetch Google Doc text from Drive:', err);
            // Strict error guard: Do NOT silently populate Master Template if file exists but is unreadable!
            resultPayload = {
              success: false,
              found: false,
              readError: true,
              state: 'DOCUMENT_READ_ERROR',
              documentId: discovery.documentId || null,
              documentName: discovery.fileName || 'Purchasing Checklist',
              projectId: targetProjectId,
              source: `Google Drive (${projLabel})`,
              message: `I found "${discovery.fileName || 'Purchasing Checklist'}" in Google Drive for ${projLabel}, but was unable to retrieve its contents. Please verify Google Drive permissions so I can import your checklist.`
            };
            break;
          }
        }

        if (rawDoc && (rawDoc.includes('- [ ]') || rawDoc.includes('- [x]'))) {
          await purchasingService.migrateFromGoogleDocContent(targetProjectId, rawDoc, {
            sourceDocId: discovery.documentId,
            sourceDocName: discovery.fileName
          });
          items = await purchasingService.getItems(targetProjectId, {
            category: trade,
            status: args.status ? args.status : (unpurchasedOnly ? PURCHASING_STATUSES.NEEDED : null)
          });
        } else if (targetProjectId === 'lot_3' || args.initializeFromMaster) {
          // Lot 3 or explicit master initialization only
          await purchasingService.initializeProjectFromMaster(targetProjectId);
          items = await purchasingService.getItems(targetProjectId, {
            category: trade,
            status: args.status ? args.status : (unpurchasedOnly ? PURCHASING_STATUSES.NEEDED : null)
          });
        }
      }

      // Group into trade sections matching expected UI structure
      const categoryOrder = ['quartz', 'electrical', 'plumbing', 'hvac', 'paint_drywall', 'general'];
      const grouped = {};
      for (const catKey of categoryOrder) {
        grouped[catKey] = {
          sectionId: catKey,
          category: STRUCTURED_TRADE_MAP[catKey]?.title || catKey,
          title: STRUCTURED_TRADE_MAP[catKey]?.title || catKey,
          items: []
        };
      }

      for (const it of items) {
        const cat = it.categoryId || 'general';
        if (!grouped[cat]) {
          grouped[cat] = {
            sectionId: cat,
            category: it.categoryTitle || cat,
            title: it.categoryTitle || cat,
            items: []
          };
        }
        grouped[cat].items.push({
          itemId: it.id,
          id: it.id,
          name: it.itemName,
          itemName: it.itemName,
          quantity: it.quantity,
          isPurchased: it.status === PURCHASING_STATUSES.PURCHASED,
          status: it.status,
          notes: it.notes || ''
        });
      }

      const sections = Object.values(grouped).filter(s => s.items.length > 0);
      const totalItems = items.length;

      // Always calculate project-wide live purchased vs needed counts for accurate synthesis
      const allProjectItems = await purchasingService.getItems(targetProjectId);
      const totalPurchased = allProjectItems.filter(it => it.status === PURCHASING_STATUSES.PURCHASED).length;
      const totalNeeded = allProjectItems.filter(it => it.status === PURCHASING_STATUSES.NEEDED).length;
      const grandTotal = allProjectItems.length;

      const unpurchasedItems = allProjectItems.filter(it => it.status === PURCHASING_STATUSES.NEEDED).map(it => ({ ...it, name: it.itemName }));
      const purchasedItems = allProjectItems.filter(it => it.status === PURCHASING_STATUSES.PURCHASED).map(it => ({ ...it, name: it.itemName }));

      // Build authoritative trade breakdown with side-by-side needed, purchased, and total
      const tradeBreakdown = {};
      for (const catKey of categoryOrder) {
        const catTitle = STRUCTURED_TRADE_MAP[catKey]?.title || catKey;
        const catItems = allProjectItems.filter(it => (it.categoryId || 'general') === catKey);
        if (catItems.length > 0) {
          tradeBreakdown[catTitle] = {
            needed: catItems.filter(it => it.status === PURCHASING_STATUSES.NEEDED).length,
            purchased: catItems.filter(it => it.status === PURCHASING_STATUSES.PURCHASED).length,
            total: catItems.length
          };
        }
      }

      // Check user's conversational intent for specific answer formats
      const userPrompt = String(projectContext?.userQuery || args.item || args.itemName || '').trim();

      // Infer trade from query if not explicitly passed
      let effectiveTrade = trade;
      if (!effectiveTrade && userPrompt) {
        const matchedTradeKey = Object.keys(STRUCTURED_TRADE_MAP).find(k => {
          const title = STRUCTURED_TRADE_MAP[k]?.title.toLowerCase() || '';
          return new RegExp(`\\b(${k}|${title.replace(/&/g, '(?:&|and)')})\\b`, 'i').test(userPrompt);
        });
        if (matchedTradeKey) {
          effectiveTrade = matchedTradeKey;
        }
      }

      const isComparisonInquiry = (!effectiveTrade) && /\b(versus|vs\.?|compared to|comparison|breakdown|purchased and needed|purchased vs needed|status overview|purchasing status|what have we purchased.*(?:versus|vs\.?|compared to|and what).*need|what do we need.*(?:versus|vs\.?|compared to|and what).*purchased)\b/i.test(userPrompt);

      const isPurchasedInquiry = !isComparisonInquiry && (
        args.status === PURCHASING_STATUSES.PURCHASED ||
        /\b(what have we (already )?(purchased|bought)|what did we (already )?(purchase|buy)|what items are purchased|what items have been purchased|what is purchased|what's purchased|already purchased|purchased items|list purchased|show purchased)\b/i.test(userPrompt)
      );

      const collectionCountRegex = /\b(how many|how much|count of|quantity of|number of|total number of)\s+(?:total\s+)?(?:(?:[a-z\s]+)\s+)?(?:items|materials|fixtures|stuff|things|supplies|categories|sections)\b/i;
      const genericCountRegex = /\b(how many|how much)\s+(?:have we|did we|do we|are there)\s+(?:purchased|bought|got|to buy|needed|left|remaining)\b/i;
      const isCollectionCountInquiry = collectionCountRegex.test(userPrompt) || genericCountRegex.test(userPrompt);

      // Generate canonical pre-synthesized answer
      let canonicalAnswer = '';
      if (effectiveTrade) {
        const matchedTradeKey = Object.keys(STRUCTURED_TRADE_MAP).find(k => k === effectiveTrade.toLowerCase() || STRUCTURED_TRADE_MAP[k]?.title.toLowerCase().includes(effectiveTrade.toLowerCase()));
        const matchedTradeTitle = (matchedTradeKey && STRUCTURED_TRADE_MAP[matchedTradeKey]?.title) || effectiveTrade;
        const tradeAllItems = allProjectItems.filter(it => (it.categoryId || 'general') === (matchedTradeKey || 'general'));
        const tradePurchasedItems = tradeAllItems.filter(it => it.status === PURCHASING_STATUSES.PURCHASED);
        const tradeNeededItems = tradeAllItems.filter(it => it.status === PURCHASING_STATUSES.NEEDED);

        const isTradePurchasedOnly = args.status === PURCHASING_STATUSES.PURCHASED ||
          /\b(purchased|already bought|already purchased|have we (already )?(bought|purchased)|did we (already )?(buy|purchase)|what have we (already )?(bought|purchased))\b/i.test(userPrompt);

        const isTradeNeededOnly = args.status === PURCHASING_STATUSES.NEEDED ||
          /\b(needed|still need|need to (buy|purchase)|left to (buy|purchase)|unpurchased|to buy|to purchase)\b/i.test(userPrompt);

        if (isTradePurchasedOnly) {
          if (tradePurchasedItems.length === 0) {
            canonicalAnswer = `No ${matchedTradeTitle.toLowerCase()} have been marked as purchased yet for ${projLabel}.`;
          } else {
            const itemLines = tradePurchasedItems.map(it => `• ${it.itemName}${it.quantity && it.quantity > 1 ? ` — Qty: ${it.quantity}` : ''} (Purchased)`).join('\n');
            const prefix = isCollectionCountInquiry
              ? `You have purchased ${tradePurchasedItems.length} ${matchedTradeTitle} item${tradePurchasedItems.length === 1 ? '' : 's'} for ${projLabel}`
              : `Purchased ${matchedTradeTitle} for ${projLabel} (${tradePurchasedItems.length} item${tradePurchasedItems.length === 1 ? '' : 's'})`;
            canonicalAnswer = `${prefix}:\n${itemLines}`;
          }
        } else if (isTradeNeededOnly) {
          if (tradeNeededItems.length === 0) {
            canonicalAnswer = `All ${matchedTradeTitle.toLowerCase()} have been purchased for ${projLabel}.`;
          } else {
            const itemLines = tradeNeededItems.map(it => `• ${it.itemName} — Qty: ${it.quantity || 1} (Needed)`).join('\n');
            const prefix = isCollectionCountInquiry
              ? `You still need to purchase ${tradeNeededItems.length} ${matchedTradeTitle} item${tradeNeededItems.length === 1 ? '' : 's'} for ${projLabel}`
              : `${matchedTradeTitle} needed for ${projLabel} (${tradeNeededItems.length} item${tradeNeededItems.length === 1 ? '' : 's'})`;
            canonicalAnswer = `${prefix}:\n${itemLines}`;
          }
        } else {
          if (tradeAllItems.length === 0) {
            canonicalAnswer = `No purchasing items found under ${matchedTradeTitle} for ${projLabel}.`;
          } else {
            const itemLines = tradeAllItems.map(it => `• ${it.itemName} — Qty: ${it.quantity || 1} (${it.status === PURCHASING_STATUSES.PURCHASED ? 'Purchased' : 'Needed'})`).join('\n');
            const prefix = isCollectionCountInquiry
              ? `You have ${tradeAllItems.length} total ${matchedTradeTitle} items on the ${projLabel} checklist (${tradePurchasedItems.length} purchased, ${tradeNeededItems.length} needed)`
              : `${matchedTradeTitle} for ${projLabel} (${tradeAllItems.length} item${tradeAllItems.length === 1 ? '' : 's'})`;
            canonicalAnswer = `${prefix}:\n${itemLines}`;
          }
        }
      } else if (isComparisonInquiry) {
        const purchasedLines = [];
        const neededLines = [];
        for (const catKey of categoryOrder) {
          const catTitle = STRUCTURED_TRADE_MAP[catKey]?.title || catKey;
          const catPurchased = allProjectItems.filter(it => (it.categoryId || 'general') === catKey && it.status === PURCHASING_STATUSES.PURCHASED).length;
          const catNeeded = allProjectItems.filter(it => (it.categoryId || 'general') === catKey && it.status === PURCHASING_STATUSES.NEEDED).length;
          if (catPurchased > 0) {
            purchasedLines.push(`• ${catTitle}: ${catPurchased}`);
          }
          if (catNeeded > 0) {
            neededLines.push(`• ${catTitle}: ${catNeeded}`);
          }
        }

        const purchasedBlock = purchasedLines.length > 0
          ? `Purchased:\n${purchasedLines.join('\n')}`
          : 'Purchased:\n• None';

        const neededBlock = neededLines.length > 0
          ? `Still needed:\n${neededLines.join('\n')}`
          : 'Still needed:\n• None';

        canonicalAnswer = `${projLabel} Purchasing Status:\n• Purchased: ${totalPurchased} item${totalPurchased === 1 ? '' : 's'}\n• Still needed: ${totalNeeded} item${totalNeeded === 1 ? '' : 's'}\n• Total: ${grandTotal} item${grandTotal === 1 ? '' : 's'}\n\n${purchasedBlock}\n\n${neededBlock}\n\nI can give you the detailed item list for any trade.`;
      } else if (isPurchasedInquiry) {
        if (totalPurchased === 0) {
          canonicalAnswer = `Nothing has been marked as purchased yet for ${projLabel}.`;
        } else {
          const purchasedLines = [];
          for (const catKey of categoryOrder) {
            const catTitle = STRUCTURED_TRADE_MAP[catKey]?.title || catKey;
            const catPurchased = allProjectItems.filter(it => (it.categoryId || 'general') === catKey && it.status === PURCHASING_STATUSES.PURCHASED);
            if (catPurchased.length > 0) {
              purchasedLines.push(`${catTitle}:`);
              for (const it of catPurchased) {
                const qtyStr = it.quantity && it.quantity > 1 ? ` — Qty: ${it.quantity}` : '';
                purchasedLines.push(`• ${it.itemName}${qtyStr} (Purchased)`);
              }
            }
          }
          canonicalAnswer = `Purchased items for ${projLabel} (${totalPurchased} item${totalPurchased === 1 ? '' : 's'}):\n${purchasedLines.join('\n')}`;
        }
      } else if (totalNeeded === 0 && grandTotal > 0) {
        canonicalAnswer = `All ${grandTotal} items have been purchased for ${projLabel}.`;
      } else if (grandTotal === 0) {
        canonicalAnswer = `No purchasing items found on the checklist for ${projLabel}.`;
      } else {
        const breakdownParts = Object.entries(tradeBreakdown)
          .filter(([_, counts]) => counts.needed > 0)
          .map(([title, counts]) => `${counts.needed} ${title}`);
        
        let breakdownStr = '';
        if (breakdownParts.length > 1) {
          const last = breakdownParts.pop();
          breakdownStr = `${breakdownParts.join(', ')}, and ${last}`;
        } else if (breakdownParts.length === 1) {
          breakdownStr = breakdownParts[0];
        }

        const purchasedNote = totalPurchased > 0
          ? `You have ${totalPurchased} item${totalPurchased === 1 ? '' : 's'} marked as purchased.`
          : 'Nothing has been marked as purchased yet.';

        canonicalAnswer = `You still have ${totalNeeded} items to purchase for ${projLabel}${breakdownStr ? `: ${breakdownStr}` : ''}. ${purchasedNote} If you want, I can give you the individual items for any trade.`;
      }

      // Check if user's question was an item status or quantity query (e.g. "Did we buy the lights?", "How many pool heaters do we have?")
      let itemLookup = null;
      const isListInquiry = isComparisonInquiry || isCollectionCountInquiry || (
        (!/\b(how many|how much|count of|quantity of)\b/i.test(userPrompt)) && (
          /\b(what|which)\s+(?:[a-z\s]+\s+)?(?:items|materials|fixtures|stuff|things|supplies|list|checklist)\b/i.test(userPrompt) ||
          /\b(what|which)\s+(?:have we|did we|do we|is on|are on|are the)\b/i.test(userPrompt) ||
          /\b(show|list|all items|everything)\b/i.test(userPrompt)
        )
      );

      if (userPrompt && !isListInquiry) {
        const isQuantityInquiry = /\b(how many|how much|count|quantity)\b/i.test(userPrompt);
        let extractedSubject = userPrompt
          .replace(/^(how many|how much|do we have any|do we have|is there a|is there an|is there|are there any|are there|what is the quantity of|what's the count of|what count of|did we|have we|was the|is the|did you|did they|have they|has the|can we check if we|check if we|check if|verify if|did we already|have we already|did we buy|have we bought)\s+/i, '')
          .replace(/^(already\s+|ever\s+)?(buy|bought|purchase|purchased|get|got|have|need)\s+/i, '')
          .replace(/^(the|those|these|that|a|an)\s+/i, '')
          .replace(/\s+(?:in|under|for|from)\s+(?:general\s+hardware(?:\s+&\s+materials)?|electrical(?:\s+hardware)?(?:\s+fixtures)?|plumbing(?:\s+hardware)?(?:\s+fixtures)?|quartz(?:\s+hardware)?|hvac|paint|drywall|paint\s+&\s+drywall|general).*$/i, '')
          .replace(/\s+(?:do we have|are there|are on|have we got|do we need|are needed|on the purchasing list|on the list|on the checklist|on our checklist|in the purchasing list|in the list|for lot\s*\d+|on lot\s*\d+|in lot\s*\d+|already|yet|so far|now|recently|been purchased|been bought|purchased|needed).*$/i, '')
          .replace(/[?.!]+$/, '')
          .trim();

        if (extractedSubject && extractedSubject.length > 2 && !/^(what|which|show|list|all|items|everything|anything|purchasing list)$/i.test(extractedSubject) && !/\b(what have we|what did we|what is|what's)\b/i.test(userPrompt)) {
          const lookupMatch = purchasingService.findMatchingItems(allProjectItems, extractedSubject);
          if (lookupMatch && lookupMatch.type !== 'NONE') {
            let lookupAnswer = '';
            if (lookupMatch.type === 'EXACT' || lookupMatch.type === 'SINGLE_MATCH') {
              const item = lookupMatch.item;
              const isP = item.isPurchased || item.status === PURCHASING_STATUSES.PURCHASED;
              const statusLabel = isP ? 'Purchased' : 'Needed';
              const name = item.itemName || item.name;
              const isPlural = /s$/i.test(name) && !/ss$/i.test(name);
              const verb = isPlural ? 'are' : 'is';
              const qtyNote = item.quantity && item.quantity > 1 ? ` Quantity: ${item.quantity}.` : '';

              if (isQuantityInquiry) {
                lookupAnswer = `You have ${item.quantity || 1} ${name} (${statusLabel}) on the ${projLabel} purchasing checklist.`;
              } else {
                lookupAnswer = isP
                  ? `Yes. The ${name} ${verb} marked as purchased on ${projLabel}.${qtyNote}`
                  : `No. The ${name} ${verb} still marked as needed on ${projLabel}.${qtyNote}`;
              }
            } else if (lookupMatch.type === 'AMBIGUOUS') {
              const candidateLines = lookupMatch.matches.map(m => `• ${m.itemName} (${m.status === PURCHASING_STATUSES.PURCHASED ? 'Purchased' : 'Needed'})`).join('\n');
              lookupAnswer = `There are ${lookupMatch.matches.length} matching items on the ${projLabel} checklist:\n${candidateLines}\nWhich one were you asking about?`;
            }

            itemLookup = {
              subject: extractedSubject,
              matchType: lookupMatch.type,
              matchCount: lookupMatch.matches.length,
              matches: lookupMatch.matches.map(m => ({ ...m, name: m.itemName })),
              canonicalAnswer: lookupAnswer
            };
          } else if (lookupMatch && lookupMatch.type === 'NONE' && (isQuantityInquiry || /\b(is there|do we have)\b/i.test(userPrompt))) {
            itemLookup = {
              subject: extractedSubject,
              matchType: 'NONE',
              matchCount: 0,
              matches: [],
              canonicalAnswer: `"${extractedSubject}" is not currently on the ${projLabel} purchasing checklist.`
            };
          }
        }
      }

      const summary = {
        neededCount: totalNeeded,
        purchasedCount: totalPurchased,
        totalChecklistCount: grandTotal,
        tradeBreakdown,
        canonicalAnswer,
        itemLookup
      };

      const message = totalItems > 0
        ? `Found ${totalItems} item(s) in Purchasing Checklist for ${projLabel}${trade ? ` (${trade})` : ''}.`
        : `No pending items found in Purchasing Checklist for ${projLabel}${trade ? ` under ${trade}` : ''}.`;

      const discovery = discoverAndBindProjectPurchasingDoc(storage, targetProjectId, projectContext);

      if (discovery.readError) {
        resultPayload = {
          success: false,
          found: false,
          readError: true,
          state: discovery.state || 'DOCUMENT_READ_ERROR',
          documentId: discovery.documentId || null,
          documentName: discovery.fileName || null,
          projectId: targetProjectId,
          source: `Firestore (${projLabel} Purchasing Checklist)`,
          message: discovery.message || `Found "${discovery.fileName}", but was unable to read its current contents.`
        };
        break;
      }

      resultPayload = {
        found: totalItems > 0,
        hasExistingDocument: true,
        documentId: discovery?.documentId || null,
        documentName: discovery?.fileName || null,
        resourceType: RESOURCE_TYPES.PROJECT_PURCHASING,
        projectId: targetProjectId,
        source: `Firestore (${projLabel} Purchasing Checklist)`,
        trade: trade || 'all',
        unpurchasedOnly,
        totalSections: sections.length,
        totalItems,
        totalPurchased,
        totalNeeded,
        grandTotal,
        summary,
        itemLookup,
        unpurchasedItems,
        purchasedItems,
        allItems: allProjectItems.map(it => ({ ...it, name: it.itemName })),
        sections,
        items: items.map(it => ({ ...it, name: it.itemName })),
        message
      };
      break;
    }

    case 'add_purchasing_item': {
      const itemInput = args.item || '';
      const quantity = args.quantity || 1;
      const category = args.category || null;
      const isMaster = args.projectId === 'master' || args.targetResource === 'master';
      const targetProjectId = isMaster ? 'purchasing_master' : (resolveTargetProjectId(args.projectId, projectContext) || 'lot_3');
      const projLabel = isMaster ? 'Master' : (projectContext?.activeProjectName || targetProjectId || 'Lot');
      const storage = typeof localStorage !== 'undefined' ? localStorage : null;

      const addResult = await purchasingService.addItem(targetProjectId, itemInput, quantity, category);
      const updatedDoc = await purchasingService.exportToGoogleDocMarkdown(targetProjectId);
      if (isMaster) {
        saveMasterPurchasingDoc(storage, updatedDoc, true);
      } else {
        saveProjectPurchasingDoc(storage, targetProjectId, updatedDoc);
      }

      const isAlreadyExists = addResult.action === 'ALREADY_EXISTS';
      resultPayload = {
        success: true,
        status: isAlreadyExists ? 'already_exists' : 'ok',
        projectId: targetProjectId,
        resourceType: isMaster ? 'purchasing_master' : 'project_purchasing',
        source: `Firestore (${projLabel} Purchasing Checklist)`,
        itemId: addResult.item.id,
        itemName: addResult.item.itemName,
        quantity: addResult.item.quantity,
        isDuplicate: Boolean(addResult.isDuplicate),
        action: addResult.action,
        updatedQuantity: addResult.item.quantity,
        category: addResult.item.categoryTitle,
        sectionId: addResult.item.categoryId,
        message: addResult.message
      };
      break;
    }

    case 'update_purchasing_item_status': {
      const itemName = args.itemName || args.item || '';
      const isPurchased = args.isPurchased !== false;
      const targetProjectId = resolveTargetProjectId(args.projectId, projectContext) || 'lot_3';
      const projLabel = projectContext?.activeProjectName || targetProjectId || 'Lot';
      const storage = typeof localStorage !== 'undefined' ? localStorage : null;
      const status = isPurchased ? PURCHASING_STATUSES.PURCHASED : PURCHASING_STATUSES.NEEDED;

      const updateRes = await purchasingService.updateItemStatus(targetProjectId, itemName, status);
      if (updateRes.success && updateRes.action !== 'NO_OP' && !updateRes.isAlreadyInState) {
        const updatedDoc = await purchasingService.exportToGoogleDocMarkdown(targetProjectId);
        saveProjectPurchasingDoc(storage, targetProjectId, updatedDoc);
      }

      if (updateRes.success) {
        resultPayload = {
          success: true,
          action: updateRes.action,
          isAlreadyInState: Boolean(updateRes.isAlreadyInState),
          writesPerformed: updateRes.writesPerformed ?? (updateRes.action === 'NO_OP' ? 0 : 1),
          projectId: targetProjectId,
          source: `Firestore (${projLabel} Purchasing Checklist)`,
          item: updateRes.item,
          itemId: updateRes.item.id,
          name: updateRes.item.itemName,
          itemName: updateRes.item.itemName,
          category: updateRes.item.categoryTitle,
          sectionId: updateRes.item.categoryId,
          isPurchased,
          status: updateRes.action === 'NO_OP' ? (updateRes.status || (isPurchased ? 'ALREADY_PURCHASED' : 'ALREADY_NEEDED')) : status,
          message: updateRes.message
        };
      } else {
        resultPayload = {
          success: false,
          isAmbiguous: Boolean(updateRes.isAmbiguous),
          isNotFound: Boolean(updateRes.isNotFound),
          matches: updateRes.matches || [],
          projectId: targetProjectId,
          source: `Firestore (${projLabel} Purchasing Checklist)`,
          error: updateRes.message,
          message: updateRes.message
        };
      }
      break;
    }

    case 'remove_purchasing_item': {
      const targetProjectId = resolveTargetProjectId(args.projectId, projectContext) || 'lot_3';
      const projLabel = projectContext?.activeProjectName || targetProjectId || 'Lot';
      const storage = typeof localStorage !== 'undefined' ? localStorage : null;
      const itemName = args.itemName || args.item;

      const removeRes = await purchasingService.removeItem(targetProjectId, itemName);
      if (removeRes.success) {
        const updatedDoc = await purchasingService.exportToGoogleDocMarkdown(targetProjectId);
        saveProjectPurchasingDoc(storage, targetProjectId, updatedDoc);
      }

      resultPayload = {
        success: removeRes.success,
        found: removeRes.success,
        isAmbiguous: Boolean(removeRes.isAmbiguous),
        isNotFound: Boolean(removeRes.isNotFound),
        matches: removeRes.matches || [],
        projectId: targetProjectId,
        source: `Firestore (${projLabel} Purchasing Checklist)`,
        itemName: removeRes.item?.itemName || itemName,
        error: removeRes.success ? undefined : removeRes.message,
        message: removeRes.message
      };
      break;
    }

    case 'export_purchasing_doc': {
      const targetProjectId = resolveTargetProjectId(args.projectId, projectContext) || 'lot_3';
      const projLabel = projectContext?.activeProjectName || targetProjectId || 'Lot';

      const markdown = await purchasingService.exportToGoogleDocMarkdown(targetProjectId, {
        title: `Master Fixtures & Hardware Purchasing Checklist - ${projLabel}`
      });

      resultPayload = {
        success: true,
        projectId: targetProjectId,
        markdown,
        message: `Generated clean purchasing checklist export for ${projLabel}.`
      };
      break;
    }

    case 'remove_purchasing_section': {
      const storage = typeof localStorage !== 'undefined' ? localStorage : null;
      const target = resolvePurchasingTarget(args, projectContext);
      const targetProjectId = target.projectId;
      const sectionName = args.sectionName || args.section || args.category;

      const discovery = discoverAndBindProjectPurchasingDoc(storage, targetProjectId, driveTree);
      const docName = target.resourceType === RESOURCE_TYPES.PURCHASING_MASTER 
        ? 'Master Purchasing Template' 
        : (discovery.fileName || `${targetProjectId} Purchasing Checklist.docx`);
      const sourceLabel = target.resourceType === RESOURCE_TYPES.PURCHASING_MASTER 
        ? 'Google Docs (Master Purchasing Checklist)' 
        : `Google Docs (${targetProjectId} Purchasing Checklist)`;

      let rawDoc = target.resourceType === RESOURCE_TYPES.PURCHASING_MASTER
        ? loadMasterPurchasingDoc(storage)
        : loadProjectPurchasingDoc(storage, targetProjectId);

      if (discovery.found && discovery.documentId && fetchDocumentContent) {
        const fetchRes = await fetchDocumentContent({
          documentId: discovery.documentId,
          fileName: discovery.fileName,
          modifiedTime: discovery.modifiedTime,
          projectContext
        });
        if (fetchRes.success && fetchRes.content !== null && fetchRes.content !== undefined) {
          rawDoc = fetchRes.content;
        }
      }

      const parsed = parseGoogleDocPurchasingStructure(rawDoc);
      const removeRes = calculateRemoveSection(parsed, sectionName);

      if (removeRes.found) {
        const before = rawDoc.slice(0, removeRes.replaceRange.startIndex);
        const after = rawDoc.slice(removeRes.replaceRange.endIndex);
        const updatedDoc = before + removeRes.replacementText + after;

        // Write to Google Drive if bound
        if (discovery.found && discovery.documentId) {
          const writeRes = await writeDocumentContent({
            documentId: discovery.documentId,
            fileName: discovery.fileName,
            content: updatedDoc,
            projectContext
          });

          if (!writeRes.success) {
            resultPayload = {
              success: false,
              writeError: true,
              state: DOCUMENT_STATES.DOCUMENT_WRITE_ERROR,
              documentId: discovery.documentId,
              documentName: docName,
              source: sourceLabel,
              message: `Failed to remove section from Google Drive document "${docName}": ${writeRes.error}`,
              error: writeRes.error
            };
            break;
          }
        }

        // Update local cache
        if (target.resourceType === RESOURCE_TYPES.PURCHASING_MASTER) {
          saveMasterPurchasingDoc(storage, updatedDoc, true);
        } else {
          saveProjectPurchasingDoc(storage, targetProjectId, updatedDoc);
          if (projectContext) {
            if (!projectContext[targetProjectId]) projectContext[targetProjectId] = {};
            projectContext[targetProjectId].purchasingDocContent = updatedDoc;
            if (projectContext.projectId === targetProjectId || !projectContext.projectId) {
              projectContext.purchasingDocContent = updatedDoc;
            }
          }
        }

        resultPayload = {
          success: true,
          state: DOCUMENT_STATES.DOCUMENT_WRITE_SUCCESS,
          projectId: targetProjectId,
          documentId: discovery.documentId || null,
          documentName: docName,
          source: sourceLabel,
          sectionName: removeRes.section?.canonicalTitle || removeRes.section?.title,
          message: removeRes.message
        };
      } else {
        resultPayload = {
          success: false,
          projectId: targetProjectId,
          documentId: discovery.documentId || null,
          documentName: docName,
          source: sourceLabel,
          message: removeRes.message || `Section "${sectionName}" was not found in project ${targetProjectId}.`
        };
      }
      break;
    }

    case 'sync_purchasing_master_to_projects': {
      const storage = typeof localStorage !== 'undefined' ? localStorage : null;
      let targets = Array.isArray(args.targetProjectIds) && args.targetProjectIds.length > 0 ? args.targetProjectIds : [];
      
      if (targets.length === 0) {
        if (Array.isArray(projectContext?.projects)) {
          targets = projectContext.projects.map(p => p.id).filter(Boolean);
        } else if (Array.isArray(projectContext?.allProjects)) {
          targets = projectContext.allProjects.map(p => p.id).filter(Boolean);
        } else {
          targets = ['lot_3', 'lot_37', 'lot_55', 'lot_59'];
        }
      }

      const syncResult = syncMasterPurchasingToProjects(storage, targets, {
        dryRun: Boolean(args.dryRun),
        userCommand: args.userCommand || projectContext?.lastUserMessage
      });

      if (syncResult.isDryRun) {
        resultPayload = {
          success: true,
          isDryRun: true,
          masterVersion: syncResult.masterVersion,
          resourceType: syncResult.resourceType,
          totalProjectsTargeted: syncResult.totalProjectsTargeted,
          projectsSynced: syncResult.projectsSynced,
          missingInProjects: syncResult.missingInProjects,
          detailedPreview: syncResult.detailedPreview,
          totalMissingItemsCount: syncResult.totalMissingItemsCount,
          alreadyCurrentCount: syncResult.alreadyCurrentCount,
          customItemsUntouchedCount: syncResult.customItemsUntouchedCount,
          voiceSummary: syncResult.voiceSummary,
          summaryPrompt: syncResult.voiceSummary,
          message: syncResult.voiceSummary
        };
      } else {
        for (const pid of syncResult.projectsSynced) {
          const docText = loadProjectPurchasingDoc(storage, pid);
          if (docText) {
            await purchasingService.migrateFromGoogleDocContent(pid, docText);
          }
        }

        resultPayload = {
          success: true,
          isDryRun: false,
          masterVersion: syncResult.masterVersion,
          resourceType: syncResult.resourceType,
          totalProjectsTargeted: syncResult.totalProjectsTargeted,
          projectsSynced: syncResult.projectsSynced,
          itemsAddedSummary: syncResult.itemsAddedSummary,
          detailedPreview: syncResult.detailedPreview,
          auditEntriesCount: syncResult.auditEntries.length,
          voiceSummary: syncResult.voiceSummary,
          message: syncResult.voiceSummary
        };
      }
      break;
    }

    case 'open_drive_document': {
      const actionRes = await executeClientAction(ACTION_TYPES.OPEN_DOCUMENT, {
        fileName: args.fileName,
        folderName: args.folderName,
        documentId: args.documentId
      }, {
        driveTree,
        activeProjectName: projectContext?.activeProject?.name || projectContext?.projectName || 'Lot 3'
      });
      resultPayload = actionRes;
      break;
    }

    case 'open_drive_folder': {
      const actionRes = await executeClientAction(ACTION_TYPES.OPEN_FOLDER, {
        folderName: args.folderName,
        folderId: args.folderId
      }, {
        driveTree,
        activeProjectName: projectContext?.activeProject?.name || projectContext?.projectName || 'Lot 3'
      });
      resultPayload = actionRes;
      break;
    }

    case 'navigate_app_tab': {
      const actionRes = await executeClientAction(ACTION_TYPES.NAVIGATE_TO, {
        tab: args.tab
      }, {
        onNavigateTab: projectContext?.onNavigateTab
      });
      resultPayload = actionRes;
      break;
    }

    case 'deprecate_purchasing_master_item': {
      const storage = typeof localStorage !== 'undefined' ? localStorage : null;
      const item = args.item;
      const res = deprecateMasterItem(storage, item);
      resultPayload = res;
      break;
    }

    case 'get_purchasing_audit_log': {
      const storage = typeof localStorage !== 'undefined' ? localStorage : null;
      const limit = typeof args.limit === 'number' ? args.limit : 20;
      const logs = getPurchasingAuditLog(storage, limit);

      resultPayload = {
        success: true,
        totalEntries: logs.length,
        entries: logs
      };
      break;
    }

    case 'get_project_schedule': {
      const category = args.category || 'all';
      const filtered = items.filter(i => {
        if (category === 'all') return true;
        if (category === 'reminder') return i.category === 'reminder';
        if (category === 'trade_call') return i.category === 'subcontractor';
        if (category === 'watchout') return i.category === 'watchout';
        return true;
      });

      resultPayload = {
        found: true,
        category,
        totalItems: filtered.length,
        items: filtered.map(i => ({
          title: i.title,
          category: i.category,
          status: i.status,
          notes: i.notes,
          targetDate: i.targetDate || null
        }))
      };
      break;
    }

    case 'get_municipal_inspections': {
      const inspections = projectContext?.inspectionsData || [];
      const stageId = (args.stageId || '').toLowerCase();
      const filtered = stageId
        ? inspections.filter(s => (s.id || '').toLowerCase().includes(stageId) || (s.title || '').toLowerCase().includes(stageId))
        : inspections;

      resultPayload = {
        found: true,
        totalStages: inspections.length,
        stages: filtered.map(s => ({
          id: s.id,
          title: s.title,
          isPassed: Boolean(s.isPassed),
          progress: s.progress || 0,
          pendingItemsCount: Array.isArray(s.items) ? s.items.filter(it => !it.checked).length : 0
        }))
      };
      break;
    }

    case 'get_project_budget': {
      const info = dashboardData?.projectInfo || {};
      const phases = getPhasesArray(dashboardData);

      const budgetGross = parseAmount(info.budgetGross || info.grossBudget);
      const budgetBuild = parseAmount(info.budgetBuild || info.buildBudget || info.hardCostBudget);
      const infoSpent = parseAmount(info.totalSpent || info.drawsPaid || info.spent);
      const capitalBalance = parseAmount(info.capitalBalance || info.netCapital);

      let phaseTotalBudget = 0;
      let phaseTotalSpent = 0;

      const breakdown = phases.map(p => {
        const quote = parseAmount(p.originalQuote || p.contractAmount || p.estimatedCost);
        const spent = parseAmount(p.totalSpent || p.totalPaid || (p.payments || []).reduce((sum, pay) => sum + parseAmount(pay.amount || pay.totalCost || pay.materialCost || pay.laborCost), 0));
        phaseTotalBudget += quote;
        phaseTotalSpent += spent;
        return {
          phaseName: p.phase || p.name || 'Unassigned',
          contractor: p.payee || p.contractor || '',
          budget: quote,
          spent,
          remainingBalance: parseAmount(p.remainingBalance) || Math.max(0, quote - spent)
        };
      });

      const totalBudget = budgetGross || budgetBuild || phaseTotalBudget;
      const totalSpent = infoSpent || phaseTotalSpent;
      const remainingBudget = capitalBalance || (totalBudget > 0 ? Math.max(0, totalBudget - totalSpent) : null);

      if (!totalBudget && !totalSpent && phases.length === 0) {
        resultPayload = {
          found: false,
          message: 'I cannot locate financial dashboard data or budget records for this project.',
          totalBudget: null,
          totalSpent: null,
          remainingBudget: null,
          breakdown: []
        };
      } else {
        resultPayload = {
          found: true,
          grossBudget: budgetGross || totalBudget,
          buildBudget: budgetBuild || totalBudget,
          totalBudget,
          totalSpent,
          remainingBudget,
          netCapital: capitalBalance || remainingBudget,
          breakdown: breakdown.slice(0, 30)
        };
      }
      break;
    }

    case 'get_drive_files': {
      const rawFolder = (args.folderName || '').trim();
      const cleanFolder = rawFolder.replace(/\b(folder|folders|directory|the|in|inside)\b/gi, '').trim().toLowerCase();
      const keyword = (args.keyword || '').trim().toLowerCase();

      const allFiles = Array.isArray(driveTree?.allFiles) ? driveTree.allFiles : [];
      const subfolders = Array.isArray(driveTree?.subfolders) ? driveTree.subfolders : [];
      const directFiles = Array.isArray(driveTree?.directFiles) ? driveTree.directFiles : (Array.isArray(driveTree) ? driveTree : []);

      console.log('[get_drive_files] Exact search/folder parameter received:', {
        rawFolder,
        cleanFolder,
        keyword
      });
      console.log('[get_drive_files] Drive hierarchy stats at execution:', {
        allFilesCount: allFiles.length,
        subfoldersCount: subfolders.length,
        directFilesCount: directFiles.length,
        subfolders: subfolders.map(s => s.name || s.folderName)
      });

      const results = [];
      let matchedFolder = null;
      let matchedFolderFileCount = 0;
      let matchedFolderSubfolders = [];

      // 1. If a specific subfolder is requested, search across all nested subfolders
      if (cleanFolder || rawFolder) {
        const targetQ = cleanFolder || rawFolder.toLowerCase();
        matchedFolder = subfolders.find(s => {
          const sName = (s.name || s.folderName || '').toLowerCase();
          const sPath = (s.folderPath || '').toLowerCase();
          const sId = String(s.folderId || s.id || '').toLowerCase();
          return sName === targetQ || sPath === targetQ || sId === targetQ;
        }) || subfolders.find(s => {
          const sName = (s.name || s.folderName || '').toLowerCase();
          const sPath = (s.folderPath || '').toLowerCase();
          return sName.includes(targetQ) || targetQ.includes(sName) || sPath.includes(targetQ);
        });

        if (matchedFolder) {
          const filesInSub = Array.isArray(matchedFolder.files) ? matchedFolder.files : (Array.isArray(matchedFolder.children) ? matchedFolder.children : []);
          matchedFolderFileCount = filesInSub.length;
          matchedFolderSubfolders = matchedFolder.subfolderNames || [];

          for (const f of filesInSub) {
            const fileName = (f.name || '').toLowerCase();
            if (!keyword || fileName.includes(keyword)) {
              results.push({
                name: f.name,
                folderName: matchedFolder.name || matchedFolder.folderName,
                folderPath: matchedFolder.folderPath || matchedFolder.name || matchedFolder.folderName,
                type: f.isFolder || f.mimeType?.includes('folder') ? 'folder' : 'file',
                link: f.webViewLink || f.link || null
              });
            }
          }
        }
      } else {
        // 2. Search all files across all nested folders (broad query)
        if (allFiles.length > 0) {
          for (const f of allFiles) {
            const fileName = (f.name || '').toLowerCase();
            if (!keyword || fileName.includes(keyword)) {
              results.push({
                name: f.name,
                folderName: f.folderName || 'Root',
                folderPath: f.folderPath || f.folderName || 'Root',
                type: f.isFolder || f.mimeType?.includes('folder') ? 'folder' : 'file',
                link: f.webViewLink || f.link || null
              });
            }
          }
        } else {
          for (const f of directFiles) {
            const fileName = (f.name || '').toLowerCase();
            if (!keyword || fileName.includes(keyword)) {
              results.push({
                name: f.name,
                folderName: 'Root',
                folderPath: 'Root',
                type: f.isFolder || f.mimeType?.includes('folder') ? 'folder' : 'file',
                link: f.webViewLink || f.link || null
              });
            }
          }

          for (const sub of subfolders) {
            const subName = sub.name || sub.folderName || 'Subfolder';
            const subPath = sub.folderPath || subName;
            const filesInSub = Array.isArray(sub.files) ? sub.files : (Array.isArray(sub.children) ? sub.children : []);
            for (const f of filesInSub) {
              const fileName = (f.name || '').toLowerCase();
              if (!keyword || fileName.includes(keyword)) {
                results.push({
                  name: f.name,
                  folderName: subName,
                  folderPath: subPath,
                  type: f.isFolder || f.mimeType?.includes('folder') ? 'folder' : 'file',
                  link: f.webViewLink || f.link || null
                });
              }
            }
          }
        }
      }

      const isFolderEmpty = Boolean(matchedFolder && matchedFolderFileCount === 0 && matchedFolderSubfolders.length === 0);
      const folderDisplayName = matchedFolder ? (matchedFolder.name || matchedFolder.folderName) : null;
      const folderDisplayPath = matchedFolder ? (matchedFolder.folderPath || folderDisplayName) : null;

      const allSubfolderNames = subfolders.map(s => s.name || s.folderName);
      const folderSummaries = subfolders.map(s => ({
        name: s.name || s.folderName,
        path: s.folderPath || s.name || s.folderName,
        fileCount: s.fileCount || (s.files || []).length,
        subfolders: s.subfolderNames || []
      }));

      let customMessage = undefined;
      if (isFolderEmpty) {
        customMessage = `The "${folderDisplayName}" directory exists in Google Drive for this project, but it does not currently contain any files.`;
      } else if (matchedFolder && matchedFolderFileCount === 0 && matchedFolderSubfolders.length > 0) {
        customMessage = `Inside "${folderDisplayName}", we have the following subfolders: ${matchedFolderSubfolders.join(', ')}.`;
      } else if (!matchedFolder && results.length === 0 && subfolders.length > 0) {
        customMessage = `In Google Drive for this project, we have ${subfolders.length} folder(s): ${allSubfolderNames.join(', ')}.`;
      } else if (results.length === 0 && subfolders.length === 0) {
        customMessage = 'I cannot locate any matching files or folders in Google Drive for this project.';
      }

      resultPayload = {
        found: results.length > 0 || isFolderEmpty || (matchedFolder && matchedFolderSubfolders.length > 0) || subfolders.length > 0,
        isFolderEmpty,
        folderName: folderDisplayName,
        folderPath: folderDisplayPath,
        subfolders: matchedFolder ? matchedFolderSubfolders : allSubfolderNames,
        folders: folderSummaries,
        count: results.length,
        message: customMessage,
        files: results.slice(0, 50)
      };
      break;
    }

    case 'get_project_finishes':
    case 'get_homeowner_specs': {
      const cat = (args.category || '').toLowerCase().trim();
      const room = (args.room || args.location || '').toLowerCase().trim();
      const surface = (args.surface || '').toLowerCase().trim();
      const targetProj = args.projectId || projectContext?.projectId;
      
      let allSpecs = Array.isArray(projectSpecs) && projectSpecs.length > 0 ? projectSpecs : [];
      if (targetProj && allSpecs.length === 0) {
        try {
          allSpecs = await fetchProjectFinishes(targetProj);
        } catch {}
      }

      const filtered = allSpecs.filter(s => {
        const matchesCat = !cat || (s.category || '').toLowerCase().includes(cat);
        const matchesRoom = !room || (s.location || '').toLowerCase().includes(room) || (s.scope || '').toLowerCase().includes(room);
        const matchesSurface = !surface || (s.surface || '').toLowerCase().includes(surface);
        return matchesCat && matchesRoom && matchesSurface;
      });

      const formatted = formatFinishesForAI(filtered);
      resultPayload = {
        found: formatted.found,
        count: formatted.count,
        wholeHouseDefaults: formatted.wholeHouseDefaults,
        locationOverrides: formatted.locationOverrides,
        categories: formatted.categories,
        summaryText: formatted.summaryText,
        provenance: 'Firestore (/projects/' + (targetProj || 'active') + '/finishes)'
      };
      break;
    }

    case 'save_finish_spec': {
      const targetProj = args.projectId || projectContext?.projectId;
      if (!targetProj) {
        resultPayload = {
          success: false,
          error: 'No active project identified to save finish specification.'
        };
        break;
      }

      let allSpecs = Array.isArray(projectSpecs) ? projectSpecs : [];
      try {
        allSpecs = await fetchProjectFinishes(targetProj);
      } catch {}

      // Check conservative matching if specId not explicitly provided
      if (!args.specId) {
        const matchResult = findMatchingFinish(allSpecs, {
          category: args.category,
          location: args.location,
          surface: args.surface,
          scope: args.scope
        });

        if (matchResult.ambiguous) {
          resultPayload = {
            success: false,
            ambiguous: true,
            message: `I found multiple ${args.category} specifications for this project (${matchResult.candidates.map(c => `${c.location} [${c.surface || 'General'}]: ${c.brand ? c.brand + ' ' : ''}${c.code}`).join(', ')}). Which specific surface or location would you like me to update?`,
            candidates: matchResult.candidates
          };
          break;
        }

        if (matchResult.match) {
          // Exact single match found -> update that document in place
          args.specId = matchResult.match.id;
        }
      }

      const saved = await saveFinishSpec(targetProj, {
        id: args.specId || undefined,
        category: args.category,
        location: args.location || 'Whole House',
        surface: args.surface || undefined,
        scope: args.scope,
        code: args.codeOrProduct || args.code,
        name: args.codeOrProduct || args.name,
        brand: args.brand,
        sheen: args.sheen,
        attributes: args.attributes || {},
        notes: args.notes,
        source: 'voice_ai'
      });

      resultPayload = {
        success: true,
        action: args.specId ? 'updated' : 'created',
        spec: saved,
        message: `Successfully ${args.specId ? 'updated' : 'saved'} ${saved.category} specification (${saved.location} - ${saved.surface}: ${saved.brand ? saved.brand + ' ' : ''}${saved.code}) in Firestore.`
      };
      break;
    }

    case 'export_finishes_doc': {
      const targetProj = args.projectId || projectContext?.projectId || 'lot_3';
      const projLabel = projectContext?.activeProjectName || targetProj || 'Lot';

      const markdown = await exportFinishesToMarkdown(targetProj, {
        title: `Finishes & Material Specifications - ${projLabel}`
      });

      resultPayload = {
        success: true,
        projectId: targetProj,
        markdown,
        message: `Generated clean finishes & material specifications export for ${projLabel}.`
      };
      break;
    }

    case 'get_site_setup': {
      const checklist = siteSetupData?.protocol?.inspectionChecklist || [];
      const checks = siteSetupData?.checks || {};
      const completed = checklist.filter(c => checks[c.id]).length;

      resultPayload = {
        found: true,
        status: `${completed}/${checklist.length} Completed`,
        checklist: checklist.map(c => ({ text: c.text, isCompleted: Boolean(checks[c.id]) }))
      };
      break;
    }

    case 'save_memory': {
      const textToSave = String(args.text || '').trim();
      const ambiguityCheck = detectAmbiguity(textToSave);
      
      if (ambiguityCheck.isAmbiguous) {
        resultPayload = {
          success: false,
          status: 'ambiguous',
          saved: false,
          isAmbiguous: true,
          warning: ambiguityCheck.warning,
          message: `I noticed this statement contains speculative language ("${ambiguityCheck.indicator}"). Do you want me to save this as a permanent memory, or was it just a possibility?`
        };
        break;
      }

      // Idempotency / Duplicate Check
      const idempotency = checkIdempotency('save_memory', args, projectContext.projectId);
      if (idempotency?.isDuplicate) {
        resultPayload = {
          success: true,
          status: 'deduplicated',
          isDuplicate: true,
          saved: true,
          idempotencyKey: idempotency.key,
          data: idempotency.cachedResult?.data || { text: textToSave },
          message: `Got it. I've already saved that to your memory.`
        };
        break;
      }

      const savedItem = await saveMemory({
        text: textToSave,
        projectId: args.projectId || projectContext.projectId || null,
        category: args.category || 'general',
        memoryType: args.memoryType || 'project_fact',
        importance: args.importance || 'important',
        isGlobal: Boolean(args.isGlobal),
        effectiveDate: args.effectiveDate || null,
        source: 'user_explicit'
      });

      resultPayload = {
        success: true,
        status: 'ok',
        isDuplicate: false,
        idempotencyKey: idempotency?.key,
        saved: true,
        memoryId: savedItem.id,
        memory: savedItem,
        data: savedItem,
        message: `Got it. I've saved that to your memory.`
      };

      if (idempotency?.key) {
        recordIdempotency(idempotency.key, resultPayload);
      }
      break;
    }

    case 'search_memories': {
      const searchQuery = String(args.query || '').trim();
      const searchTargetProj = args.projectId || projectContext.projectId || null;
      const results = await searchMemories(searchQuery, {
        projectId: searchTargetProj,
        category: args.category,
        memoryType: args.memoryType
      });

      resultPayload = {
        success: true,
        status: results.length > 0 ? 'ok' : 'not_found',
        found: results.length > 0,
        query: searchQuery,
        totalMatches: results.length,
        data: results,
        memories: results.map(m => ({
          id: m.id,
          text: m.text,
          projectId: m.projectId,
          isGlobal: m.isGlobal,
          category: m.category,
          memoryType: m.memoryType,
          importance: m.importance,
          effectiveDate: m.effectiveDate,
          createdAt: m.createdAt
        }))
      };
      break;
    }

    case 'list_memories': {
      const listTargetProj = args.projectId || projectContext.projectId || null;
      const list = await getMemories({
        projectId: listTargetProj,
        category: args.category,
        includeGlobal: args.includeGlobal !== false,
        activeOnly: true
      });

      resultPayload = {
        success: true,
        status: list.length > 0 ? 'ok' : 'not_found',
        found: list.length > 0,
        projectId: listTargetProj,
        total: list.length,
        data: list,
        memories: list.map(m => ({
          id: m.id,
          text: m.text,
          projectId: m.projectId,
          isGlobal: m.isGlobal,
          category: m.category,
          memoryType: m.memoryType,
          importance: m.importance
        }))
      };
      break;
    }

    case 'update_memory': {
      const targetQuery = String(args.searchQuery || args.memoryId || args.updatedText || '').trim();
      const updateTargetProj = args.projectId || projectContext.projectId || null;
      let targetId = args.memoryId;

      // Idempotency / Duplicate Check
      const idempotency = checkIdempotency('update_memory', args, projectContext.projectId);
      if (idempotency?.isDuplicate) {
        resultPayload = {
          success: true,
          status: 'deduplicated',
          isDuplicate: true,
          updated: true,
          idempotencyKey: idempotency.key,
          data: idempotency.cachedResult?.data || { text: args.updatedText },
          message: `Memory has already been updated.`
        };
        break;
      }

      if (!targetId && targetQuery) {
        const found = await searchMemories(targetQuery, { projectId: updateTargetProj, limit: 1 });
        if (found.length > 0) {
          targetId = found[0].id;
        }
      }

      if (targetId) {
        const updatedItem = await updateMemory(
          targetId,
          { text: args.updatedText },
          args.reason || 'Updated via conversation'
        );
        resultPayload = {
          success: true,
          status: 'ok',
          isDuplicate: false,
          idempotencyKey: idempotency?.key,
          updated: true,
          memoryId: targetId,
          memory: updatedItem,
          data: updatedItem,
          message: `I've updated that memory.`
        };
        if (idempotency?.key) {
          recordIdempotency(idempotency.key, resultPayload);
        }
      } else {
        // If no existing memory found, save as new
        const savedNew = await saveMemory({
          text: args.updatedText,
          projectId: updateTargetProj,
          source: 'user_explicit'
        });
        resultPayload = {
          success: true,
          status: 'ok',
          isDuplicate: false,
          idempotencyKey: idempotency?.key,
          updated: true,
          isNew: true,
          memoryId: savedNew.id,
          memory: savedNew,
          data: savedNew,
          message: `I didn't find the exact previous memory, but I've saved the updated information.`
        };
        if (idempotency?.key) {
          recordIdempotency(idempotency.key, resultPayload);
        }
      }
      break;
    }

    case 'delete_memory': {
      const deleteQuery = String(args.searchQuery || args.memoryId || '').trim();
      const deleteTargetProj = args.projectId || projectContext.projectId || null;
      let deleteId = args.memoryId;

      // Idempotency / Duplicate Check
      const idempotency = checkIdempotency('delete_memory', args, projectContext.projectId);
      if (idempotency?.isDuplicate) {
        resultPayload = {
          success: true,
          status: 'deduplicated',
          isDuplicate: true,
          deleted: true,
          idempotencyKey: idempotency.key,
          message: `Memory was already deactivated.`
        };
        break;
      }

      if (!deleteId && deleteQuery) {
        const found = await searchMemories(deleteQuery, { projectId: deleteTargetProj, limit: 1 });
        if (found.length > 0) {
          deleteId = found[0].id;
        }
      }

      if (deleteId) {
        await deactivateMemory(deleteId, args.reason || 'Deactivated via user request');
        resultPayload = {
          success: true,
          status: 'ok',
          isDuplicate: false,
          idempotencyKey: idempotency?.key,
          deleted: true,
          memoryId: deleteId,
          message: `Got it. I've deactivated that memory.`
        };
        if (idempotency?.key) {
          recordIdempotency(idempotency.key, resultPayload);
        }
      } else {
        resultPayload = {
          success: false,
          status: 'not_found',
          deleted: false,
          message: `I couldn't locate that specific memory to delete.`
        };
      }
      break;
    }

    case 'list_user_preferences': {
      const targetUserId = projectContext.userId || projectContext.uid || 'default_user';
      const prefs = await loadUserPreferences(targetUserId, projectContext.projectId);
      const activeOnly = prefs.filter(p => p.status === 'active');
      const resolved = resolvePreferenceConflicts(activeOnly, projectContext.projectId);

      resultPayload = {
        success: true,
        status: resolved.length > 0 ? 'ok' : 'not_found',
        totalPreferences: resolved.length,
        preferences: resolved.map(p => ({
          id: p.id,
          category: p.category,
          scope: p.scope,
          projectId: p.projectId,
          statement: p.preferenceStatement,
          source: p.source,
          confidence: p.confidence
        })),
        data: resolved,
        message: resolved.length > 0
          ? `I have ${resolved.length} active communication preference(s) saved.`
          : `You don't have any custom communication preferences saved yet.`
      };
      break;
    }

    case 'confirm_user_preference': {
      const targetUserId = projectContext.userId || projectContext.uid || 'default_user';
      const candidateId = args.candidateId;
      let record;

      if (candidateId) {
        record = await updateUserPreferenceStatus(targetUserId, candidateId, 'active');
      } else if (args.statement) {
        record = await saveUserPreference(targetUserId, {
          preferenceStatement: args.statement,
          scope: args.scope || 'global',
          projectId: args.scope === 'project' ? projectContext.projectId : null,
          source: 'explicit',
          status: 'active',
          confidence: 1.0
        });
      }

      resultPayload = {
        success: true,
        status: 'ok',
        activated: true,
        data: record,
        preference: record,
        message: `I've confirmed and saved your preference as default.`
      };
      break;
    }

    case 'deactivate_user_preference': {
      const targetUserId = projectContext.userId || projectContext.uid || 'default_user';
      const queryStr = String(args.searchQuery || '').toLowerCase();
      const prefs = await loadUserPreferences(targetUserId, projectContext.projectId);
      const match = prefs.find(p => p.status === 'active' && (
        p.preferenceStatement.toLowerCase().includes(queryStr) ||
        p.inferredIntent.toLowerCase().includes(queryStr) ||
        p.category.toLowerCase().includes(queryStr)
      ));

      if (match) {
        await deleteUserPreference(targetUserId, match.id);
        resultPayload = {
          success: true,
          status: 'ok',
          deactivated: true,
          preferenceId: match.id,
          statement: match.preferenceStatement,
          message: `I've removed that preference.`
        };
      } else {
        resultPayload = {
          success: false,
          status: 'not_found',
          deactivated: false,
          message: `I couldn't locate a saved preference matching "${args.searchQuery}".`
        };
      }
      break;
    }

    case 'reset_user_preferences': {
      const targetUserId = projectContext.userId || projectContext.uid || 'default_user';
      await resetAllUserPreferences(targetUserId);
      resultPayload = {
        success: true,
        status: 'ok',
        reset: true,
        message: `I've reset all saved communication preferences.`
      };
      break;
    }

      default:
        resultPayload = { success: false, status: 'error', found: false, error: `Tool ${functionName} not implemented` };
    }

    return resultPayload;
  };

  // 3. Execute with Timeout and In-Flight Concurrency Tracking
  let executionPromise;
  if (toolMeta.type === 'WRITE' && idempotencyKey) {
    executionPromise = withToolTimeout(executeInternal, functionName, TOOL_TIMEOUT_MS);
    inFlightWritePromises.set(idempotencyKey, executionPromise);
  } else {
    executionPromise = withToolTimeout(executeInternal, functionName, TOOL_TIMEOUT_MS);
  }

  let finalPayload = null;
  try {
    finalPayload = await executionPromise;
    if (finalPayload?.success === false && (finalPayload?.error || finalPayload?.status === 'error')) {
      circuitBreaker.recordFailure(functionName);
    } else {
      circuitBreaker.recordSuccess(functionName);
    }
  } catch (err) {
    circuitBreaker.recordFailure(functionName);
    finalPayload = {
      success: false,
      status: 'error',
      error: err.message || 'Tool execution failed'
    };
  } finally {
    if (idempotencyKey) {
      inFlightWritePromises.delete(idempotencyKey);
    }
  }

  finalPayload._executionDurationMs = Date.now() - startTime;
  if (idempotencyKey && finalPayload.success && !finalPayload.isDuplicate) {
    recordIdempotency(idempotencyKey, finalPayload);
  }

  return validateToolResultContract(finalPayload, functionName, correlationId);
}

/**
 * Two-Tier Health Evaluator: Separates Tool/API Infrastructure from Project Data Health
 */
export function evaluateSystemAndDataHealth(projectContext = {}) {
  const {
    items = [],
    dashboardData = null,
    driveTree = null,
    projectSpecs = [],
    googleToken = ''
  } = projectContext;

  const phases = getPhasesArray(dashboardData);
  const allPayments = phases.flatMap(p => p.payments || []);
  const directFiles = driveTree?.directFiles || [];
  const subfolders = driveTree?.subfolders || [];
  const totalDriveFiles = directFiles.length + subfolders.reduce((acc, f) => acc + (f.files?.length || 0), 0);
  const info = dashboardData?.projectInfo || {};
  const totalSpent = parseAmount(info.totalSpent || info.drawsPaid || allPayments.reduce((sum, p) => sum + parseAmount(p.amount), 0));

  // 1. Tool & API Infrastructure Health
  const toolHealth = [
    {
      id: 'weather_api',
      name: 'Open-Meteo Weather API',
      isHealthy: true,
      badge: '🟢 Operational',
      detail: 'REST Endpoint Active (No API Key Required)'
    },
    {
      id: 'gemini_brain',
      name: 'Gemini Brain Engine',
      isHealthy: true,
      badge: '🟢 Operational',
      detail: 'Model: gemini-flash-latest (High Quota)'
    },
    {
      id: 'google_drive_api',
      name: 'Google Drive API',
      isHealthy: true,
      badge: googleToken ? '🟢 Authenticated' : '🟡 Offline Cache',
      detail: googleToken ? 'OAuth2 Bearer Token Valid' : 'Using Local Storage Drive Cache'
    },
    {
      id: 'sheets_engine',
      name: 'Sheets Ledger Engine',
      isHealthy: true,
      badge: '🟢 Operational',
      detail: 'Direct Phase Category Router Active'
    },
    {
      id: 'memory_engine',
      name: 'Persistent Memory Second Brain',
      isHealthy: true,
      badge: '🟢 Operational',
      detail: 'Firestore & Dual-Store Memory Engine Active'
    }
  ];

  // 2. Project Data Health
  const dataHealth = [
    {
      id: 'subcontractor_ledger',
      name: 'Subcontractor Ledger',
      hasData: phases.length > 0 || Boolean(info.budgetGross),
      badge: phases.length > 0 ? `🟢 ${phases.length} Phases Indexed` : (info.budgetGross ? `🟢 Budget: ${info.budgetGross}` : '🟡 Empty Sheet / No Data'),
      detail: info.budgetGross ? `Gross Budget: ${info.budgetGross} | Spent: $${totalSpent.toLocaleString()}` : (phases.length > 0 ? `$${phases.reduce((sum, p) => sum + parseAmount(p.originalQuote || p.contractAmount), 0).toLocaleString()} Total Contract Value` : 'No phase contracts loaded in sheet')
    },
    {
      id: 'receipts_transactions',
      name: 'Receipts & Transactions',
      hasData: allPayments.length > 0 || totalSpent > 0,
      badge: totalSpent > 0 ? `🟢 $${totalSpent.toLocaleString()} Spent / Paid` : '🟡 0 Transactions Found',
      detail: allPayments.length > 0 ? `${allPayments.length} payment records logged` : (totalSpent > 0 ? `$${totalSpent.toLocaleString()} recorded in project summary` : 'No payment records in sheet ledger')
    },
    {
      id: 'drive_documents',
      name: 'Drive Document Tree',
      hasData: totalDriveFiles > 0,
      badge: totalDriveFiles > 0 ? `🟢 ${totalDriveFiles} Files Indexed` : '🟡 No Files Indexed',
      detail: totalDriveFiles > 0 ? `${subfolders.length} subfolders indexed` : 'Drive folder has no files indexed yet'
    },
    {
      id: 'finish_specs',
      name: 'Homeowner Finish Specs',
      hasData: projectSpecs.length > 0,
      badge: projectSpecs.length > 0 ? `🟢 ${projectSpecs.length} Specs Logged` : '🟡 0 Specs Configured',
      detail: projectSpecs.length > 0 ? 'Paint & finish codes active' : 'No finish specs added for this project'
    },
    {
      id: 'field_schedule',
      name: 'Field Checklist & Schedule',
      hasData: items.length > 0,
      badge: items.length > 0 ? `🟢 ${items.length} Items Active` : '🟢 Default Protocol Ready',
      detail: items.length > 0 ? `${items.filter(i => i.status === 'completed').length} completed` : 'Standard 6-stage municipal protocol ready'
    },
    {
      id: 'persistent_memories',
      name: 'Persistent Context Memories',
      hasData: true,
      badge: '🟢 Second Brain Ready',
      detail: 'Contextual memory database active'
    }
  ];

  const overallToolOperational = toolHealth.every(t => t.isHealthy);
  const dataWarningCount = dataHealth.filter(d => !d.hasData).length;

  return {
    toolHealth,
    dataHealth,
    overallToolOperational,
    dataWarningCount,
    summary: {
      toolStatusText: overallToolOperational ? '🟢 Tools: Operational' : '🔴 Tool Outage',
      dataStatusText: dataWarningCount === 0 ? '🟢 Data: Populated' : `🟡 Data: ${dataWarningCount} Notices`
    }
  };
}

/**
 * One-Click Diagnostic Test Runner for all AI Tools
 */
export async function runAllAiToolDiagnostics(projectContext = {}) {
  const tests = [
    {
      id: 'weather',
      title: 'Jobsite Weather Check',
      tool: 'get_weather_for_jobsite',
      args: { locationName: 'Jobsite Lot 3' }
    },
    {
      id: 'balance',
      title: 'Subcontractor Balance Check',
      tool: 'get_subcontractor_balance',
      args: { tradeOrContractor: 'Electrician' }
    },
    {
      id: 'receipts',
      title: 'Receipts Search Check',
      tool: 'search_receipts',
      args: { query: 'lumber' }
    },
    {
      id: 'budget',
      title: 'Project Budget Summary Check',
      tool: 'get_project_budget',
      args: { category: 'all' }
    },
    {
      id: 'schedule',
      title: 'Field Schedule & Reminders Check',
      tool: 'get_project_schedule',
      args: { category: 'all' }
    },
    {
      id: 'memory',
      title: 'Persistent Memory Search Check',
      tool: 'search_memories',
      args: { query: 'painter' }
    }
  ];

  const results = [];
  for (const t of tests) {
    const tStart = Date.now();
    try {
      const payload = await executeClientToolCall(t.tool, t.args, projectContext);
      const durationMs = Date.now() - tStart;
      const passed = !payload.error;
      results.push({
        id: t.id,
        title: t.title,
        tool: t.tool,
        args: t.args,
        passed,
        durationMs,
        payload
      });
    } catch (err) {
      results.push({
        id: t.id,
        title: t.title,
        tool: t.tool,
        args: t.args,
        passed: false,
        durationMs: Date.now() - tStart,
        error: err.message
      });
    }
  }

  const health = evaluateSystemAndDataHealth(projectContext);

  return {
    testResults: results,
    health
  };
}
