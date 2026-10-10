/**
 * Support for the new per-house Google Sheet layout ("v2").
 *
 * A v2 Sheet has a `Transactions` tab (the only tab the app writes receipts to),
 * a `Contracts` tab (quotes typed by the owner) and a `Project Info` tab (house setup values).
 * The Dashboard and category tabs are formulas only and are never written or parsed by the app:
 * everything the in-app Dashboard shows is worked out here from the three data tabs.
 *
 * Sheets without both `Transactions` and `Project Info` keep the old behavior.
 */

const GOOGLE_SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export const SHEET_LAYOUT_V2 = 'v2';
export const SHEET_LAYOUT_LEGACY = 'legacy';

export const V2_TABS = {
  transactions: 'Transactions',
  projectInfo: 'Project Info',
  contracts: 'Contracts'
};

/** The 9 categories and 26 phases, in Sheet order. `key` is the app's internal category key. */
export const V2_CATEGORIES = [
  { key: 'Paperwork_&_Permits', name: 'Paperwork & Permits', phases: ['Paperwork & Permits'] },
  { key: 'Site_Prep_&_Structure', name: 'Site Prep & Structure', phases: ['Foundation & Flatwork', 'Roofing', 'Windows & Exterior Doors'] },
  { key: 'Framing_&_Lumber', name: 'Framing & Lumber', phases: ['Framing Lumber & Truss'] },
  { key: 'Mechanicals_&_Utilities', name: 'Mechanicals & Utilities', phases: ['Plumbing Rough-In', 'Electrical & Lighting', 'HVAC / AC Systems', 'Insulation & Alarms'] },
  { key: 'Interior_Finishes', name: 'Interior Finishes', phases: ['Drywall & Sheetrock', 'Cabinets & Trim Carpentry', 'Quartz & Countertops', 'Glass Work'] },
  { key: 'Paint_Tile', name: 'Paint & Tile', phases: ['Tile & Flooring', 'Paint & Finishes'] },
  { key: 'Interior_Hardware', name: 'Interior Hardware', phases: ['Plumbing Hardware Fixtures', 'Electrical Hardware Fixtures'] },
  { key: 'House_Exterior_&_Yard', name: 'House Exterior & Yard', phases: ['Stucco & Masonry', 'Garage Doors', 'Driveway & Sidewalks', 'Cantera Stone Detail', 'Fencing & Gates', 'Landscaping & Irrigation'] },
  { key: 'Project_Overhead_&_Bills', name: 'Project Overhead & Bills', phases: ['Monthly Utility Bills', 'Dumpsters & Cleaning', 'Extra Costs & Misc'] }
];

/** Project Info rows 2-7: label in column A (exact), value in column B. */
export const PROJECT_INFO_FIELDS = [
  { field: 'name', label: 'Project Name' },
  { field: 'address', label: 'Street Address' },
  { field: 'cityStateZip', label: 'City, State, Zip' },
  { field: 'scope', label: 'Development Scope' },
  { field: 'budgetBuild', label: 'Budget for Build (Hard Costs)', numeric: true },
  { field: 'lotCost', label: 'Lot Cost (Land)', numeric: true }
];
export const PROJECT_INFO_RANGE = `'${V2_TABS.projectInfo}'!B2:B7`;
export const TRANSACTIONS_APPEND_RANGE = `${V2_TABS.transactions}!A:J`;

function normKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function toAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = parseFloat(String(value || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundCents(value) {
  return Math.round(value * 100) / 100;
}

function cellText(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

const PHASE_ALIASES = {
  framing: 'Framing Lumber & Truss',
  framinglumber: 'Framing Lumber & Truss',
  hvacroughin: 'HVAC / AC Systems',
  tile: 'Tile & Flooring',
  paint: 'Paint & Finishes'
};

/** v2 when the Sheet has both a `Transactions` and a `Project Info` tab. */
export function detectSheetLayout(tabTitles) {
  const titles = new Set((Array.isArray(tabTitles) ? tabTitles : []).map(t => cellText(t)));
  return titles.has(V2_TABS.transactions) && titles.has(V2_TABS.projectInfo)
    ? SHEET_LAYOUT_V2
    : SHEET_LAYOUT_LEGACY;
}

/** Category display name from an internal key ("Mechanicals_&_Utilities") or a display name. */
export function categoryDisplayName(keyOrName) {
  const wanted = normKey(keyOrName);
  if (!wanted) return '';
  const found = V2_CATEGORIES.find(c => normKey(c.key) === wanted || normKey(c.name) === wanted);
  return found ? found.name : String(keyOrName).replace(/_/g, ' ').trim();
}

/** Internal category key from a display name or key. */
export function categoryKeyFor(keyOrName) {
  const wanted = normKey(keyOrName);
  const found = V2_CATEGORIES.find(c => normKey(c.key) === wanted || normKey(c.name) === wanted);
  return found ? found.key : '';
}

/** The exact phase name used in the Sheet, or the input trimmed when it is not one of the 26. */
export function canonicalPhaseName(phase) {
  const wanted = normKey(phase);
  if (!wanted) return '';
  for (const category of V2_CATEGORIES) {
    const match = category.phases.find(p => normKey(p) === wanted);
    if (match) return match;
  }
  return PHASE_ALIASES[wanted] || String(phase).trim();
}

export function categoryForPhase(phase) {
  const wanted = normKey(canonicalPhaseName(phase));
  return V2_CATEGORIES.find(c => c.phases.some(p => normKey(p) === wanted)) || null;
}

/** Text typed into the Sheet with USER_ENTERED must never turn into a formula. */
export function asSheetText(value) {
  const text = cellText(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

/** The Receipt ID for a synced Drive file: the app's own receipt/split id, else the Drive file id. */
export function getReceiptId(file, metadata) {
  return cellText(metadata?.receiptId) || cellText(file?.id);
}

/**
 * One Transactions row (A:J) for a receipt or one split of a receipt.
 * Date, Payee, Description, Category, Phase, Material, Labor, Check / Payment, Receipt, Receipt ID
 */
export function buildTransactionRow(metadata = {}, { receiptId = '', fileUrl = '' } = {}) {
  const amountSource = typeof metadata.amount === 'number'
    ? metadata.amount
    : (typeof metadata.totalCost === 'number'
      ? metadata.totalCost
      : (metadata.amount ?? metadata.totalCost ?? metadata.cost ?? metadata.price ?? metadata.total));
  const amount = roundCents(toAmount(amountSource));
  const isLabor = String(metadata.costCategory || 'material').toLowerCase().includes('labor');
  const payee = metadata.vendor || metadata.contractorVendor || metadata.payee || metadata.contractor || '';
  const date = metadata.date || metadata.paymentDate || metadata.transactionDate || '';
  const check = metadata.checkNumber || metadata.checkNo || metadata.checkOrTrans || metadata.check || '';
  const description = metadata.description || metadata.desc || metadata.item || 'Scanned Invoice';
  const safeUrl = String(fileUrl || '').trim();

  return [
    asSheetText(date),
    asSheetText(payee),
    asSheetText(description),
    categoryDisplayName(metadata.tradeCategory),
    canonicalPhaseName(metadata.tradePhase),
    isLabor ? '' : amount,
    isLabor ? amount : '',
    asSheetText(check),
    // Plain URL (not a HYPERLINK formula): the category tabs copy these rows with FILTER and only plain URLs stay clickable
    asSheetText(safeUrl),
    asSheetText(receiptId)
  ];
}

/** Receipt IDs already in Transactions column J (values from a `Transactions!J2:J` read). */
export function collectReceiptIds(columnValues) {
  const ids = new Set();
  (Array.isArray(columnValues) ? columnValues : []).forEach(row => {
    const id = cellText(Array.isArray(row) ? row[0] : row);
    if (id) ids.add(id);
  });
  return ids;
}

/** Project Info values by label (rows of [label, value]). */
export function parseProjectInfo(rows) {
  const byLabel = {};
  (Array.isArray(rows) ? rows : []).forEach(row => {
    if (!Array.isArray(row)) return;
    const label = normKey(row[0]);
    if (label && !(label in byLabel)) byLabel[label] = row[1];
  });

  const info = {};
  PROJECT_INFO_FIELDS.forEach(({ field, label, numeric }) => {
    const raw = byLabel[normKey(label)];
    info[field] = numeric ? toAmount(raw) : cellText(raw);
  });
  return info;
}

/** The six Project Info values for `Project Info!B2:B7`, in row order. */
export function buildProjectInfoValues(info = {}) {
  return PROJECT_INFO_FIELDS.map(({ field, numeric }) => {
    const raw = info[field];
    if (numeric) {
      const text = cellText(raw);
      if (!text) return [''];
      const amount = toAmount(text);
      return [Number.isFinite(amount) ? amount : ''];
    }
    return [asSheetText(raw)];
  });
}

/** Transactions rows (row 1 = headers) into plain objects. */
export function parseTransactions(rows) {
  const list = [];
  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    if (index === 0 || !Array.isArray(row)) return;
    if (!row.some(cell => cellText(cell) !== '')) return;
    list.push({
      rowNumber: index + 1,
      date: cellText(row[0]),
      payee: cellText(row[1]),
      description: cellText(row[2]),
      category: cellText(row[3]),
      phase: cellText(row[4]),
      material: toAmount(row[5]),
      labor: toAmount(row[6]),
      check: cellText(row[7]),
      receipt: cellText(row[8]),
      receiptId: cellText(row[9])
    });
  });
  return list;
}

/** Contracts rows (row 1 = headers): Sub, Company, Category, Phase, Quote. Paid / Still owed are worked out in code. */
export function parseContracts(rows) {
  const list = [];
  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    if (index === 0 || !Array.isArray(row)) return;
    const sub = cellText(row[0]);
    const company = cellText(row[1]);
    if (!sub && !company) return;
    list.push({
      rowNumber: index + 1,
      sub,
      company,
      category: cellText(row[2]),
      phase: cellText(row[3]),
      quote: toAmount(row[4])
    });
  });
  return list;
}

function samePayee(a, b) {
  const left = cellText(a).toLowerCase();
  return Boolean(left) && left === cellText(b).toLowerCase();
}

/**
 * Paid on a contract = labor in Transactions for the contract's phase where Payee = Sub or Payee = Company
 * (same rule as the Sheet's Contracts formula; Sheets compares text without case).
 */
export function computeContractPaid(contract, transactions) {
  if (!contract?.phase) return 0;
  const phaseKey = normKey(contract.phase);
  const total = (Array.isArray(transactions) ? transactions : []).reduce((sum, t) => {
    if (normKey(t.phase) !== phaseKey) return sum;
    const matches = samePayee(t.payee, contract.sub) || (contract.company && samePayee(t.payee, contract.company));
    return matches ? sum + t.labor : sum;
  }, 0);
  return roundCents(total);
}

/** How a contract's sub is shown: "Enrique Vallejo (Lucen LLC)" when both names exist and differ, else the one name. */
export function contractDisplayName(sub, company) {
  const person = cellText(sub);
  const firm = cellText(company);
  if (person && firm && person.toLowerCase() !== firm.toLowerCase()) return `${person} (${firm})`;
  return person || firm;
}

function formatMoney(value) {
  return `$${roundCents(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Everything the in-app Dashboard shows for a v2 Sheet, in the same shapes the old parser returns:
 * { projectInfo, subcontractors (one entry per phase), categories, contracts }.
 */
export function computeV2Dashboard({ projectInfoRows = [], transactionRows = [], contractRows = [] } = {}) {
  const info = parseProjectInfo(projectInfoRows);
  const transactions = parseTransactions(transactionRows);
  const contracts = parseContracts(contractRows).map(contract => {
    const paid = computeContractPaid(contract, transactions);
    return {
      ...contract,
      displayName: contractDisplayName(contract.sub, contract.company),
      phase: canonicalPhaseName(contract.phase),
      category: categoryForPhase(contract.phase)?.name || categoryDisplayName(contract.category),
      paid,
      stillOwed: roundCents(contract.quote - paid)
    };
  });

  const totalSpent = roundCents(transactions.reduce((sum, t) => sum + t.material + t.labor, 0));
  const stillOwed = roundCents(contracts.reduce((sum, c) => sum + Math.max(0, c.stillOwed), 0));
  const budgetBuild = info.budgetBuild;
  const budgetLand = info.lotCost;
  const budgetRemaining = roundCents(budgetBuild - totalSpent);

  // Phases in Sheet order, plus any phase typed by hand that is not one of the 26
  const phaseEntries = [];
  const phaseIndex = new Map();
  const addPhase = (categoryName, phaseName) => {
    const key = normKey(phaseName);
    if (phaseIndex.has(key)) return phaseIndex.get(key);
    const entry = { category: categoryName, phase: phaseName, material: 0, labor: 0, payments: [], contracts: [] };
    phaseIndex.set(key, entry);
    phaseEntries.push(entry);
    return entry;
  };
  V2_CATEGORIES.forEach(c => c.phases.forEach(p => addPhase(c.name, p)));

  const phaseEntryFor = (phase, categoryText) => {
    const canonical = canonicalPhaseName(phase) || 'Unassigned';
    const existing = phaseIndex.get(normKey(canonical));
    if (existing) return existing;
    return addPhase(categoryForPhase(canonical)?.name || categoryDisplayName(categoryText) || 'Other', canonical);
  };

  transactions.forEach(t => {
    const entry = phaseEntryFor(t.phase, t.category);
    entry.material += t.material;
    entry.labor += t.labor;
    entry.payments.push({
      vendor: t.payee || 'Unknown Vendor',
      materialCost: formatMoney(t.material),
      laborCost: formatMoney(t.labor),
      date: t.date || 'N/A',
      checkNumber: t.check || 'N/A',
      rowNumber: t.rowNumber
    });
  });
  contracts.forEach(c => phaseEntryFor(c.phase, c.category).contracts.push(c));

  const subcontractors = phaseEntries.map(entry => {
    const quote = entry.contracts.reduce((sum, c) => sum + c.quote, 0);
    const paid = entry.contracts.reduce((sum, c) => sum + c.paid, 0);
    const owed = entry.contracts.reduce((sum, c) => sum + c.stillOwed, 0);
    const payee = entry.contracts.map(c => c.displayName).filter(Boolean).join(' / ');
    const material = roundCents(entry.material);
    const labor = roundCents(entry.labor);
    return {
      id: `sub_${entry.phase.replace(/[^a-z0-9]/gi, '_')}`,
      category: entry.category,
      categorySheetName: entry.category,
      phase: entry.phase,
      payee,
      originalQuote: roundCents(quote),
      contractorPaid: roundCents(paid),
      totalPaid: roundCents(material + labor),
      remainingBalance: roundCents(owed),
      status: '',
      payments: entry.payments,
      contracts: entry.contracts,
      totalMaterial: material,
      totalLabor: labor,
      totalSpent: roundCents(material + labor),
      hasFormulaError: false,
      formulaErrors: []
    };
  });

  const categoryNames = [];
  subcontractors.forEach(s => { if (!categoryNames.includes(s.category)) categoryNames.push(s.category); });
  const categories = categoryNames.map(name => {
    const subs = subcontractors.filter(s => s.category === name);
    const sum = (field) => roundCents(subs.reduce((total, s) => total + s[field], 0));
    return {
      name,
      sheetName: name,
      totalQuote: sum('originalQuote'),
      totalPaid: sum('totalSpent'),
      totalOwed: sum('remainingBalance'),
      totalMaterial: sum('totalMaterial'),
      totalLabor: sum('totalLabor'),
      phasesCount: subs.length
    };
  });

  return {
    layout: SHEET_LAYOUT_V2,
    projectInfo: {
      layout: SHEET_LAYOUT_V2,
      name: info.name || 'Unnamed Project',
      scope: info.scope,
      address: info.address,
      cityStateZip: info.cityStateZip,
      budgetBuild,
      budgetLand,
      budgetGross: roundCents(budgetBuild + budgetLand),
      totalSpent,
      budgetRemaining,
      stillOwed,
      budgetAfterSubs: roundCents(budgetRemaining - stillOwed),
      projectedBuildCost: roundCents(totalSpent + stillOwed),
      hasFormulaError: false,
      formulaErrors: []
    },
    subcontractors,
    categories,
    contracts
  };
}

async function sheetsRequest(accessToken, url, options = {}, action = 'read the Google Sheet') {
  const response = await fetch(url, {
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

/** Tab titles (and ids) of a spreadsheet. */
export async function fetchSheetTabs(accessToken, spreadsheetId) {
  const url = `${GOOGLE_SHEETS_API_BASE}/${spreadsheetId}?fields=sheets(properties(sheetId,title))`;
  const data = await sheetsRequest(accessToken, url, {}, 'read the Google Sheet tabs');
  return (data.sheets || []).map(s => s.properties || {}).filter(p => p.title);
}

/** batchUpdate body that clips long receipt links: column G (rows 1-2000) of each category tab and Transactions column I (rows 1-5000). */
export function buildClipReceiptLinksRequest(tabs) {
  const clip = (sheetId, column, endRow) => ({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: endRow, startColumnIndex: column, endColumnIndex: column + 1 },
      cell: { userEnteredFormat: { wrapStrategy: 'CLIP' } },
      fields: 'userEnteredFormat.wrapStrategy'
    }
  });
  const requests = [];
  const list = Array.isArray(tabs) ? tabs : [];
  V2_CATEGORIES.forEach(category => {
    const tab = list.find(t => cellText(t?.title) === category.name);
    if (tab && tab.sheetId !== undefined && tab.sheetId !== null) requests.push(clip(tab.sheetId, 6, 2000));
  });
  const transactions = list.find(t => cellText(t?.title) === V2_TABS.transactions);
  if (transactions && transactions.sheetId !== undefined && transactions.sheetId !== null) {
    requests.push(clip(transactions.sheetId, 8, 5000));
  }
  return { requests };
}

/**
 * Keeps long Drive links inside their cell instead of spilling into the empty columns to the right.
 * Returns { ok, error }; never throws.
 */
export async function clipReceiptLinkColumns(accessToken, spreadsheetId) {
  try {
    const body = buildClipReceiptLinksRequest(await fetchSheetTabs(accessToken, spreadsheetId));
    if (body.requests.length === 0) return { ok: true, error: null };
    await sheetsRequest(accessToken, `${GOOGLE_SHEETS_API_BASE}/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, 'format the receipt link columns');
    return { ok: true, error: null };
  } catch (err) {
    console.warn('[sheetV2] Could not clip the receipt link columns:', err);
    return { ok: false, error: err };
  }
}

