import { HttpError } from './firebase-auth.js';

/**
 * Makes a lot's Notion page (in SiteTactix → Projects) from the "NEW LOT TEMPLATE (duplicate me)" page:
 * the template's checklists and notes are copied live, so edits to the template show up in every new lot.
 */

export const NOTION_VERSION = '2025-09-03';
export const NOTION_IDS = {
  projectsDataSource: '8c04b7a2-7442-469b-8b19-99b7b8d4becf',
  finishesDataSource: '5ad21128-862c-42fa-8c85-0915544df0eb',
  templatePage: '3f053b8e-2336-8151-a336-e97f4ebca8e8'
};

const MAX_TRIES = 3;
const APPEND_LIMIT = 100;

export function resolveNotionKey() {
  return process.env.NOTION_API_KEY || '';
}

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** One Notion API call. Waits and retries when Notion is busy (429) or briefly down (5xx). */
export async function notionRequest(path, { method = 'GET', body, apiKey, fetchImpl = fetch, sleep = wait } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(`https://api.notion.com/v1/${path}`, {
        method,
        headers: {
          authorization: `Bearer ${apiKey}`,
          'notion-version': NOTION_VERSION,
          'content-type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch {
      if (attempt < MAX_TRIES) { await sleep(1000 * attempt); continue; }
      throw new HttpError(502, 'Could not reach Notion. Please try again.');
    }

    if (response.ok) return response.json();

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < MAX_TRIES) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : 1000 * attempt);
      continue;
    }
    throw notionError(response.status);
  }
}

function notionError(status) {
  if (status === 401) return new HttpError(502, 'Notion did not accept the app\'s key. Check NOTION_API_KEY in Vercel.');
  if (status === 403 || status === 404) {
    return new HttpError(502, 'The app can\'t see the SiteTactix pages in Notion. Give the "SiteTactix App" connection access to the SiteTactix page.');
  }
  if (status === 429) return new HttpError(503, 'Notion is busy right now. Please try again in a minute.');
  return new HttpError(502, 'Notion could not finish the request. Please try again.');
}

/** Rich text as Notion accepts it on create (mentions and equations become their plain text). */
export function cleanRichText(richText = []) {
  return richText.map(part => {
    const annotations = part.annotations;
    if (part.type === 'text') {
      return { type: 'text', text: { content: part.text.content, link: part.text.link || null }, annotations };
    }
    return { type: 'text', text: { content: part.plain_text || '' }, annotations };
  });
}

const TEXT_BLOCKS = new Set(['paragraph', 'bulleted_list_item', 'numbered_list_item', 'toggle', 'quote']);
const HEADINGS = new Set(['heading_1', 'heading_2', 'heading_3']);

/** A template block as a "create" block (no ids, checkboxes unticked). Returns null for block types we can't copy. */
export function toCreateBlock(block) {
  const { type } = block;
  const data = block[type] || {};
  if (TEXT_BLOCKS.has(type)) {
    return { type, [type]: { rich_text: cleanRichText(data.rich_text), color: data.color || 'default' } };
  }
  if (HEADINGS.has(type)) {
    return {
      type,
      [type]: { rich_text: cleanRichText(data.rich_text), color: data.color || 'default', is_toggleable: Boolean(data.is_toggleable) }
    };
  }
  if (type === 'to_do') {
    return { type, to_do: { rich_text: cleanRichText(data.rich_text), checked: false, color: data.color || 'default' } };
  }
  if (type === 'callout') {
    const callout = { rich_text: cleanRichText(data.rich_text), color: data.color || 'default' };
    if (data.icon?.type === 'emoji') callout.icon = { type: 'emoji', emoji: data.icon.emoji };
    return { type, callout };
  }
  if (type === 'divider') return { type, divider: {} };
  return null;
}

