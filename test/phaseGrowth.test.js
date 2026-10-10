import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGrowthRequests,
  countReceiptsByPhase,
  findPhaseBlock,
  growPhaseSections,
  planPhaseGrowth
} from '../src/services/phaseGrowth.js';
import { syncUploadedInvoicesDirectly } from '../src/services/directSyncService.js';

const MECH = ['Plumbing Rough-In', 'Electrical & Lighting', 'HVAC / AC Systems', 'Insulation & Alarms'];

// Column A of a category tab laid out per the block contract (rows 1-4 title, block R = 6, 18 rows per block)
function buildTabColumnA(phases, receiptAreaRows = {}) {
  const rows = [['MECHANICALS & UTILITIES'], ['Material'], [''], [''], ['']];
  phases.forEach(phase => {
    rows.push([phase], ['DATE']);
    const size = receiptAreaRows[phase] ?? 10;
    for (let i = 0; i < size; i++) rows.push([i === 0 ? 'No receipts yet' : '']);
    rows.push(['QUOTES']);
    for (let i = 0; i < 4; i++) rows.push([i === 0 ? 'No quote on file' : '']);
    rows.push(['']);
  });
  return rows;
}

function phaseColumn(counts) {
  const rows = [];
  Object.entries(counts).forEach(([phase, n]) => { for (let i = 0; i < n; i++) rows.push([phase]); });
  return rows;
}

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('finding phase blocks on a category tab', () => {
  const tab = buildTabColumnA(MECH);

  test('band row is the exact phase name; QUOTES is the first marker below it', () => {
    assert.deepEqual(findPhaseBlock(tab, 'Plumbing Rough-In'), { bandRow: 6, quotesRow: 18 });
    assert.deepEqual(findPhaseBlock(tab, 'Electrical & Lighting'), { bandRow: 24, quotesRow: 36 });
    assert.deepEqual(findPhaseBlock(tab, 'Insulation & Alarms'), { bandRow: 60, quotesRow: 72 });
  });

  test('missing phase or no QUOTES marker (older template copy) gives null', () => {
    assert.equal(findPhaseBlock(tab, 'Roofing'), null);
    const oldTab = [['MECHANICALS'], ['→ Electrical & Lighting'], ['Electrical & Lighting'], ['Wire', 'Home Depot']];
    assert.equal(findPhaseBlock(oldTab, 'Electrical & Lighting'), null);
  });

  test('Paperwork & Permits: title/total rows 1-5 that read like the phase are ignored', () => {
    const tab = buildTabColumnA(['Paperwork & Permits']);
    tab[0] = ['Paperwork & Permits'];
    tab[3] = ['Paperwork & Permits'];
    tab[4] = ['QUOTES'];
    assert.deepEqual(findPhaseBlock(tab, 'Paperwork & Permits'), { bandRow: 6, quotesRow: 18 });
    const plan = planPhaseGrowth(tab, ['Paperwork & Permits'], countReceiptsByPhase(phaseColumn({ 'Paperwork & Permits': 8 })));
    assert.deepEqual(plan.map(p => [p.insertCount, p.startIndex]), [[8, 17]]);
  });

  test('band and QUOTES match exactly and case-sensitively after trimming', () => {
    const tab = buildTabColumnA(['Roofing']);
    tab[5] = ['  Roofing  '];
    assert.deepEqual(findPhaseBlock(tab, 'Roofing'), { bandRow: 6, quotesRow: 18 });
    tab[5] = ['ROOFING'];
    assert.equal(findPhaseBlock(tab, 'Roofing'), null);
    const lowerQuotes = buildTabColumnA(['Roofing']);
    lowerQuotes[17] = ['Quotes'];
    assert.equal(findPhaseBlock(lowerQuotes, 'Roofing'), null);
  });

  test('receipts are counted per phase without case', () => {
    const counts = countReceiptsByPhase([['Electrical & Lighting'], ['electrical & lighting '], [''], ['Roofing']]);
    assert.equal(counts.get('electrical & lighting'), 2);
    assert.equal(counts.get('roofing'), 1);
  });
});