export async function fetchSheetLayout(accessToken, spreadsheetId) {
  const tabs = await fetchSheetTabs(accessToken, spreadsheetId);
  return detectSheetLayout(tabs.map(t => t.title));
}

/** Reads Project Info, Transactions and Contracts in one request and works out the Dashboard. */
export async function fetchV2DashboardData(accessToken, spreadsheetId) {
  const ranges = [
    `'${V2_TABS.projectInfo}'!A1:B20`,
    `${V2_TABS.transactions}!A1:J`,
    `${V2_TABS.contracts}!A1:E`
  ];
  const query = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');
  const url = `${GOOGLE_SHEETS_API_BASE}/${spreadsheetId}/values:batchGet?${query}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
  const data = await sheetsRequest(accessToken, url, {}, 'load the Google Sheet');
  const [projectInfoRange, transactionsRange, contractsRange] = data.valueRanges || [];
  return computeV2Dashboard({
    projectInfoRows: projectInfoRange?.values || [],
    transactionRows: transactionsRange?.values || [],
    contractRows: contractsRange?.values || []
  });
}

/** Receipt IDs already in Transactions (column J). */
export async function fetchExistingReceiptIds(accessToken, spreadsheetId) {
  const url = `${GOOGLE_SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(`${V2_TABS.transactions}!J2:J`)}`;
  const data = await sheetsRequest(accessToken, url, {}, 'read Transactions');
  return collectReceiptIds(data.values || []);
}

/** Fills the next empty rows at the bottom of Transactions (keeps the template's row formatting and dropdowns). Returns the fetch response. */
export async function appendTransactionRows(accessToken, spreadsheetId, rows) {
  const url = `${GOOGLE_SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(TRANSACTIONS_APPEND_RANGE)}:append?valueInputOption=USER_ENTERED&insertDataOption=OVERWRITE`;
  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ values: rows })
  });
}

/** Writes the six setup values to `Project Info!B2:B7`. */
export async function writeProjectInfo(accessToken, spreadsheetId, info) {
  const url = `${GOOGLE_SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(PROJECT_INFO_RANGE)}?valueInputOption=USER_ENTERED`;
  return sheetsRequest(accessToken, url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ range: PROJECT_INFO_RANGE, majorDimension: 'ROWS', values: buildProjectInfoValues(info) })
  }, 'write Project Info');
}

/** Project Info of a linked Sheet, or null when the Sheet is not the new layout. */
export async function readProjectInfoIfV2(accessToken, spreadsheetId) {
  if (await fetchSheetLayout(accessToken, spreadsheetId) !== SHEET_LAYOUT_V2) return null;
  const url = `${GOOGLE_SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(`'${V2_TABS.projectInfo}'!A1:B20`)}?valueRenderOption=UNFORMATTED_VALUE`;
  const data = await sheetsRequest(accessToken, url, {}, 'read Project Info');
  return parseProjectInfo(data.values || []);
}

/** Known subs from the Contracts tab of a v2 Sheet ([] for old Sheets). */
export async function fetchKnownSubs(accessToken, spreadsheetId) {
  if (await fetchSheetLayout(accessToken, spreadsheetId) !== SHEET_LAYOUT_V2) return [];
  const url = `${GOOGLE_SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(`${V2_TABS.contracts}!A1:B`)}`;
  const data = await sheetsRequest(accessToken, url, {}, 'read Contracts');
  return buildKnownSubs(data.values || []);
}

/** Unique (Sub, Company) pairs from Contracts rows (row 1 = headers). */
export function buildKnownSubs(rows) {
  const seen = new Set();
  const list = [];
  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    if (index === 0 || !Array.isArray(row)) return;
    const sub = cellText(row[0]);
    const company = cellText(row[1]);
    if (!sub && !company) return;
    const key = `${sub.toLowerCase()}|${company.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ sub, company });
  });
  return list;
}
