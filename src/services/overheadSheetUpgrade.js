/**
 * Safe, idempotent upgrader for adding the 4 new Project Overhead & Bills phases
 * (Fuel & Gas, Food & Crew, Office & Tech, Tools & Supplies) to an existing v2 Google Sheet
 * and reclassifying matching rows currently in `Extra Costs & Misc`.
 *
 * Never touches any category other than `Project Overhead & Bills`.
 */

import { detectSheetLayout, parseTransactions, SHEET_LAYOUT_V2, V2_TABS } from './sheetV2.js';
import { findPhaseBlock } from './phaseGrowth.js';

const GOOGLE_SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const OVERHEAD_CATEGORY = 'Project Overhead & Bills';
const EXTRA_MISC_PHASE = 'Extra Costs & Misc';

export const NEW_OVERHEAD_PHASES = [
  'Fuel & Gas',
  'Food & Crew',
  'Office & Tech',
  'Tools & Supplies'
];

const FUEL_PATTERN = /\b(fuel|gasoline|unleaded|diesel|def fluid|at the pump|exxon|mobil|shell|chevron|valero|texaco|sunoco|murphy usa|cefco|loves travel|pilot flying)\b/i;
const FOOD_PATTERN = /\b(crew lunch|crew meal|tacos?|burgers?|pizza|whataburger|mcdonald'?s|wendy'?s|chick-fil-a|chipotle|subway|little caesars|domino'?s|wingstop|panda express|starbucks|dunkin|gatorade|powerade|bottled water|water cases|bagged ice|donuts)\b/i;
const OFFICE_PATTERN = /\b(ink cartridge|toner|printer|subscription|google ai|chatgpt|openai|claude|icloud|adobe|microsoft 365|dropbox|notion|sim kits?|mint mobile|verizon|at&t|t-mobile|postage|usps|ups store|fedex|staples|office depot|best buy)\b/i;
const GOOGLE_LLC_PAYEE_PATTERN = /google llc/i;
const GOOGLE_LLC_DESC_PATTERN = /\b(ai|cloud|workspace|storage|one|pro|subscription)\b/i;
const TOOLS_PATTERN = /\b(saw blades?|drill bits?|extension cords?|brooms?|trash bags?|shop vac|tarps?|padlocks?|safety glasses|work gloves|harbor freight|northern tool)\b/i;

function cellText(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function colIndexToLetter(index) {
  let n = index;
  let letters = '';
  while (n >= 0) {
    letters = String.fromCharCode((n % 26) + 65) + letters;
    n = Math.floor(n / 26) - 1;
  }
  return letters;
}

function quoteTab(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

/**
 * Conservative, deterministic classifier for existing `Extra Costs & Misc` overhead rows.
 * Returns one of NEW_OVERHEAD_PHASES, or null when ambiguous (so the row stays in `Extra Costs & Misc`).
 */
export function classifyOverheadPhase({ payee = '', description = '' } = {}) {
  const payeeText = cellText(payee);
  const descText = cellText(description);
  const combined = `${payeeText} ${descText}`.trim();
  if (!combined) return null;

  if (FUEL_PATTERN.test(combined)) return 'Fuel & Gas';
  if (FOOD_PATTERN.test(combined)) return 'Food & Crew';
  if (
    OFFICE_PATTERN.test(combined) ||
    (GOOGLE_LLC_PAYEE_PATTERN.test(payeeText) && GOOGLE_LLC_DESC_PATTERN.test(descText))
  ) {
    return 'Office & Tech';
  }
  if (TOOLS_PATTERN.test(combined)) return 'Tools & Supplies';
  return null;
}

async function sheetsApi(fetchImpl, accessToken, url, options = {}, action = 'update the Google Sheet') {
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

function colLetterToIndex(letters) {
  let idx = 0;
  const upper = String(letters || '').toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    idx = idx * 26 + (upper.charCodeAt(i) - 64);
  }
  return idx - 1;
}

function parseRangeFormula(rawFormula) {
  const text = cellText(rawFormula);
  const match = text.match(/^(=?)(?:(?:'([^']+)'|([A-Za-z0-9_]+))!)?(\$?)([A-Z]+)(\$?)(\d+):(\$?)([A-Z]+)(\$?)(\d+)$/i);
  if (!match) return null;
  const [, eqPrefix, quotedSheet, bareSheet, colDollar1, col1, rowDollar1, startRowStr, colDollar2, col2, rowDollar2, endRowStr] = match;
  const bangIdx = text.indexOf('!');
  const sheetPrefix = bangIdx >= 0 ? text.slice(0, bangIdx + 1).replace(/^=/, '') : '';
  const sheetName = (quotedSheet ? quotedSheet.replace(/''/g, "'") : bareSheet) || '';
  const leadingEq = eqPrefix || text.startsWith('=') ? '=' : '=';
  return {
    leadingEq,
    sheetPrefix,
    sheetName,
    colDollar1,
    col1,
    rowDollar1,
    startRowStr,
    colDollar2,
    col2,
    rowDollar2,
    endRowStr
  };
}

function updateValidationRule(rule, phaseListColumns, phaseListRows = new Map()) {
  const condition = rule?.condition;
  if (!condition?.type) return null;

  if (condition.type === 'ONE_OF_RANGE') {
    const parsed = parseRangeFormula(condition.values?.[0]?.userEnteredValue);
    if (!parsed) return null;
    const {
      leadingEq,
      sheetPrefix,
      sheetName,
      colDollar1,
      col1,
      rowDollar1,
      startRowStr,
      colDollar2,
      col2,
      rowDollar2,
      endRowStr
    } = parsed;

    // Vertical column range on Lists (e.g. =Lists!$I$2:$I$4, =Lists!$B$2:$B$27, or =Lists!$B$25:$B$27)
    if (col1.toUpperCase() === col2.toUpperCase() && /^lists$/i.test(sheetName)) {
      const colMeta = phaseListColumns.get(col1.toUpperCase());
      const endRowNum = Number(endRowStr);
      if (!colMeta || endRowNum < colMeta.oldEndRow || endRowNum >= colMeta.newEndRow) return null;
      const updatedFormula = `${leadingEq}${sheetPrefix}${colDollar1}${col1}${rowDollar1}${startRowStr}:${colDollar2}${col2}${rowDollar2}${colMeta.newEndRow}`;
      return {
        ...rule,
        condition: {
          ...condition,
          values: [{ userEnteredValue: updatedFormula }]
        }
      };
    }

    // Horizontal row range (either explicit Lists row in phaseListRows, or per-row TRANSPOSE/FILTER helper range of width 3..6 -> expand to 7 phases)
    if (startRowStr === endRowStr) {
      const startColIdx = colLetterToIndex(col1);
      const endColIdx = colLetterToIndex(col2);
      const currentWidth = endColIdx - startColIdx + 1;
      const explicitEndCol = /^lists$/i.test(sheetName) ? phaseListRows.get(Number(startRowStr)) : null;
      const minRequiredEndIdx = startColIdx + 6; // 7 overhead phases require 7 columns
      const targetEndIdx = explicitEndCol
        ? Math.max(colLetterToIndex(explicitEndCol), minRequiredEndIdx)
        : (currentWidth >= 3 && currentWidth < 7 ? minRequiredEndIdx : -1);

      if (targetEndIdx === -1 || endColIdx >= targetEndIdx) return null;
      const targetEndCol = colIndexToLetter(targetEndIdx);
      const updatedFormula = `${leadingEq}${sheetPrefix}${colDollar1}${col1}${rowDollar1}${startRowStr}:${colDollar2}${targetEndCol}${rowDollar2}${endRowStr}`;
      return {
        ...rule,
        condition: {
          ...condition,
          values: [{ userEnteredValue: updatedFormula }]
        }
      };
    }

    return null;
  }

  if (condition.type === 'ONE_OF_LIST') {
    const existingValues = (condition.values || []).map(v => cellText(v?.userEnteredValue)).filter(Boolean);
    const existingLower = new Set(existingValues.map(v => v.toLowerCase()));
    if (!existingLower.has(EXTRA_MISC_PHASE.toLowerCase()) && !existingLower.has('monthly utility bills')) {
      return null;
    }
    const missing = NEW_OVERHEAD_PHASES.filter(p => !existingLower.has(p.toLowerCase()));
    if (missing.length === 0) return null;
    const extraIdx = existingValues.findIndex(v => v.toLowerCase() === EXTRA_MISC_PHASE.toLowerCase());
    const nextValues = extraIdx === -1
      ? [...existingValues, ...missing]
      : [...existingValues.slice(0, extraIdx), ...missing, ...existingValues.slice(extraIdx)];
    return {
      ...rule,
      condition: {
        ...condition,
        values: nextValues.map(v => ({ userEnteredValue: v }))
      }
    };
  }

  return null;
}

/**
 * Safely and idempotently upgrades a v2 Google Sheet with the 4 new Project Overhead & Bills phases,
 * updates dropdowns/validations, clones the phase blocks on `Project Overhead & Bills`, updates
 * `Dashboard` if it lists `Extra Costs & Misc`, and reclassifies matching `Transactions` rows.
 */
export async function upgradeOverheadPhasesInSheet(accessToken, spreadsheetId, fetchImpl = fetch) {
  if (!accessToken) throw new Error('Missing Google access token.');
  if (!spreadsheetId) throw new Error('Missing Google Sheet ID.');

  const baseUrl = `${GOOGLE_SHEETS_API_BASE}/${spreadsheetId}`;

  // 1. Fetch spreadsheet tabs + namedRanges metadata and verify v2 layout
  const meta = await sheetsApi(
    fetchImpl,
    accessToken,
    `${baseUrl}?fields=namedRanges,sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))`,
    {},
    'read Google Sheet metadata'
  );
  const tabs = (meta.sheets || []).map(s => s.properties || {}).filter(p => p.title);
  if (detectSheetLayout(tabs.map(t => t.title)) !== SHEET_LAYOUT_V2) {
    throw new Error('This Google Sheet is not using the v2 layout (missing Transactions or Project Info tab).');
  }

  const findTab = (name) => tabs.find(t => cellText(t.title).toLowerCase() === name.toLowerCase()) || null;
  const listsTab = findTab('Lists');
  const overheadTab = findTab(OVERHEAD_CATEGORY);
  const dashboardTab = findTab(V2_TABS.dashboard);
  const transactionsTab = findTab(V2_TABS.transactions);
  const contractsTab = findTab(V2_TABS.contracts);

  // 2. Update `Lists` tab (supports vertical columns, paired Category-Phase columns, horizontal rows, and helper formulas)
  const phaseListColumns = new Map();
  const phaseListRows = new Map();
  let listUpdatesCount = 0;
  let formulaReplacementsCount = 0;
  if (listsTab) {
    const listsRange = encodeURIComponent(`${quoteTab(listsTab.title)}!A1:Z100`);
    const listsData = await sheetsApi(
      fetchImpl,
      accessToken,
      `${baseUrl}/values/${listsRange}?valueRenderOption=FORMULA`,
      {},
      'read Lists tab'
    );
    const rows = listsData.values || [];
    const listUpdates = [];
    const horizontalSpillCols = new Set();
    let maxRequiredCols = 0;

    const isStaticText = (val) => {
      const t = cellText(val);
      return t !== '' && !t.startsWith('=');
    };

    // 2a. Detect static horizontal overhead phase rows (formulas starting with '=' are automatically skipped)
    for (let r = 0; r < rows.length; r++) {
      const row = Array.isArray(rows[r]) ? rows[r] : [];
      const colM = row.findIndex(c => isStaticText(c) && cellText(c).toLowerCase() === 'monthly utility bills');
      const colD = row.findIndex(c => isStaticText(c) && cellText(c).toLowerCase() === 'dumpsters & cleaning');
      if (colM !== -1 && colD !== -1 && colM !== colD) {
        const startCol = Math.min(colM, colD);
        const fullHorizontal = ['Monthly Utility Bills', 'Dumpsters & Cleaning', ...NEW_OVERHEAD_PHASES, EXTRA_MISC_PHASE];
        const endColIdx = startCol + fullHorizontal.length - 1;
        const endColLetter = colIndexToLetter(endColIdx);
        const startColLetter = colIndexToLetter(startCol);
        maxRequiredCols = Math.max(maxRequiredCols, endColIdx + 1);

        const currentSlice = fullHorizontal.map((_, i) => cellText(row[startCol + i]));
        const alreadyMatches = fullHorizontal.every((val, i) => currentSlice[i].toLowerCase() === val.toLowerCase());
        if (!alreadyMatches) {
          listUpdates.push({
            range: `${quoteTab(listsTab.title)}!${startColLetter}${r + 1}:${endColLetter}${r + 1}`,
            values: [fullHorizontal]
          });
        }

        const spillCol = startCol + 2;
        horizontalSpillCols.add(spillCol);
        const spillColLetter = colIndexToLetter(spillCol);
        const expectedSpill = ['food & crew', 'office & tech', 'tools & supplies', 'extra costs & misc'];
        const hasVerticalSpill = expectedSpill.every(
          (val, idx) => cellText(rows[r + 1 + idx]?.[spillCol]).toLowerCase() === val
        );
        if (hasVerticalSpill) {
          listUpdates.push({
            range: `${quoteTab(listsTab.title)}!${spillColLetter}${r + 2}:${spillColLetter}${r + 5}`,
            values: [[''], [''], [''], ['']]
          });
        }

        phaseListRows.set(r + 1, endColLetter);
      }
    }

    // 2b. Detect vertical phase columns (and paired Category-per-Phase columns for FILTER dropdowns)
    const maxCols = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
    for (let colIdx = 0; colIdx < maxCols; colIdx++) {
      if (horizontalSpillCols.has(colIdx)) continue;
      let lastNonEmptyRow = -1;
      for (let r = 0; r < rows.length; r++) {
        if (cellText(rows[r]?.[colIdx]) !== '') lastNonEmptyRow = r;
      }
      if (lastNonEmptyRow === -1) continue;

      const colValues = [];
      for (let r = 0; r <= lastNonEmptyRow; r++) {
        colValues.push(cellText(rows[r]?.[colIdx]));
      }

      const monthlyIdx = colValues.findIndex(v => !v.startsWith('=') && v.toLowerCase() === 'monthly utility bills');
      const dumpstersIdx = colValues.findIndex(v => !v.startsWith('=') && v.toLowerCase() === 'dumpsters & cleaning');
      const extraRowIdx = colValues.findIndex(v => !v.startsWith('=') && v.toLowerCase() === EXTRA_MISC_PHASE.toLowerCase());
      if (extraRowIdx === -1 || (monthlyIdx !== -1 && dumpstersIdx === -1)) continue;

      const colLetter = colIndexToLetter(colIdx);
      const existingLower = new Set(colValues.map(v => v.toLowerCase()));
      const missingInCol = NEW_OVERHEAD_PHASES.filter(p => !existingLower.has(p.toLowerCase()));

      let finalEndRow = colValues.length;
      if (missingInCol.length > 0) {
        const restOfCol = colValues.slice(extraRowIdx + 1);
        const replacementSlice = [...missingInCol, colValues[extraRowIdx], ...restOfCol];
        const startRow = extraRowIdx + 1;
        finalEndRow = extraRowIdx + replacementSlice.length;
        listUpdates.push({
          range: `${quoteTab(listsTab.title)}!${colLetter}${startRow}:${colLetter}${finalEndRow}`,
          values: replacementSlice.map(v => [v])
        });
      }

      const originalEndRow = Math.max(2, finalEndRow - NEW_OVERHEAD_PHASES.length);
      phaseListColumns.set(colLetter, { oldEndRow: originalEndRow, newEndRow: finalEndRow });

      // Detect any paired Category-per-Phase column (where both Monthly Utility Bills & Dumpsters & Cleaning have "Project Overhead & Bills")
      if (monthlyIdx !== -1 && dumpstersIdx === monthlyIdx + 1) {
        for (let c = 0; c < maxCols; c++) {
          if (c === colIdx) continue;
          const catAtMonthly = cellText(rows[monthlyIdx]?.[c]);
          const catAtDumpsters = cellText(rows[dumpstersIdx]?.[c]);
          const isOverheadCat =
            isStaticText(catAtMonthly) &&
            catAtMonthly.toLowerCase() === catAtDumpsters.toLowerCase() &&
            (catAtMonthly.toLowerCase() === OVERHEAD_CATEGORY.toLowerCase() ||
              catAtMonthly.toLowerCase() === 'project_overhead_&_bills');

          if (!isOverheadCat) continue;

          const catColLetter = colIndexToLetter(c);
          const overheadStartRow1Based = monthlyIdx + 1;
          const overheadEndRow1Based = monthlyIdx + 7; // 7 overhead phases total
          const restOfCatCol = missingInCol.length > 0
            ? Array.from({ length: Math.max(0, lastNonEmptyRow - extraRowIdx) }, (_, idx) => cellText(rows[extraRowIdx + 1 + idx]?.[c]))
            : [];
          const desiredCatSlice = [
            ...Array.from({ length: 7 }, () => catAtMonthly),
            ...restOfCatCol
          ];
          const writeEndRow1Based = overheadStartRow1Based + desiredCatSlice.length - 1;

          let needsCatFill = false;
          for (let i = 0; i < desiredCatSlice.length; i++) {
            if (cellText(rows[monthlyIdx + i]?.[c]).toLowerCase() !== desiredCatSlice[i].toLowerCase()) {
              needsCatFill = true;
              break;
            }
          }
          if (needsCatFill) {
            listUpdates.push({
              range: `${quoteTab(listsTab.title)}!${catColLetter}${overheadStartRow1Based}:${catColLetter}${writeEndRow1Based}`,
              values: desiredCatSlice.map(v => [v])
            });
          }
          const catNewEndRow = Math.max(finalEndRow, overheadEndRow1Based);
          phaseListColumns.set(catColLetter, { oldEndRow: originalEndRow, newEndRow: catNewEndRow });
        }
      }
    }

    listUpdatesCount = listUpdates.length;
    if (listUpdates.length > 0) {
      const dimRequests = [];
      const maxTargetRow = phaseListColumns.size > 0
        ? Math.max(...Array.from(phaseListColumns.values(), m => m.newEndRow))
        : 0;
      const currentListsRows = listsTab.gridProperties?.rowCount;
      if (currentListsRows && maxTargetRow > currentListsRows && listsTab.sheetId !== undefined && listsTab.sheetId !== null) {
        dimRequests.push({
          appendDimension: {
            sheetId: listsTab.sheetId,
            dimension: 'ROWS',
            length: maxTargetRow - currentListsRows
          }
        });
      }
      const currentListsCols = listsTab.gridProperties?.columnCount;
      if (currentListsCols && maxRequiredCols > currentListsCols && listsTab.sheetId !== undefined && listsTab.sheetId !== null) {
        dimRequests.push({
          appendDimension: {
            sheetId: listsTab.sheetId,
            dimension: 'COLUMNS',
            length: maxRequiredCols - currentListsCols
          }
        });
        listsTab.gridProperties.columnCount = maxRequiredCols;
      }
      if (dimRequests.length > 0) {
        await sheetsApi(
          fetchImpl,
          accessToken,
          `${baseUrl}:batchUpdate`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requests: dimRequests })
          },
          'expand Lists tab dimensions'
        );
      }
      await sheetsApi(
        fetchImpl,
        accessToken,
        `${baseUrl}/values:batchUpdate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: listUpdates })
        },
        'update Lists tab'
      );
    }

    // 2b-formulas: Only emit findReplace for Lists formulas that actually contain the stale oldEndRow reference
    if (phaseListColumns.size > 0 && listsTab.sheetId !== undefined && listsTab.sheetId !== null) {
      const formulaTexts = [];
      rows.forEach(row => {
        if (!Array.isArray(row)) return;
        row.forEach(cell => {
          const t = cellText(cell);
          if (t.startsWith('=')) formulaTexts.push(t);
        });
      });

      const formulaRangeRequests = [];
      for (const [colLetter, { oldEndRow, newEndRow }] of phaseListColumns.entries()) {
        if (oldEndRow >= newEndRow) continue;
        const detectRe = new RegExp(`(\\$?[A-Z]+\\$?[0-9]+:\\$?${colLetter}\\$?)${oldEndRow}\\b`, 'i');
        if (formulaTexts.some(f => detectRe.test(f))) {
          formulaRangeRequests.push({
            findReplace: {
              find: `(\\$?[A-Z]+\\$?[0-9]+:\\$?${colLetter}\\$?)${oldEndRow}\\b`,
              replacement: `$1${newEndRow}`,
              searchByRegex: true,
              includeFormulas: true,
              sheetId: listsTab.sheetId
            }
          });
        }
      }
      if (formulaRangeRequests.length > 0) {
        const frResp = await sheetsApi(
          fetchImpl,
          accessToken,
          `${baseUrl}:batchUpdate`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requests: formulaRangeRequests })
          },
          'expand helper formulas on Lists tab'
        );
        const replies = frResp?.replies || [];
        formulaReplacementsCount += replies.length > 0
          ? replies.reduce((sum, rep) => sum + Number(rep?.findReplace?.occurrencesChanged || 0), 0)
          : formulaRangeRequests.length;
      }
    }
  }

  // 2c. Expand any Named Ranges on Lists + per-row dataValidation across Transactions!E2:E1000 and Contracts!D2:D500
  const validationRequests = [];
  if (listsTab && Array.isArray(meta.namedRanges)) {
    for (const nr of meta.namedRanges) {
      const r = nr?.range;
      if (!r || r.sheetId !== listsTab.sheetId) continue;
      const startCol = r.startColumnIndex ?? 0;
      const startRow = r.startRowIndex ?? 0;
      if (r.endColumnIndex === startCol + 1 && typeof r.endRowIndex === 'number') {
        const colLetter = colIndexToLetter(startCol);
        const colMeta = phaseListColumns.get(colLetter);
        if (colMeta && r.endRowIndex >= colMeta.oldEndRow && r.endRowIndex < colMeta.newEndRow) {
          validationRequests.push({
            updateNamedRange: {
              namedRange: {
                ...nr,
                range: { ...r, endRowIndex: colMeta.newEndRow }
              },
              fields: 'range'
            }
          });
        }
      } else if (r.endRowIndex === startRow + 1 && typeof r.endColumnIndex === 'number') {
        const targetEndColLetter = phaseListRows.get(startRow + 1);
        const targetEndColExclusive = targetEndColLetter ? colLetterToIndex(targetEndColLetter) + 1 : 0;
        if (targetEndColExclusive && r.endColumnIndex < targetEndColExclusive) {
          validationRequests.push({
            updateNamedRange: {
              namedRange: {
                ...nr,
                range: { ...r, endColumnIndex: targetEndColExclusive }
              },
              fields: 'range'
            }
          });
        }
      }
    }
  }

  const txSampleEnd = Math.max(2, Math.min(1000, transactionsTab?.gridProperties?.rowCount || 1000));
  const validationRanges = [`${V2_TABS.transactions}!D2:E${txSampleEnd}`];
  if (contractsTab) {
    const contractsSampleEnd = Math.max(2, Math.min(500, contractsTab?.gridProperties?.rowCount || 500));
    validationRanges.push(`${V2_TABS.contracts}!C2:D${contractsSampleEnd}`);
  }
  const validationQuery = validationRanges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');
  const validationMeta = await sheetsApi(
    fetchImpl,
    accessToken,
    `${baseUrl}?${validationQuery}&fields=sheets(properties(sheetId,title,gridProperties(rowCount)),data(rowData(values(dataValidation))))`,
    {},
    'read phase dropdown validations'
  );

  const requiredColsBySheetId = new Map();
  const nonListsHelperTargets = new Map();
  const dataValidationRequests = [];

  for (const sheet of validationMeta.sheets || []) {
    const title = cellText(sheet?.properties?.title);
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) continue;
    const isTransactions = title.toLowerCase() === V2_TABS.transactions.toLowerCase();
    const isContracts = title.toLowerCase() === V2_TABS.contracts.toLowerCase();
    if (!isTransactions && !isContracts) continue;

    const phaseColIndex = isTransactions ? 4 : 3;
    const maxRows = sheet?.properties?.gridProperties?.rowCount || (isTransactions ? 5000 : 500);
    const rowData = sheet?.data?.[0]?.rowData || [];

    // Inspect raw ONE_OF_RANGE targets so if helper formulas live on Transactions/Contracts/another tab, we expand their Lists! ranges too
    for (let i = 0; i < Math.min(rowData.length, 25); i++) {
      const cellValues = rowData[i]?.values || [];
      const rawRule = cellValues[1]?.dataValidation || (cellValues.length === 1 ? cellValues[0]?.dataValidation : null);
      if (rawRule?.condition?.type === 'ONE_OF_RANGE') {
        const parsedRaw = parseRangeFormula(rawRule.condition.values?.[0]?.userEnteredValue);
        if (parsedRaw && parsedRaw.startRowStr === parsedRaw.endRowStr && !/^lists$/i.test(parsedRaw.sheetName)) {
          const targetTab = parsedRaw.sheetName ? findTab(parsedRaw.sheetName) : findTab(title);
          if (targetTab && targetTab.sheetId !== undefined && !nonListsHelperTargets.has(targetTab.sheetId)) {
            nonListsHelperTargets.set(targetTab.sheetId, { tab: targetTab, colLetter: parsedRaw.col1.toUpperCase() });
          }
        }
      }
    }

    const nextRules = rowData.map((rItem) => {
      const cellValues = rItem?.values || [];
      const rule = cellValues[1]?.dataValidation || (cellValues.length === 1 ? cellValues[0]?.dataValidation : null);
      const updated = updateValidationRule(rule, phaseListColumns, phaseListRows);
      if (updated?.condition?.type === 'ONE_OF_RANGE') {
        const parsedNext = parseRangeFormula(updated.condition.values?.[0]?.userEnteredValue);
        if (parsedNext && parsedNext.startRowStr === parsedNext.endRowStr) {
          const targetTab = parsedNext.sheetName ? findTab(parsedNext.sheetName) : findTab(title);
          if (targetTab?.sheetId !== undefined && targetTab?.sheetId !== null) {
            const neededCols = colLetterToIndex(parsedNext.col2) + 1;
            requiredColsBySheetId.set(
              targetTab.sheetId,
              Math.max(requiredColsBySheetId.get(targetTab.sheetId) || 0, neededCols)
            );
          }
        }
      }
      return updated;
    });

    // Check if all sampled rows follow a single relative-row horizontal formula starting at row 2 (e.g. =Lists!D2:J2, =Lists!D3:J3, ...)
    const firstParsed = nextRules[0]?.condition?.type === 'ONE_OF_RANGE'
      ? parseRangeFormula(nextRules[0].condition.values?.[0]?.userEnteredValue)
      : null;
    const isUniformRelativeHorizontal =
      rowData.length >= 2 &&
      Boolean(firstParsed) &&
      firstParsed.startRowStr === '2' &&
      firstParsed.endRowStr === '2' &&
      firstParsed.rowDollar1 === '' &&
      firstParsed.rowDollar2 === '' &&
      nextRules.every((nr, idx) => {
        if (!nr || nr.condition?.type !== 'ONE_OF_RANGE') return false;
        const expectedRow = String(idx + 2);
        const expectedFormula = `${firstParsed.leadingEq}${firstParsed.sheetPrefix}${firstParsed.colDollar1}${firstParsed.col1}${expectedRow}:${firstParsed.colDollar2}${firstParsed.col2}${expectedRow}`;
        return cellText(nr.condition.values?.[0]?.userEnteredValue) === expectedFormula;
      });

    if (isUniformRelativeHorizontal) {
      dataValidationRequests.push({
        setDataValidation: {
          range: {
            sheetId,
            startRowIndex: 1,
            endRowIndex: maxRows,
            startColumnIndex: phaseColIndex,
            endColumnIndex: phaseColIndex + 1
          },
          rule: nextRules[0]
        }
      });
      continue;
    }

    let runStart = -1;
    let runKey = '';
    let runRule = null;

    const flushRun = (endExclusive) => {
      if (runRule && runStart >= 1) {
        dataValidationRequests.push({
          setDataValidation: {
            range: {
              sheetId,
              startRowIndex: runStart,
              endRowIndex: endExclusive,
              startColumnIndex: phaseColIndex,
              endColumnIndex: phaseColIndex + 1
            },
            rule: runRule
          }
        });
      }
      runStart = -1;
      runKey = '';
      runRule = null;
    };

    for (let i = 0; i < nextRules.length; i++) {
      const sheetRowIndex = i + 1;
      const nextRule = nextRules[i];
      const key = nextRule ? JSON.stringify(nextRule) : '';

      if (!nextRule) {
        flushRun(sheetRowIndex);
      } else if (key === runKey) {
        // continue contiguous run
      } else {
        flushRun(sheetRowIndex);
        runStart = sheetRowIndex;
        runKey = key;
        runRule = nextRule;
      }
    }

    if (runRule) {
      const endRow = (runStart === 1 && rowData.length === 1) || (runStart === 1 && rowData.length >= (isTransactions ? txSampleEnd - 1 : 1))
        ? maxRows
        : rowData.length + 1;
      flushRun(endRow);
    }
  }

  // Ensure any sheet whose horizontal helper range expanded to 7 columns actually has at least that many columns
  for (const [targetSheetId, neededCols] of requiredColsBySheetId.entries()) {
    const tabMeta = tabs.find(t => t.sheetId === targetSheetId);
    const currentCols = tabMeta?.gridProperties?.columnCount;
    if (currentCols && neededCols > currentCols) {
      validationRequests.push({
        appendDimension: {
          sheetId: targetSheetId,
          dimension: 'COLUMNS',
          length: neededCols - currentCols
        }
      });
    }
  }

  // If horizontal helper formulas live on Transactions/Contracts/another tab (outside Lists), check & expand stale Lists! end-rows there too
  if (phaseListColumns.size > 0 && nonListsHelperTargets.size > 0) {
    for (const { tab, colLetter } of nonListsHelperTargets.values()) {
      const sampleRange = encodeURIComponent(`${quoteTab(tab.title)}!${colLetter}1:${colLetter}25`);
      const sampleData = await sheetsApi(
        fetchImpl,
        accessToken,
        `${baseUrl}/values/${sampleRange}?valueRenderOption=FORMULA`,
        {},
        `read helper formulas on ${tab.title}`
      );
      const helperFormulas = (sampleData.values || [])
        .flatMap(r => (Array.isArray(r) ? r : []))
        .map(c => cellText(c))
        .filter(c => c.startsWith('='));

      for (const [listsCol, { oldEndRow, newEndRow }] of phaseListColumns.entries()) {
        if (oldEndRow >= newEndRow) continue;
        const detectRe = new RegExp(`((?:'Lists'|Lists)!\\$?[A-Z]+\\$?[0-9]+:\\$?${listsCol}\\$?)${oldEndRow}\\b`, 'i');
        if (helperFormulas.some(f => detectRe.test(f))) {
          validationRequests.push({
            findReplace: {
              find: `((?:'Lists'|Lists)!\\$?[A-Z]+\\$?[0-9]+:\\$?${listsCol}\\$?)${oldEndRow}\\b`,
              replacement: `$1${newEndRow}`,
              searchByRegex: true,
              includeFormulas: true,
              sheetId: tab.sheetId
            }
          });
        }
      }
    }
  }

  validationRequests.push(...dataValidationRequests);

  if (validationRequests.length > 0) {
    await sheetsApi(
      fetchImpl,
      accessToken,
      `${baseUrl}:batchUpdate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: validationRequests })
      },
      'update phase dropdown validations'
    );
  }

  // 3. Update `Project Overhead & Bills` tab (clone Extra Costs & Misc phase block)
  let missingBlockPhases = [];
  if (overheadTab) {
    const colARange = encodeURIComponent(`${quoteTab(overheadTab.title)}!A1:A2000`);
    const colAData = await sheetsApi(fetchImpl, accessToken, `${baseUrl}/values/${colARange}`, {}, 'read Project Overhead & Bills tab');
    const columnA = colAData.values || [];

    missingBlockPhases = NEW_OVERHEAD_PHASES.filter(phase => findPhaseBlock(columnA, phase) === null);
    if (missingBlockPhases.length > 0) {
      const extraBlock = findPhaseBlock(columnA, EXTRA_MISC_PHASE);
      if (extraBlock) {
        const startRow = extraBlock.bandRow - 1;
        const rawBlockHeight = (extraBlock.quotesRow - extraBlock.bandRow) + 6;
        const originalRowCount = overheadTab.gridProperties?.rowCount;
        const blockHeight = originalRowCount
          ? Math.max(1, Math.min(rawBlockHeight, originalRowCount - startRow))
          : rawBlockHeight;
        const totalInserted = missingBlockPhases.length * blockHeight;
        const shiftedExtraStart = startRow + totalInserted;
        const shiftedExtraEnd = shiftedExtraStart + blockHeight;

        const requests = [
          {
            insertDimension: {
              range: {
                sheetId: overheadTab.sheetId,
                dimension: 'ROWS',
                startIndex: startRow,
                endIndex: shiftedExtraStart
              },
              inheritFromBefore: false
            }
          }
        ];

        missingBlockPhases.forEach((phaseName, i) => {
          const destStart = startRow + i * blockHeight;
          const destEnd = destStart + blockHeight;
          requests.push(
            {
              copyPaste: {
                source: {
                  sheetId: overheadTab.sheetId,
                  startRowIndex: shiftedExtraStart,
                  endRowIndex: shiftedExtraEnd,
                  startColumnIndex: 0,
                  endColumnIndex: 10
                },
                destination: {
                  sheetId: overheadTab.sheetId,
                  startRowIndex: destStart,
                  endRowIndex: destEnd,
                  startColumnIndex: 0,
                  endColumnIndex: 10
                },
                pasteType: 'PASTE_NORMAL'
              }
            },
            {
              findReplace: {
                find: EXTRA_MISC_PHASE,
                replacement: phaseName,
                matchCase: false,
                includeFormulas: true,
                range: {
                  sheetId: overheadTab.sheetId,
                  startRowIndex: destStart,
                  endRowIndex: destEnd
                }
              }
            }
          );
        });

        await sheetsApi(
          fetchImpl,
          accessToken,
          `${baseUrl}:batchUpdate`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requests })
          },
          'add overhead phase blocks'
        );
      }
    }
  }

  // 4. Update `Dashboard` tab if it explicitly lists `Extra Costs & Misc`
  if (dashboardTab) {
    const dashRange = encodeURIComponent(`${quoteTab(dashboardTab.title)}!A1:L100`);
    const dashData = await sheetsApi(fetchImpl, accessToken, `${baseUrl}/values/${dashRange}`, {}, 'read Dashboard tab');
    const dashRows = dashData.values || [];
    const extraDashRowIdx = dashRows.findIndex(
      row => Array.isArray(row) && row.some(cell => cellText(cell).toLowerCase() === EXTRA_MISC_PHASE.toLowerCase())
    );

    if (extraDashRowIdx !== -1) {
      const dashCellsLower = new Set();
      dashRows.forEach(row => {
        if (!Array.isArray(row)) return;
        row.forEach(cell => {
          const t = cellText(cell).toLowerCase();
          if (t) dashCellsLower.add(t);
        });
      });

      const missingDash = NEW_OVERHEAD_PHASES.filter(p => !dashCellsLower.has(p.toLowerCase()));
      if (missingDash.length > 0) {
        const shiftedExtraRow = extraDashRowIdx + missingDash.length;
        const dashRequests = [
          {
            insertDimension: {
              range: {
                sheetId: dashboardTab.sheetId,
                dimension: 'ROWS',
                startIndex: extraDashRowIdx,
                endIndex: shiftedExtraRow
              },
              inheritFromBefore: false
            }
          }
        ];

        missingDash.forEach((phaseName, i) => {
          const destRow = extraDashRowIdx + i;
          dashRequests.push(
            {
              copyPaste: {
                source: {
                  sheetId: dashboardTab.sheetId,
                  startRowIndex: shiftedExtraRow,
                  endRowIndex: shiftedExtraRow + 1,
                  startColumnIndex: 0,
                  endColumnIndex: 12
                },
                destination: {
                  sheetId: dashboardTab.sheetId,
                  startRowIndex: destRow,
                  endRowIndex: destRow + 1,
                  startColumnIndex: 0,
                  endColumnIndex: 12
                },
                pasteType: 'PASTE_NORMAL'
              }
            },
            {
              findReplace: {
                find: EXTRA_MISC_PHASE,
                replacement: phaseName,
                matchCase: false,
                includeFormulas: true,
                range: {
                  sheetId: dashboardTab.sheetId,
                  startRowIndex: destRow,
                  endRowIndex: destRow + 1
                }
              }
            }
          );
        });

        await sheetsApi(
          fetchImpl,
          accessToken,
          `${baseUrl}:batchUpdate`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requests: dashRequests })
          },
          'update Dashboard overhead rows'
        );
      }
    }
  }

  // 5. Auto-reclassify existing `Extra Costs & Misc` rows in `Transactions`
  const txRange = encodeURIComponent(`${V2_TABS.transactions}!A1:J`);
  const txData = await sheetsApi(
    fetchImpl,
    accessToken,
    `${baseUrl}/values/${txRange}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
    {},
    'read Transactions tab'
  );
  const transactions = parseTransactions(txData.values || []);
  const reclassified = [];
  const txUpdates = [];

  for (const row of transactions) {
    if (
      row.category.toLowerCase() !== OVERHEAD_CATEGORY.toLowerCase() ||
      row.phase.toLowerCase() !== EXTRA_MISC_PHASE.toLowerCase()
    ) {
      continue;
    }
    const newPhase = classifyOverheadPhase({ payee: row.payee, description: row.description });
    if (!newPhase) continue;
    txUpdates.push({
      range: `${V2_TABS.transactions}!E${row.rowNumber}`,
      values: [[newPhase]]
    });
    reclassified.push({
      rowNumber: row.rowNumber,
      receiptId: row.receiptId,
      payee: row.payee,
      newPhase
    });
  }

  if (txUpdates.length > 0) {
    await sheetsApi(
      fetchImpl,
      accessToken,
      `${baseUrl}/values:batchUpdate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: txUpdates })
      },
      'reclassify Transactions overhead phases'
    );
  }

  return {
    addedPhases: missingBlockPhases,
    reclassified,
    updatedValidations: validationRequests.length + formulaReplacementsCount + (missingBlockPhases.length === 0 ? listUpdatesCount : 0)
  };
}
