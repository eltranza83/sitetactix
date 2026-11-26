import { createFolder, findFolder, uploadFileToDrive } from './googleDrive.js';
import { compressImage } from './imageFiles.js';
import { parseMoney } from './money.js';
import {
  SHEET_LAYOUT_V2,
  V2_TABS,
  asSheetText,
  canonicalPhaseName,
  categoryDisplayName,
  categoryForPhase,
  detectSheetLayout,
  parseContracts
} from './sheetV2.js';
import { OLD_LAYOUT_MESSAGE } from './sheetsDataService.js';

const GOOGLE_SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export const CONTRACTS_QUOTES_FOLDER_NAME = 'Contracts & Quotes';

function roundCents(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function cellText(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function normPhase(phase) {
  return canonicalPhaseName(phase).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function cleanFilePart(value) {
  return String(value || '')
    .trim()
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildQuoteFileName({ file, sub, company, date, now = new Date() }) {
  const party = cleanFilePart(company || sub || 'Subcontractor').slice(0, 40) || 'Subcontractor';
  const safeDate = cleanFilePart(date || now.toISOString().slice(0, 10));
  const origName = cleanFilePart(file?.name || 'quote');
  const isPdf = (file?.type || '').toLowerCase() === 'application/pdf' || /\.pdf$/i.test(origName);
  const extMatch = origName.match(/(\.[a-zA-Z0-9]{2,5})$/);
  const ext = extMatch ? extMatch[1] : (isPdf ? '.pdf' : '.jpg');
  const stem = origName.replace(/\.[a-zA-Z0-9]{2,5}$/, '').slice(0, 32) || 'quote';
  return `Quote - ${party} - ${safeDate} - ${stem}${ext}`;
}

/**
 * Uploads an attached subcontractor quote PDF or photo into the "Contracts & Quotes"
 * subfolder directly inside the active Lot's Google Drive folder.
 */
export async function uploadQuoteFileToDrive({
  accessToken,
  projectFolderId,
  file,
  sub = '',
  company = '',
  date = ''
}) {
  if (!accessToken) throw new Error('Google Drive session not connected.');
  if (!projectFolderId) throw new Error('No project Drive folder is selected.');
  if (!file) return null;

  let quotesFolderId = await findFolder(accessToken, CONTRACTS_QUOTES_FOLDER_NAME, projectFolderId);
  if (!quotesFolderId) {
    const created = await createFolder(accessToken, CONTRACTS_QUOTES_FOLDER_NAME, projectFolderId);
    quotesFolderId = created.id;
  }

  let uploadBlob = file;
  let mimeType = file.type || (/\.pdf$/i.test(file.name || '') ? 'application/pdf' : 'image/jpeg');

  if (mimeType.startsWith('image/') && typeof Image !== 'undefined' && typeof document !== 'undefined') {
    uploadBlob = await compressImage(file, 2000, 2000, 0.85);
    mimeType = uploadBlob.type || mimeType;
  } else if (mimeType === 'application/pdf' || /\.pdf$/i.test(file.name || '')) {
    mimeType = 'application/pdf';
  }

  const fileName = buildQuoteFileName({ file: uploadBlob, sub, company, date });
  const uploaded = await uploadFileToDrive(accessToken, quotesFolderId, fileName, mimeType, uploadBlob);
  return {
    id: uploaded.id,
    webViewLink: uploaded.webViewLink,
    name: uploaded.name || fileName
  };
}

async function sheetsJsonRequest(accessToken, url, options = {}, action = 'access Contracts in Google Sheets', fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const err = new Error(`Could not ${action}: ${text || response.statusText || response.status}`);
    err.status = response.status;
    throw err;
  }
  return response.json();
}

/**
 * Verifies v2 layout and reads `Contracts!A1:E` (UNFORMATTED_VALUE), returning raw rows,
 * parsed contracts, and the `Contracts` sheet metadata (`sheetId`, `rowCount`).
 */
export async function readExistingContracts(accessToken, spreadsheetId, fetchImpl = fetch) {
  if (!accessToken) {
    const err = new Error('Google Drive session not connected.');
    err.status = 401;
    throw err;
  }
  if (!spreadsheetId) {
    throw new Error('No Google Sheet is linked to this project.');
  }

  const metaUrl = `${GOOGLE_SHEETS_API_BASE}/${spreadsheetId}?fields=sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))`;
  const metaData = await sheetsJsonRequest(accessToken, metaUrl, {}, 'read Google Sheet tabs', fetchImpl);
  const sheetProps = (metaData.sheets || []).map(s => s.properties || {}).filter(p => p.title);

  if (detectSheetLayout(sheetProps.map(p => p.title)) !== SHEET_LAYOUT_V2) {
    throw new Error(OLD_LAYOUT_MESSAGE);
  }

  const contractsTab = sheetProps.find(p => cellText(p.title) === V2_TABS.contracts);
  if (!contractsTab) {
    throw new Error('The Google Sheet is missing its Contracts tab.');
  }

  const rangeUrl = `${GOOGLE_SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(`${V2_TABS.contracts}!A1:E`)}?valueRenderOption=UNFORMATTED_VALUE`;
  const valuesData = await sheetsJsonRequest(accessToken, rangeUrl, {}, 'read Contracts tab', fetchImpl);
  const rawRows = valuesData.values || [];

  return {
    rawRows,
    contracts: parseContracts(rawRows),
    contractsSheetId: contractsTab.sheetId ?? null,
    contractsRowCount: contractsTab.gridProperties?.rowCount ?? 0
  };
}

function partyNamesMatch(existing, { sub, company }) {
  const existingNames = [cellText(existing?.sub), cellText(existing?.company)]
    .filter(Boolean)
    .map(n => n.toLowerCase());
  const draftNames = [cellText(sub), cellText(company)]
    .filter(Boolean)
    .map(n => n.toLowerCase());
  if (existingNames.length === 0 || draftNames.length === 0) return false;
  return draftNames.some(dn => existingNames.includes(dn));
}

/**
 * Finds existing Contract rows that match draft quote items by canonical phase AND
 * case-insensitive match between any non-empty `(existing.sub, existing.company)` and `(sub, company)`.
 */
export function findDuplicateContractMatches(existingContracts = [], draftItems = [], { sub = '', company = '' } = {}) {
  const contractsList = Array.isArray(existingContracts) ? existingContracts : [];
  const itemsList = Array.isArray(draftItems) ? draftItems : [];
  const matches = [];

  itemsList.forEach((item, itemIndex) => {
    const phaseKey = normPhase(item?.tradePhase);
    if (!phaseKey) return;
    const existing = contractsList.find(
      c => normPhase(c?.phase) === phaseKey && partyNamesMatch(c, { sub, company })
    );
    if (existing) {
      const newQuote = roundCents(parseMoney(item.quoteAmount));
      const oldQuote = roundCents(parseMoney(existing.quote));
      matches.push({
        itemIndex,
        item,
        existing,
        phase: canonicalPhaseName(item.tradePhase),
        oldQuote,
        newQuote,
        combinedQuote: roundCents(oldQuote + newQuote)
      });
    }
  });

  return matches;
}

function findNextEmptyContractRow(rawRows, usedRows) {
  let r = 2; // Row 1 is always the Contracts header row
  while (true) {
    if (!usedRows.has(r)) {
      const row = Array.isArray(rawRows?.[r - 1]) ? rawRows[r - 1] : [];
      const colA = cellText(row[0]);
      const colB = cellText(row[1]);
      if (!colA && !colB) {
        usedRows.add(r);
        return r;
      }
    }
    r += 1;
  }
}

/**
 * Writes subcontractor quotes strictly into `Contracts!A{r}:E{r}` (`Sub, Company, Category, Phase, Quote`).
 * NEVER touches columns `F:G` (which hold Paid & Still Owed formulas in the Sheet template)
 * and NEVER calls `:append` (because pre-filled formulas in F2:G100 would push `:append` to row 101).
 *
 * `conflictResolution`: `'replace'` | `'add_to_quote'` | `'append_row'`
 */
export async function saveQuoteContractsToSheet({
  accessToken,
  spreadsheetId,
  sub = '',
  company = '',
  items = [],
  conflictResolution = 'append_row',
  fetchImpl = fetch
}) {
  const cleanSub = cellText(sub);
  const cleanCompany = cellText(company);
  if (!cleanSub && !cleanCompany) {
    throw new Error('Please enter a Subcontractor name or Company name.');
  }

  const validItems = (Array.isArray(items) ? items : []).filter(
    item => cellText(item?.tradePhase) && roundCents(parseMoney(item?.quoteAmount)) > 0
  );
  if (validItems.length === 0) {
    throw new Error('Please enter at least one phase with a quote amount greater than $0.');
  }

  const {
    rawRows,
    contracts,
    contractsSheetId,
    contractsRowCount
  } = await readExistingContracts(accessToken, spreadsheetId, fetchImpl);

  // Clone contracts so multiple items targeting the same row in add_to_quote accumulate accurately
  const workingContracts = contracts.map(c => ({ ...c }));
  const usedRows = new Set();
  const writesByRow = new Map();

  for (const item of validItems) {
    const phaseName = canonicalPhaseName(item.tradePhase);
    const categoryName = categoryDisplayName(item.tradeCategory) || categoryForPhase(phaseName)?.name || '';
    const quoteAmount = roundCents(parseMoney(item.quoteAmount));
    const phaseKey = normPhase(phaseName);

    const matchedExisting = conflictResolution !== 'append_row'
      ? workingContracts.find(c => normPhase(c.phase) === phaseKey && partyNamesMatch(c, { sub: cleanSub, company: cleanCompany }))
      : null;

    if (matchedExisting && conflictResolution === 'replace') {
      const targetRow = matchedExisting.rowNumber;
      usedRows.add(targetRow);
      matchedExisting.sub = cleanSub || matchedExisting.sub;
      matchedExisting.company = cleanCompany || matchedExisting.company;
      matchedExisting.quote = quoteAmount;
      writesByRow.set(targetRow, {
        rowNumber: targetRow,
        action: 'replace',
        values: [
          asSheetText(matchedExisting.sub),
          asSheetText(matchedExisting.company),
          categoryName,
          phaseName,
          quoteAmount
        ]
      });
    } else if (matchedExisting && conflictResolution === 'add_to_quote') {
      const targetRow = matchedExisting.rowNumber;
      usedRows.add(targetRow);
      const updatedQuote = roundCents(parseMoney(matchedExisting.quote) + quoteAmount);
      matchedExisting.sub = matchedExisting.sub || cleanSub;
      matchedExisting.company = matchedExisting.company || cleanCompany;
      matchedExisting.quote = updatedQuote;
      writesByRow.set(targetRow, {
        rowNumber: targetRow,
        action: 'add_to_quote',
        values: [
          asSheetText(matchedExisting.sub),
          asSheetText(matchedExisting.company),
          categoryName || categoryDisplayName(matchedExisting.category),
          phaseName,
          updatedQuote
        ]
      });
    } else {
      const targetRow = findNextEmptyContractRow(rawRows, usedRows);
      writesByRow.set(targetRow, {
        rowNumber: targetRow,
        action: 'append_row',
        values: [
          asSheetText(cleanSub),
          asSheetText(cleanCompany),
          categoryName,
          phaseName,
          quoteAmount
        ]
      });
    }
  }

  const writes = [...writesByRow.values()].sort((a, b) => a.rowNumber - b.rowNumber);
  const maxRowNeeded = Math.max(...writes.map(w => w.rowNumber));

  if (contractsRowCount > 0 && maxRowNeeded > contractsRowCount && contractsSheetId !== null && contractsSheetId !== undefined) {
    const expandUrl = `${GOOGLE_SHEETS_API_BASE}/${spreadsheetId}:batchUpdate`;
    await sheetsJsonRequest(accessToken, expandUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          appendDimension: {
            sheetId: contractsSheetId,
            dimension: 'ROWS',
            length: maxRowNeeded - contractsRowCount
          }
        }]
      })
    }, 'expand Contracts tab rows', fetchImpl);
  }

  const writeUrl = `${GOOGLE_SHEETS_API_BASE}/${spreadsheetId}/values:batchUpdate`;
  await sheetsJsonRequest(accessToken, writeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: writes.map(w => ({
        range: `${V2_TABS.contracts}!A${w.rowNumber}:E${w.rowNumber}`,
        values: [w.values]
      }))
    })
  }, 'save quote to Contracts tab', fetchImpl);

  return {
    writtenRows: writes,
    updatedCount: writes.length
  };
}
