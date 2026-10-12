import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NOTION_IDS,
  appendBlockTree,
  cleanRichText,
  createLotPage,
  finishCopyProperties,
  lotProperties,
  notionRequest,
  parseLotRequest,
  readBlockTree,
  toCreateBlock
} from '../api/_lib/notion-lot.js';
import { buildNotionLotRequest, linkNotionPageToProject, localDateString } from '../src/services/notionLot.js';
import { normalizeProjectRecord } from '../src/services/projectService.js';

const text = (content, extra = {}) => ({
  type: 'text', text: { content, link: null }, plain_text: content,
  annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default', ...extra }
});

/**
 * A small fake Notion: the template page (headings → sub-headings → checkboxes, like the real one),
 * Projects and Finishes rows, and every block the app adds.
 */
function fakeNotion({ existingLots = [], templateFinishes = [], failAppendAfter = Infinity } = {}) {
  const children = new Map();
  const blocks = new Map();
  let nextId = 1;
  const addBlock = (parentId, block) => {
    const id = `blk-${nextId++}`;
    const stored = { id, ...block, has_children: false };
    blocks.set(id, stored);
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(id);
    if (blocks.has(parentId)) blocks.get(parentId).has_children = true;
    return stored;
  };

  const T = NOTION_IDS.templatePage;
  addBlock(T, { type: 'callout', callout: { rich_text: [text('Tap a phase to open it')], icon: { type: 'emoji', emoji: '📋' }, color: 'gray_background' } });
  addBlock(T, { type: 'heading_1', heading_1: { rich_text: [text('Inspections')], color: 'default', is_toggleable: false } });
  const site = addBlock(T, { type: 'heading_2', heading_2: { rich_text: [text('SITE SETUP')], color: 'default', is_toggleable: true } });
  addBlock(site.id, { type: 'to_do', to_do: { rich_text: [text('Water meter set')], checked: true, color: 'default' } });
  const framing = addBlock(T, { type: 'heading_2', heading_2: { rich_text: [text('3. FRAMING')], color: 'default', is_toggleable: true } });
  const sub = addBlock(framing.id, { type: 'heading_3', heading_3: { rich_text: [text('3a. Framing')], color: 'default', is_toggleable: true } });
  addBlock(sub.id, { type: 'to_do', to_do: { rich_text: [text('Builder:', { bold: true }), text(' hurricane clips')], checked: false, color: 'red' } });
  addBlock(T, { type: 'child_database', child_database: { title: 'Something odd' } });
  addBlock(T, { type: 'divider', divider: {} });
  addBlock(T, { type: 'paragraph', paragraph: { rich_text: [], color: 'default' } });

  const pages = new Map();
  for (const lot of existingLots) pages.set(lot.id, lot);
  const calls = [];
  let appends = 0;

  const fetchImpl = async (url, options = {}) => {
    const path = String(url).replace('https://api.notion.com/v1/', '');
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ method, path, body, headers: options.headers });

    let match;
    if (method === 'POST' && (match = path.match(/^data_sources\/(.+)\/query$/))) {
      if (match[1] === NOTION_IDS.projectsDataSource) {
        const name = body.filter.title.equals;
        return Response.json({ results: [...pages.values()].filter(p => p.title === name), has_more: false });
      }
      return Response.json({ results: templateFinishes, has_more: false });
    }
    if (method === 'POST' && path === 'pages') {
      const id = `page-${nextId++}`;
      const page = { id, url: `https://www.notion.so/${id}`, parent: body.parent, properties: body.properties };
      pages.set(id, page);
      return Response.json(page);
    }
    if (method === 'PATCH' && (match = path.match(/^pages\/(.+)$/))) {
      Object.assign(pages.get(match[1]), body);
      return Response.json(pages.get(match[1]));
    }
    if (method === 'GET' && (match = path.match(/^blocks\/(.+)\/children/))) {
      const ids = children.get(match[1]) || [];
      return Response.json({ results: ids.map(id => blocks.get(id)), has_more: false });
    }
    if (method === 'PATCH' && (match = path.match(/^blocks\/(.+)\/children$/))) {
      appends += 1;
      if (appends > failAppendAfter) return new Response('{}', { status: 400 });
      const created = body.children.map(block => addBlock(match[1], block));
      return Response.json({ results: created });
    }
    return new Response('{}', { status: 404 });
  };

  const tree = (parentId) => (children.get(parentId) || []).map(id => {
    const block = blocks.get(id);
    const data = block[block.type];
    return {
      type: block.type,
      text: (data.rich_text || []).map(r => r.text.content).join(''),
      checked: data.checked,
      color: data.color,
      children: tree(id)
    };
  });

  return { fetchImpl, pages, calls, tree };
}

const noSleep = async () => {};