describe('planning growth', () => {
  test('no rows added while at least 3 spare rows remain', () => {
    const tab = buildTabColumnA(MECH);
    assert.deepEqual(planPhaseGrowth(tab, MECH, countReceiptsByPhase(phaseColumn({ 'Electrical & Lighting': 7 }))), []);
  });

  test('8 receipts in a 10-row area adds 8 rows above QUOTES (10 spare again)', () => {
    const tab = buildTabColumnA(MECH);
    const plan = planPhaseGrowth(tab, MECH, countReceiptsByPhase(phaseColumn({ 'Electrical & Lighting': 8 })));
    assert.equal(plan.length, 1);
    assert.deepEqual(plan[0], {
      phase: 'Electrical & Lighting', bandRow: 24, quotesRow: 36, receiptAreaSize: 10, receiptCount: 8,
      insertCount: 8, startIndex: 35
    });
  });

  test('an already grown area uses its live size; several phases are planned bottom-up', () => {
    const tab = buildTabColumnA(MECH, { 'Plumbing Rough-In': 25 });
    const counts = countReceiptsByPhase(phaseColumn({ 'Plumbing Rough-In': 23, 'HVAC / AC Systems': 12 }));
    const plan = planPhaseGrowth(tab, MECH, counts);
    assert.deepEqual(plan.map(p => [p.phase, p.insertCount, p.startIndex]), [
      ['HVAC / AC Systems', 12, 68],
      ['Plumbing Rough-In', 8, 32]
    ]);
    const body = buildGrowthRequests(42, plan);
    assert.deepEqual(body.requests[0], {
      insertDimension: { range: { sheetId: 42, dimension: 'ROWS', startIndex: 68, endIndex: 80 }, inheritFromBefore: true }
    });
  });
});

describe('growing phase sections against the Sheets API', () => {
  const tabs = [
    { sheetId: 7, title: 'Mechanicals & Utilities' },
    { sheetId: 9, title: 'Paint & Tile' },
    { sheetId: 1, title: 'Transactions' }
  ];

  function mock({ tabsColumnA, phases, failUpdate = false, failRead = false }) {
    const calls = { reads: [], updates: [] };
    globalThis.fetch = async (url, options = {}) => {
      const decoded = decodeURIComponent(String(url));
      if (decoded.includes('values:batchGet')) {
        calls.reads.push(decoded);
        if (failRead) return { ok: false, status: 500, text: async () => 'down' };
        const requested = new URL(String(url)).searchParams.getAll('ranges');
        return {
          ok: true,
          json: async () => ({
            valueRanges: requested.map(r => (r.startsWith('Transactions!E2:E5000')
              ? { values: phases }
              : { values: tabsColumnA[r.split('!')[0].replace(/^'|'$/g, '')] || [] }))
          })
        };
      }
      if (decoded.endsWith(':batchUpdate')) {
        calls.updates.push(JSON.parse(options.body));
        if (failUpdate) return { ok: false, status: 400, text: async () => 'protected' };
        return { ok: true, json: async () => ({}) };
      }
      throw new Error(`Unexpected ${decoded}`);
    };
    return calls;
  }

  test('reads once, then sends one insert request for the tab that needs room', async () => {
    const calls = mock({
      tabsColumnA: { 'Mechanicals & Utilities': buildTabColumnA(MECH), 'Paint & Tile': buildTabColumnA(['Tile & Flooring', 'Paint & Finishes']) },
      phases: phaseColumn({ 'Electrical & Lighting': 9, 'Tile & Flooring': 2 })
    });
    const result = await growPhaseSections('tok', 'sheet_1', { tabs, categoryNames: ['Mechanicals & Utilities', 'Paint & Tile'] });
    assert.equal(calls.reads.length, 1);
    assert.match(calls.reads[0], /ranges=Transactions!E2:E5000/);
    assert.match(calls.reads[0], /ranges='Mechanicals & Utilities'!A1:A2000/);
    assert.equal(calls.updates.length, 1);
    assert.deepEqual(calls.updates[0].requests, [{
      insertDimension: { range: { sheetId: 7, dimension: 'ROWS', startIndex: 35, endIndex: 44 }, inheritFromBefore: true }
    }]);
    assert.deepEqual(result, { grown: [{ tab: 'Mechanicals & Utilities', phase: 'Electrical & Lighting', inserted: 9 }], errors: [] });
  });

  test('older tabs without QUOTES markers are skipped silently', async () => {
    const calls = mock({
      tabsColumnA: { 'Mechanicals & Utilities': [['→ Electrical & Lighting'], ['Electrical & Lighting']] },
      phases: phaseColumn({ 'Electrical & Lighting': 40 })
    });
    const result = await growPhaseSections('tok', 'sheet_1', { tabs, categoryNames: ['Mechanicals & Utilities'] });
    assert.equal(calls.updates.length, 0);
    assert.deepEqual(result, { grown: [], errors: [] });
  });

  test('no matching tab means no requests at all', async () => {
    const calls = mock({ tabsColumnA: {}, phases: [] });
    const result = await growPhaseSections('tok', 'sheet_1', { tabs, categoryNames: ['Interior Finishes'] });
    assert.equal(calls.reads.length, 0);
    assert.deepEqual(result, { grown: [], errors: [] });
  });

  test('API failures and thrown errors come back as errors, never thrown', async () => {
    mock({ tabsColumnA: { 'Mechanicals & Utilities': buildTabColumnA(MECH) }, phases: phaseColumn({ 'Electrical & Lighting': 9 }), failUpdate: true });
    const failedUpdate = await growPhaseSections('tok', 'sheet_1', { tabs, categoryNames: ['Mechanicals & Utilities'] });
    assert.equal(failedUpdate.errors.length, 1);
    assert.match(failedUpdate.errors[0], /protected/);

    mock({ tabsColumnA: {}, phases: [], failRead: true });
    const failedRead = await growPhaseSections('tok', 'sheet_1', { tabs, categoryNames: ['Mechanicals & Utilities'] });
    assert.equal(failedRead.errors.length, 1);

    globalThis.fetch = async () => { throw new Error('offline'); };
    const thrown = await growPhaseSections('tok', 'sheet_1', { tabs, categoryNames: ['Mechanicals & Utilities'] });
    assert.match(thrown.errors[0], /offline/);
  });
});

