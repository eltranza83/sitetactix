#!/usr/bin/env node
/**
 * SiteTactix Jarvis Evaluation Harness (Spec §8)
 * Runs the New Jarvis (askNewJarvis) against the REAL model on the owner's
 * questions in test/jarvis-eval/cases.json. There is no offline/fixture mode:
 * results only count when the real model answered.
 *
 * Usage:
 *   node scripts/run-jarvis-eval.js             # needs GEMINI_API_KEY (env or .env)
 *   node scripts/run-jarvis-eval.js --case=M1   # single case
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');

// 1. Load Fixtures and Cases
const casesPath = resolve(ROOT_DIR, 'test/jarvis-eval/cases.json');
const fixturePath = resolve(ROOT_DIR, 'test/jarvis-eval/lot3-fixture.json');

const testCases = JSON.parse(readFileSync(casesPath, 'utf-8'));
const lot3Fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));

// 2. Parse CLI Arguments
const args = process.argv.slice(2);
let targetCaseId = null;
let cliApiKey = null;

for (const arg of args) {
  if (arg.startsWith('--case=')) targetCaseId = arg.split('=')[1].toUpperCase();
  else if (arg.startsWith('--api-key=')) cliApiKey = arg.split('=')[1];
}

let resolvedApiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || cliApiKey || '';
if (!resolvedApiKey) {
  try {
    const envContent = readFileSync(resolve(ROOT_DIR, '.env'), 'utf-8');
    for (const line of envContent.split('\n')) {
      const [k, ...vParts] = line.split('=');
      const val = vParts.join('=').trim();
      if (['GEMINI_API_KEY', 'VITE_GEMINI_API_KEY'].includes(k?.trim()) && val) {
        resolvedApiKey = val;
        break;
      }
    }
  } catch {}
}

if (!resolvedApiKey) {
  console.error('No GEMINI_API_KEY found (env, --api-key=, or .env). This eval only runs against the real model.');
  process.exit(1);
}

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
    return t.isWrite && t.ok !== false;
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
  console.log('  SiteTactix Jarvis Evaluation (live model)');
  console.log(`  Model: ${process.env.GEMINI_MODEL || AI_CONFIG.primaryModel} | Cases: ${testCases.length}`);
  console.log('='.repeat(80));

  const casesToRun = targetCaseId
    ? testCases.filter(c => c.id === targetCaseId)
    : testCases;
  const results = [];

  for (const tc of casesToRun) {
    localStore = {};
    clearPendingAction();
    clearSessionDriveListing();

    process.stdout.write(`  Running ${tc.id.padEnd(3)}: "${tc.say.slice(0, 40)}"... `);
    let runResult;
    try {
      runResult = await runNewJarvisLive(tc);
      process.stdout.write('done\n');
    } catch (err) {
      process.stdout.write(`ERROR: ${err.message}\n`);
      runResult = { toolCalls: [], text: `Error: ${err.message}` };
    }
    const evalRes = evaluateCaseResult('new', tc, runResult);
    results.push({ tc, evalRes, runResult });
    await new Promise(r => setTimeout(r, 4500));
  }

  console.log('\nAnswers:');
  console.log('='.repeat(80));
  for (const { tc, evalRes, runResult } of results) {
    console.log(`\n[${tc.id}] ${evalRes.passed ? 'PASS ✓' : 'FAIL ✗'} (${tc.category}) "${tc.say}"${tc.followUp ? ` -> "${tc.followUp}"` : ''}`);
    console.log(`  Tools:  ${(runResult.executedTools || []).map(t => t.name).join(', ') || 'none'}`);
    console.log(`  Answer: "${(runResult.text || '').replace(/\s+/g, ' ').trim()}"`);
    for (const issue of evalRes.issues) console.log(`  ↳ Issue: ${issue}`);
  }

  const passed = results.filter(r => r.evalRes.passed).length;
  const total = results.length;
  const rate = total > 0 ? ((passed / total) * 100).toFixed(1) : 0;
  const unintendedWrites = results.filter(r => r.evalRes.issues.some(i => i.includes('UNINTENDED WRITE'))).length;

  console.log('\n' + '='.repeat(80));
  console.log(`  Passed: ${passed}/${total} (${rate}%) | Unintended writes: ${unintendedWrites}`);
  if (Number(rate) >= 95 && unintendedWrites === 0) {
    console.log('  >> VERDICT: PASS (>=95% and 0 unintended writes) <<');
  } else {
    console.log('  >> VERDICT: FAIL <<');
    process.exitCode = 1;
  }
  console.log('='.repeat(80));
}

runEval().catch(err => {
  console.error('Fatal eval harness error:', err);
  process.exit(1);
});