test('cleanRichText keeps formatting and turns mentions into plain text', () => {
  const cleaned = cleanRichText([
    text('Builder:', { bold: true }),
    { type: 'mention', plain_text: '@Lot 5', annotations: { bold: false } }
  ]);
  assert.deepEqual(cleaned[0], { type: 'text', text: { content: 'Builder:', link: null }, annotations: text('x', { bold: true }).annotations });
  assert.deepEqual(cleaned[1], { type: 'text', text: { content: '@Lot 5' }, annotations: { bold: false } });
});

test('toCreateBlock unticks checkboxes, keeps toggles and colors, and skips blocks it cannot copy', () => {
  assert.deepEqual(
    toCreateBlock({ type: 'to_do', to_do: { rich_text: [text('Done')], checked: true, color: 'red' } }).to_do.checked,
    false
  );
  const heading = toCreateBlock({ type: 'heading_2', heading_2: { rich_text: [text('Phase')], is_toggleable: true, color: 'default' } });
  assert.equal(heading.heading_2.is_toggleable, true);
  assert.equal(toCreateBlock({ type: 'child_database', child_database: {} }), null);
  assert.equal(toCreateBlock({ type: 'callout', callout: { rich_text: [], icon: { type: 'external', external: {} } } }).callout.icon, undefined);
});

test('createLotPage copies the whole template (3 levels deep) into a new lot page, unticked', async () => {
  const notion = fakeNotion();
  const result = await createLotPage(
    { name: 'Lot 7 – Northwood Trail', address: '12 Oak St, McAllen, TX', startDate: '2026-10-12', spreadsheetId: 'sheet_ABC123xyz' },
    { apiKey: 'secret', fetchImpl: notion.fetchImpl, sleep: noSleep }
  );

  assert.equal(result.existing, false);
  assert.equal(result.skippedBlocks, 1);
  const page = notion.pages.get(result.pageId);
  assert.deepEqual(page.parent, { type: 'data_source_id', data_source_id: NOTION_IDS.projectsDataSource });
  assert.equal(page.properties.Lot.title[0].text.content, 'Lot 7 – Northwood Trail');
  assert.equal(page.properties.Status.select.name, 'Active');
  assert.equal(page.properties.Sheet.url, 'https://docs.google.com/spreadsheets/d/sheet_ABC123xyz/edit');
  assert.equal(page.properties['Start date'].date.start, '2026-10-12');

  const copied = notion.tree(result.pageId);
  assert.deepEqual(copied.map(b => b.type), ['callout', 'heading_1', 'heading_2', 'heading_2', 'divider', 'paragraph']);
  assert.deepEqual(copied[2].children.map(b => [b.text, b.checked]), [['Water meter set', false]]);
  const framingCheck = copied[3].children[0].children[0];
  assert.equal(framingCheck.text, 'Builder: hurricane clips');
  assert.equal(framingCheck.color, 'red');
  assert.equal(framingCheck.checked, false);

  assert.equal(notion.calls.every(c => c.headers.authorization === 'Bearer secret' && c.headers['notion-version']), true);
});

test('createLotPage copies the template\'s standard finishes to the new lot', async () => {
  const notion = fakeNotion({
    templateFinishes: [{
      id: 'fin-1',
      properties: {
        Item: { title: [text('Interior paint')] },
        Category: { select: { name: 'Paint' } },
        'Product / color': { rich_text: [text('Agreeable Gray SW 7029 – satin')] },
        Brand: { rich_text: [] },
        SKU: { rich_text: [text('123')] }
      }
    }]
  });
  const result = await createLotPage({ name: 'Lot 8', address: '', startDate: '', spreadsheetId: '' },
    { apiKey: 'k', fetchImpl: notion.fetchImpl, sleep: noSleep });

  assert.equal(result.finishesCopied, 1);
  const finish = [...notion.pages.values()].find(p => p.parent.data_source_id === NOTION_IDS.finishesDataSource);
  assert.equal(finish.properties.Item.title[0].text.content, 'Interior paint');
  assert.deepEqual(finish.properties.Lot.relation, [{ id: result.pageId }]);
  assert.equal(finish.properties.Category.select.name, 'Paint');
  assert.equal(finish.properties.SKU.rich_text[0].text.content, '123');
  assert.equal(finish.properties.Brand, undefined);
});

test('createLotPage returns the existing page instead of making a second one', async () => {
  const notion = fakeNotion({ existingLots: [{ id: 'old-page', url: 'https://www.notion.so/old', title: 'Lot 9' }] });
  const result = await createLotPage({ name: 'Lot 9', address: '', startDate: '', spreadsheetId: '' },
    { apiKey: 'k', fetchImpl: notion.fetchImpl, sleep: noSleep });

  assert.deepEqual(result, { pageId: 'old-page', url: 'https://www.notion.so/old', existing: true, finishesCopied: 0, skippedBlocks: 0 });
  assert.equal(notion.calls.some(c => c.method === 'POST' && c.path === 'pages'), false);
});

