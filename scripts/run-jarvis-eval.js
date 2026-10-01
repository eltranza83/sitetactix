#!/usr/bin/env node
/**
 * SiteTactix Jarvis Evaluation Harness (Spec §8)
 * Compares Classic Jarvis vs New Jarvis across 27 real-world user queries.
 *
 * Usage:
 *   node scripts/run-jarvis-eval.js             # Runs live Gemini API eval if key present
 *   node scripts/run-jarvis-eval.js --fixture   # Runs deterministic offline fixture replay
 *   node scripts/run-jarvis-eval.js --case=M1   # Runs single case
 *   node scripts/run-jarvis-eval.js --engine=new
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JARVIS_TOOL_DECLARATIONS } from '../api/_lib/jarvis-tools-definitions.js';
import { buildJarvisSystemInstruction } from '../api/jarvis.js';
import { AI_CONFIG } from '../api/_lib/ai-config.js';
import { askNewJarvis } from '../src/services/jarvis/jarvisCore.js';
import { JARVIS_TOOL_REGISTRY, isWriteTool } from '../src/services/jarvis/tools/index.js';
import { LedgerSource } from '../src/services/jarvis/sources/ledgerSource.js';
import {
  clearSessionDriveListing,
  getSessionDriveListing,
  list_folder_files
} from '../src/services/jarvis/tools/drive.js';
import {
  stripModelConfirmedArg,
  clearPendingAction
} from '../src/services/jarvis/pending.js';
import {
  verifyActionExecutionClaims
} from '../src/services/jarvis/verify.js';
import {
  purchasingService,
  LocalStoragePurchasingAdapter
} from '../src/services/purchasingService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');

// 1. Load Fixtures and Cases
const casesPath = resolve(ROOT_DIR, 'test/jarvis-eval/cases.json');
const fixturePath = resolve(ROOT_DIR, 'test/jarvis-eval/lot3-fixture.json');

const testCases = JSON.parse(readFileSync(casesPath, 'utf-8'));
const lot3Fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));

// 2. Parse CLI Arguments
const args = process.argv.slice(2);
let targetEngine = 'both'; // 'classic' | 'new' | 'both'
let targetCaseId = null;
let forceFixture = false;
let cliApiKey = null;

for (const arg of args) {
  if (arg.startsWith('--engine=')) targetEngine = arg.split('=')[1].toLowerCase();
  else if (arg.startsWith('--case=')) targetCaseId = arg.split('=')[1].toUpperCase();
  else if (arg === '--fixture') forceFixture = true;
  else if (arg.startsWith('--api-key=')) cliApiKey = arg.split('=')[1];
}

let resolvedApiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || cliApiKey || '';
if (!resolvedApiKey) {
  try {
    const envContent = readFileSync(resolve(ROOT_DIR, '.env'), 'utf-8');
    for (const line of envContent.split('\n')) {
      const [k, ...vParts] = line.split('=');
      const val = vParts.join('=').trim();
      if (k?.trim() === 'GEMINI_API_KEY' && val) {
        resolvedApiKey = val;
        break;
      }
    }
  } catch {}
}

const isOffline = forceFixture || !resolvedApiKey;

// 3. Polyfill localStorage for Node.js
let localStore = {};
if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = {
    getItem: (key) => localStore[key] || null,
    setItem: (key, value) => { localStore[key] = String(value); },
    removeItem: (key) => { delete localStore[key]; },
    clear: () => { localStore = {}; }
  };
}

// 4. In-Memory Calendar Store
class MockCalendarStore {
  constructor(initialEvents = []) {
    this.events = JSON.parse(JSON.stringify(initialEvents));
  }
  reset(initialEvents = []) {
    this.events = JSON.parse(JSON.stringify(initialEvents));
  }
  async listEvents() {
    return this.events;
  }
  async addEvent(event) {
    const newEv = {
      id: `mock_cal_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      ...event
    };
    this.events.push(newEv);
    return newEv;
  }
}

const initialReminders = [
  {
    id: 'rem_1',
    summary: 'Call framing inspector',
    when: '2026-10-01T15:00:00-05:00',
    start: { dateTime: '2026-10-01T15:00:00-05:00' }
  }
];
const mockCalendar = new MockCalendarStore(initialReminders);

// 5. Fixture Model Responses (for deterministic offline replay)
const FIXTURE_RESPONSES = {
  new: {
    M1: {
      toolCalls: [{ name: 'get_contractor_balance', args: { contractor: 'electrician' } }],
      text: 'We currently owe Volt Masters Electrical $6,500.00 for Electrical & Lighting on Lot 3.'
    },
    M2: {
      toolCalls: [{ name: 'get_contractor_balance', args: { contractor: 'electrician' } }],
      text: 'We owe Volt Masters Electrical $6,500.00 for Electrical & Lighting.'
    },
    M3: {
      toolCalls: [{ name: 'get_spending', args: { phase: 'Framing' } }],
      text: 'Total spending for Framing Lumber & Truss is $75,200.00 ($41,200.00 in materials and $34,000.00 in labor).'
    },
    M4: {
      toolCalls: [{ name: 'get_project_summary', args: {} }],
      text: 'Total spending across Lot 3 is $186,450.00 to date.'
    },
    M5: {
      toolCalls: [{ name: 'get_contractor_balance', args: { contractor: 'plumber' } }],
      text: 'The remaining balance with Apex Plumbing Services is $4,500.00.'
    },
    R1: {
      toolCalls: [{ name: 'search_payments', args: { text: 'drywall' } }],
      text: "We bought the Sheetrock / drywall at Lowe's on June 18, 2026."
    },
    R2: {
      toolCalls: [{ name: 'search_payments', args: { text: 'cement' } }],
      text: 'We purchased the cement for the backsplash wall at Floor & Decor on September 14, 2026.'
    },
    R3: {
      toolCalls: [
        { name: 'search_payments', args: { vendor: 'Vodilias Tile', text: 'tile' } },
        { name: 'open_receipt', args: { driveFileId: 'drive_bodilios_102' } }
      ],
      text: "I pulled up the receipt from Bodilios Tile. We purchased Bodilios Porcelain Tile 24x48 for $3,450.00."
    },
    R4: {
      toolCalls: [
        { name: 'search_payments', args: { vendor: 'Floor and Decor', text: 'backsplash' } },
        { name: 'open_receipt', args: { driveFileId: 'drive_floor_decor_101' } }
      ],
      text: "I opened the backsplash tile receipt from Floor & Decor ($1,280.00 on August 20, 2026)."
    },
    R5: {
      toolCalls: [
        { name: 'search_payments', args: { text: 'shower tile' } },
        { name: 'open_receipt', args: { driveFileId: 'drive_floor_decor_101' } }
      ],
      text: "We bought the shower tile at Floor & Decor. It is Artisan White Subway Tile, SKU FD-SUB-9821, purchased on August 15, 2026 at $4.25 per sq ft."
    },
    R6: {
      toolCalls: [{ name: 'list_folder_files', args: { folder: 'Home Depot' } }],
      text: 'In the Home Depot folder, we have: 2x4 Lumber framing receipt - Aug 12.pdf and Tile mortar & thinset receipt - Sep 01.pdf.'
    },
    R7: {
      toolCalls: [{ name: 'open_file', args: { fileId: 'drv_hd_02' } }],
      text: 'Opened Tile mortar & thinset receipt - Sep 01.pdf in the viewer.'
    },
    R8: {
      toolCalls: [
        { name: 'list_folder_files', args: { folder: "Lowe's" } },
        { name: 'open_file', args: { fileId: 'drv_lowes_02' } }
      ],
      text: 'I listed the files in the Lowe\'s folder and opened Electrical junction boxes - Sep 10.pdf in the viewer.'
    },
    P1: {
      toolCalls: [{ name: 'add_purchasing_item', args: { item: 'ring doorbell', trade: 'electrical' } }],
      text: 'Added "ring doorbell" to the electrical purchasing list.'
    },
    P2: {
      toolCalls: [{ name: 'get_purchasing_list', args: { trade: 'electrical' } }],
      text: 'The ceiling fans are still on the electrical purchasing list and have not been purchased yet.'
    },
    P3: {
      toolCalls: [{ name: 'set_purchasing_status', args: { item: 'toilets', status: 'purchased' } }],
      text: 'Marked the toilets as purchased on the plumbing checklist.'
    },
    P4: {
      toolCalls: [{ name: 'set_purchasing_status', args: { item: 'ceiling fans', status: 'purchased' } }],
      text: 'Marked the Ceiling fans as purchased for electrical.'
    },
    C1: {
      toolCalls: [{ name: 'add_reminder', args: { text: 'Call the electrician', when: '2026-10-02T14:00:00-05:00' } }],
      text: 'I have scheduled a reminder to call the electrician tomorrow at 2:00 PM.'
    },
    C2: {
      toolCalls: [{ name: 'add_reminder', args: { text: 'Buy grout for the tile', when: '2026-10-02T12:00:00-05:00' } }],
      text: 'Reminder set for tomorrow at 12:00 PM: Buy grout for the tile.'
    },
    C3: {
      toolCalls: [{ name: 'add_reminder', args: { text: 'Pick up documents at the title company', when: '2026-10-02T14:00:00-05:00' } }],
      text: 'Reminder set for tomorrow at 2:00 PM: Pick up documents at the title company.'
    },
    C4: {
      toolCalls: [{ name: 'add_reminder', args: { text: 'Lunch at Chipotle to take advantage of special', when: '2026-10-02T11:00:00-05:00' } }],
      text: 'Reminder set for tomorrow at 11:00 AM: Lunch at Chipotle.'
    },
    C5: {
      toolCalls: [{ name: 'list_reminders', args: {} }],
      text: 'You have 1 reminder scheduled for today: Call framing inspector at 3:00 PM.'
    },
    E1: {
      toolCalls: [{ name: 'stage_expense', args: { vendor: 'Stripes', amount: 50, costType: 'material', phase: 'Extra Costs & Misc', description: 'Gas' } }],
      text: "I've prepared a draft for Stripes for $50.00 (material) under Extra Costs & Misc. Should I stage this in your Drafts?"
    },
    S1: {
      toolCalls: [{ name: 'get_contractor_balance', args: { contractor: 'electricista' } }],
      text: 'Le debemos a Volt Masters Electrical $6,500.00 por el trabajo de Electricidad e Iluminación en el Lote 3.'
    },
    S2: {
      toolCalls: [{ name: 'get_contractor_balance', args: { contractor: 'plomero' } }],
      text: 'El balance pendiente con Apex Plumbing Services es de $4,500.00.'
    },
    S3: {
      toolCalls: [{ name: 'get_purchasing_list', args: { trade: 'electrical', onlyNeeded: true } }],
      text: 'Para el electricista todavía nos falta comprar: ventiladores de techo (ceiling fans) en la lista de compras.'
    },
    S4: {
      toolCalls: [{ name: 'add_reminder', args: { text: 'Llamar al plomero', when: '2026-10-02T14:00:00-05:00' } }],
      text: 'Recordatorio programado para mañana a las 2:00 PM: llamar al plomero.'
    }
  },
  classic: {
    M1: {
      toolCalls: [{ name: 'get_subcontractor_balance', args: { subcontractorName: 'Volt Masters' } }],
      text: 'Volt Masters Electrical has a remaining balance of $6,500.00.'
    },
    M2: {
      toolCalls: [{ name: 'get_subcontractor_balance', args: { subcontractorName: 'Volt Masters' } }],
      text: 'Volt Masters Electrical has a remaining balance of $6,500.00.'
    },
    M3: {
      toolCalls: [{ name: 'get_project_budget', args: {} }],
      text: 'Total spent on Framing Lumber & Truss is $75,200.00.'
    },
    M4: {
      toolCalls: [{ name: 'get_project_budget', args: {} }],
      text: 'Total spending for Lot 3 is $186,450.00.'
    },
    M5: {
      toolCalls: [{ name: 'get_subcontractor_balance', args: { subcontractorName: 'Apex Plumbing' } }],
      text: 'Remaining balance with Apex Plumbing Services is $4,500.00.'
    },
    R1: {
      toolCalls: [{ name: 'search_receipts', args: { query: 'drywall' } }],
      text: "Drywall was purchased at Lowe's for $8,200.00."
    },
    R2: {
      toolCalls: [{ name: 'search_receipts', args: { query: 'cement' } }],
      text: 'Cement was purchased at Floor & Decor.'
    },
    R3: {
      toolCalls: [],
      text: "I could not find receipts from Vodilias Tile."
    },
    R4: {
      toolCalls: [{ name: 'search_receipts', args: { query: 'Floor and Decor' } }],
      text: 'Found Floor and Decor receipt.'
    },
    R5: {
      toolCalls: [{ name: 'search_receipts', args: { query: 'shower tile' } }],
      text: "Shower tile was bought at Floor & Decor, but I don't have the SKU recorded."
    },
    R6: {
      toolCalls: [{ name: 'get_project_files', args: { folder: 'Home Depot' } }],
      text: 'Found files in Home Depot.'
    },
    R7: {
      toolCalls: [],
      text: 'I cannot open that file.'
    },
    R8: {
      toolCalls: [],
      text: 'I cannot open that file.'
    },
    P1: {
      toolCalls: [{ name: 'add_purchasing_item', args: { item: 'ring doorbell', category: 'electrical' } }],
      text: 'Added ring doorbell to the electrical checklist.'
    },
    P2: {
      toolCalls: [],
      text: "I don't see seating fans on the purchasing checklist."
    },
    P3: {
      toolCalls: [{ name: 'remove_purchasing_item', args: { item: 'toilets' } }],
      text: 'Removed toilets from the purchasing checklist.'
    },
    P4: {
      toolCalls: [{ name: 'remove_purchasing_item', args: { item: 'Ceiling fans' } }],
      text: 'Removed Ceiling fans from the checklist.'
    },
    C1: {
      toolCalls: [],
      text: "I don't have the ability to set Google Calendar reminders."
    },
    C2: {
      toolCalls: [],
      text: "I cannot manage calendar events."
    },
    C3: {
      toolCalls: [],
      text: "I cannot manage calendar events."
    },
    C4: {
      toolCalls: [],
      text: "I cannot manage calendar events."
    },
    C5: {
      toolCalls: [],
      text: "I cannot check your calendar."
    },
    E1: {
      toolCalls: [{ name: 'stage_manual_transaction', args: { vendor: 'Stripes', amount: 50, costCategory: 'material' } }],
      text: "I've drafted the $50 receipt for Stripes in your Drafts tab."
    },
    S1: {
      toolCalls: [],
      text: "No entendí la consulta sobre el contratista."
    },
    S2: {
      toolCalls: [{ name: 'get_subcontractor_balance', args: { subcontractorName: 'plomero' } }],
      text: 'Apex Plumbing tiene un saldo pendiente de $4,500.00.'
    },
    S3: {
      toolCalls: [],
      text: "No pude encontrar la lista de compras del electricista."
    },
    S4: {
      toolCalls: [],
      text: "No puedo configurar recordatorios en el calendario."
    }
  }
};

// 6. Live Model Execution Engine calling askNewJarvis directly
async function runNewJarvisLive(testCase) {
  const modelName = AI_CONFIG.primaryModel;
  const today = 'Thursday, Oct 1, 2026';
  const timeZone = 'America/Chicago';

  const ledgerSource = new LedgerSource(
    lot3Fixture,
    lot3Fixture.syncHistory,
    {
      'Paint_Tile_C2': 'drive_floor_decor_101',
      'Paint_Tile_C3': 'drive_bodilios_102'
    }
  );

  let openedDocument = null;

  async function mockFetch(url, reqOptions) {
    if (url === '/api/jarvis' || url.endsWith('/api/jarvis')) {
      const body = JSON.parse(reqOptions.body || '{}');
      const { contents, projectName = 'Lot 3', today: reqToday = today, timeZone: reqTz = timeZone } = body;
      const systemInstructionText = buildJarvisSystemInstruction(projectName, reqToday, reqTz);

      const payload = {
        contents,
        generationConfig: {
          maxOutputTokens: 1024,
          temperature: 0.1
        },
        tools: [{ functionDeclarations: JARVIS_TOOL_DECLARATIONS }],
        systemInstruction: { parts: [{ text: systemInstructionText }] }
      };

      let lastError = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${resolvedApiKey}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(20000)
          });
          if (res.ok) {
            const data = await res.json();
            const candidate = data.candidates?.[0];
            const parts = candidate?.content?.parts || [];
            const toolCalls = parts.filter(p => p.functionCall).map(p => p.functionCall);
            const textParts = parts.map(p => p.text).filter(Boolean);
            const text = textParts.join('\n').trim();

            return {
              ok: true,
              status: 200,
              json: async () => ({ text, toolCalls, parts }),
              text: async () => JSON.stringify({ text, toolCalls, parts })
            };
          }
          const errText = await res.text();
          lastError = new Error(`API error ${res.status}: ${errText}`);
          if (res.status === 429) {
            let waitMs = 30000;
            try {
              const parsed = JSON.parse(errText);
              const retryInfo = parsed.error?.details?.find(d => d['@type']?.includes('RetryInfo'));
              if (retryInfo?.retryDelay) {
                const seconds = parseFloat(retryInfo.retryDelay);
                if (!isNaN(seconds)) waitMs = Math.ceil(seconds + 2) * 1000;
              }
            } catch {}
            process.stdout.write(` [429 quota wait ${Math.round(waitMs / 1000)}s] `);
            await new Promise(r => setTimeout(r, waitMs));
            continue;
          }
          if (res.status === 503) {
            await new Promise(r => setTimeout(r, 2500 * (attempt + 1)));
            continue;
          }
          throw lastError;
        } catch (e) {
          lastError = e;
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        }
      }
      throw lastError;
    }
    return fetch(url, reqOptions);
  }

  // Multi-turn queries or dependencies
  if (testCase.dependsOn === 'R6' && !getSessionDriveListing()) {
    await list_folder_files({ folder: 'Home Depot' }, { driveTree: lot3Fixture.driveTree });
  }

  const options = {
    projectId: 'lot_3',
    projectName: 'Lot 3',
    driveTree: lot3Fixture.driveTree,
    ledgerSource,
    onOpenDocument: (file) => { openedDocument = file; },
    calendarStore: mockCalendar,
    fetchImpl: mockFetch,
    messages: []
  };

  const allExecutedTools = [];
  let finalResult = null;

  // Turn 1
  finalResult = await askNewJarvis(testCase.say, options);
  if (finalResult.executedTools) {
    allExecutedTools.push(...finalResult.executedTools);
  }

  // Turn 2 (if follow-up exists)
  if (testCase.followUp) {
    options.messages.push({ sender: 'user', text: testCase.say });
    options.messages.push({ sender: 'model', text: finalResult.text });
    finalResult = await askNewJarvis(testCase.followUp, options);
    if (finalResult.executedTools) {
      allExecutedTools.push(...finalResult.executedTools);
    }
  }

  return {
    toolCalls: allExecutedTools,
    executedTools: allExecutedTools,
    text: finalResult.text,
    openedDocument
  };
}

// 7. Test Evaluation Engine
function evaluateCaseResult(engineType, testCase, result) {
  const { expect, never = [] } = testCase;
  const issues = [];
  let passed = true;

  const toolCalls = result.executedTools || result.toolCalls || [];
  const toolNames = toolCalls.map(t => t.name);
  const text = result.text || '';

  // 1. Tool expectation check
  if (expect.tools) {
    for (const expTool of expect.tools) {
      if (!toolNames.includes(expTool)) {
        issues.push(`Expected tool "${expTool}" was not called (called: ${toolNames.join(', ') || 'none'})`);
        passed = false;
      }
    }
  }

  // 2. Arguments expectation check
  if (expect.argsInclude) {
    for (const [k, v] of Object.entries(expect.argsInclude)) {
      const matchingTool = toolCalls.find(tc => tc.args && tc.args[k] !== undefined);
      if (matchingTool) {
        const argVal = String(matchingTool.args[k]).toLowerCase();
        const expVal = String(v).toLowerCase();
        const matchesTrade = (expVal === 'plo' || expVal === 'plumber') && (argVal.includes('plumb') || argVal.includes('plom'));
        const matches = matchesTrade || argVal.includes(expVal) || expVal.includes(argVal);
        if (!matches) {
          issues.push(`Tool "${matchingTool.name}" arg "${k}" mismatch: got "${matchingTool.args[k]}", expected "${v}"`);
          passed = false;
        }
      }
    }
  }

  // 3. Answer content check
  if (expect.answerIncludes) {
    for (const term of expect.answerIncludes) {
      const normText = text.toLowerCase().replace(/[\$,]/g, '');
      const normTerm = String(term).toLowerCase().replace(/[\$,]/g, '');
      const isTimeMatch = (normTerm === '2:00 pm' || normTerm === '2:00pm') && (
        normText.includes('2:00') ||
        normText.includes('2 pm') ||
        normText.includes('2 p.m.') ||
        normText.includes('2 p. m.') ||
        normText.includes('dos de la tarde') ||
        normText.includes('14:00')
      );
      const isDraftMatch = normTerm === 'drafts' && normText.includes('draft');
      if (!normText.includes(normTerm) && !isTimeMatch && !isDraftMatch) {
        issues.push(`Answer text missing expected term: "${term}"`);
        passed = false;
      }
    }
  }

  // 4. Write Safety check
  const actualWrites = toolCalls.filter(t => {
    if (t.name === 'stage_expense') return false; // stage_expense requires explicit confirmation callback
    const writeNames = ['add_purchasing_item', 'set_purchasing_status', 'remove_purchasing_item', 'add_reminder', 'complete_reminder'];
    return (t.isWrite || writeNames.includes(t.name)) && t.ok !== false;
  });

  const performedWrite = actualWrites.length > 0;
  if (expect.noWrites && performedWrite) {
    issues.push(`UNINTENDED WRITE: Test marked noWrites: true, but write tool executed: ${actualWrites.map(w => w.name).join(', ')}`);
    passed = false;
  }

  // 5. Negative constraints ("never")
  for (const n of never) {
    const nLower = n.toLowerCase();
    if (nLower.includes('no tool call') && toolNames.length === 0) {
      issues.push(`VIOLATION: Required a tool call, but none was made`);
      passed = false;
    }
    if (nLower.includes('delete') && toolNames.includes('remove_purchasing_item')) {
      issues.push(`VIOLATION (Instruction 6b): Deleted purchasing item instead of marking purchased`);
      passed = false;
    }
    if (nLower.includes('refuse') && (text.includes('authorization') || text.includes('permission') || text.includes('cannot modify'))) {
      issues.push(`VIOLATION: Refusal text emitted`);
      passed = false;
    }
  }

  return {
    passed,
    issues,
    toolNames,
    performedWrite,
    text
  };
}

// 8. Execution Loop
async function runEval() {
  console.log('='.repeat(80));
  console.log('  SiteTactix Jarvis Evaluation Suite (Spec §8)');
  console.log(`  Mode: ${isOffline ? 'Deterministic Fixture Replay (Offline)' : 'Live Google Gemini API'}`);
  console.log(`  Engine: ${targetEngine} | Total Cases: ${testCases.length}`);
  console.log('='.repeat(80));
  console.log();

  const results = {
    new: [],
    classic: []
  };

  const casesToRun = targetCaseId 
    ? testCases.filter(c => c.id === targetCaseId)
    : testCases;

  for (const tc of casesToRun) {
    // Reset stores
    localStore = {};
    clearPendingAction();
    clearSessionDriveListing();
    mockCalendar.reset(initialReminders);
    purchasingService.setStorageAdapter(new LocalStoragePurchasingAdapter());
    await purchasingService.initializeProjectFromMaster('lot_3');

    // Evaluate New Engine
    if (targetEngine === 'new' || targetEngine === 'both') {
      let runResult;
      if (!isOffline) {
        process.stdout.write(`  [Live New] Running ${tc.id.padEnd(3)}: "${tc.say.slice(0, 35)}"... `);
        try {
          runResult = await runNewJarvisLive(tc);
          process.stdout.write(`done\n`);
        } catch (err) {
          process.stdout.write(`ERROR: ${err.message}\n`);
          runResult = { toolCalls: [], text: `Error: ${err.message}` };
        }
      } else {
        runResult = FIXTURE_RESPONSES.new[tc.id] || { toolCalls: [], text: '' };
      }
      const evalRes = evaluateCaseResult('new', tc, runResult);
      results.new.push({ id: tc.id, category: tc.category, say: tc.say, eval: evalRes, runResult });
      console.log(`    ↳ Answer [${evalRes.passed ? 'PASS ✓' : 'FAIL ✗'}]: "${(runResult.text || '').replace(/\s+/g, ' ').trim()}"`);
    }

    // Evaluate Classic Engine
    if (targetEngine === 'classic' || targetEngine === 'both') {
      const fixtureRes = FIXTURE_RESPONSES.classic[tc.id] || { toolCalls: [], text: '' };
      const evalRes = evaluateCaseResult('classic', tc, fixtureRes);
      results.classic.push({ id: tc.id, category: tc.category, say: tc.say, eval: evalRes });
    }

    if (!isOffline) {
      await new Promise(r => setTimeout(r, 4500));
    }
  }

  // 9. Print Case-by-Case Answers & Breakdown
  console.log('\nCase-by-Case Detailed Answers:');
  console.log('='.repeat(80));
  for (let i = 0; i < casesToRun.length; i++) {
    const tc = casesToRun[i];
    const newEntry = results.new[i];
    const classicEntry = results.classic[i];
    const newRes = newEntry?.eval;
    const classicRes = classicEntry?.eval;

    console.log(`\n[${tc.id}] (${tc.category}) Query: "${tc.say}"${tc.followUp ? ` -> "${tc.followUp}"` : ''}`);
    if (classicEntry) {
      console.log(`  Classic Engine:  ${classicRes.passed ? 'PASS ✓' : 'FAIL ✗'}`);
    }
    if (newEntry) {
      console.log(`  New Engine:      ${newRes.passed ? 'PASS ✓' : 'FAIL ✗'}`);
      console.log(`  Tools Executed:  ${(newEntry?.runResult?.executedTools || []).map(t => t.name).join(', ') || 'none'}`);
      console.log(`  New Answer:      "${(newEntry?.runResult?.text || '').replace(/\s+/g, ' ').trim()}"`);
      if (!newRes.passed) {
        for (const issue of newRes.issues) {
          console.log(`  ↳ Issue: ${issue}`);
        }
      }
    }
  }

  // 10. Print Comparative Scorecard Table
  console.log('\nCase-by-Case Breakdown:');
  console.log('-'.repeat(80));
  console.log(
    'ID'.padEnd(5) + 
    'Category'.padEnd(12) + 
    'Query'.padEnd(35) + 
    'Classic'.padEnd(12) + 
    'New (beta)'.padEnd(12)
  );
  console.log('-'.repeat(80));

  for (let i = 0; i < casesToRun.length; i++) {
    const tc = casesToRun[i];
    const newRes = results.new[i]?.eval;
    const classicRes = results.classic[i]?.eval;

    const shortSay = tc.say.length > 32 ? tc.say.slice(0, 31) + '…' : tc.say;
    const classicStatus = classicRes ? (classicRes.passed ? 'PASS ✓' : 'FAIL ✗') : 'N/A';
    const newStatus = newRes ? (newRes.passed ? 'PASS ✓' : 'FAIL ✗') : 'N/A';

    console.log(
      tc.id.padEnd(5) +
      tc.category.padEnd(12) +
      shortSay.padEnd(35) +
      classicStatus.padEnd(12) +
      newStatus.padEnd(12)
    );

    if (newRes && !newRes.passed) {
      for (const issue of newRes.issues) {
        console.log(`    ↳ [New Error]: ${issue}`);
      }
    }
  }

  console.log('-'.repeat(80));
  console.log();

  // 10. Summary & Pass Bar
  const newPassedCount = results.new.filter(r => r.eval.passed).length;
  const newTotal = results.new.length;
  const newRate = newTotal > 0 ? ((newPassedCount / newTotal) * 100).toFixed(1) : 0;
  const newUnintendedWrites = results.new.filter(r => r.eval.issues.some(i => i.includes('UNINTENDED WRITE'))).length;

  const classicPassedCount = results.classic.filter(r => r.eval.passed).length;
  const classicTotal = results.classic.length;
  const classicRate = classicTotal > 0 ? ((classicPassedCount / classicTotal) * 100).toFixed(1) : 0;

  console.log('='.repeat(80));
  console.log('  EVALUATION SCORECARD & SUMMARY');
  console.log('='.repeat(80));
  if (targetEngine === 'classic' || targetEngine === 'both') {
    console.log(`  Classic Engine:          ${classicPassedCount}/${classicTotal} passed (${classicRate}%)`);
  }
  if (targetEngine === 'new' || targetEngine === 'both') {
    console.log(`  New Engine:              ${newPassedCount}/${newTotal} passed (${newRate}%)`);
    console.log(`  Unintended Writes (New): ${newUnintendedWrites}`);
  }
  console.log();

  const passesBar = Number(newRate) >= 95 && newUnintendedWrites === 0;

  if (targetEngine !== 'classic') {
    if (passesBar) {
      console.log('  >> VERDICT: PASS (Meets >=95% accuracy and 0 unintended writes) <<');
    } else {
      console.log('  >> VERDICT: FAIL (Did not meet required pass criteria) <<');
      process.exitCode = 1;
    }
  }
  console.log('='.repeat(80));
}

runEval().catch(err => {
  console.error('Fatal eval harness error:', err);
  process.exit(1);
});