async function readChildren(blockId, ctx, skipped) {
  const nodes = [];
  let cursor;
  do {
    const query = `page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`;
    const page = await notionRequest(`blocks/${blockId}/children?${query}`, ctx);
    for (const block of page.results || []) {
      const createBlock = toCreateBlock(block);
      if (!createBlock) { skipped.count += 1; continue; }
      const children = block.has_children ? await readChildren(block.id, ctx, skipped) : [];
      nodes.push({ block: createBlock, children });
    }
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return nodes;
}

/** Reads a page's blocks (and their nested blocks) as a tree of create blocks, counting blocks it can't copy. */
export async function readBlockTree(blockId, ctx) {
  const skipped = { count: 0 };
  const nodes = await readChildren(blockId, ctx, skipped);
  return { nodes, skipped: skipped.count };
}

/** Adds a tree of blocks under a page or block, level by level (Notion returns the new blocks in order). */
export async function appendBlockTree(parentId, nodes, ctx) {
  for (let start = 0; start < nodes.length; start += APPEND_LIMIT) {
    const chunk = nodes.slice(start, start + APPEND_LIMIT);
    const result = await notionRequest(`blocks/${parentId}/children`, {
      ...ctx,
      method: 'PATCH',
      body: { children: chunk.map(node => node.block) }
    });
    const created = result.results || [];
    if (created.length !== chunk.length) {
      throw new HttpError(502, 'Notion did not add every template block. Please try again.');
    }
    for (let i = 0; i < chunk.length; i += 1) {
      if (chunk[i].children.length) await appendBlockTree(created[i].id, chunk[i].children, ctx);
    }
  }
}

export function sheetUrl(spreadsheetId) {
  return spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` : null;
}

const plain = (value) => [{ type: 'text', text: { content: value } }];

/** The lot's Projects properties: name, Active, address, start date and Sheet link. */
export function lotProperties({ name, address, startDate, spreadsheetId }) {
  const properties = {
    Lot: { title: plain(name) },
    Status: { select: { name: 'Active' } },
    Sheet: { url: sheetUrl(spreadsheetId) }
  };
  if (address) properties.Address = { rich_text: plain(address) };
  if (startDate) properties['Start date'] = { date: { start: startDate } };
  return properties;
}

const textValue = (prop) => (prop?.rich_text || prop?.title || []).map(part => part.plain_text || '').join('');

/** Finishes properties copied from the template's standard rows, linked to the new lot. */
export function finishCopyProperties(row, lotPageId) {
  const props = row.properties || {};
  const properties = { Item: { title: plain(textValue(props.Item)) }, Lot: { relation: [{ id: lotPageId }] } };
  for (const field of ['Area', 'Product / color', 'Brand', 'Where to buy', 'SKU', 'Notes']) {
    const value = textValue(props[field]);
    if (value) properties[field] = { rich_text: plain(value) };
  }
  if (props.Category?.select?.name) properties.Category = { select: { name: props.Category.select.name } };
  return properties;
}

async function queryAll(dataSourceId, filter, ctx) {
  const rows = [];
  let cursor;
  do {
    const page = await notionRequest(`data_sources/${dataSourceId}/query`, {
      ...ctx,
      method: 'POST',
      body: { filter, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }
    });
    rows.push(...(page.results || []));
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return rows;
}

/** An existing lot page with exactly this name (so a retry never makes a second page). */
export async function findLotPage(name, ctx) {
  const rows = await queryAll(NOTION_IDS.projectsDataSource, { property: 'Lot', title: { equals: name } }, ctx);
  return rows.find(row => !row.in_trash && !row.archived && row.id !== NOTION_IDS.templatePage) || null;
}

/**
 * Makes the lot page, or returns the one that already exists under that name.
 * If copying the template fails part way, the half-made page is moved to Notion's trash so a retry starts clean.
 */
export async function createLotPage({ name, address, startDate, spreadsheetId }, ctx) {
  const existing = await findLotPage(name, ctx);
  if (existing) {
    return { pageId: existing.id, url: existing.url, existing: true, finishesCopied: 0, skippedBlocks: 0 };
  }

  const template = await readBlockTree(NOTION_IDS.templatePage, ctx);
  const templateFinishes = await queryAll(
    NOTION_IDS.finishesDataSource,
    { property: 'Lot', relation: { contains: NOTION_IDS.templatePage } },
    ctx
  );

  const page = await notionRequest('pages', {
    ...ctx,
    method: 'POST',
    body: {
      parent: { type: 'data_source_id', data_source_id: NOTION_IDS.projectsDataSource },
      properties: lotProperties({ name, address, startDate, spreadsheetId })
    }
  });

  let finishesCopied = 0;
  try {
    await appendBlockTree(page.id, template.nodes, ctx);
    for (const row of templateFinishes) {
      await notionRequest('pages', {
        ...ctx,
        method: 'POST',
        body: {
          parent: { type: 'data_source_id', data_source_id: NOTION_IDS.finishesDataSource },
          properties: finishCopyProperties(row, page.id)
        }
      });
      finishesCopied += 1;
    }
  } catch (error) {
    await notionRequest(`pages/${page.id}`, { ...ctx, method: 'PATCH', body: { in_trash: true } }).catch(() => {});
    throw error;
  }

  return { pageId: page.id, url: page.url, existing: false, finishesCopied, skippedBlocks: template.skipped };
}

/** Checks and tidies what the browser sent. */
export function parseLotRequest(payload) {
  const name = String(payload?.name || '').trim();
  if (!name) throw new HttpError(400, 'The project needs a name.');
  if (name.length > 200) throw new HttpError(400, 'The project name is too long.');
  const address = String(payload?.address || '').trim().slice(0, 300);
  const startDate = String(payload?.startDate || '').trim();
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new HttpError(400, 'The start date is not valid.');
  const spreadsheetId = String(payload?.spreadsheetId || '').trim();
  if (spreadsheetId && !/^[A-Za-z0-9_-]{10,100}$/.test(spreadsheetId)) throw new HttpError(400, 'The Sheet link is not valid.');
  return { name, address, startDate, spreadsheetId };
}