test('a page half-made when copying fails is moved to the trash, and the error is passed on', async () => {
  const notion = fakeNotion({ failAppendAfter: 2 });
  await assert.rejects(
    () => createLotPage({ name: 'Lot 10', address: '', startDate: '', spreadsheetId: '' },
      { apiKey: 'k', fetchImpl: notion.fetchImpl, sleep: noSleep }),
    /Notion could not finish/
  );
  const lot = [...notion.pages.values()].find(p => p.properties?.Lot);
  assert.equal(lot.in_trash, true);
});

test('notionRequest waits and retries when Notion is busy, then gives a clear key error', async () => {
  let tries = 0;
  const slept = [];
  const result = await notionRequest('users/me', {
    apiKey: 'k',
    sleep: async (ms) => { slept.push(ms); },
    fetchImpl: async () => {
      tries += 1;
      return tries === 1
        ? new Response('{}', { status: 429, headers: { 'retry-after': '2' } })
        : Response.json({ ok: true });
    }
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(slept, [2000]);

  await assert.rejects(
    () => notionRequest('users/me', { apiKey: 'k', sleep: noSleep, fetchImpl: async () => new Response('{}', { status: 401 }) }),
    /NOTION_API_KEY/
  );
  await assert.rejects(
    () => notionRequest('users/me', { apiKey: 'k', sleep: noSleep, fetchImpl: async () => new Response('{}', { status: 404 }) }),
    /SiteTactix App/
  );
});

test('readBlockTree and appendBlockTree add more than 100 blocks in chunks, in order', async () => {
  const notion = fakeNotion();
  const nodes = Array.from({ length: 150 }, (_, i) => ({
    block: { type: 'paragraph', paragraph: { rich_text: [text(`line ${i}`)], color: 'default' } },
    children: []
  }));
  const ctx = { apiKey: 'k', fetchImpl: notion.fetchImpl, sleep: noSleep };
  await appendBlockTree('target', nodes, ctx);
  const { nodes: readBack } = await readBlockTree('target', ctx);
  assert.equal(readBack.length, 150);
  assert.equal(readBack[149].block.paragraph.rich_text[0].text.content, 'line 149');
  assert.equal(notion.calls.filter(c => c.method === 'PATCH').length, 2);
});

test('parseLotRequest checks what the browser sent', () => {
  assert.throws(() => parseLotRequest({ name: '  ' }), /needs a name/);
  assert.throws(() => parseLotRequest({ name: 'Lot 1', startDate: '10/12/2026' }), /start date/);
  assert.throws(() => parseLotRequest({ name: 'Lot 1', spreadsheetId: 'bad id/../x' }), /Sheet link/);
  assert.deepEqual(parseLotRequest({ name: ' Lot 1 ', address: ' 1 Main ', startDate: '2026-10-12', spreadsheetId: 'abcdefghij_-12' }),
    { name: 'Lot 1', address: '1 Main', startDate: '2026-10-12', spreadsheetId: 'abcdefghij_-12' });
});

test('lotProperties leaves the Sheet empty when the project has none', () => {
  const properties = lotProperties({ name: 'Lot 2', address: '', startDate: '', spreadsheetId: '' });
  assert.equal(properties.Sheet.url, null);
  assert.equal(properties.Address, undefined);
  assert.equal(properties['Start date'], undefined);
});

test('finishCopyProperties never copies photos', () => {
  const properties = finishCopyProperties({ properties: { Item: { title: [text('Tile')] }, Photo: { files: [{ name: 'x.jpg' }] } } }, 'lot-1');
  assert.equal(properties.Photo, undefined);
});

test('the app sends the project name, full address, today and its Sheet', () => {
  const request = buildNotionLotRequest(
    { name: 'Lot 7', spreadsheetId: 'sheet1' },
    { address: '12 Oak St', cityStateZip: 'McAllen, TX 78504' },
    '2026-10-12'
  );
  assert.deepEqual(request, { name: 'Lot 7', address: '12 Oak St, McAllen, TX 78504', startDate: '2026-10-12', spreadsheetId: 'sheet1' });
  assert.equal(localDateString(new Date(2026, 0, 5)), '2026-01-05');
});

test('a project remembers its Notion page in the saved record', () => {
  const linked = linkNotionPageToProject({ name: 'Lot 7', folderId: 'f1' }, { pageId: 'p1', url: 'https://www.notion.so/p1' });
  const saved = normalizeProjectRecord(linked, 'lot_7');
  assert.equal(saved.notionPageId, 'p1');
  assert.equal(saved.notionPageUrl, 'https://www.notion.so/p1');
  assert.equal(normalizeProjectRecord({ name: 'Lot 8' }).notionPageUrl, '');
});
