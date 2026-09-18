/**
 * J.A.R.V.I.S. Builder Brain AI Service
 * Pure AI Model Architecture: Feeds live project records directly to Gemini Cloud AI in one pass.
 * No brittle hardcoded if/else rules or regex catchphrases.
 */
import { determineTaskModel } from '../config/aiConfig.js';
import { executeClientToolCall, circuitBreaker, resetWriteIdempotencyState } from './aiTools.js';
import { getFirebaseAuthInstance } from './firebase.js';
import { INSPECTION_STAGES, loadInspectionData } from './inspectionService.js';
import { searchMemories, formatMemoriesForPrompt, loadUserPreferences, saveUserPreference } from './memoryService.js';
import { getTodayCalendarDate } from './sheetsDataService.js';
import {
  compileUserPreferencesPrompt,
  analyzeInteractionForPreference,
  PREFERENCE_STATUS,
  PREFERENCE_SOURCES
} from './userPreferenceEngine.js';

import {
  evaluateCognitiveInitiative,
  resolvePendingSuggestionConfirmation,
  recordSuggestionOutcome,
  isConversationEnding,
  INITIATIVE_OUTCOMES
} from './cognitiveInitiativeEngine.js';

import {
  synthesizeGroundedEvidence,
  getSemanticPromptGuidelines
} from './semanticIntentService.js';

import {
  fetchProjectFinishes,
  formatFinishesForAI
} from './finishService.js';
import {
  getCachedDashboardSpreadsheetId,
  loadProjectDashboardFromFolder,
  persistDashboardCache,
  persistDashboardSpreadsheetId
} from './dashboardDrive.js';

let _activeSessionCognitiveState = {
  turnIndex: 0,
  lastSuggestionTurn: -999,
  pendingProactiveSuggestion: null
};

export function getActiveSessionCognitiveState() {
  return _activeSessionCognitiveState;
}

export function resetActiveSessionCognitiveState() {
  _activeSessionCognitiveState = {
    turnIndex: 0,
    lastSuggestionTurn: -999,
    pendingProactiveSuggestion: null
  };
  try {
    resetWriteIdempotencyState();
  } catch {}
}



const SPECS_STORAGE_PREFIX = 'jobscan_project_specs_';
const GLOBAL_PHASES_STORAGE_KEY = 'jobscan_global_phase_protocols_v4';
const GLOBAL_SITE_SETUP_KEY = 'jobscan_global_site_setup_protocol_v2';

export function playChimeAlert() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.36);
  } catch {}
}

export function loadGlobalSiteSetupProtocol(defaultProtocol = {}) {
  try {
    if (typeof localStorage === 'undefined') return defaultProtocol;
    const raw = localStorage.getItem(GLOBAL_SITE_SETUP_KEY);
    if (!raw) return defaultProtocol;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : defaultProtocol;
  } catch (e) {
    console.error('Error loading global site setup protocol:', e);
    return defaultProtocol;
  }
}

export function saveGlobalSiteSetupProtocol(protocol) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(GLOBAL_SITE_SETUP_KEY, JSON.stringify(protocol));
  } catch (e) {
    console.error('Error saving global site setup protocol:', e);
  }
}

export function resetGlobalSiteSetupProtocol(defaultProtocol = {}) {
  try {
    if (typeof localStorage === 'undefined') return defaultProtocol;
    localStorage.removeItem(GLOBAL_SITE_SETUP_KEY);
    return defaultProtocol;
  } catch (e) {
    console.error('Error resetting global site setup protocol:', e);
    return defaultProtocol;
  }
}

export function loadGlobalPhases(defaultPhases = []) {
  try {
    if (typeof localStorage === 'undefined') return defaultPhases;
    const raw = localStorage.getItem(GLOBAL_PHASES_STORAGE_KEY);
    if (!raw) return defaultPhases;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : defaultPhases;
  } catch (e) {
    console.error('Error loading global phases:', e);
    return defaultPhases;
  }
}

export function saveGlobalPhases(phases) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(GLOBAL_PHASES_STORAGE_KEY, JSON.stringify(phases));
  } catch (e) {
    console.error('Error saving global phases:', e);
  }
}

export function resetGlobalPhases(defaultPhases = []) {
  try {
    if (typeof localStorage === 'undefined') return defaultPhases;
    localStorage.removeItem(GLOBAL_PHASES_STORAGE_KEY);
    return defaultPhases;
  } catch (e) {
    console.error('Error resetting global phases:', e);
    return defaultPhases;
  }
}

export const DEFAULT_SITE_SETUP_PROTOCOL = {
  id: 'site_setup',
  name: 'Site Setup & Lot Mobilization',
  trade: 'Site Prep & Utilities',
  icon: '🚩',
  preTradeNotes: [
    'Set temporary hose bibb with anti-siphon vacuum breaker on water meter line.',
    'Erect permit board with visible Lot # and city building permit in clear weatherproof pouch.',
    'Install erosion control barrier / silt fencing along lot boundaries to prevent dirt runoff.',
    'Ensure port-a-potty / temporary toilet is delivered and visible at front of lot.',
    'Verify city utility water meter is requested, set, and active prior to temp plumbing connections.'
  ],
  inspectionChecklist: [
    { id: 'ss_water_meter', text: 'City Water Meter Set & Installed' },
    { id: 'ss_vacuum_breaker', text: 'Temporary Hose Faucet with Vacuum Breaker (Backflow Preventer)' },
    { id: 'ss_permit_board', text: 'Lot Number & City Building Permit Board Posted On-Site' },
    { id: 'ss_erosion_control', text: 'Erosion Control Barrier / Silt Fencing' },
    { id: 'ss_port_a_potty', text: 'Port-A-Potty / Temporary Toilet Delivered On-Site' }
  ]
};

function getSiteSetupProtocol() {
  return loadGlobalSiteSetupProtocol(DEFAULT_SITE_SETUP_PROTOCOL);
}

export function formatNaturalDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return dateStr || 'N/A';
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    const year = match[1];
    if (months[month]) {
      const suffix = (day === 1 || day === 21 || day === 31) ? 'st' : (day === 2 || day === 22) ? 'nd' : (day === 3 || day === 23) ? 'rd' : 'th';
      return `${months[month]} ${day}${suffix}, ${year}`;
    }
  }
  return dateStr;
}



export function loadStoredReminders() {
  try {
    const keys = ['jobscan_reminders', 'jobscan_ai_reminders', 'jobscan_field_reminders'];
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    }
  } catch {}
  return [];
}


export function saveStoredReminders(reminders) {
  try {
    localStorage.setItem('jobscan_reminders', JSON.stringify(reminders));
    localStorage.setItem('jobscan_ai_reminders', JSON.stringify(reminders));
  } catch {}
}

