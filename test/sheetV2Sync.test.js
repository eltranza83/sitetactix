import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { syncUploadedInvoicesDirectly } from '../src/services/directSyncService.js';
import { fetchProjectDashboardData } from '../src/services/sheetsDataService.js';
import {
  createProjectSheetFromTemplate,
  projectInfoChanged,
  templateCopyName,
  buildProjectInfoFromForm,
  projectDetailsFromSheet
} from '../src/services/projectSheet.js';

const originalFetch = globalThis.fetch;
const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

const V2_TABS = ['Dashboard', 'Contracts', 'Paint & Tile', 'Project Info', 'Lists', 'Transactions'];

function makeFile(id, extra = {}) {
  return {
    id,
    name: `${id}.pdf`,
    mimeType: 'application/pdf',
    webViewLink: `https://drive.google.com/file/d/${id}/view`,
    description: JSON.stringify({
      vendor: 'Pedro Salinas',
      description: 'Tile labor draw',
      amount: 3000,
      costCategory: 'labor',
      date: '2026-09-20',
      checkNumber: '1050',
      tradeCategory: 'Paint_Tile',
      tradePhase: 'Tile & Flooring',
      ...extra
    })
  };
}

function installMock({ tabs = V2_TABS, files = [], existingIds = [] } = {}) {
  const log = { appends: [], puts: [], tagged: [], moved: [], reads: [] };
  globalThis.fetch = async (url, options = {}) => {
    const raw = String(url);
    const decoded = decodeURIComponent(raw);
    const method = options.method || 'GET';

    if (raw.includes('googleapis.com/drive/v3/files') && method === 'GET') {
      if (decoded.includes("'uploads_folder' in parents")) return json({ files });
      if (decoded.includes("name='Invoice Uploads'")) return json({ files: [{ id: 'uploads_folder' }] });
      return json({ files: [{ id: 'some_folder', name: 'Folder' }] });
    }
    if (raw.includes('googleapis.com/drive/v3/files/') && method === 'PATCH') {
      const fileId = raw.match(/\/files\/([a-zA-Z0-9_-]+)/)[1];
      if (raw.includes('addParents')) log.moved.push(fileId);
      else log.tagged.push(fileId);
      return json({ id: fileId });
    }
    if (raw.includes('sheets.googleapis.com/v4/spreadsheets/sheet_1?')) {
      return json({ sheets: tabs.map((title, i) => ({ properties: { sheetId: i, title } })) });
    }
    if (raw.includes('sheets.googleapis.com/v4/spreadsheets/sheet_1/values/')) {
      log.reads.push(decoded);
      if (method === 'POST' && decoded.includes(':append')) {
        log.appends.push({ url: decoded, body: JSON.parse(options.body) });
        return json({ updates: { updatedRows: 1 } });
      }
      if (method === 'PUT') {
        log.puts.push(decoded);
        return json({});
      }
      if (decoded.includes('Transactions!J2:J')) return json({ values: existingIds.map(id => [id]) });
      return json({ values: [] });
    }
    // Phase-section growth check after the sync (tabs here have no QUOTES markers, so nothing grows)
    if (raw.includes('sheets.googleapis.com/v4/spreadsheets/sheet_1/values:batchGet')) return json({ valueRanges: [] });
    throw new Error(`Unexpected request ${method} ${decoded}`);
  };
  return log;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('sync to a new-layout Sheet', () => {
  it('appends one Transactions row per receipt and never touches the Dashboard or category tabs', async () => {
    const log = installMock({
      files: [
        makeFile('file_a', { receiptId: 'draft_1_split_0' }),
        makeFile('file_b', { receiptId: 'draft_1_split_1', costCategory: 'material', amount: 120.5, vendor: 'Floor and Decor' })
      ]
    });
    const result = await syncUploadedInvoicesDirectly('tok', 'project_folder', 'sheet_1');
    assert.equal(result.processedCount, 2);
    assert.deepEqual(result.failed, []);
    assert.equal(log.appends.length, 2);
    assert.equal(log.puts.length, 0, 'no PUT writes into category tabs');
    const { url, body } = log.appends[0];
    assert.match(url, /\/values\/Transactions!A:J:append\?valueInputOption=USER_ENTERED&insertDataOption=OVERWRITE$/);
    assert.deepEqual(body.values, [[
      '2026-09-20', 'Pedro Salinas', 'Tile labor draw', 'Paint & Tile', 'Tile & Flooring',
      '', 3000, '1050', 'https://drive.google.com/file/d/file_a/view', 'draft_1_split_0'
    ]]);
    assert.equal(log.appends[1].body.values[0][5], 120.5);
    assert.ok(log.reads.every(r => !/Dashboard|Paint & Tile'?!/.test(r.split('/values/')[1] || '')));
    assert.deepEqual(log.tagged, ['file_a', 'file_b']);
    assert.deepEqual(log.moved, ['file_a', 'file_b']);
  });

  it('skips a receipt whose Receipt ID is already in Transactions, but still files it away', async () => {
    const log = installMock({
      files: [makeFile('file_a', { receiptId: 'draft_1' }), makeFile('file_b'), makeFile('file_c', { receiptId: 'draft_3' })],
      existingIds: ['draft_1', 'file_b']
    });
    const result = await syncUploadedInvoicesDirectly('tok', 'project_folder', 'sheet_1');
    assert.equal(result.processedCount, 3);
    assert.equal(log.appends.length, 1);
    assert.equal(log.appends[0].body.values[0][9], 'draft_3');
    assert.deepEqual(log.tagged, ['file_a', 'file_b', 'file_c']);
  });

  it('two files with the same Receipt ID in one run give one row', async () => {
    const log = installMock({ files: [makeFile('file_a', { receiptId: 'draft_7' }), makeFile('file_b', { receiptId: 'draft_7' })] });
    await syncUploadedInvoicesDirectly('tok', 'project_folder', 'sheet_1');
    assert.equal(log.appends.length, 1);
  });

  it('files already tagged as written are not written again', async () => {
    const tagged = { ...makeFile('file_a'), appProperties: { sheetRowWritten: 'true' } };
    const log = installMock({ files: [tagged] });
    const result = await syncUploadedInvoicesDirectly('tok', 'project_folder', 'sheet_1');
    assert.equal(result.processedCount, 1);
    assert.equal(log.appends.length, 0);
  });

  it('an old-layout Sheet does not use Transactions', async () => {
    const log = installMock({ tabs: ['Summary_Dashboard', 'Paint_Tile', 'Transactions'], files: [makeFile('file_a')] });
    const result = await syncUploadedInvoicesDirectly('tok', 'project_folder', 'sheet_1');
    assert.equal(log.appends.length, 0);
    assert.ok(!log.reads.some(r => r.includes('Transactions!J2:J')));
    // The old path looks for the phase in the category tab (empty here), so it reports the missing phase
    assert.equal(result.failed.length, 1);
    assert.match(result.failed[0].reason, /Phase header "Tile & Flooring" not found/);
  });
});

describe('Dashboard data picks the reader by layout', () => {
  it('new-layout Sheets read Project Info / Transactions / Contracts', async () => {
    const urls = [];
    globalThis.fetch = async (url) => {
      const decoded = decodeURIComponent(String(url));
      urls.push(decoded);
      if (decoded.includes('?fields=sheets')) return json({ sheets: V2_TABS.map(title => ({ properties: { title } })) });
      return json({ valueRanges: [
        { values: [['Project Name', 'Lot 3'], ['Street Address', '12 Oak'], ['City, State, Zip', 'McAllen, TX 78504']] },
        { values: [['Date'], ['2026-09-01', 'Home Depot', 'x', 'Paint & Tile', 'Tile & Flooring', 100, '', '', '', 'r1']] },
        { values: [['Sub']] }
      ] });
    };
    const data = await fetchProjectDashboardData('tok', 'sheet_1');
    assert.equal(data.projectInfo.layout, 'v2');
    assert.equal(data.projectInfo.address, '12 Oak');
    assert.equal(data.projectInfo.cityStateZip, 'McAllen, TX 78504');
    assert.equal(data.projectInfo.totalSpent, 100);
    assert.ok(!urls.some(u => u.includes('Summary_Dashboard')));
  });

  it('old Sheets keep the Summary_Dashboard reader', async () => {
    const urls = [];
    globalThis.fetch = async (url) => {
      const decoded = decodeURIComponent(String(url));
      urls.push(decoded);
      if (decoded.includes('?fields=sheets')) return json({ sheets: [{ properties: { title: 'Summary_Dashboard' } }] });
      return json({ valueRanges: [{ range: 'Summary_Dashboard!A1:E', values: [['Street Address:', '9 Elm'], ['Real Budget Deposits (Capital)', '$5.00']] }] });
    };
    const data = await fetchProjectDashboardData('tok', 'sheet_1');
    assert.equal(data.projectInfo.address, '9 Elm');
    assert.equal(data.projectInfo.deposits, '$5.00');
    assert.equal(data.projectInfo.layout, undefined);
    assert.ok(urls.some(u => u.includes('Summary_Dashboard!A1:E')));
  });
});

describe('new project Sheet from the template', () => {
  it('copies the template into the lot folder and fills Project Info B2:B7', async () => {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url: decodeURIComponent(String(url)), options });
      if (String(url).includes('/copy')) return json({ id: 'new_sheet', name: 'Lot 4 – SiteTactix' });
      return json({});
    };
    const info = buildProjectInfoFromForm(' Lot 4 ', { address: '14 Northwood Trail', cityStateZip: 'McAllen, TX 78504', scope: 'SFR', budgetBuild: '250000', lotCost: '72,000' });
    const result = await createProjectSheetFromTemplate({
      accessToken: 'tok', templateId: 'template_1', folderId: 'lot_folder', projectName: 'Lot 4', info
    });

    assert.deepEqual(result.sheet, { id: 'new_sheet', name: 'Lot 4 – SiteTactix' });
    assert.equal(result.infoWritten, true);
    assert.equal(calls.length, 2);

    const copy = calls[0];
    assert.equal(copy.url, 'https://www.googleapis.com/drive/v3/files/template_1/copy?fields=id,name,webViewLink&supportsAllDrives=true');
    assert.equal(copy.options.method, 'POST');
    assert.equal(copy.options.headers.Authorization, 'Bearer tok');
    assert.deepEqual(JSON.parse(copy.options.body), { name: 'Lot 4 – SiteTactix', parents: ['lot_folder'] });

    const write = calls[1];
    assert.match(write.url, /spreadsheets\/new_sheet\/values\/'Project Info'!B2:B7\?valueInputOption=USER_ENTERED$/);
    assert.deepEqual(JSON.parse(write.options.body).values, [['Lot 4'], ['14 Northwood Trail'], ['McAllen, TX 78504'], ['SFR'], [250000], [72000]]);
  });

  it('keeps the copy when Project Info could not be written', async () => {
    globalThis.fetch = async (url) => (String(url).includes('/copy')
      ? json({ id: 'new_sheet', name: 'Lot 5 – SiteTactix' })
      : { ok: false, status: 400, statusText: 'Bad', text: async () => 'no tab' });
    const result = await createProjectSheetFromTemplate({ accessToken: 'tok', templateId: 't', folderId: 'f', projectName: 'Lot 5', info: {} });
    assert.equal(result.sheet.id, 'new_sheet');
    assert.equal(result.infoWritten, false);
  });

  it('copy name, form values and change detection', () => {
    assert.equal(templateCopyName('Lot 3 – Northwood Trail'), 'Lot 3 – Northwood Trail – SiteTactix');
    const fromSheet = { name: 'Lot 3', address: '', cityStateZip: 'McAllen, TX', scope: 'SFR', budgetBuild: 240000, lotCost: 0 };
    assert.deepEqual(projectDetailsFromSheet(fromSheet), { address: '', cityStateZip: 'McAllen, TX', scope: 'SFR', budgetBuild: '240000', lotCost: '' });
    const same = buildProjectInfoFromForm('Lot 3', projectDetailsFromSheet(fromSheet));
    assert.equal(projectInfoChanged(fromSheet, same), false);
    assert.equal(projectInfoChanged(fromSheet, { ...same, budgetBuild: '$240,000' }), false);
    assert.equal(projectInfoChanged(fromSheet, { ...same, address: '12 Oak' }), true);
    assert.equal(projectInfoChanged(null, same), true);
  });
});
