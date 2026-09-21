import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectRequiredGroundingDomains,
  buildGroundingSystemInstruction,
  buildLeanSynthesisPrompt
} from '../src/services/builderBrainService.js';
import {
  AI_TOOL_DECLARATIONS,
  AI_TOOL_CLUSTERS,
  selectRelevantToolDeclarations
} from '../api/_lib/ai-tools-definitions.js';

test('Speed & Token Optimization: Domain Partitioning and Tool Subsetting Suite', async (t) => {

  await t.test('1. detectRequiredGroundingDomains isolates Financials domain for payment inquiries', () => {
    const domains = detectRequiredGroundingDomains('do we owe the plumber any money?');
    assert.equal(domains.financials, true);
    assert.equal(domains.inspections, false);
    assert.equal(domains.drive, false);
    assert.equal(domains.siteSetup, false);
    assert.equal(domains.memories, true);
    assert.equal(domains.isBroad, false);
  });

  await t.test('2. detectRequiredGroundingDomains isolates Inspections domain for building official inquiries', () => {
    const domains = detectRequiredGroundingDomains('did city framing inspection pass on Lot 3?');
    assert.equal(domains.financials, false);
    assert.equal(domains.inspections, true);
    assert.equal(domains.drive, false);
    assert.equal(domains.memories, true);
    assert.equal(domains.isBroad, false);
  });

  await t.test('3. detectRequiredGroundingDomains isolates Finishes domain for paint and tile inquiries', () => {
    const domains = detectRequiredGroundingDomains('what is the Sherwin Williams paint color for the master bedroom?');
    assert.equal(domains.financials, false);
    assert.equal(domains.finishes, true);
    assert.equal(domains.inspections, false);
    assert.equal(domains.drive, false);
    assert.equal(domains.memories, true);
    assert.equal(domains.isBroad, false);
  });

  await t.test('4. detectRequiredGroundingDomains isolates Drive domain for plans and folder inquiries', () => {
    const domains = detectRequiredGroundingDomains('what files or PDFs are in the architectural plans folder?');
    assert.equal(domains.drive, true);
    assert.equal(domains.financials, false);
    assert.equal(domains.inspections, false);
    assert.equal(domains.memories, true);
    assert.equal(domains.isBroad, false);
  });

  await t.test('5. detectRequiredGroundingDomains fails open to ALL domains on broad or audit queries', () => {
    const auditDomains = detectRequiredGroundingDomains('audit this project and give me a full status report');
    assert.equal(auditDomains.isBroad, true);
    assert.equal(auditDomains.financials, true);
    assert.equal(auditDomains.inspections, true);
    assert.equal(auditDomains.finishes, true);
    assert.equal(auditDomains.drive, true);
    assert.equal(auditDomains.siteSetup, true);
    assert.equal(auditDomains.memories, true);
  });

  await t.test('6. detectRequiredGroundingDomains preserves backwards compatibility when query is omitted', () => {
    const emptyDomains = detectRequiredGroundingDomains('');
    assert.equal(emptyDomains.isBroad, true);
    assert.equal(emptyDomains.financials, true);
    assert.equal(emptyDomains.inspections, true);
    assert.equal(emptyDomains.finishes, true);
    assert.equal(emptyDomains.drive, true);
  });

  await t.test('7. detectRequiredGroundingDomains carries over previous conversation context on follow-up questions', () => {
    const history = [
      { role: 'user', parts: [{ text: 'How much do we owe Rios Plumbing?' }] },
      { role: 'model', parts: [{ text: 'You owe Rios Plumbing $1,500.' }] }
    ];
    // Follow-up query introduces inspection while retaining plumbing financial context
    const domains = detectRequiredGroundingDomains('and did the city rough-in inspection pass?', history);
    assert.equal(domains.inspections, true);
    assert.equal(domains.financials, true);
    assert.equal(domains.memories, true);
  });

  await t.test('8. selectRelevantToolDeclarations selects lean tool subset for domain queries', () => {
    const tools = selectRelevantToolDeclarations('do we owe the plumber any money?');
    const toolNames = tools.map(t => t.name);

    // Should include financial tools
    assert.ok(toolNames.includes('get_subcontractor_balance'));
    assert.ok(toolNames.includes('get_vendor_history'));
    assert.ok(toolNames.includes('save_memory'));

    // Should NOT include drive or weather tools
    assert.ok(!toolNames.includes('get_drive_files'));
    assert.ok(!toolNames.includes('get_weather_for_jobsite'));

    // Subset should be significantly smaller than all 33 tools
    assert.ok(tools.length < AI_TOOL_DECLARATIONS.length);
    assert.ok(tools.length <= 15, `Expected <= 15 tools, got ${tools.length}`);
  });

  await t.test('9. selectRelevantToolDeclarations returns all 33 tools on broad/audit inquiries', () => {
    const tools = selectRelevantToolDeclarations('audit all phases and give me a full project update');
    assert.equal(tools.length, AI_TOOL_DECLARATIONS.length);
  });

  await t.test('10. buildGroundingSystemInstruction generates significantly smaller prompt for domain-specific queries', () => {
    const mockContext = {
      activeProjectName: 'Lot 3',
      dashData: {
        projectInfo: { budgetGross: '$350,000', totalSpent: '$50,000' },
        subcontractors: Array.from({ length: 26 }, (_, i) => ({
          phase: `Phase ${i + 1}`,
          payee: `Contractor ${i + 1}`,
          quote: '$10,000',
          totalSpent: '$2,000',
          remainingBalance: '$8,000',
          payments: [{ amount: '$2,000', vendor: `Contractor ${i + 1}`, date: '2026-08-01', checkNumber: '101' }]
        }))
      },
      inspectionsData: Array.from({ length: 6 }, (_, i) => ({
        stageName: `Inspection Stage ${i + 1}`,
        description: `Stage description ${i + 1}`,
        passedCount: 5,
        totalItems: 5,
        isFullyPassed: true,
        items: Array.from({ length: 8 }, (_, j) => ({ title: `Item ${j + 1}`, status: 'PASSED' }))
      })),
      driveData: {
        subfolders: Array.from({ length: 10 }, (_, i) => ({
          folderName: `Folder ${i + 1}`,
          files: Array.from({ length: 5 }, (_, j) => ({ name: `File_${i}_${j}.pdf` }))
        }))
      },
      projectSpecs: [{ category: 'Paint', finishName: 'SW Repose Gray', location: 'Whole House', scope: 'whole_house' }],
      siteSetupData: { protocol: { lotPrepList: ['Water meter set'] }, checks: {} },
      memoriesData: [{ memoryText: 'Plumber prefers check' }]
    };

    // Full / Broad Prompt
    const fullPrompt = buildGroundingSystemInstruction({
      ...mockContext,
      query: 'give me a full audit of this project'
    });

    // Lean Domain-Specific Prompt
    const leanPrompt = buildGroundingSystemInstruction({
      ...mockContext,
      query: 'do we owe the plumber any money?'
    });

    assert.ok(fullPrompt.includes('[MODULE 1: LIVE FINANCIAL SPREADSHEET'));
    assert.ok(fullPrompt.includes('[MODULE 3: MUNICIPAL INSPECTION PROTOCOLS'));
    assert.ok(fullPrompt.includes('[MODULE 6: GOOGLE DRIVE FOLDER'));

    assert.ok(leanPrompt.includes('[MODULE 1: LIVE FINANCIAL SPREADSHEET'));
    // Inspections and Drive should be excluded from the lean plumbing query
    assert.ok(!leanPrompt.includes('[MODULE 3: MUNICIPAL INSPECTION PROTOCOLS'));
    assert.ok(!leanPrompt.includes('[MODULE 6: GOOGLE DRIVE FOLDER'));

    // Lean prompt should be substantially smaller than full prompt (>40% character reduction)
    const reductionRatio = (fullPrompt.length - leanPrompt.length) / fullPrompt.length;
    assert.ok(reductionRatio > 0.40, `Expected > 40% reduction, got ${(reductionRatio * 100).toFixed(1)}% reduction`);
  });

  await t.test('11. selectRelevantToolDeclarations includes get_purchasing_list for purchasing and material inquiries', () => {
    const purchasingQueries = [
      'show me the purchasing list for the plumber',
      'what does the plumber need',
      'what are we buying for the electrician',
      'show me plumbing materials',
      'what fixtures are needed for lot 3',
      'what items do we need to order',
      'what supplies does the painter need',
      'what did we order for appliances'
    ];

    for (const q of purchasingQueries) {
      const tools = selectRelevantToolDeclarations(q);
      const toolNames = tools.map(t => t.name);
      assert.ok(
        toolNames.includes('get_purchasing_list'),
        `Query "${q}" should include "get_purchasing_list", but tools were: ${toolNames.join(', ')}`
      );
    }
  });

  await t.test('12. detectRequiredGroundingDomains enables finishes domain and omits financial spreadsheet for pure purchasing inquiries', () => {
    const domains = detectRequiredGroundingDomains('show me the purchasing list for the plumber');
    assert.equal(domains.finishes, true);
    assert.equal(domains.financials, false); // Pure purchasing omits 10,000-token spreadsheet
    assert.equal(domains.inspections, false);
    assert.equal(domains.drive, false);
  });

  await t.test('13. detectRequiredGroundingDomains enables financials domain when trade inquiry asks about money or payments', () => {
    const oweDomains = detectRequiredGroundingDomains('how much do we owe the electrician?');
    assert.equal(oweDomains.financials, true);
    assert.equal(oweDomains.finishes, false);

    const paidDomains = detectRequiredGroundingDomains('how much did we pay the plumber?');
    assert.equal(paidDomains.financials, true);
    assert.equal(paidDomains.finishes, false);

    const generalTrade = detectRequiredGroundingDomains('tell me about the framer');
    assert.equal(generalTrade.financials, true);
    assert.equal(generalTrade.finishes, false);
  });

  await t.test('14. buildLeanSynthesisPrompt generates a lightweight prompt with tool outcomes and user preferences', () => {
    const mockTelemetry = [
      {
        name: 'get_purchasing_list',
        args: { trade: 'electrical' },
        source: 'Firestore (Lot 3 Purchasing Checklist)',
        result: {
          items: [
            { name: 'Ceiling fans', quantity: 1, status: 'needed' },
            { name: 'Smart switches', quantity: 1, status: 'needed' }
          ]
        }
      }
    ];

    const synthPrompt = buildLeanSynthesisPrompt({
      activeProjectName: 'Lot 3',
      toolTelemetryList: mockTelemetry,
      userPreferencesPrompt: 'Be direct and concise.',
      memoriesData: [{ text: 'Electrician works Mondays.' }]
    });

    // Contains essential context and evidence
    assert.ok(synthPrompt.includes('Lot 3'));
    assert.ok(synthPrompt.includes('[MULTI-INTENT TOOL EXECUTION OUTCOMES]'));
    assert.ok(synthPrompt.includes('Be direct and concise.'));
    assert.ok(synthPrompt.includes('Electrician works Mondays.'));

    // Strictly does NOT contain bulky spreadsheet or municipal inspection modules
    assert.ok(!synthPrompt.includes('[MODULE 1: LIVE FINANCIAL SPREADSHEET'));
    assert.ok(!synthPrompt.includes('[MODULE 3: MUNICIPAL INSPECTION PROTOCOLS'));
    assert.ok(!synthPrompt.includes('[MODULE 6: GOOGLE DRIVE FOLDER'));

    // Lean prompt length should be under 5,000 characters (typically ~4,000 chars, ~1,000 tokens vs 35,000+ chars previously)
    assert.ok(synthPrompt.length < 5000, `Expected < 5000 chars, got ${synthPrompt.length}`);
  });

});