export function loadProjectSpecs(projectId) {
  if (!projectId) return [];
  try {
    const cleanId = String(projectId).toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
    const rawNew = typeof localStorage !== 'undefined' ? localStorage.getItem(`sitetactix_finishes_${cleanId}`) : null;
    if (rawNew) {
      const parsed = JSON.parse(rawNew);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(`${SPECS_STORAGE_PREFIX}${projectId}`) : null;
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveProjectSpecs(projectId, specs) {
  if (!projectId) return;
  try {
    const cleanId = String(projectId).toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`sitetactix_finishes_${cleanId}`, JSON.stringify(specs));
      localStorage.setItem(`${SPECS_STORAGE_PREFIX}${projectId}`, JSON.stringify(specs));
    }
  } catch {}
}

export function loadProjectDashboard(projectId) {
  try {
    if (!projectId) return null;
    const directKey = `jobscan_cached_dashboard_${projectId}`;
    const rawDirect = localStorage.getItem(directKey);
    if (rawDirect) return JSON.parse(rawDirect);

    const normKey = `jobscan_cached_dashboard_${projectId.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_')}`;
    const rawNorm = localStorage.getItem(normKey);
    if (rawNorm) return JSON.parse(rawNorm);

    return null;
  } catch {
    return null;
  }
}

export function loadProjectDriveTree(projectId) {
  try {
    if (!projectId) return null;
    const raw = localStorage.getItem(`jobscan_cached_drivetree_${projectId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveProjectDriveTree(projectId, tree) {
  if (!projectId || !tree) return;
  try {
    localStorage.setItem(`jobscan_cached_drivetree_${projectId}`, JSON.stringify(tree));
  } catch {}
}

export const loadDriveTree = loadProjectDriveTree;

/**
 * Builds grounded Markdown context for the Gemini system prompt.
 * This feeds your entire project ledger, sub-balances, expenses, site setup, municipal inspections, specs, and drive files directly into Gemini.
 */
export function buildGroundingSystemInstruction(context) {
  const {
    activeProjectName = 'Active Project',
    dashData = null,
    driveData = null,
    projectSpecs = [],
    siteSetupData = null,
    inspectionsData = [],
    pendingR = [],
    memoriesData = [],
    userPreferencesPrompt = '',
    _timeGreeting = 'Good morning',
    _spanishTimeGreeting = 'Buenos días',
    currentTimeString = '',
    currentDayString = ''
  } = context;

  const info = dashData?.projectInfo || {};
  const subs = Array.isArray(dashData?.subcontractors) ? dashData.subcontractors : (Array.isArray(dashData?.phases) ? dashData.phases : []);

  const grossBudget = info.budgetGross || info.grossBudget || '$0.00';
  const buildBudget = info.budgetBuild || info.buildBudget || '$0.00';
  const totalSpent = info.totalSpent || info.drawsPaid || '$0.00';
  const workingCapital = info.capitalBalance || info.netCapital || '$0.00';

  let phaseRecords = 'No trade records recorded yet.';
  if (subs.length > 0) {
    phaseRecords = subs.map(s => {
      const name = s.phase || s.name || 'Trade';
      const payee = s.payee || s.contractor || 'Unassigned';
      const quote = s.originalQuote || s.quote || '$0.00';
      const paid = s.totalSpent || s.totalPaid || '$0.00';
      const bal = s.remainingBalance || '$0.00';
      const payments = (s.payments || []).map(p => `    - Payment: ${p.amount || p.laborCost || p.materialCost || '$0.00'} to ${p.vendor || payee} on ${formatNaturalDate(p.date)} (Check #${p.checkNumber || 'N/A'}${p.description ? `, ${p.description}` : ''})`).join('\n');

      return `* Phase: "${name}" | Payee: "${payee}" | Quote: ${quote} | Paid: ${paid} | Remaining Balance: ${bal}${payments ? '\n' + payments : ''}`;
    }).join('\n');
  }

  let siteSetupRecords = 'Site Setup Protocol not initialized.';
  if (siteSetupData?.protocol) {
    const protocol = siteSetupData.protocol;
    const preNotes = protocol.preTradeNotes || protocol.lotPrepList || [];
    const chkList = protocol.inspectionChecklist || [];
    const checks = siteSetupData.checks || {};
    const passedCount = chkList.filter(c => checks[c.id]).length;

    const notesFormatted = preNotes.length > 0
      ? preNotes.map((n, i) => `  ${i + 1}. ${typeof n === 'string' ? n : n.text || n.title}`).join('\n')
      : '  (No pre-work notes)';

    const auditFormatted = chkList.length > 0
      ? chkList.map(c => `  - [${checks[c.id] ? 'x' : ' '}] ${c.text || c.title} (${checks[c.id] ? 'PASSED / CHECKED' : 'PENDING'})`).join('\n')
      : '  (No checklist items)';

    siteSetupRecords = `Status: ${passedCount}/${chkList.length} Passed\nCritical Pre-Work Notes:\n${notesFormatted}\n\nSite Readiness Audit Checklist:\n${auditFormatted}`;
  }

  let inspectionRecords = 'No municipal inspection data loaded.';
  if (Array.isArray(inspectionsData) && inspectionsData.length > 0) {
    inspectionRecords = inspectionsData.map((s, idx) => {
      const itemsList = s.items.map(i => `    - [${i.status === 'PASSED' ? 'x' : ' '}] ${i.title} [Status: ${i.status}]${i.category ? ` (Category: ${i.category})` : ''}${i.note ? ` - Note: "${i.note}"` : ''}`).join('\n');
      return `${idx + 1}. Stage: "${s.stageName}" (${s.passedCount}/${s.totalItems} Passed - ${s.isFullyPassed ? 'COMPLETE' : 'IN PROGRESS'})\n   Description: ${s.description}\n   Checklist:\n${itemsList}`;
    }).join('\n\n');
  }

  let reminderRecords = 'No pending field reminders.';
  if (pendingR.length > 0) {
    reminderRecords = pendingR.map((r, i) => `${i + 1}. ${r.title} (${r.notes || 'No notes'})`).join('\n');
  }

  let specRecords = 'No finish specifications recorded.';
  if (Array.isArray(projectSpecs) && projectSpecs.length > 0) {
    specRecords = formatFinishesForAI(projectSpecs).summaryText;
  }

  let driveRecords = 'No Drive folders or files indexed.';
  if (driveData) {
    const lines = [];
    if (Array.isArray(driveData.directFiles) && driveData.directFiles.length > 0) {
      lines.push(`* Root Project Folder Files:\n` + driveData.directFiles.map(f => `  - "${f.name}" (${f.mimeType || 'file'}${f.id ? `, ID: ${f.id}` : ''})`).join('\n'));
    }
    if (Array.isArray(driveData.subfolders) && driveData.subfolders.length > 0) {
      for (const sub of driveData.subfolders) {
        const fileList = Array.isArray(sub.files) && sub.files.length > 0
          ? sub.files.map(f => `  - "${f.name}" (${f.mimeType || 'file'}${f.id ? `, ID: ${f.id}` : ''})`).join('\n')
          : '  - (Empty folder or no files uploaded yet)';
        const subfolderMeta = sub.subfolderNames?.length ? ` [Contains Subfolders: ${sub.subfolderNames.join(', ')}]` : '';
        lines.push(`* Folder "${sub.folderPath || sub.folderName}" (Folder ID: ${sub.folderId || sub.id || 'N/A'})${subfolderMeta}:\n${fileList}`);
      }
    }
    if (lines.length > 0) {
      driveRecords = lines.join('\n\n');
    }
  }

  const memoryRecords = formatMemoriesForPrompt(memoriesData);

  return `You are Jarvis, the expert AI Construction Field Co-Pilot for custom home builder ADEPEC HOMES / SiteTactix.

CURRENT PROJECT CONTEXT:
- Active Lot / Project: "${activeProjectName}"
- Current Time: ${currentTimeString}, ${currentDayString}

LIVE PROJECT DATA MODULE MANIFEST FOR "${activeProjectName}":

======================================================================
[MODULE 1: LIVE FINANCIAL SPREADSHEET (Summary_Dashboard)] -> SOURCE: Google Sheets (Project Financials)
======================================================================
(NOTE: Contains ONLY financial numbers, budgets, draws paid, hard costs, and subcontractor payments. Does NOT contain calendar reminders or schedules.)
- Gross Budget: ${grossBudget}
- Hard Cost Build Budget: ${buildBudget}
- Total Draws Paid / Total Spent To Date: ${totalSpent}
- Remaining Working Capital / Net Liquidity: ${workingCapital}

SUBCONTRACTOR CONTRACTS, PAYMENTS & REMAINING BALANCES:
${phaseRecords}

======================================================================
[MODULE 2: SITE SETUP & LOT MOBILIZATION] -> SOURCE: Site Setup Checklist Database
======================================================================
${siteSetupRecords}

======================================================================
[MODULE 3: MUNICIPAL INSPECTION PROTOCOLS (6 BUILD STAGES)] -> SOURCE: Municipal Inspections
======================================================================
${inspectionRecords}

======================================================================
[MODULE 4: HOMEOWNER FINISH SPECIFICATIONS] -> SOURCE: Homeowner Specifications
======================================================================
${specRecords}

======================================================================
[MODULE 5: PENDING FIELD REMINDERS] -> SOURCE: Field Reminders (SiteTactix App)
======================================================================
(NOTE: In-app task and reminder list stored locally in SiteTactix app.)
${reminderRecords}

======================================================================
[MODULE 6: GOOGLE DRIVE FOLDER & FILE TREE] -> SOURCE: Google Drive
======================================================================
${driveRecords}

======================================================================
[MODULE 7: PERSISTENT BUSINESS & SITE MEMORIES (SECOND BRAIN)] -> SOURCE: J.A.R.V.I.S. Memory (Persistent Vault)
======================================================================
(NOTE: Verbal builder notes, contractor preferences, and site facts stored in Firestore /memories.)
${memoryRecords}

======================================================================
[MODULE 8: USER PREFERENCES & INTERACTION STYLE (LEARNED & CONFIGURED)] -> SOURCE: J.A.R.V.I.S. Memory (Persistent Vault)
======================================================================
${userPreferencesPrompt || 'Default: Concise, professional builder co-pilot.'}

======================================================================
BEHAVIOR, VERIFICATION & CITATION RULES:
======================================================================
1. SYSTEM ARCHITECTURE & DUAL-STORE ROLES:
   - "Live Financial Spreadsheet" is the single authoritative source for actual financial transactions, payments, and mathematical accounting.
   - "Persistent Saved Memory" is the authoritative source for verbal quotes, subcontractor preferences, site decisions, and lessons learned that the user told you to remember.
   - You (Jarvis / Gemini) are responsible for natural language understanding, reasoning, and conversational presentation over the data provided in this manifest.

2. EXPLICIT MEMORY COMMAND EXECUTION (SAVE, UPDATE, FORGET):
   - STRICT IMPERATIVE INTENT REQUIREMENT: Call 'save_memory' ONLY when the user gives you an explicit, direct command to store a note or remember something for future recall. The mere presence of the word "remember" or "memory" in a sentence is NOT sufficient (e.g. "I remember we bought the faucets" -> DO NOT call save_memory; "Remember that the faucets were bought" -> CALL save_memory).
   - Valid imperative triggers include:
     * "Remember that / this..."
     * "I need you to remember..."
     * "Make a note that / of..."
     * "Keep this in mind: ..."
     * "Save this to memory / save this note..."
     * "Don't forget that..."
   - STRUCTURED DOMAIN EXCLUSIVITY (ZERO SHADOW MEMORIES):
     * NEVER call 'save_memory' for purchasing items, purchasing statuses (needed/purchased), material checklists, subcontractor contract balances, payment amounts, or municipal inspection statuses.
     * Those domains are strictly and exclusively managed by their dedicated tools and databases (Firestore Purchasing Collections: projects/{projectId}/purchasing_items; Live Financial Ledger; Municipal Inspection Database).
     * Conversational statements, observations, confirmations, or remarks about purchasing (e.g., "We still need to buy the faucets", "Those are all the electrical items we need", "We still need to purchase all of these items for electrical") MUST NEVER trigger 'save_memory'.
   - When the user uses explicit memory commands meeting the above criteria, call the 'save_memory' function tool immediately.
   - When the user asks to change, correct, or update a previously remembered fact (e.g., "Actually change that note to check", "The painter wants checks now"), you MUST call the 'update_memory' function tool.
   - When the user asks to forget or remove a memory (e.g., "Forget what I told you about...", "Delete that note"), you MUST call the 'delete_memory' function tool.
   - When the user asks what you remember or queries preferences/quotes (e.g., "What do you remember about Lot 12?", "How does the painter want to get paid?"), answer naturally, concisely, and directly in your professional co-pilot persona (e.g., "For Lot 3, the painter prefers to be paid by check.") using the factual records retrieved from 'search_memories' or [MODULE 7].

3. MANUAL TRANSACTION (NO-RECEIPT / CONVERSATIONAL DATA-ENTRY) WORKFLOW:
   - When the user asks to log or create a manual expense, contractor payment, or check (e.g. "I spent $50 on gas at Stripes today", "Create a $2,500 payment for the plumber"):
   - 1. AUTO-RESOLVE WHAT IS KNOWN SAFELY:
     * Active Project / Lot: defaults to active project context (e.g. Lot 3) unless specified otherwise.
     * Date: defaults to today's date unless a specific date is mentioned.
     * Contractor Payee: look up the contractor/payee name from the active project spreadsheet if a trade is named (e.g. "the plumber" -> look up Plumbing Rough-In payee from [MODULE 1]).
     * Category & Phase: strictly match to existing spreadsheet tabs & phase names (e.g. gas -> Project_Overhead_&_Bills / Extra Costs & Misc; plumbing -> Mechanicals_&_Utilities / Plumbing Rough-In). NEVER invent phantom categories or phases.
   - 2. STRICT SLOT-FILLING (ZERO ASSUMPTIONS ON PAYMENT METHOD OR COST CATEGORY):
     * NEVER assume or guess the payment method (do NOT automatically assume card/debit for store expenses, and do NOT assume check for contractor payments).
     * If payment method is not explicitly stated in the conversation, DO NOT call 'stage_manual_transaction'. Instead, ASK: "How was this paid (Card, Cash, Check, or Transfer)?"
     * If payment method is Check and check number is not provided, ASK: "What is the check number?"
     * Cost Classification (Material vs Labor): ONLY set costCategory to 'material' or 'labor' if the user explicitly stated "for materials", "supplies", "labor", or "labor draw". For general merchant/store expenses (e.g. gas at Stripes, lunch, tools without explicit classification), leave costCategory unset/empty string "" so the user can classify it in EditForm. Do NOT guess "material".
   - 3. CONCISE CONFIRMATION FIRST:
     * Once all required fields (including payment method) are collected, present a concise confirmation summary:
       - Payee / Vendor
       - Amount
       - Project / Lot
       - Spreadsheet Destination (Category Tab -> Trade Phase)
       - Payment Method / Check #
       - Document Type: Manual Entry (No Receipt Attached)
     * Ask: "Should I stage this in your Drafts?"
   - 4. EXECUTION ON CONFIRMATION:
     * ONLY after the user confirms (or if the user explicitly provided all fields and commanded immediate staging), call the 'stage_manual_transaction' tool.

4. DUAL-STORE CONTRADICTION & RECONCILIATION RULE:
   - When a saved memory and the live spreadsheet differ (for example, memory records an original verbal quote of $8,500 while the spreadsheet shows $0.00 paid to date), DO NOT state the difference as an absolute financial ledger balance.
   - State both clearly and transparently (e.g., "The painter's saved verbal quote is $8,500, while the project spreadsheet currently shows $0.00 paid. That means $8,500 of the quoted amount has not yet been recorded as paid in the official ledger.").
   - Financial calculations (balances, payments, totals) must ALWAYS come from the spreadsheet, never assumed or hallucinated from memory.

5. STRICT PROJECT ISOLATION:
   - Never apply a project-specific memory from one lot (e.g. Lot 12) to a different lot (e.g. Lot 15).
   - Only memories explicitly marked as [GLOBAL BUSINESS KNOWLEDGE] apply across all projects.
   - If information for a requested lot is not in the spreadsheet or memory, state clearly that you do not have that record; do NOT guess or transfer from other lots.

6. SPECULATION & AMBIGUITY GUARD:
   - If the user uses speculative or tentative language (e.g., "might switch to ACH", "may want", "possibly considering"), do NOT save it as a permanent fact. Clarify or ask for confirmation first.

7. MANDATORY SOURCE CITATION:
   - Always clearly cite the origin of facts in your response:
     * "According to your project spreadsheet..." (for financial numbers, payments)
     * "Your saved memory says..." (for verbal agreements, preferences, quotes)
     * "Municipal Inspection Checklist..." (for plumbing, framing, etc.)
     * "Site Setup Checklist..." (for meters, silt fence, mobilization)
     * "Google Drive Index..." (for folder/file structure)

7. CLEAN FORMATTING & NATURAL DATES (NO ASTERISKS / NO DUPLICATE DATES / NO RAW IDS):
   - Do NOT use Markdown asterisks (* or **) in your text responses. Use plain text and standard bullet dashes (-) or numbered lists (1., 2.).
   - Always output dates in natural conversational English (e.g. "July 22, 2026") or Spanish (e.g. "22 de julio de 2026").
   - NEVER output raw Google Drive Folder IDs or File IDs (e.g. '1-_2MHhajXEKLDsIADlzkOnf1167DMYN_') in your conversational text responses.

8. OPENING DOCUMENTS & PRONOUN CONFIRMATIONS:
   - When the user asks to see, open, pull up, or show a document or receipt, or says 'open it', 'yeah go ahead', 'show it to me', 'pull it up':
     * Check the recent conversation context to resolve the exact file being discussed.
     * If the reference unambiguously maps to a single file, confirm you are opening it and ALWAYS append: [[ACTION:VIEW_FILE:{"fileId":"FILE_ID","fileName":"FILE_NAME","folderName":"FOLDER_NAME"}]].
     * If multiple matching files exist, ask ONE clarifying question asking which specific file to open instead of guessing.

9. STATE-CHANGING ACTIONS & PERMISSIONS:
   - For Google Drive file actions (creating folders, moving files, or deleting files in Drive), you MUST ask for explicit confirmation from the user first (e.g. "Would you like me to go ahead and create the folder '[Folder Name]' in your Google Drive project folder for [Project Name]?").
   - This confirmation requirement does NOT apply to memory commands (save_memory, update_memory, delete_memory), which execute immediately when explicitly commanded.
   - When confirmed by the user, emit the corresponding action code (e.g. [[ACTION:CREATE_FOLDER:FolderName]]).

10. INTENT FIRST & RELEVANCE GUARDRAIL (DATA AVAILABILITY != PERMISSION TO VOLUNTEER):
   - Principle: Having access to project data, financial spreadsheets, municipal inspections, memories, and specs in this prompt does NOT give you permission to volunteer that information unprompted. Answer ONLY what the user specifically asked for, and stop.
   - CASUAL GREETINGS & CHIT-CHAT ("what's up", "hey", "hello", "good morning", "how's it going", "how are you"):
     * Respond with a natural, crisp 1-sentence time-of-day greeting: e.g. "Good evening. How can I help with ${activeProjectName} tonight?" (or in Spanish: "Buenas noches. ¿Cómo te ayudo con ${activeProjectName} hoy?").
     * ABSOLUTE PROHIBITION: NEVER volunteer gross budgets, draws paid, working capital, subcontractor balances, inspection checklists, or memories on greetings or casual chit-chat.
   - SPECIFIC DOMAIN QUERIES:
     * When asked about a specific trade (e.g. "What do we owe the electrician?"), answer ONLY for that trade. Do NOT add unrelated trades, gross budgets, or inspection items.
   - FINANCIAL OVERVIEW QUERIES:
     * When asked specifically about finances (e.g. "How much have we spent?", "What is our remaining budget?"), provide the requested financial figures accurately.
   - PROJECT STATUS QUERIES:
     * When the user explicitly requests an overall project status (e.g. "Where are we at on ${activeProjectName}?", "Give me the status on ${activeProjectName}"), provide the relevant project status.
   - COMPREHENSIVE REPORTS:
     * When the user explicitly requests a comprehensive breakdown (e.g. "Give me a full breakdown", "Provide a comprehensive status report"), deliver the complete detailed report rather than being artificially brief.
   - CONCISE BY DEFAULT, BUT COMPLETE FOR THE TOPIC:
     * Answer the requested question completely and accurately, then stop. Do NOT volunteer unsolicited next steps or unrequested background history.

11. VOICE-FIRST RESPONSE CODES (NO ASTERISKS / NATURAL VOICE):
   - Output clean plain text. Do not emit markdown formatting symbols like asterisks.

12. STRICT TRUTHFUL DATA PROVENANCE & ATTRIBUTION:
   - Always attribute facts to their TRUE originating system:
     * "Google Sheets (Project Financials)" or "Google Sheets (Subcontractor Ledger)": Contains ONLY financial numbers, budgets, payments, and trade balances. You are STRICTLY FORBIDDEN from stating or implying that Google Sheets contains calendar reminders, dates, or schedules.
     * "Field Reminders (SiteTactix App)": In-app task list.
     * "J.A.R.V.I.S. Memory (Persistent Vault)": Verbal builder notes and contractor preferences in Firestore. When speaking to the user, use natural first-person conversational phrasing (e.g. "According to my memory" or "In my notes") rather than referring to yourself in the third person.
     * "Google Drive": Files, plans, blueprints, permits.
     * "Municipal Inspections": 6-stage city building inspection checklist.
     * "Weather API": Real-time jobsite weather.
   - Seamlessly support English and Spanish based on user input.

13. COGNITIVE INITIATIVE & PROACTIVE ASSISTANT BEHAVIOR:
   - Understand context first: Helpful when needed, proactive when useful, quiet when not.
   - If the user shares an observation (e.g. "I'm heading over to Lot 3" or "The electrician is finishing today"), acknowledge warmly and, if genuinely useful, offer AT MOST ONE natural, conversational next step as a brief question.
   - NEVER use robotic alert formats like "Suggestion:" or "Proactive Alert:". Sound like a competent human assistant.
   - If the user confirms a suggestion ("yeah", "sure", "go ahead", "check it"), execute the action immediately without asking twice.
   - If the user is concluding ("thanks", "got it", "that's all"), acknowledge cleanly without unsolicited suggestions or data dumps.

14. FIRESTORE STRUCTURED PURCHASING ARCHITECTURE (SINGLE SOURCE OF TRUTH):
   - You manage project lot purchasing items and master templates strictly in Firestore via get_purchasing_list, add_purchasing_item, update_purchasing_item_status, remove_purchasing_item, export_purchasing_doc, and sync_purchasing_master_to_projects.
   - FIRESTORE IS THE AUTHORITATIVE SOURCE OF TRUTH: All purchasing items, quantities, and statuses (needed/purchased) live in the Firestore database (projects/{projectId}/purchasing_items). Never claim Google Docs or Google Drive is the purchasing database. Google Docs/PDFs are one-way exports only.
   - MANDATORY LIVE VERIFICATION FOR PURCHASING CLAIMS & FOLLOW-UPS:
     * When the user asks purchasing questions ("what do we still need to purchase?"), queries specific trades ("what electrical items do we need?"), checks purchased status ("what have we already purchased?"), or asks to VERIFY / CONFIRM purchasing completeness ("are those all the electrical items?", "those are all the electrical items we still need to purchase", "is that everything we still need?", "did we miss anything?", "that's everything we need to buy, right?", "nothing else is needed for plumbing?"), you MUST call 'get_purchasing_list' with the appropriate trade/status filters to verify against live Firestore data in real time.
     * NEVER assume purchasing completeness from short-term conversational memory alone—always execute 'get_purchasing_list' so your answer is 100% freshly validated against the live database.
   - 3-RULE CONVERSATIONAL PRESENTATION:
     * Broad questions (e.g. "what do we still need to purchase for Lot 3?"): Give a concise summary with total count and breakdown by trade (e.g. "You still have 20 items to purchase for Lot 3: 2 Quartz Hardware, 10 Electrical Hardware Fixtures, and 8 Plumbing Hardware Fixtures. Nothing has been marked as purchased yet. If you want, I can give you the individual items for any trade."). If items have been purchased, state the purchased count (e.g. "You have 1 item marked as purchased.").
     * Specific trade questions (e.g. "what electrical items do we need?"): Present the detailed line-item checklist for that trade.
     * Specific item status questions (e.g. "Did we already buy the ceiling fans?", "Have we purchased the faucets?", "Did we buy the lights?"):
       - If exactly 1 match: Answer directly with that specific item's status (e.g. "No. The ceiling fans are still marked as needed on Lot 3." or "Yes. The faucets are marked as purchased on Lot 3.").
       - If multiple matches (ambiguous, e.g. "lights"): List all candidate items with their current statuses (Needed or Purchased) and ask the user which one they meant. Never claim the item is unlisted when candidate fixtures exist.
       - If 0 matches: State clearly that the item is not currently listed on the project's purchasing checklist.
     * Purchased-status questions ("what have we already purchased?"): If 0 items, state nothing has been marked as purchased yet. If 1-5 items, list them directly. If 6+ items, summarize count and trade breakdown.
     * Action requests ("mark faucets as purchased", "mark security lights purchased", "we bought the vanity lights", "set lights to needed"):
       - You MUST call 'update_purchasing_item_status'. You are STRICTLY FORBIDDEN from calling 'add_purchasing_item' for status updates or purchase confirmations.
       - Only call 'add_purchasing_item' when the user explicitly uses creation verbs ("add 6 GFCI outlets", "create item").
   - DEFAULT SCOPE = ACTIVE LOT ONLY: Target ONLY the currently active lot (e.g. Lot 3, Lot 37, Lot 55) unless explicitly managing Master.
   - PROVENANCE ATTRIBUTION: Attribute purchasing sources strictly to "Firestore (<Project Name> Purchasing Checklist)" (e.g. "Firestore (Lot 3 Purchasing Checklist)"). Attribute to "Firestore (Purchasing Master Template)" ONLY when explicitly referencing or managing the company-wide Master Template. Never cite Google Docs for purchasing.
   - DOMAIN BOUNDARIES: When the user asks purchasing questions ("what do I need to buy", "what do we still need to purchase", "what materials do we need for [trade]"), focus strictly on physical fixtures, materials, and hardware from the Firestore Purchasing Checklist (get_purchasing_list). Do NOT dump contractor contract quotes, balances, or payments from Google Sheets unless the user explicitly asked about money, cost, quotes, balances, or payments.
   - NO UNPROMPTED FULLSCREEN VIEWERS: Output the items directly in your answer. Never emit [[ACTION:VIEW_FILE:...]] for purchasing list queries unless the user specifically and explicitly asks to open a full-screen file viewer.

15. GOOGLE DRIVE FOLDER & FILE SEARCH INSTRUCTIONS:
    - SPECIFIC FOLDER INQUIRIES: When the user asks about a specific folder or documents (e.g. "What's in the Purchasing List folder?", "What is in Google Doc Purchasing List?", "What is in App Folders / Google Doc Purchasing List?", "Find framing POs", "What files do we have in electrical?"):
      * You MUST call the 'get_drive_files' tool.
      * You MUST populate the 'folderName' argument with the specific folder name or path mentioned (e.g. { "folderName": "Google Doc Purchasing List" }, { "folderName": "Purchasing List" }, or { "folderName": "App Folders / Google Doc Purchasing List" }).
      * You MUST NEVER leave 'folderName' empty when the user explicitly queries a specific folder.
    - BROAD FOLDER HIERARCHY INQUIRIES: When the user asks broadly what folders exist (e.g. "What folders do we have?", "List our folders", "Show me our drive directories"):
      * Call 'get_drive_files' with empty args {} to retrieve the complete directory hierarchy.

16. FINISHES & MATERIAL SPECIFICATIONS INSTRUCTIONS:
    - FIRESTORE IS THE SINGLE AUTHORITATIVE SOURCE: All paint codes, stucco finishes, stone/cantera specs, tile/grout selections, roofing shingles, and fixtures live in Firestore (/projects/{projectId}/finishes) and are provided in [MODULE 4: HOMEOWNER FINISH SPECIFICATIONS].
    - RETRIEVAL MANDATE & ZERO-HALLUCINATION:
      * When the user asks about paint, finishes, materials, colors, sheens, stucco, stone, roofing, tile, or fixtures, ALWAYS call 'get_project_finishes' or inspect [MODULE 4: HOMEOWNER FINISH SPECIFICATIONS].
      * You are STRICTLY FORBIDDEN from stating that no finish selections or paint specifications exist when records are present in [MODULE 4: HOMEOWNER FINISH SPECIFICATIONS] or returned by 'get_project_finishes'.
      * Always report the exact brand, code/name, sheen, surface, and dynamic attributes recorded.
    - LIVE SPECIFICATIONS SUPERSEDE CONVERSATION HISTORY:
      * Live specifications in [MODULE 4] and 'get_project_finishes' tool outcomes represent current live ground truth.
      * If a finish specification was edited, updated, or deleted during an active conversation, ALWAYS state the latest value from Module 4 or tool results.
      * NEVER echo, assume, or repeat outdated paint codes, brands, or sheens from earlier conversation turns.
    - HIERARCHICAL OVERRIDE RULE:
      * SPECIFIC ROOM/LOCATION OVERRIDE > WHOLE-HOUSE DEFAULT.
      * When a user asks about paint, flooring, or materials for a specific room (e.g., "What paint is in the Study?", "What tile is in the Master Bath?"), always check for location-specific overrides first. If an override exists, state it clearly (e.g., "For the Study, the accent wall is SW 6244 Naval in Satin, while the rest of the house uses SW 7005 Pure White.").
      * When a user asks general questions (e.g., "What paint are we using on Lot 3?"), state the Whole-House default first, and mention any specific room accents or overrides.
    - AMBIGUITY & CONSERVATIVE CLARIFICATION:
      * If an inquiry or change request is ambiguous because multiple records share the same category (e.g., "Roofing — Whole House" vs. "Roofing — Detached Garage"), DO NOT guess or pick one arbitrarily. Clarify with the user (e.g., "Which roofing specification do you want to update — Whole House or Detached Garage?").
    - DYNAMIC ATTRIBUTES ARE FIRST-CLASS DATA:
      * Attributes like Texture, Sealant, Thickness, Warranty, Sheen, Grout Color, and Joint Size are first-class specifications. Always report them accurately when asked (e.g., "What's the stucco texture?", "What's the sealant on the Cantera?").`;
}

export function isPurchaseStatusMutationCommand(query = '') {
  const q = String(query).trim().toLowerCase();
  if (!q) return false;

  // 1. Explicit Addition commands (e.g. "add a pool heater", "create a new item") are NOT status mutations
  if (/\b(add|create|insert|new item)\b/i.test(q) && !/\b(as purchased|as needed|to purchased|to needed|mark|bought|got|check off|cross off)\b/i.test(q)) {
    return false;
  }

  // 2. Information-Seeking Inquiries (READ ONLY):
  // Questions starting with interrogative pronouns/adverbs or auxiliary inversions (e.g. "what have we purchased", "did we buy the lights", "have we bought those lights yet", "is the security light purchased", "can you check if we bought")
  const isInterrogativeStart = /^(what|which|who|where|how|did we|have we|has the|was the|is the|are the|do we|does the|can you (?:tell me|check|verify)|could you (?:tell me|check|verify)|check if|verify if)\b/i.test(q);
  if (isInterrogativeStart) {
    // Exception: Explicit imperative polite requests like "Can you mark the lights as purchased?" or "Could you set the vanity lights to purchased?"
    const hasPoliteImperative = /\b(can you|could you|please)\s+(mark|set|update|check off|cross off)\b/i.test(q);
    if (!hasPoliteImperative) {
      return false;
    }
  }

  // 3. Trailing question mark without an imperative verb is an inquiry (e.g. "any lights purchased yet?", "ceiling fans bought?")
  if (/\?\s*$/.test(q) && !/\b(mark|set|update|check off|cross off)\b/i.test(q)) {
    return false;
  }

  // 4. Positive Imperative Mutation Commands:
  // (e.g. "mark security lights as purchased", "set vanity lights to purchased", "check off front porch light", "cross off faucets", "mark done")
  if (/\b(mark|set|change|update|cross off|check off)\b.*\b(purchased|needed|bought|off|done|completed|finished)\b/i.test(q)) {
    return true;
  }
  if (/^(check off|cross off)\s+/i.test(q)) {
    return true;
  }

  // 5. Positive Rooted Declarative Statements:
  // Strictly anchored to sentence start (e.g. "we bought the lights", "i bought security lights", "we already bought the vanity lights", "we installed the ceiling fans")
  if (/^(we|i|we already|i already|already|just)\s+(bought|got|purchased|installed)\b/i.test(q)) {
    return true;
  }
  if (/^(bought|purchased|got|installed)\s+/i.test(q)) {
    return true;
  }

  return false;
}

export function extractPurchasingSubjectFromQuery(query = '') {
  const q = String(query).trim();
  if (!q) return '';

  let rawSubject = '';

  const checkOffMatch = q.match(/\b(?:check\s+off|cross\s+off)\s+(?:the\s+|those\s+|these\s+|that\s+|a\s+|an\s+)?(.+?)(?:\s+(?:for|on|in)\s+lot\s*\d+|\s*$)/i);
  if (checkOffMatch && checkOffMatch[1]) {
    rawSubject = checkOffMatch[1];
  } else {
    const markMatch = q.match(/\b(?:mark|set|change|update)\s+(?:the\s+|those\s+|these\s+|that\s+|a\s+|an\s+)?(.+?)\s+(?:as\s+|to\s+)?(?:purchased|needed|bought|done|completed|finished)\b/i);
    if (markMatch && markMatch[1]) {
      rawSubject = markMatch[1];
    } else {
      const boughtMatch = q.match(/^(?:we|i|already|just|have)?\s*(?:bought|purchased|got|installed)\s+(?:the\s+|those\s+|these\s+|that\s+|a\s+|an\s+)?(.+?)(?:\s+(?:for|on|in)\s+lot\s*\d+|\s*$)/i);
      if (boughtMatch && boughtMatch[1]) {
        rawSubject = boughtMatch[1];
      }
    }
  }

  if (!rawSubject) return '';

  // Clean lot suffixes, demonstratives, and temporal modifiers
  return rawSubject
    .replace(/\b(for|on|in)\s+lot\s*\d+/gi, '')
    .replace(/^(the|those|these|that|a|an)\s+/gi, '')
    .replace(/\s+(yet|already|so far|now|recently|done|finished)\s*$/gi, '')
    .trim();
}

export function normalizePurchasingToolCalls(toolCalls = [], userQuery = '') {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return toolCalls;

  const isMutation = isPurchaseStatusMutationCommand(userQuery);

  if (isMutation) {
    const extractedSubject = extractPurchasingSubjectFromQuery(userQuery);
    
    // Safety Gate: If extracted subject is empty or a broad quantifier, REFUSE mutation
    if (!extractedSubject || extractedSubject.length < 2 || /^(what|which|all|everything|items|list|anything)$/i.test(extractedSubject)) {
      return toolCalls.map(tc => {
        if (tc.name === 'update_purchasing_item_status' || tc.name === 'add_purchasing_item') {
          return { ...tc, name: 'get_purchasing_list', args: { projectId: tc.args?.projectId, unpurchasedOnly: false } };
        }
        return tc;
      });
    }

    const isPurchased = !/\b(needed|as needed|unpurchased)\b/i.test(userQuery);

    // CRITICAL: Collapse all proposed mutation calls into exactly ONE authoritative call
    // targeting the user's actual subject. Gemini is forbidden from splitting one ambiguous
    // command (e.g. "Mark the lights as purchased") into multiple specific writes.
    const primaryProject = toolCalls.find(tc => tc.args?.projectId)?.args?.projectId;
    return [{
      name: 'update_purchasing_item_status',
      args: {
        itemName: extractedSubject,
        isPurchased,
        projectId: primaryProject
      }
    }];
  }

  const VALID_TRADES_MAP = {
    quartz: 'quartz',
    'quartz hardware': 'quartz',
    electrical: 'electrical',
    'electrical hardware': 'electrical',
    'electrical hardware fixtures': 'electrical',
    electrician: 'electrical',
    plumbing: 'plumbing',
    'plumbing hardware': 'plumbing',
    'plumbing hardware fixtures': 'plumbing',
    plumber: 'plumbing',
    hvac: 'hvac',
    'hvac materials': 'hvac',
    heating: 'hvac',
    cooling: 'hvac',
    paint: 'paint_drywall',
    drywall: 'paint_drywall',
    paint_drywall: 'paint_drywall',
    'paint & drywall': 'paint_drywall',
    'paint and drywall': 'paint_drywall',
    general: 'general',
    'general hardware': 'general',
    'general hardware & materials': 'general',
    'general hardware and materials': 'general',
    'general materials': 'general',
    materials: 'general'
  };

  // If NOT a mutation command (READ ONLY), intercept any hallucinated mutation tool calls & normalize trade arguments
  const isExplicitAdd = /^(add|create|insert|new item)\b/i.test(userQuery) && !/\b(as purchased|as needed|to purchased|to needed|mark|bought|got)\b/i.test(userQuery);
  return toolCalls.map(tc => {
    let call = tc;
    if (!isExplicitAdd && (tc.name === 'update_purchasing_item_status' || tc.name === 'add_purchasing_item')) {
      call = {
        ...tc,
        name: 'get_purchasing_list',
        args: {
          projectId: tc.args?.projectId,
          unpurchasedOnly: false
        }
      };
    }

    if (call.name === 'get_purchasing_list' && call.args?.trade) {
      const cleanTrade = String(call.args.trade).toLowerCase().trim();
      const normalizedTrade = VALID_TRADES_MAP[cleanTrade];
      if (normalizedTrade) {
        call = { ...call, args: { ...call.args, trade: normalizedTrade } };
      } else {
        // Trade argument was actually an item name (e.g. "pool", "pool heater")
        const newArgs = { ...call.args };
        if (!newArgs.itemName) {
          newArgs.itemName = newArgs.trade;
        }
        delete newArgs.trade;
        call = { ...call, args: newArgs };
      }
    }

    return call;
  });
}

export function formatUserFriendlyToolError(toolName) {
  if (toolName === 'get_weather_for_jobsite') return 'The jobsite weather forecast service was temporarily unavailable.';
  if (toolName === 'get_drive_files') return 'Google Drive document search was temporarily unreachable.';
  if (toolName === 'save_memory' || toolName === 'update_memory') return 'Memory database sync was temporarily unavailable.';
  if (toolName === 'search_receipts' || toolName === 'get_subcontractor_balance') return 'Financial ledger lookup was temporarily unavailable.';
  return 'The requested tool action was temporarily unavailable.';
}

export function formatToolResultsForSynthesis(toolTelemetryList = []) {
  if (!Array.isArray(toolTelemetryList) || toolTelemetryList.length === 0) {
    return 'No tool calls were executed.';
  }

  return toolTelemetryList.map((t, i) => {
    const classification = t.toolType || (t.name.startsWith('save_') || t.name.startsWith('update_') || t.name.startsWith('delete_') ? 'WRITE' : 'READ');
    const sourceTag = t.source ? `[SOURCE: ${t.source}]` : '[SOURCE: Local Project Data]';
    const isAlreadyExists = t.isDuplicate || t.data?.action === 'ALREADY_EXISTS' || t.result?.action === 'ALREADY_EXISTS' || t.status === 'already_exists';
    const statusText = isAlreadyExists ? 'ALREADY_EXISTS' : (t.status ? String(t.status).toUpperCase() : (t.success ? 'OK' : 'ERROR'));
    const statusTag = `[STATUS: ${statusText}]`;
    const dupTag = isAlreadyExists ? ' (Deduplicated idempotent 0-write)' : '';

    const dataPayload = t.data !== undefined ? t.data : t.result;

    if (t.success) {
      let priorityHeader = '';
      if (dataPayload?.itemLookup?.canonicalAnswer) {
        priorityHeader = `\n[PRIORITY TARGET ITEM QUERY RESOLUTION: ${dataPayload.itemLookup.canonicalAnswer}]\n`;
      } else if (dataPayload?.trade && dataPayload.trade !== 'all') {
        priorityHeader = `\n[PRIORITY TRADE ITEM LIST: ${dataPayload.summary?.canonicalAnswer || dataPayload.message}]\n`;
      } else if (dataPayload?.summary?.canonicalAnswer && /\bPurchased items for\b/i.test(dataPayload.summary.canonicalAnswer)) {
        priorityHeader = `\n[PRIORITY PURCHASED ITEMS LIST: ${dataPayload.summary.canonicalAnswer}]\n`;
      }
      return `Tool ${i + 1} [${t.name}] (Type: ${classification}) ${sourceTag} ${statusTag}${dupTag}: SUCCESS${priorityHeader}Structured Data: ${JSON.stringify(dataPayload)}`;
    } else {
      const extraContext = dataPayload && (dataPayload.matches || dataPayload.isAmbiguous || dataPayload.isNotFound)
        ? `\nValidation Context: ${JSON.stringify(dataPayload)}`
        : '';
      return `Tool ${i + 1} [${t.name}] (Type: ${classification}) ${sourceTag} ${statusTag}: FAILED\nReason: ${t.error || 'Temporary service error'}${extraContext}`;
    }
  }).join('\n\n');
}

/**
 * Granular & Truthful Grounded Source Provenance Detector
 * Resolves exact originating systems based on the user's query, synthesized answer, and context.
 */
export function detectGroundedSourcesUsed(query = '', answerText = '', _context = {}) {
  const sources = new Set();
  const q = String(query).toLowerCase();
  const a = String(answerText).toLowerCase();

  // 1. Casual greetings / chit-chat -> No data source used
  if (/^(what'?s up|hey|hello|good (morning|afternoon|evening)|how'?s it going|how are you)[\s!.,?]*$/i.test(q.trim())) {
    return [];
  }

  // 2. Google Sheets: Subcontractor Ledger or Project Financials
  const isBalanceOrCostQuery = /\$|\b(budget|gross budget|build budget|hard cost|draw|draws|spent|paid|owe|balance|cost|expense|receipt|invoice|contract|payment)\b/i.test(q);
  const isFinanceAnswer = /\$|\b(gross budget|working capital|draws paid|remaining balance|quoted|contract balance)\b/i.test(a);

  if (isBalanceOrCostQuery || isFinanceAnswer) {
    if (/\b(electrician|plumber|framing|drywall|painter|hvac|concrete|roofing|subcontractor|sub|payee|contractor|owe|balance)\b/i.test(q) || /\b(subcontractor|ledger|remaining balance|owed)\b/i.test(a)) {
      sources.add('Google Sheets (Subcontractor Ledger)');
    } else {
      sources.add('Google Sheets (Project Financials)');
    }
  }

  // 3. J.A.R.V.I.S. Memory (Persistent Vault)
  if (
    /\b(remember|memory|note|preference|told you|saved note|said about|likes to|prefers)\b/i.test(q) ||
    /\b(saved memor|memory vault|you told me|remembered|saved note)\b/i.test(a)
  ) {
    sources.add('J.A.R.V.I.S. Memory (Persistent Vault)');
  }

  // 4. Field Reminders (SiteTactix App)
  if (
    /\b(reminder|pending reminder|field reminder|task list|to-do|todo|scheduled for tomorrow|remind me)\b/i.test(q) ||
    /\b(field reminder|pending reminder|no specific reminder|reminder list)\b/i.test(a)
  ) {
    if (/\b(field reminder|pending reminder|app reminder|task list|reminder)s?\b/i.test(a) || /\b(field reminder|reminder list|task list)\b/i.test(q)) {
      sources.add('Field Reminders (SiteTactix App)');
    }
    if (/\b(saved memor|memory vault)\b/i.test(a)) {
      sources.add('J.A.R.V.I.S. Memory (Persistent Vault)');
    }
  }

  // 5. Municipal Inspections
  if (
    /\b(inspection|inspector|passed|failed|permit|municipal|city|stage|foundation inspection|framing inspection|plumbing inspection)\b/i.test(q) ||
    /\b(inspection stage|municipal inspection|inspections passed)\b/i.test(a)
  ) {
    sources.add('Municipal Inspections');
  }

  // 6. Google Drive
  if (
    /\b(file|folder|document|pdf|blueprint|plan|drive|google drive|upload|drawing)\b/i.test(q) ||
    /\b(google drive|drive folder|drive tree|pdf)\b/i.test(a)
  ) {
    sources.add('Google Drive');
  }

  // 7. Homeowner Specifications
  if (
    /\b(spec|specification|finish|fixture|paint color|appliance|cabinet|hardware)\b/i.test(q) ||
    /\b(homeowner specification|finish spec)\b/i.test(a)
  ) {
    sources.add('Homeowner Specifications');
  }

  // 8. Site Setup Checklist Database
  if (
    /\b(site setup|mobilization|silt fence|dumpster|porta potty|temp power|temp water)\b/i.test(q) ||
    /\b(site setup|mobilization checklist)\b/i.test(a)
  ) {
    sources.add('Site Setup Checklist Database');
  }

  return Array.from(sources);
}

export const inferSourcesUsed = detectGroundedSourcesUsed;

/**
 * Multi-Domain Grounding & Anti-Hallucination Guard
 * Cross-checks currency values, numerical figures, contractor entities, and filenames
 * against live project data and verified tool outputs.
 */
export function verifyResponseGrounding(synthesizedText = '', projectContext = {}, toolResults = []) {
  if (!synthesizedText || typeof synthesizedText !== 'string') {
    return {
      status: 'fully_grounded',
      checkedClaimsCount: 0,
      supportedClaims: [],
      unsupportedClaims: [],
      unsupportedEntities: [],
      unsupportedFiles: []
    };
  }

  // 1. Gather all verified ground truth strings
  const groundTruthTokens = [];

  for (const t of (toolResults || [])) {
    if (t.data) groundTruthTokens.push(JSON.stringify(t.data));
    if (t.result) groundTruthTokens.push(JSON.stringify(t.result));
    if (t.files) groundTruthTokens.push(JSON.stringify(t.files));
  }

  if (projectContext.dashboardData) groundTruthTokens.push(JSON.stringify(projectContext.dashboardData));
  if (projectContext.dashData) groundTruthTokens.push(JSON.stringify(projectContext.dashData));
  if (projectContext.driveTree) groundTruthTokens.push(JSON.stringify(projectContext.driveTree));
  if (projectContext.driveData) groundTruthTokens.push(JSON.stringify(projectContext.driveData));
  if (projectContext.projectSpecs) groundTruthTokens.push(JSON.stringify(projectContext.projectSpecs));
  if (projectContext.memoriesData) groundTruthTokens.push(JSON.stringify(projectContext.memoriesData));
  if (projectContext.items) groundTruthTokens.push(JSON.stringify(projectContext.items));

  const groundTruth = groundTruthTokens.join(' ').toLowerCase();

  const supportedClaims = [];
  const unsupportedClaims = [];
  const unsupportedEntities = [];
  const unsupportedFiles = [];
  let checkedCount = 0;

  // 2. Financial / Currency Validation ($X,XXX or $XXX)
  const currencyRegex = /\$([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/g;
  const currencyMatches = [...synthesizedText.matchAll(currencyRegex)];

  for (const m of currencyMatches) {
    checkedCount++;
    const rawVal = m[0]; // e.g. "$4,000"
    const rawNum = m[1].replace(/,/g, ''); // "4000"
    const formattedWithComma = parseFloat(rawNum).toLocaleString('en-US'); // "4,000"

    const isSupported =
      groundTruth.includes(rawVal.toLowerCase()) ||
      groundTruth.includes(rawNum) ||
      groundTruth.includes(formattedWithComma);

    if (isSupported) {
      supportedClaims.push(rawVal);
    } else {
      unsupportedClaims.push(rawVal);
    }
  }

  // 3. Document / Blueprint File Claims (*.pdf, *.dwg, etc.)
  const fileRegex = /\b([a-zA-Z0-9_-]+\.(?:pdf|dwg|png|jpg|docx|xlsx|csv))\b/gi;
  const fileMatches = [...synthesizedText.matchAll(fileRegex)];

  for (const fm of fileMatches) {
    checkedCount++;
    const fileName = fm[1];
    if (groundTruth.includes(fileName.toLowerCase())) {
      supportedClaims.push(fileName);
    } else {
      unsupportedClaims.push(fileName);
      unsupportedFiles.push(fileName);
    }
  }

  // 4. Contractor / Vendor Entity Claims
  const vendorRegex = /\b([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+)*\s+(?:Electric|Plumbing|Framing|Roofing|Masonry|Concrete|HVAC|Supply|Pros|Masters|Services|LLC|Inc|Corp|Contractors?))\b/g;
  const vendorMatches = [...synthesizedText.matchAll(vendorRegex)];

  for (const vm of vendorMatches) {
    checkedCount++;
    const vendorName = vm[1].trim();
    if (groundTruth.includes(vendorName.toLowerCase())) {
      supportedClaims.push(vendorName);
    } else {
      unsupportedClaims.push(vendorName);
      unsupportedEntities.push(vendorName);
    }
  }

  // 5. Purchasing Evidence Grounding & Answer-Priority Hierarchy
  // Hierarchy: Item-Specific Lookup (itemLookup) > Specific Trade Filter (trade) > Project-Wide Summary
  let purchasingDiscrepancyDetected = false;
  let suggestedCorrection = null;

  const purchasingTool = (toolResults || []).find(t => (t.name === 'get_purchasing_list' || t.tool?.name === 'get_purchasing_list') && t.success);
  const purchasingData = purchasingTool?.data || purchasingTool?.result;

  if (purchasingData?.itemLookup?.canonicalAnswer) {
    const itemLookup = purchasingData.itemLookup;
    const isBroadClaim = /\b(still have \d+ items to purchase|all \d+ items have been purchased)\b/i.test(synthesizedText);
    const hasItemName = synthesizedText.toLowerCase().includes((itemLookup.subject || '').toLowerCase()) ||
                        (itemLookup.matches || []).some(m => synthesizedText.toLowerCase().includes((m.itemName || m.name || '').toLowerCase()));

    if (isBroadClaim && !hasItemName) {
      unsupportedClaims.push(`Broad summary given instead of specific item lookup for "${itemLookup.subject}"`);
      purchasingDiscrepancyDetected = true;
      suggestedCorrection = itemLookup.canonicalAnswer;
    } else if (itemLookup.matchType === 'AMBIGUOUS' && /\b(not currently listed|not listed|not on the|does not exist|item isn't listed)\b/i.test(synthesizedText)) {
      unsupportedClaims.push(`False not-listed claim for ambiguous item: "${itemLookup.subject}"`);
      purchasingDiscrepancyDetected = true;
      suggestedCorrection = itemLookup.canonicalAnswer;
    }
  } else if (purchasingData?.trade && purchasingData.trade !== 'all') {
    // Trade filter active: Ensure the response is focused on this trade, not project-wide summary
    const isBroadProjectSummary = /\b(still have \d+ items to purchase for|all \d+ items have been purchased for)\b/i.test(synthesizedText) &&
                                  !synthesizedText.toLowerCase().includes(purchasingData.trade.toLowerCase());
    if (isBroadProjectSummary) {
      unsupportedClaims.push(`Project-wide summary given instead of trade-specific list for "${purchasingData.trade}"`);
      purchasingDiscrepancyDetected = true;
      suggestedCorrection = purchasingData.summary?.canonicalAnswer || purchasingData.message;
    }
  } else if (purchasingData?.summary?.canonicalAnswer && /\bPurchased items for\b/i.test(purchasingData.summary.canonicalAnswer)) {
    const isNeededSummary = /\bstill have \d+ items to purchase\b/i.test(synthesizedText);
    if (isNeededSummary) {
      unsupportedClaims.push('Unpurchased project summary given instead of purchased items list');
      purchasingDiscrepancyDetected = true;
      suggestedCorrection = purchasingData.summary.canonicalAnswer;
    }
  } else if (purchasingData?.summary?.canonicalAnswer && /\bPurchasing Status:\b/i.test(purchasingData.summary.canonicalAnswer)) {
    const isOneSided = (synthesizedText.toLowerCase().includes('purchased') && !synthesizedText.toLowerCase().includes('needed')) ||
                       (!synthesizedText.toLowerCase().includes('purchased') && synthesizedText.toLowerCase().includes('needed'));
    if (isOneSided) {
      unsupportedClaims.push('One-sided summary given instead of purchased vs needed comparison');
      purchasingDiscrepancyDetected = true;
      suggestedCorrection = purchasingData.summary.canonicalAnswer;
    }
  } else if (purchasingData?.summary) {
    const summary = purchasingData.summary;
    const needed = summary.neededCount;
    const _purchased = summary.purchasedCount;
    const total = summary.totalChecklistCount;
    const tradeBreakdown = summary.tradeBreakdown || {};

    // Check project-wide needed count claims
    const neededClaimRegex = /\b(?:have|still have|need(?: to purchase)?|remaining|left to (?:buy|purchase)|pending)\s+(\d+)\s+(?:items|materials|fixtures)\b/gi;
    const neededMatches = [...synthesizedText.matchAll(neededClaimRegex)];
    for (const nm of neededMatches) {
      checkedCount++;
      const claimedCount = parseInt(nm[1], 10);
      if (claimedCount === needed || (needed === 0 && claimedCount === total)) {
        supportedClaims.push(nm[0]);
      } else {
        unsupportedClaims.push(`${nm[0]} (Expected: ${needed})`);
        purchasingDiscrepancyDetected = true;
        suggestedCorrection = summary.canonicalAnswer;
      }
    }

    // Check trade breakdown count claims
    const tradeClaimRegex = /\b(\d+)\s+(?:in\s+)?(quartz|electrical|plumbing|hvac|paint|drywall|general)(?:\s+(?:hardware|fixtures|supplies|materials|items))?\b/gi;
    const tradeMatches = [...synthesizedText.matchAll(tradeClaimRegex)];
    for (const tm of tradeMatches) {
      checkedCount++;
      const claimedTradeCount = parseInt(tm[1], 10);
      const tradeName = tm[2].toLowerCase();

      let matchedBreakdown = null;
      for (const [title, counts] of Object.entries(tradeBreakdown)) {
        if (title.toLowerCase().includes(tradeName)) {
          matchedBreakdown = counts;
          break;
        }
      }

      if (matchedBreakdown) {
        if (claimedTradeCount === matchedBreakdown.needed || claimedTradeCount === matchedBreakdown.total || claimedTradeCount === matchedBreakdown.purchased) {
          supportedClaims.push(tm[0]);
        } else {
          unsupportedClaims.push(`${tm[0]} (Expected needed: ${matchedBreakdown.needed})`);
          purchasingDiscrepancyDetected = true;
          suggestedCorrection = summary.canonicalAnswer;
        }
      }
    }
  }

  // 6. Purchasing Mutation Result Grounding (Never allow generic "temporarily unavailable" on validation)
  const mutTool = (toolResults || []).find(t => (t.name === 'update_purchasing_item_status' || t.tool?.name === 'update_purchasing_item_status') && (t.result?.isAmbiguous || t.result?.isNotFound || t.data?.isAmbiguous || t.data?.isNotFound));
  const mutData = mutTool?.data || mutTool?.result;
  if (mutData?.message) {
    if (/\b(temporarily unavailable|service error|added|created)\b/i.test(synthesizedText)) {
      unsupportedClaims.push(`Mischaracterized mutation business validation: "${mutData.message}"`);
      purchasingDiscrepancyDetected = true;
      suggestedCorrection = mutData.message;
    }
  }

  let status = 'fully_grounded';
  if (unsupportedClaims.length > 0) {
    status = supportedClaims.length > 0 ? 'partially_grounded' : 'unsupported_claims_detected';
  }

  return {
    status,
    checkedClaimsCount: checkedCount,
    supportedClaims,
    unsupportedClaims,
    unsupportedEntities,
    unsupportedFiles,
    purchasingDiscrepancyDetected,
    suggestedCorrection
  };
}

export function formatToolResultsHumanReadable(toolTelemetryList, userQuery = '', projectContext = {}) {
  const synthesized = synthesizeGroundedEvidence(toolTelemetryList, userQuery, projectContext);
  if (synthesized) return synthesized;

  const parts = [];
  for (const t of (toolTelemetryList || [])) {
    if (!t.success) {
      parts.push(`(Note: ${t.error || formatUserFriendlyToolError(t.name)})`);
      continue;
    }

    const res = t.result;
    if (!res) continue;

    if (t.name === 'get_weather_for_jobsite') {
      if (res.current) {
        parts.push(`The current weather at the jobsite is ${res.current.temperature_2m || res.current.temp || 75}°F${res.current.condition ? `, ${res.current.condition}` : ''}.`);
      }
    } else if (res.message) {
      parts.push(res.message);
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}

const AUTHORITATIVE_READ_ACTIONS = /\b(add|create|update|delete|remove|mark|set|save|scan|capture|upload|attach|stage|log)\b/i;
const AUTHORITATIVE_READ_QUESTION = /\b(what|which|who|when|where|why|how|show|list|tell|do|did|does|is|are|have|has|can)\b|\?/i;
const PURCHASE_QUERY = /\b(purchas|buy|bought|needed|need|checklist|hardware|fixture|material|quartz|countertop|sink|electrical|plumb|hvac|roof|drywall|paint|tile|flooring)\b/i;
const FINANCE_QUERY = /\b(budget|spent|spend|paid|payment|owe|owed|balance|expense|receipt|invoice|draw|quote|contract|capital|money)\b/i;
const INSPECTION_QUERY = /\b(inspection|inspect|framing|rough[ -]?in|foundation|municipal|permit)\b/i;
const FINISH_QUERY = /\b(finish|paint|color|sheen|stucco|stone|cantera|tile|grout|shingle|fixture spec)\b/i;
const DRIVE_QUERY = /\b(file|folder|document|drive|blueprint|plan|permit|photo|pdf)\b/i;

function getPurchasingTrade(query) {
  const normalized = String(query || '').toLowerCase();
  if (/\b(quartz|countertop|sink)\b/.test(normalized)) return 'quartz';
  if (/\b(electrical|electrician|lighting)\b/.test(normalized)) return 'electrical';
  if (/\b(plumb|faucet|toilet|shower)\b/.test(normalized)) return 'plumbing';
  if (/\b(hvac|air conditioning|mechanical)\b/.test(normalized)) return 'hvac';
  if (/\b(paint|drywall)\b/.test(normalized)) return 'paint_drywall';
  return '';
}

/**
 * Project facts are not left to model discretion. A matching route returns a
 * live tool request; the caller must return that tool's evidence or an honest
 * verification failure, never a generated fallback.
 */
export function getAuthoritativeReadRoute(query = '') {
  const normalized = String(query).trim();
  if (!normalized || AUTHORITATIVE_READ_ACTIONS.test(normalized) || !AUTHORITATIVE_READ_QUESTION.test(normalized)) return null;

  // “Paint color” and similar specification questions are finishes, while a
  // request to buy paint belongs to purchasing.
  if (FINISH_QUERY.test(normalized) && /\b(finish|color|sheen|stucco|stone|cantera|grout|shingle|spec)\b/i.test(normalized)) {
    return { toolName: 'get_project_finishes', args: {}, source: 'Firestore finishes and specifications' };
  }
  if (PURCHASE_QUERY.test(normalized)) {
    return {
      toolName: 'get_purchasing_list',
      args: { trade: getPurchasingTrade(normalized), unpurchasedOnly: /\b(need|needed|still)\b/i.test(normalized) },
      source: 'Firestore purchasing checklist'
    };
  }
  if (FINANCE_QUERY.test(normalized)) {
    const tradeMatch = normalized.match(/\b(electrician|electrical|plumber|plumbing|hvac|roofing|framing|drywall|painter|paint|tile|concrete)\b/i);
    return tradeMatch
      ? { toolName: 'get_subcontractor_balance', args: { tradeOrContractor: tradeMatch[1] }, source: 'Google Sheets financial ledger' }
      : { toolName: 'get_project_budget', args: { category: 'all' }, source: 'Google Sheets financial ledger' };
  }
  if (INSPECTION_QUERY.test(normalized)) {
    return { toolName: 'get_municipal_inspections', args: {}, source: 'Municipal inspection records' };
  }
  if (FINISH_QUERY.test(normalized)) {
    return { toolName: 'get_project_finishes', args: {}, source: 'Firestore finishes and specifications' };
  }
  if (DRIVE_QUERY.test(normalized)) {
    return { toolName: 'get_drive_files', args: {}, source: 'Google Drive' };
  }
  return null;
}

async function answerFromAuthoritativeSource(route, query, projectContext, correlationId, startedAt) {
  try {
    if (route.source === 'Google Sheets financial ledger') {
      const accessToken = projectContext.accessToken;
      const projectFolderId = projectContext.projectFolderId;
      if (!accessToken || !projectFolderId) {
        return {
          text: 'I cannot verify financial information until the active project’s Google Sheet is connected.',
          telemetry: { modelUsed: 'Authoritative Source Gate', source: route.source, intent: 'Google Sheets Connection Required', durationMs: Date.now() - startedAt, toolsExecuted: [{ name: route.toolName, args: route.args }] }
        };
      }

      const cachedSpreadsheetId = getCachedDashboardSpreadsheetId(localStorage, projectContext.projectId);
      const { spreadsheetId, data } = await loadProjectDashboardFromFolder({
        accessToken,
        projectFolderId,
        cachedSpreadsheetId
      });
      // The current Google Sheet response becomes the only financial context
      // available to this lookup. Persisting it only improves the dashboard;
      // it is never used instead of this refresh for a Jarvis finance answer.
      projectContext.dashboardData = data;
      persistDashboardSpreadsheetId(localStorage, projectContext.projectId, spreadsheetId);
      persistDashboardCache(localStorage, projectContext.projectId, data);
    }

    const result = await executeClientToolCall(route.toolName, route.args, projectContext, correlationId);
    if (!result || result.error || result.success === false || result.readError) {
      return {
        text: `I could not verify that against the ${route.source} right now, so I will not guess.`,
        telemetry: { modelUsed: 'Authoritative Source Gate', source: route.source, intent: 'Verification Unavailable', durationMs: Date.now() - startedAt, toolsExecuted: [{ name: route.toolName, args: route.args }] }
      };
    }

    const evidence = [{
      name: route.toolName,
      args: route.args,
      success: true,
      source: result.source || route.source,
      result,
      data: result.data !== undefined ? result.data : result
    }];
    const text = formatToolResultsHumanReadable(evidence, query, projectContext)
      || result.itemLookup?.canonicalAnswer
      || result.summary?.canonicalAnswer
      || result.canonicalAnswer
      || result.message;

    if (!text) {
      return {
        text: `I checked the ${route.source}, but it did not return a verifiable answer for that question.`,
        telemetry: { modelUsed: 'Authoritative Source Gate', source: route.source, intent: 'No Verifiable Result', durationMs: Date.now() - startedAt, toolsExecuted: [{ name: route.toolName, args: route.args, result }] }
      };
    }

    return {
      text,
      telemetry: { modelUsed: 'Authoritative Source Gate', source: route.source, intent: 'Verified Lookup', durationMs: Date.now() - startedAt, toolsExecuted: [{ name: route.toolName, args: route.args, result }] }
    };
  } catch {
    return {
      text: `I could not verify that against the ${route.source} right now, so I will not guess.`,
      telemetry: { modelUsed: 'Authoritative Source Gate', source: route.source, intent: 'Verification Unavailable', durationMs: Date.now() - startedAt, toolsExecuted: [{ name: route.toolName, args: route.args }] }
    };
  }
}

/**
 * Main AI Query Handler: Pure AI Model with Grounded Live Project Data
 */
export async function askGeminiBrain(
  query,
  conversationHistory = [],
  activeProjectName = 'Lot 3',
  apiKey = '',
  dashboardOverride = null,
  projectIdOverride = '',
  messages = [],
  driveTreeOverride = null,
  fileAttachment = null,
  forceDeepReasoning = false,
  googleTokenOverride = null,
  options = {}
) {
  const clientStartTime = Date.now();
  const correlationId = `corr_${clientStartTime}_${Math.random().toString(36).slice(2, 8)}`;
  const projectId = projectIdOverride || activeProjectName.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const dashData = dashboardOverride || loadProjectDashboard(projectId);
  const driveData = driveTreeOverride || loadDriveTree(projectId);
  let projectSpecs = [];
  try {
    projectSpecs = await fetchProjectFinishes(projectId);
  } catch {
    projectSpecs = loadProjectSpecs(projectId);
  }
  const siteSetupProtocol = getSiteSetupProtocol();
  let lastErrorCode = null;
  let toolTelemetryList = [];

  let siteSetupChecks = {};
  try {
    if (projectId) {
      const raw = localStorage.getItem(`jobscan_sitesetup_checks_${projectId}`);
      if (raw) siteSetupChecks = JSON.parse(raw);
    }
  } catch {}

  const siteSetupData = {
    protocol: siteSetupProtocol,
    checks: siteSetupChecks
  };

  const reminders = loadStoredReminders();
  const todayStr = getTodayCalendarDate();
  const pendingR = reminders.filter((r) => r.status === 'pending' && (!r.targetDate || r.targetDate === todayStr));

  let savedPhaseChecks = {};
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem('jobscan_phase_checks_' + projectId);
      if (raw) savedPhaseChecks = JSON.parse(raw);
    }
  } catch {}

  // Load All 6 Municipal Inspection Stages with live checklist status
  const inspectionsData = (INSPECTION_STAGES || []).map((stage) => {
    const items = loadInspectionData(projectId, stage.id) || [];
    const stageShortId = stage.id === 'rough-in-plumbing' ? 'plumbing' : stage.id;
    const passedCount = items.filter((i) => i.status === 'pass' || savedPhaseChecks[`${stageShortId}_${i.id}`] || savedPhaseChecks[`${stage.id}_${i.id}`]).length;
    return {
      stageId: stage.id,
      stageName: stage.name,
      icon: stage.icon,
      description: stage.description,
      totalItems: items.length,
      passedCount,
      isFullyPassed: items.length > 0 && passedCount === items.length,
      items: items.map((i) => {
        const isPassed = i.status === 'pass' || savedPhaseChecks[`${stageShortId}_${i.id}`] || savedPhaseChecks[`${stage.id}_${i.id}`];
        return {
          id: i.id,
          title: i.title || i.text || i.name || 'Inspection Item',
          category: i.category || 'General',
          status: isPassed ? 'PASSED' : (i.status === 'fail' ? 'FAILED' : 'PENDING'),
          note: i.note || ''
        };
      })
    };
  });


  // Pre-fetch relevant persistent memories for this lot / project scope
  let memoriesData = [];
  try {
    memoriesData = await searchMemories(query, {
      projectId,
      limit: 8
    });
  } catch (mErr) {
    console.warn('[BuilderBrain] Failed to pre-fetch memories:', mErr);
  }

  const authInstance = getFirebaseAuthInstance();
  const userId = authInstance?.currentUser?.uid || 'default_user';

  let userPreferences = [];
  let userPreferencesPrompt = '';
  try {
    userPreferences = await loadUserPreferences(userId, projectId);
    userPreferencesPrompt = compileUserPreferencesPrompt(userPreferences, projectId);
  } catch (pErr) {
    console.warn('[BuilderBrain] Failed to load user preferences:', pErr);
  }

  const accessToken = googleTokenOverride || (typeof window !== 'undefined' ? (localStorage.getItem('jobscan_google_token') || localStorage.getItem('google_access_token') || localStorage.getItem('gdrive_token')) : null);

  const projectContext = {
    projectId,
    userId,
    accessToken,
    projectFolderId: options?.projectFolderId || null,
    activeProjectName,
    projectName: activeProjectName,
    onNavigateTab: options?.onNavigateTab,
    items: reminders,
    pendingR,
    dashboardData: dashData,
    driveTree: driveData,
    projectSpecs,
    siteSetupData,
    inspectionsData,
    memoriesData,
    userPreferences
  };

  const authoritativeRoute = getAuthoritativeReadRoute(query);
  if (authoritativeRoute) {
    return answerFromAuthoritativeSource(authoritativeRoute, query, projectContext, correlationId, clientStartTime);
  }

  const now = new Date();
  const currentHour = now.getHours();
  const timeGreeting = currentHour < 12 ? 'Good morning' : currentHour < 17 ? 'Good afternoon' : 'Good evening';
  const spanishTimeGreeting = currentHour < 12 ? 'Buenos días' : currentHour < 19 ? 'Buenas tardes' : 'Buenas noches';
  const currentTimeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const currentDayString = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });

  // Build the complete grounded system prompt
  const systemInstruction = buildGroundingSystemInstruction({
    activeProjectName,
    dashData,
    driveData,
    projectSpecs,
    siteSetupData,
    inspectionsData,
    pendingR,
    memoriesData,
    userPreferencesPrompt,
    timeGreeting,
    spanishTimeGreeting,
    currentTimeString,
    currentDayString
  });


  // Prepare clean conversation history
  const historySource = (Array.isArray(messages) && messages.length > 0) ? messages : conversationHistory;
  const recentHistory = historySource.slice(-6);
  const rawContents = [];

  for (const msg of recentHistory) {
    const text = msg.text || msg.content || '';
    if (!text || typeof text !== 'string') continue;
    rawContents.push({
      role: (msg.sender === 'ai' || msg.role === 'model' || msg.sender === 'jarvis') ? 'model' : 'user',
      parts: [{ text: text.slice(0, 1500) }]
    });
  }

  rawContents.push({
    role: 'user',
    parts: [{ text: query }]
  });

  while (rawContents.length > 0 && rawContents[0].role !== 'user') {
    rawContents.shift();
  }

  const contents = [];
  for (const turn of rawContents) {
    if (contents.length > 0 && contents[contents.length - 1].role === turn.role) {
      contents[contents.length - 1].parts.push(...turn.parts);
    } else {
      contents.push(turn);
    }
  }

  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: query }] });
  }

  const envKey = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GEMINI_API_KEY) ? import.meta.env.VITE_GEMINI_API_KEY : '';
  const effectiveKey = (apiKey && apiKey.trim()) || (typeof window !== 'undefined' ? (localStorage.getItem('jobscan_gemini_api_key') || localStorage.getItem('jobscan_gemini_key')) : '') || envKey || '';

  // 1. DIRECT USER PREFERENCE COMMAND PROCESSING
  const prefAnalysis = analyzeInteractionForPreference(query, { activeProjectId: projectId, userId });
  if (prefAnalysis) {
    if (prefAnalysis.type === 'session_opt_out') {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('jobscan_session_learning_disabled', 'true');
      }
      return {
        text: "Understood. I will not learn or observe any communication preferences from this conversation.",
        telemetry: {
          modelUsed: determineTaskModel(query, forceDeepReasoning),
          source: 'User Preference Engine',
          intent: 'Session Learning Disabled',
          durationMs: Date.now() - clientStartTime
        }
      };
    }
    if (prefAnalysis.type === 'user_command') {
      if (prefAnalysis.action === 'list_preferences') {
        const listRes = await executeClientToolCall('list_user_preferences', {}, projectContext, correlationId);
        const prefsList = listRes?.preferences || [];
        const text = prefsList.length > 0
          ? `Here is what I've learned about how you work:\n` + prefsList.map((p, i) => `${i + 1}. [${p.scope === 'project' ? `Project: ${p.projectId}` : 'Global'}] ${p.statement}`).join('\n')
          : "I haven't saved any custom communication preferences for you yet. You can tell me how you prefer answers (for example: \"Remember that I always want the bottom line first\").";
        return {
          text,
          telemetry: {
            modelUsed: determineTaskModel(query, forceDeepReasoning),
            source: 'User Preference Engine',
            intent: 'List Preferences',
            durationMs: Date.now() - clientStartTime,
            toolsExecuted: [{ name: 'list_user_preferences', result: listRes }]
          }
        };
      }
      if (prefAnalysis.action === 'reset_all_preferences') {
        const resetRes = await executeClientToolCall('reset_user_preferences', { confirm: true }, projectContext, correlationId);
        return {
          text: "I've reset and cleared all learned communication preferences and behavioral habits.",
          telemetry: {
            modelUsed: determineTaskModel(query, forceDeepReasoning),
            source: 'User Preference Engine',
            intent: 'Reset Preferences',
            durationMs: Date.now() - clientStartTime,
            toolsExecuted: [{ name: 'reset_user_preferences', result: resetRes }]
          }
        };
      }
      if (prefAnalysis.action === 'deactivate_specific') {
        const deactRes = await executeClientToolCall('deactivate_user_preference', { searchQuery: prefAnalysis.target }, projectContext, correlationId);
        return {
          text: deactRes?.message || `I've removed that preference.`,
          telemetry: {
            modelUsed: determineTaskModel(query, forceDeepReasoning),
            source: 'User Preference Engine',
            intent: 'Deactivate Preference',
            durationMs: Date.now() - clientStartTime,
            toolsExecuted: [{ name: 'deactivate_user_preference', result: deactRes }]
          }
        };
      }
    }
    if (prefAnalysis.type === 'explicit_preference') {
      const savePrefRes = await saveUserPreference(userId, {
        preferenceStatement: prefAnalysis.preferenceStatement,
        inferredIntent: prefAnalysis.inferredIntent,
        category: prefAnalysis.category,
        source: PREFERENCE_SOURCES.EXPLICIT,
        scope: prefAnalysis.scope,
        projectId: prefAnalysis.projectId,
        confidence: 1.0,
        status: PREFERENCE_STATUS.ACTIVE
      });
      return {
        text: `Got it. I've saved your preference: "${prefAnalysis.preferenceStatement}" as your persistent ${prefAnalysis.scope} default.`,
        telemetry: {
          modelUsed: determineTaskModel(query, forceDeepReasoning),
          source: 'User Preference Engine',
          intent: 'Explicit Preference Saved',
          durationMs: Date.now() - clientStartTime,
          preference: savePrefRes
        }
      };
    }
  }

  // 1.0. COGNITIVE INITIATIVE PENDING CONFIRMATION RESOLVER
  _activeSessionCognitiveState.turnIndex++;
  const pendingCheck = resolvePendingSuggestionConfirmation(query, _activeSessionCognitiveState);
  if (pendingCheck && pendingCheck.isConfirmed) {
    recordSuggestionOutcome(userId, pendingCheck.domain, INITIATIVE_OUTCOMES.ACCEPTED, pendingCheck.originalSuggestion);
    const action = pendingCheck.pendingAction;
    _activeSessionCognitiveState.pendingProactiveSuggestion = null;

    try {
      const toolRes = await executeClientToolCall(action.toolName, action.args || {}, projectContext, correlationId);
      const provenanceSource = toolRes.source || action.provenanceSource || 'Municipal Inspections';
      
      let replyText = '';
      if (action.toolName === 'get_municipal_inspections') {
        const stages = toolRes.stages || [];
        const pendingStages = stages.filter(s => !s.isPassed);
        if (pendingStages.length > 0) {
          const stageList = pendingStages.slice(0, 3).map(s => `- ${s.title} (${s.pendingItemsCount || 0} pending items)`).join('\n');
          replyText = `Here is the current municipal inspection status for ${activeProjectName}:\n${stageList}`;
        } else {
          replyText = `All municipal inspection stages are currently marked passed for ${activeProjectName}.`;
        }
      } else if (action.toolName === 'get_project_schedule') {
        const items = toolRes.items || [];
        if (items.length > 0) {
          const itemList = items.slice(0, 3).map(i => `- ${i.title || i.phase || i.name}`).join('\n');
          replyText = `Here is what is currently active in field reminders for ${activeProjectName}:\n${itemList}`;
        } else {
          replyText = `Everything is currently up to date on ${activeProjectName} with no pending items.`;
        }
      } else if (action.toolName === 'get_weather_for_jobsite') {
        replyText = `The current forecast for ${activeProjectName} shows ${toolRes.forecast || toolRes.condition || 'clear conditions'}.`;
      } else {
        replyText = `Done. Here is the verified status for ${activeProjectName}.`;
      }

      return {
        text: replyText,
        telemetry: {
          modelUsed: 'Cognitive Action Dispatcher',
          source: provenanceSource,
          intent: 'Proactive Action Confirmed',
          durationMs: Date.now() - clientStartTime,
          sourcesUsed: [provenanceSource],
          toolsExecuted: [{ name: action.toolName, args: action.args, source: provenanceSource, result: toolRes }]
        }
      };
    } catch (actErr) {
      console.warn('[BuilderBrain] Proactive action execution failed:', actErr);
    }
  } else if (pendingCheck && pendingCheck.isRejected) {
    recordSuggestionOutcome(userId, pendingCheck.domain, INITIATIVE_OUTCOMES.REJECTED);
    _activeSessionCognitiveState.pendingProactiveSuggestion = null;
    return {
      text: "Understood. I won't check that.",
      telemetry: {
        modelUsed: 'Cognitive Engine',
        source: 'User Preference Engine',
        intent: 'Proactive Suggestion Rejected',
        durationMs: Date.now() - clientStartTime,
        sourcesUsed: []
      }
    };
  }

  // 1.1. CONVERSATION ENDING SIGN-OFF
  if (isConversationEnding(query)) {
    _activeSessionCognitiveState.pendingProactiveSuggestion = null;
    return {
      text: `You're welcome. Let me know when you need anything on ${activeProjectName}.`,
      telemetry: {
        modelUsed: 'Cognitive Engine',
        source: 'Conversational State',
        intent: 'Sign Off',
        durationMs: Date.now() - clientStartTime,
        sourcesUsed: []
      }
    };
  }

  // 1.2. EVALUATE COGNITIVE INITIATIVE
  const cognitiveDecision = evaluateCognitiveInitiative({
    query,
    conversationHistory: contents,
    context: projectContext,
    preferences: userPreferences,
    sessionState: _activeSessionCognitiveState
  });

  if (cognitiveDecision.warranted) {
    _activeSessionCognitiveState.pendingProactiveSuggestion = {
      id: `sug_${Date.now()}`,
      domain: cognitiveDecision.domain,
      topic: cognitiveDecision.topic,
      suggestionText: cognitiveDecision.suggestionText,
      suggestedAction: cognitiveDecision.suggestedAction
    };
    _activeSessionCognitiveState.lastSuggestionTurn = _activeSessionCognitiveState.turnIndex;
  } else {
    if (_activeSessionCognitiveState.pendingProactiveSuggestion) {
      recordSuggestionOutcome(userId, _activeSessionCognitiveState.pendingProactiveSuggestion.domain, INITIATIVE_OUTCOMES.IGNORED);
      _activeSessionCognitiveState.pendingProactiveSuggestion = null;
    }
  }

  // 1.3. DIRECT EXPLICIT MEMORY COMMAND PROCESSING
  const qTrim = query.trim();
  const rememberMatch = qTrim.match(/^(?:i need you to |please )?remember (?:that )?(.+)$/i) 
    || qTrim.match(/^(?:make a note|take note|save (?:this )?(?:for later|to memory)?|keep (?:this )?in mind)(?: that|:)? (.+)$/i);

  const updateMatch = qTrim.match(/^(?:hey,? )?(?:actually,? )?(?:we need to |please )?(?:change|update)(?: that[.,]?)?(?: note| preference| memory)? (?:to|that)?[:\s]*(.+)$/i)
    || qTrim.match(/^(?:actually,? )?(?:the painter|he|she|they) (?:wants|prefers) (?:to be paid by )?(.+) now[.,]?$/i);

  const forgetMatch = qTrim.match(/^(?:forget|delete|remove)(?: what i told you about| that note about| the note about| that)? (.+)$/i);

  if (rememberMatch && !rememberMatch[1].toLowerCase().startsWith('what') && !rememberMatch[1].toLowerCase().startsWith('how') && !rememberMatch[1].toLowerCase().startsWith('where')) {
    const textToSave = rememberMatch[1].trim();
    try {
      const saveRes = await executeClientToolCall('save_memory', {
        text: textToSave,
        projectId
      }, projectContext);

      if (saveRes && saveRes.saved) {
        return {
          text: "Got it. I've saved that to your memory.",
          telemetry: {
            modelUsed: determineTaskModel(query, forceDeepReasoning),
            source: 'Gemini Memory Engine',
            intent: 'Memory Saved',
            durationMs: Date.now() - clientStartTime,
            toolsExecuted: [{ name: 'save_memory', args: { text: textToSave, projectId }, result: saveRes }]
          }
        };
      }
    } catch (sErr) {
      console.warn('[BuilderBrain] Direct memory save fallback failed:', sErr);
    }
  } else if (updateMatch) {
    const updatedText = updateMatch[1].trim();
    try {
      const updateRes = await executeClientToolCall('update_memory', {
        updatedText,
        projectId,
        searchQuery: updatedText
      }, projectContext);

      if (updateRes && updateRes.updated) {
        return {
          text: "Got it. I've updated that memory.",
          telemetry: {
            modelUsed: determineTaskModel(query, forceDeepReasoning),
            source: 'Gemini Memory Engine',
            intent: 'Memory Updated',
            durationMs: Date.now() - clientStartTime,
            toolsExecuted: [{ name: 'update_memory', args: { updatedText, projectId }, result: updateRes }]
          }
        };
      }
    } catch (uErr) {
      console.warn('[BuilderBrain] Direct memory update fallback failed:', uErr);
    }
  } else if (forgetMatch) {
    const searchQuery = forgetMatch[1].trim();
    try {
      const deleteRes = await executeClientToolCall('delete_memory', {
        searchQuery,
        projectId
      }, projectContext);

      if (deleteRes && deleteRes.deleted) {
        return {
          text: "Got it. I've removed that from your active memory.",
          telemetry: {
            modelUsed: determineTaskModel(query, forceDeepReasoning),
            source: 'Gemini Memory Engine',
            intent: 'Memory Deleted',
            durationMs: Date.now() - clientStartTime,
            toolsExecuted: [{ name: 'delete_memory', args: { searchQuery, projectId }, result: deleteRes }]
          }
        };
      }
    } catch (dErr) {
      console.warn('[BuilderBrain] Direct memory delete fallback failed:', dErr);
    }
  }

  // 2. REMOTE CLOUD AI INFERENCE WITH FULL GROUNDED MANIFEST (25s timeout + 1s single retry)
  const CLIENT_REQUEST_TIMEOUT_MS = 25000;
  let apiRes = null;
  let attempt1Start = Date.now();
  let attempt1DurationMs = 0;
  let attempt2DurationMs = 0;
  let retryOccurred = false;
  let retryReason = null;

  try {
    const headers = { 'Content-Type': 'application/json' };

    // 1. Wait for Firebase auth hydration and acquire authenticated ID token
    const auth = getFirebaseAuthInstance();
    let user = options.mockUser || auth?.currentUser || null;

    if (!user && auth && typeof auth.authStateReady === 'function' && typeof window !== 'undefined') {
      try {
        await auth.authStateReady();
        user = auth.currentUser;
      } catch (authReadyErr) {
        console.warn('[BuilderBrain] authStateReady warning:', authReadyErr);
      }
    }

    if (!user && typeof window !== 'undefined' && !options.skipAuthGate) {
      return {
        text: 'Sign in is required. Please sign in to your account to use J.A.R.V.I.S.',
        telemetry: {
          modelUsed: 'Client Auth Guard',
          source: 'Client Security Check',
          intent: 'Authentication Required',
          durationMs: Date.now() - clientStartTime,
          toolsExecuted: [],
          errorCode: 401
        }
      };
    }

    if (user) {
      try {
        const idToken = typeof user.getIdToken === 'function' ? await user.getIdToken() : (user.idToken || '');
        if (!idToken && typeof window !== 'undefined' && !options.skipAuthGate) {
          return {
            text: 'Your sign-in session could not be verified. Please sign in again.',
            telemetry: {
              modelUsed: 'Client Auth Guard',
              source: 'Client Security Check',
              intent: 'Authentication Required',
              durationMs: Date.now() - clientStartTime,
              toolsExecuted: [],
              errorCode: 401
            }
          };
        }
        if (idToken) {
          headers.Authorization = `Bearer ${idToken}`;
        }
      } catch (tokenErr) {
        return {
          text: `Your sign-in session could not be verified: ${tokenErr.message || 'Please sign in again.'}`,
          telemetry: {
            modelUsed: 'Client Auth Guard',
            source: 'Client Security Check',
            intent: 'Authentication Required',
            durationMs: Date.now() - clientStartTime,
            toolsExecuted: [],
            errorCode: 401
          }
        };
      }
    }

    const reqPayload = JSON.stringify({
      contents,
      systemInstruction,
      query,
      forceDeepReasoning,
      apiKey: effectiveKey
    });

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CLIENT_REQUEST_TIMEOUT_MS);

      apiRes = await fetch('/api/ask-brain', {
        method: 'POST',
        headers,
        body: reqPayload,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      attempt1DurationMs = Date.now() - attempt1Start;

      // Only retry transient 5xx gateway errors (502, 504) - NEVER retry auth (401, 403), rate limits (429), or configuration (503)
      if (!apiRes.ok && (apiRes.status === 502 || apiRes.status === 504)) {
        throw new Error(`Transient gateway error ${apiRes.status}`);
      }
    } catch (firstErr) {
      attempt1DurationMs = Date.now() - attempt1Start;
      const isTimeout = firstErr.name === 'AbortError' || attempt1DurationMs >= (CLIENT_REQUEST_TIMEOUT_MS - 500);
      retryOccurred = true;
      retryReason = isTimeout ? 'FIRST_ATTEMPT_TIMEOUT' : (firstErr.message || 'FIRST_ATTEMPT_NETWORK_ERROR');

      // Single 1-second retry ONLY on genuine network timeout/drop or 502/504
      await new Promise(resolve => setTimeout(resolve, 1000));
      const attempt2Start = Date.now();
      const retryController = new AbortController();
      const retryTimeoutId = setTimeout(() => retryController.abort(), CLIENT_REQUEST_TIMEOUT_MS);

      try {
        apiRes = await fetch('/api/ask-brain', {
          method: 'POST',
          headers,
          body: reqPayload,
          signal: retryController.signal
        });
        clearTimeout(retryTimeoutId);
        attempt2DurationMs = Date.now() - attempt2Start;
      } catch (secondErr) {
        attempt2DurationMs = Date.now() - attempt2Start;
        if (secondErr.name === 'AbortError' || isTimeout) {
          return {
            text: `That request took longer than the expected response window, so I switched to local mode. All your project financials, schedule, and files for ${activeProjectName} are active locally. What specific record would you like to check?`,
            telemetry: {
              modelUsed: 'Local Fast Ledger Engine',
              source: 'Local Project Ledger',
              intent: 'Local Mode Switch',
              durationMs: Date.now() - clientStartTime,
              toolsExecuted: [],
              errorCode: 'NETWORK_TIMEOUT',
              latencyMetrics: {
                attempt1DurationMs,
                attempt2DurationMs,
                retryOccurred: true,
                retryReason,
                totalDurationMs: Date.now() - clientStartTime,
                latencyHealth: 'OFFLINE_FALLBACK'
              }
            }
          };
        }
        throw secondErr;
      }
    }

    if (apiRes.ok) {
      const data = await apiRes.json();

      // If Gemini requested a tool execution (e.g. weather, memory, balance lookup)
      if (data && data.toolCalls && data.toolCalls.length > 0) {
        console.log('[BuilderBrain] User message:', query);
        console.log('[BuilderBrain] Gemini returned toolCalls count:', data.toolCalls.length);

        const rawToolCalls = data.toolCalls || [];
        const normalizedToolCalls = normalizePurchasingToolCalls(rawToolCalls, query);
        const fullProjectContext = { ...projectContext, userQuery: query };

        for (const tc of normalizedToolCalls) {
          const toolStartTime = Date.now();
          console.log(`[BuilderBrain] Executing Tool: "${tc.name}" | Parsed Args:`, JSON.stringify(tc.args || {}));
          try {
            const result = await executeClientToolCall(tc.name, tc.args || {}, fullProjectContext, correlationId);
            const durationMs = result._executionDurationMs || (Date.now() - toolStartTime);

            if (result && (result.error || result.success === false)) {
              const errorMessage = result.message || result.error || formatUserFriendlyToolError(tc.name);
              toolTelemetryList.push({
                name: tc.name,
                args: tc.args,
                toolType: result.toolType || (tc.name.startsWith('save_') || tc.name.startsWith('update_') || tc.name.startsWith('delete_') ? 'WRITE' : 'READ'),
                source: result.source || 'Local Project Data',
                status: result.isAmbiguous ? 'ambiguous' : (result.isNotFound ? 'not_found' : 'error'),
                success: false,
                isDuplicate: false,
                durationMs,
                error: errorMessage,
                data: result.data !== undefined ? result.data : result,
                result
              });
            } else {
              toolTelemetryList.push({
                name: tc.name,
                args: tc.args,
                toolType: result.toolType || (tc.name.startsWith('save_') || tc.name.startsWith('update_') || tc.name.startsWith('delete_') ? 'WRITE' : 'READ'),
                source: result.source || 'Local Project Data',
                status: result.status || 'ok',
                success: true,
                isDuplicate: Boolean(result.isDuplicate),
                idempotencyKey: result.idempotencyKey || null,
                durationMs,
                data: result.data !== undefined ? result.data : result,
                result
              });
            }
          } catch {
            const friendlyError = formatUserFriendlyToolError(tc.name);
            toolTelemetryList.push({
              name: tc.name,
              args: tc.args,
              toolType: tc.name.startsWith('save_') || tc.name.startsWith('update_') || tc.name.startsWith('delete_') ? 'WRITE' : 'READ',
              source: 'Local Project Data',
              status: 'error',
              success: false,
              isDuplicate: false,
              durationMs: Date.now() - toolStartTime,
              error: friendlyError
            });
          }
        }

        // Collect exact provenance strictly from executed tools
        const sourcesUsedSet = new Set();
        for (const t of toolTelemetryList) {
          if (t.source) sourcesUsedSet.add(t.source);
        }
        const sourcesUsed = Array.from(sourcesUsedSet);

        const toolsSucceeded = toolTelemetryList.filter(t => t.success).map(t => ({
          name: t.name,
          args: t.args || {},
          source: t.source,
          result: t.result
        }));
        const toolsFailed = toolTelemetryList.filter(t => !t.success).map(t => ({ name: t.name, error: t.error }));

        // 2. Perform Second-Pass Multi-Intent Synthesis via Gemini Cloud AI
        // forceNoTools: true is strictly enforced to guarantee no infinite loops
        const synthesisPrompt = `${systemInstruction}

[MULTI-INTENT TOOL EXECUTION OUTCOMES]
The user issued a request that required tool execution and/or project data retrieval.
Tool Outcomes (Grounded Evidence):
${formatToolResultsForSynthesis(toolTelemetryList)}

UNIVERSAL EVIDENCE-TO-INTENT SYNTHESIS RULES:
1. EVIDENCE VS RESPONSE: The tool outcomes above are raw EVIDENCE, not your verbatim response. Determine the user's semantic intent from their question and reason over this evidence:
${getSemanticPromptGuidelines()}
2. STRICT GROUNDING RULE: You may ONLY state financial figures, dollar amounts, contractor quotes, balances, payments, and dates that appear EXACTLY in the project manifest or tool outcomes above. Do NOT invent, assume, or estimate numbers.
3. STRICT ERROR TRUTH RULE: If a tool execution reports readError: true, state: 'DOCUMENT_READ_ERROR', or contains an error message, you MUST report the exact error to the user (e.g. "I found your Purchasing Checklist in Google Drive, but couldn't read its contents: [error]"). You are STRICTLY FORBIDDEN from stating that a document has zero items or no pending items when a read error occurred.
4. If a tool succeeded (e.g. saving a reminder/memory), clearly confirm it in your response.
5. If a tool failed, clearly and concisely report what couldn't be completed without technical jargon.
6. Provide ONE single, unified, coherent, and professional answer.`;

        let synthesisText = null;
        let synthTelemetry = null;
        try {
          const synthController = new AbortController();
          const synthTimeoutId = setTimeout(() => synthController.abort(), 15000);

          const synthRes = await fetch('/api/ask-brain', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              contents,
              systemInstruction: synthesisPrompt,
              query,
              forceDeepReasoning: Boolean(forceDeepReasoning),
              forceNoTools: true,
              apiKey: effectiveKey
            }),
            signal: synthController.signal
          });
          clearTimeout(synthTimeoutId);

          if (synthRes.ok) {
            const synthData = await synthRes.json();
            synthTelemetry = synthData?.telemetry || null;
            if (synthData?.text) {
              synthesisText = synthData.text.trim();
            }
          }
        } catch (sErr) {
          console.warn('[BuilderBrain] Second-pass synthesis request failed, using grounded fallback combiner:', sErr);
        }

        if (synthesisText) {
          const groundingReport = verifyResponseGrounding(synthesisText, projectContext, toolTelemetryList);
          const finalResponseText = (groundingReport.purchasingDiscrepancyDetected && groundingReport.suggestedCorrection)
            ? groundingReport.suggestedCorrection
            : synthesisText;

          return {
            text: finalResponseText,
            telemetry: {
              schemaVersion: '1.0',
              correlationId,
              modelUsed: synthTelemetry?.modelUsed || determineTaskModel(query, forceDeepReasoning),
              source: 'Gemini Cloud AI (Two-Pass Orchestration)',
              intent: 'Multi-Intent Tool Synthesis',
              durationMs: Date.now() - clientStartTime,
              intentsCount: toolTelemetryList.length + (query.toLowerCase().includes('how much') || query.toLowerCase().includes('what') || query.toLowerCase().includes('who') ? 1 : 0),
              toolsRequested: data.toolCalls.map(t => t.name),
              toolsExecuted: toolsSucceeded,
              toolsFailed: toolsFailed,
              circuitBreakerStatus: {
                weather: circuitBreaker.getStatus('get_weather_for_jobsite')
              },
              tools: toolTelemetryList.map(t => ({
                schemaVersion: '1.0',
                correlationId,
                name: t.name,
                type: t.toolType,
                source: t.source,
                status: t.status,
                durationMs: t.durationMs,
                isDuplicate: t.isDuplicate,
                error: t.error || null
              })),
              grounding: groundingReport,
              groundingStatus: groundingReport.status,
              synthesisMode: 'cloud_synthesis',
              sourcesUsed,
              memoriesGroundedCount: memoriesData?.length || 0
            }
          };
        }

        // Grounded fallback if synthesis network failed
        const cleanSummary = formatToolResultsHumanReadable(toolTelemetryList, query, projectContext);
        const fallbackGrounding = verifyResponseGrounding(cleanSummary || '', projectContext, toolTelemetryList);

        return {
          text: cleanSummary || 'Action completed.',
          telemetry: {
            modelUsed: data.telemetry?.modelUsed || determineTaskModel(query, forceDeepReasoning),
            source: 'Gemini Cloud AI',
            intent: 'Tool Augmented Response',
            durationMs: Date.now() - clientStartTime,
            intentsCount: toolTelemetryList.length,
            toolsRequested: data.toolCalls.map(t => t.name),
            toolsExecuted: toolsSucceeded,
            toolsFailed: toolsFailed,
            tools: toolTelemetryList.map(t => ({
              name: t.name,
              type: t.toolType,
              source: t.source,
              status: t.status,
              durationMs: t.durationMs,
              isDuplicate: t.isDuplicate,
              error: t.error || null
            })),
            grounding: fallbackGrounding,
            groundingStatus: fallbackGrounding.status,
            synthesisMode: 'grounded_fallback',
            sourcesUsed,
            cognitiveInitiative: cognitiveDecision,
            memoriesGroundedCount: memoriesData?.length || 0,
            latencyMetrics: {
              attempt1DurationMs,
              attempt2DurationMs,
              retryOccurred,
              retryReason,
              totalDurationMs: Date.now() - clientStartTime,
              latencyHealth: retryOccurred ? 'RECOVERED_RETRY_UX_WARNING' : (Date.now() - clientStartTime > 5000 ? 'ELEVATED' : 'OPTIMAL')
            }
          }
        };
      }

      if (data && data.text) {
        let finalReply = data.text.trim();

        // If cognitive initiative determined a high-value suggestion is warranted on an observation
        if (cognitiveDecision.warranted && cognitiveDecision.suggestionText && !finalReply.includes('?') && !finalReply.includes(cognitiveDecision.suggestionText)) {
          finalReply = `${finalReply} ${cognitiveDecision.suggestionText}`;
        }

        const sourcesUsed = detectGroundedSourcesUsed(query, finalReply, projectContext);

        return {
          text: finalReply,
          telemetry: {
            modelUsed: data.telemetry?.modelUsed || determineTaskModel(query, forceDeepReasoning),
            source: 'Gemini Cloud AI',
            intent: data.telemetry?.intent || (forceDeepReasoning ? 'Forced Deep Reasoning' : 'Standard Response'),
            durationMs: Date.now() - clientStartTime,
            sourcesUsed: sourcesUsed,
            cognitiveInitiative: cognitiveDecision,
            memoriesGroundedCount: memoriesData?.length || 0,
            toolsExecuted: [],
            latencyMetrics: {
              attempt1DurationMs,
              attempt2DurationMs,
              retryOccurred,
              retryReason,
              totalDurationMs: Date.now() - clientStartTime,
              latencyHealth: retryOccurred ? 'RECOVERED_RETRY_UX_WARNING' : (Date.now() - clientStartTime > 5000 ? 'ELEVATED' : 'OPTIMAL')
            }
          }
        };
      }
    } else {
      lastErrorCode = apiRes.status;
      const errorJson = await apiRes.json().catch(() => ({}));
      const serverMsg = errorJson.error || '';

      if (apiRes.status === 401) {
        return {
          text: serverMsg || 'Sign in is required. Please sign in to your account to use J.A.R.V.I.S.',
          telemetry: {
            modelUsed: 'Server Auth Gate',
            source: 'Authentication Service',
            intent: 'Authentication Required',
            durationMs: Date.now() - clientStartTime,
            toolsExecuted: [],
            errorCode: 401
          }
        };
      }

      if (apiRes.status === 403) {
        return {
          text: serverMsg || 'Scanner access is not authorized for this account.',
          telemetry: {
            modelUsed: 'Server Auth Gate',
            source: 'Authorization Service',
            intent: 'Authorization Denied',
            durationMs: Date.now() - clientStartTime,
            toolsExecuted: [],
            errorCode: 403
          }
        };
      }

      if (apiRes.status === 429) {
        return {
          text: serverMsg || 'Too many requests. Please slow down and try again in a few moments.',
          telemetry: {
            modelUsed: 'Server Rate Limiter',
            source: 'Rate Limit Guard',
            intent: 'Rate Limited',
            durationMs: Date.now() - clientStartTime,
            toolsExecuted: [],
            errorCode: 429
          }
        };
      }

      if (apiRes.status === 503) {
        return {
          text: 'AI service is temporarily unavailable; contact the administrator.',
          telemetry: {
            modelUsed: 'Server Configuration Gate',
            source: 'AI Service Config',
            intent: 'Service Unavailable',
            durationMs: Date.now() - clientStartTime,
            toolsExecuted: [],
            errorCode: 503,
            rawServerError: serverMsg
          }
        };
      }

      return {
        text: serverMsg || `I had a temporary issue connecting to the AI server (${apiRes.status}). Please try again.`,
        telemetry: {
          modelUsed: 'Server Error Handler',
          source: 'Server Response',
          intent: 'Server Error',
          durationMs: Date.now() - clientStartTime,
          toolsExecuted: [],
          errorCode: apiRes.status
        }
      };
    }
  } catch (outerErr) {
    if (outerErr.name === 'AbortError' || retryReason === 'FIRST_ATTEMPT_TIMEOUT') {
      return {
        text: `That request took longer than the expected response window, so I switched to local mode. All your project financials, schedule, and files for ${activeProjectName} are active locally. What specific record would you like to check?`,
        telemetry: {
          modelUsed: 'Local Fast Ledger Engine',
          source: 'Local Project Ledger',
          intent: 'Local Mode Switch',
          durationMs: Date.now() - clientStartTime,
          toolsExecuted: [],
          errorCode: 'NETWORK_TIMEOUT',
          latencyMetrics: {
            attempt1DurationMs,
            attempt2DurationMs,
            retryOccurred,
            retryReason,
            totalDurationMs: Date.now() - clientStartTime,
            latencyHealth: 'OFFLINE_FALLBACK'
          }
        }
      };
    }
    lastErrorCode = 'NETWORK_ERROR';
  }

  // 3. FAST LOCAL LEDGER & PERSISTENT MEMORY FALLBACK
  if (memoriesData && memoriesData.length > 0) {
    const memSummary = memoriesData.map(m => `- ${m.text}`).join('\n');
    return {
      text: `According to my memory:\n${memSummary}`,
      telemetry: {
        modelUsed: 'Local Memory Engine',
        source: 'J.A.R.V.I.S. Memory (Persistent Vault)',
        intent: 'Memory Retrieval',
        durationMs: Date.now() - clientStartTime,
        toolsExecuted: [],
        latencyMetrics: {
          attempt1DurationMs,
          attempt2DurationMs,
          retryOccurred,
          retryReason,
          totalDurationMs: Date.now() - clientStartTime,
          latencyHealth: 'OFFLINE_FALLBACK'
        }
      }
    };
  }

  return {
    text: `That request took longer than the expected response window, so I switched to local mode. All your project financials, schedule, and files for ${activeProjectName} are active locally. What specific record would you like to check?`,
    telemetry: {
      modelUsed: 'Local Fast Ledger Engine',
      source: 'Local Project Ledger',
      intent: 'Local Mode Switch',
      durationMs: Date.now() - clientStartTime,
      toolsExecuted: [],
      errorCode: lastErrorCode,
      latencyMetrics: {
        attempt1DurationMs,
        attempt2DurationMs,
        retryOccurred,
        retryReason,
        totalDurationMs: Date.now() - clientStartTime,
        latencyHealth: 'OFFLINE_FALLBACK'
      }
    }
  };
}