describe('sync grows phase sections after adding rows', () => {
  const V2_TAB_LIST = ['Dashboard', 'Contracts', 'Mechanicals & Utilities', 'Project Info', 'Lists', 'Transactions'];
  const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

  function installSyncMock({ failGrowth = false } = {}) {
    const log = { appends: 0, updates: [] };
    const file = {
      id: 'file_a', name: 'a.pdf', mimeType: 'application/pdf', webViewLink: 'https://drive.google.com/file/d/file_a/view',
      description: JSON.stringify({
        vendor: 'Vallejo Electric LLC', description: 'Draw', amount: 3000, costCategory: 'labor', date: '2026-09-20',
        checkNumber: '1051', tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Electrical & Lighting', receiptId: 'draft_1'
      })
    };
    globalThis.fetch = async (url, options = {}) => {
      const raw = String(url);
      const decoded = decodeURIComponent(raw);
      const method = options.method || 'GET';
      if (raw.includes('googleapis.com/drive/v3/files') && method === 'GET') {
        if (decoded.includes("'uploads_folder' in parents")) return json({ files: [file] });
        if (decoded.includes("name='Invoice Uploads'")) return json({ files: [{ id: 'uploads_folder' }] });
        return json({ files: [{ id: 'some_folder', name: 'Folder' }] });
      }
      if (raw.includes('googleapis.com/drive/v3/files/') && method === 'PATCH') return json({ id: 'file_a' });
      if (raw.includes('spreadsheets/sheet_1?')) {
        return json({ sheets: V2_TAB_LIST.map((title, i) => ({ properties: { sheetId: i + 100, title } })) });
      }
      if (decoded.includes('values:batchGet')) {
        if (failGrowth) throw new Error('network down');
        const requested = new URL(String(url)).searchParams.getAll('ranges');
        return json({ valueRanges: requested.map(r => (r.startsWith('Transactions')
          ? { values: phaseColumn({ 'Electrical & Lighting': 8 }) }
          : { values: buildTabColumnA(MECH) })) });
      }
      if (decoded.endsWith(':batchUpdate')) {
        log.updates.push(JSON.parse(options.body));
        return json({});
      }
      if (decoded.includes('Transactions!J2:J')) return json({ values: [] });
      if (decoded.includes(':append')) { log.appends += 1; return json({}); }
      throw new Error(`Unexpected ${method} ${decoded}`);
    };
    return log;
  }

  test('adds rows above QUOTES on the tab that received the receipt', async () => {
    const log = installSyncMock();
    const result = await syncUploadedInvoicesDirectly('tok', 'project_folder', 'sheet_1');
    assert.equal(result.processedCount, 1);
    assert.equal(log.appends, 1);
    assert.equal(log.updates.length, 1);
    assert.deepEqual(log.updates[0].requests[0].insertDimension.range, { sheetId: 102, dimension: 'ROWS', startIndex: 35, endIndex: 43 });
    assert.equal(result.growthNote, null);
  });

  test('a growth failure leaves the sync successful with a short note', async () => {
    installSyncMock({ failGrowth: true });
    const result = await syncUploadedInvoicesDirectly('tok', 'project_folder', 'sheet_1');
    assert.equal(result.processedCount, 1);
    assert.deepEqual(result.failed, []);
    assert.match(result.growthNote, /insert rows above its QUOTES row/);
  });
});
