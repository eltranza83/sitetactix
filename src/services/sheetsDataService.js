/**
 * Service to fetch and parse Google Sheets data for project dashboards and contractor summaries.
 */

const GOOGLE_SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export function normalizeKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Searches the rows for a text label and returns the cell offset value.
 * Useful for handling spreadsheet structures where row indexes might shift slightly.
 */
export function getValByLabel(rows, labelText, offsetCol = 1) {
  if (!rows || rows.length === 0) return '';
  const cleanLabel = normalizeKey(labelText);
  
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const cellVal = String(row[c] || '').trim();
      const cleanCellVal = normalizeKey(cellVal);
      if (cleanCellVal === cleanLabel) {
        return String(row[c + offsetCol] || '').trim();
      }
    }
  }
  return '';
}

export function isFormulaError(value) {
  if (value === null || value === undefined) return false;
  const str = String(value).trim();
  return /^#(?:REF|VALUE|N\/A|DIV\/0|ERROR|NAME\?|NUM|NULL)!?$/i.test(str) ||
         str.startsWith('#REF!') || str.startsWith('#VALUE!') || str.startsWith('#DIV/0!') || str.startsWith('#N/A');
}

export function getTodayCalendarDate(dateObj = new Date()) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function normalizeSpreadsheetDate(value) {
  if (!value && value !== 0) return 'N/A';
  const str = String(value).trim();
  if (!str || str === 'N/A') return 'N/A';
  if (str.toLowerCase() === 'today') return getTodayCalendarDate();

  // Excel / Google Sheets serial date number (e.g. 46235 or 46235.0, covering dates ~1982 to ~2119)
  const num = parseFloat(str);
  if (!isNaN(num) && num > 20000 && num < 80000 && /^\d+(?:\.\d+)?$/.test(str)) {
    const date = new Date(Math.round((num - 25569) * 86400 * 1000));
    if (!isNaN(date.getTime())) {
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, '0');
      const d = String(date.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }

  return str;
}

export function parseCurrency(value) {
  if (isFormulaError(value)) {
    return NaN;
  }
  return parseFloat(String(value || '').replace(/[^0-9.-]/g, '')) || 0;
}

export function getWords(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter(word => !['and', 'the', 'of'].includes(word));
}

export function scoreWordOverlap(left, right) {
  const leftWords = new Set(getWords(left));
  const rightWords = new Set(getWords(right));
  if (leftWords.size === 0 || rightWords.size === 0) return 0;

  let score = 0;
  leftWords.forEach(word => {
    if (rightWords.has(word)) {
      score += 1;
    }
  });
  return score;
}

export function findSummarySectionForSheet(sheetName, summarySections) {
  const readableSheetName = sheetName.replace(/_/g, ' ');

  let bestSection = null;
  let bestScore = 0;

  summarySections.forEach(section => {
    const score = scoreWordOverlap(readableSheetName, section.name);
    if (score > bestScore) {
      bestScore = score;
      bestSection = section;
    }
  });

  return bestScore > 0 ? bestSection : null;
}

export function isValidTransactionRow(colB, colC, colD, colE, colF) {
  const mat = parseCurrency(colC);
  const lab = parseCurrency(colD);
  if (!isNaN(mat) && mat > 0) return true;
  if (!isNaN(lab) && lab > 0) return true;
  if (isFormulaError(colC) || isFormulaError(colD)) return true;

  const vendor = String(colB || '').trim();
  const date = String(colE || '').trim();
  const check = String(colF || '').trim();

  const isPlaceholderVendor = !vendor || vendor.toLowerCase().endsWith('payee') || vendor.toLowerCase().includes('placeholder');
  const hasValidDate = date && date !== 'N/A' && date !== '0' && date !== '0.0';
  const hasValidCheck = check && check !== 'N/A' && check !== '0' && check !== '0.0';

  if (!isPlaceholderVendor && (hasValidDate || hasValidCheck)) {
    return true;
  }

  return false;
}

export function isSummarySectionHeader(row) {
  const label = String(row?.[0] || '').trim();
  if (!label) return false;

  const hasTotals = row.slice(1, 5).some(cell => String(cell || '').trim() !== '');
  if (hasTotals) return false;

  return label === label.toUpperCase() && /[A-Z]/.test(label);
}

export function createSummaryPhaseMeta(row) {
  return {
    phase: String(row[0] || '').trim(),
    status: row.length > 4 ? String(row[4] || '').trim() : '',
    materialCost: String(row[1] || '').trim() || '$0.00',
    laborCost: row.length > 2 ? String(row[2] || '').trim() || '$0.00' : '$0.00',
    combinedSpent: row.length > 3 ? String(row[3] || '').trim() || '$0.00' : '$0.00'
  };
}

/**
 * Parses the raw Summary_Dashboard tab rows.
 */
export function parseSummaryDashboard(rows) {
  if (!rows || rows.length === 0) {
    return {
      name: 'N/A',
      scope: 'N/A',
      address: 'N/A',
      cityStateZip: 'N/A',
      budgetBuild: '$0.00',
      budgetLand: '$0.00',
      budgetGross: '$0.00',
      deposits: '$0.00',
      totalSpent: '$0.00',
      capitalBalance: '$0.00',
      hasFormulaError: false,
      formulaErrors: []
    };
  }

  const budgetBuild = getValByLabel(rows, 'Budget for Build (Hard Costs)') || '$0.00';
  const budgetLand = getValByLabel(rows, 'Acquisition Lot Cost (Land)') || '$0.00';
  const budgetGross = getValByLabel(rows, 'Gross Projected Project Cost') || '$0.00';
  const deposits = getValByLabel(rows, 'Real Budget Deposits (Capital)') || '$0.00';
  const totalSpent = getValByLabel(rows, 'Total Spent to Date (Draws)') || '$0.00';
  const capitalBalance = getValByLabel(rows, 'Net Working Capital Balance') || '$0.00';

  const formulaErrors = [];
  [
    { label: 'Budget for Build (Hard Costs)', val: budgetBuild },
    { label: 'Acquisition Lot Cost (Land)', val: budgetLand },
    { label: 'Gross Projected Project Cost', val: budgetGross },
    { label: 'Real Budget Deposits (Capital)', val: deposits },
    { label: 'Total Spent to Date (Draws)', val: totalSpent },
    { label: 'Net Working Capital Balance', val: capitalBalance }
  ].forEach(item => {
    if (isFormulaError(item.val)) {
      formulaErrors.push({
        sheet: 'Summary_Dashboard',
        field: item.label,
        error: item.val,
        location: `Summary_Dashboard (${item.label})`
      });
    }
  });

  return {
    name: getValByLabel(rows, 'Project Name:') || 'Unnamed Project',
    scope: getValByLabel(rows, 'Development Scope:') || 'N/A',
    address: getValByLabel(rows, 'Street Address:') || 'N/A',
    cityStateZip: getValByLabel(rows, 'City, State, Zip:') || 'N/A',
    
    budgetBuild,
    budgetLand,
    budgetGross,
    
    deposits,
    totalSpent,
    capitalBalance,
    hasFormulaError: formulaErrors.length > 0,
    formulaErrors
  };
}

export function findPhaseMeta(phaseName, phaseStatuses) {
  if (!phaseName || !phaseStatuses) return null;
  const cleanKey = normalizeKey(phaseName);
  if (phaseStatuses[cleanKey]) return phaseStatuses[cleanKey];

  let bestMeta = null;
  let bestScore = 0;
  Object.keys(phaseStatuses).forEach(key => {
    const meta = phaseStatuses[key];
    const score = scoreWordOverlap(phaseName, meta?.phase || key);
    if (score > bestScore) {
      bestScore = score;
      bestMeta = meta;
    }
  });

  return bestScore > 0 ? bestMeta : null;
}

/**
 * Analyzes all rows in a phase block to extract the contractor payee, quote, paid, balance, status, and payments.
 */
export function finalizeBlock(block, phaseStatuses = {}, fallbackSummaryMeta = null) {
  let payee = '';
  let originalQuote = '$0.00';
  let contractorPaid = '$0.00';
  let totalPaid = '$0.00';
  let remainingBalance = '$0.00';
  let status = 'Not Started';
  const payments = [];
  const formulaErrors = [];
  const sheetName = block.categorySheetName || block.category || 'Category';

  block.rows.forEach((row, idx) => {
    const rowNumber = row.rowNumber || (block.startRowIndex ? (block.startRowIndex + idx) : (idx + 1));
    const colB = String(row[1] || '').trim(); // Vendor
    const colC = String(row[2] || '').trim(); // Material Cost
    const colD = String(row[3] || '').trim(); // Labor Cost
    const colE = String(row[4] || '').trim(); // Date
    const colF = String(row[5] || '').trim(); // Check/Trans
    const colG = String(row[6] || '').trim(); // Payee
    const colH = String(row[7] || '').trim(); // Total Paid
    const colI = String(row[8] || '').trim(); // Quote
    const colJ = String(row[9] || '').trim(); // Balance
    const colK = String(row[10] || '').trim(); // Status

    // Track cell formula errors with exact location and field
    const checkCells = [
      { col: 'C', field: 'Material Cost', val: colC },
      { col: 'D', field: 'Labor Cost', val: colD },
      { col: 'G', field: 'Contractor Payee', val: colG },
      { col: 'H', field: 'Total Paid', val: colH },
      { col: 'I', field: 'Original Quote', val: colI },
      { col: 'J', field: 'Remaining Balance', val: colJ }
    ];

    checkCells.forEach(c => {
      if (isFormulaError(c.val)) {
        formulaErrors.push({
          sheet: sheetName,
          phase: block.phase,
          row: rowNumber,
          cellRef: `${c.col}${rowNumber}`,
          field: c.field,
          error: c.val,
          location: `${sheetName}!${c.col}${rowNumber} (${c.field} in ${block.phase})`
        });
      }
    });

    // 1. Payee: Prefer a name that is not a default placeholder (like ending with 'Payee')
    if (colG && colG !== '' && !isFormulaError(colG)) {
      const isPlaceholder = colG.toLowerCase().endsWith('payee') || colG.toLowerCase().includes('placeholder');
      if (!payee || !isPlaceholder) {
        payee = colG;
      }
    }

    // 2. Quote: Extract the last non-empty, non-zero quote value
    if (colI && colI !== '' && colI !== '$0.00' && !isFormulaError(colI)) {
      originalQuote = colI;
    } else if (colI && originalQuote === '$0.00') {
      originalQuote = colI;
    }

    // 3. Paid: Extract the last non-empty, non-zero contractor paid value (Col H)
    if (colH && colH !== '' && colH !== '$0.00' && !isFormulaError(colH)) {
      contractorPaid = colH;
      totalPaid = colH;
    } else if (colH && contractorPaid === '$0.00') {
      contractorPaid = colH;
      totalPaid = colH;
    }

    // 4. Balance: Extract the last non-empty, non-zero balance value
    if (colJ && colJ !== '' && colJ !== '$0.00' && !isFormulaError(colJ)) {
      remainingBalance = colJ;
    } else if (colJ && remainingBalance === '$0.00') {
      remainingBalance = colJ;
    }

    // 5. Status fallback (from category tab Column K)
    if (colK && colK !== '' && !isFormulaError(colK)) {
      status = colK;
    }

    // 6. Payments: Rows below the phase header row containing valid transaction detail
    if (idx > 0 && isValidTransactionRow(colB, colC, colD, colE, colF)) {
      payments.push({
        vendor: colB || payee || 'Unknown Vendor',
        materialCost: isFormulaError(colC) ? colC : (colC || '$0.00'),
        laborCost: isFormulaError(colD) ? colD : (colD || '$0.00'),
        date: normalizeSpreadsheetDate(colE),
        checkNumber: colF || 'N/A',
        rowNumber: rowNumber
      });
    }
  });

  // Match phase metadata from Summary_Dashboard using fuzzy name matching or fallbackSummaryMeta
  const meta = findPhaseMeta(block.phase, phaseStatuses) || fallbackSummaryMeta;
  if (meta) {
    if (typeof meta === 'object') {
      status = meta.status || status;
      totalPaid = meta.combinedSpent || '$0.00';
      if (isFormulaError(meta.combinedSpent)) {
        formulaErrors.push({
          sheet: 'Summary_Dashboard',
          phase: block.phase,
          field: 'Combined Spent',
          error: meta.combinedSpent,
          location: `Summary_Dashboard (Combined Spent for ${block.phase})`
        });
      }
    } else {
      status = meta;
    }
  }

  const metaMaterialTotal = (meta && typeof meta === 'object') ? meta.materialCost : '$0.00';
  const metaLaborTotal = (meta && typeof meta === 'object') ? meta.laborCost : '$0.00';
  const metaCombinedSpent = (meta && typeof meta === 'object') ? meta.combinedSpent : '$0.00';

  // Subcontractor paid amount: Col H from the Payee section is the authoritative contractor paid figure.
  // If Col H was empty or $0.00, fallback to metaLaborTotal from the summary dashboard if available.
  const resolvedContractorPaid = (contractorPaid && contractorPaid !== '$0.00')
    ? contractorPaid
    : (metaLaborTotal && metaLaborTotal !== '$0.00' ? metaLaborTotal : '$0.00');

  // Fallback to placeholder payee if no custom payee is filled in
  if (!payee && block.rows.length > 0) {
    payee = String(block.rows[0][6] || '').trim();
  }

  if (!payee || isFormulaError(payee)) {
    payee = `${block.phase} Contractor`;
  }

  return {
    id: `sub_${block.phase.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}`,
    category: block.category,
    categorySheetName: block.categorySheetName,
    phase: block.phase,
    payee: payee,
    originalQuote: originalQuote,
    contractorPaid: resolvedContractorPaid,
    totalPaid: totalPaid,
    remainingBalance: remainingBalance,
    status: status,
    payments: payments,
    totalMaterial: metaMaterialTotal,
    totalLabor: metaLaborTotal,
    totalSpent: metaCombinedSpent,
    hasFormulaError: formulaErrors.length > 0,
    formulaErrors
  };
}

/**
 * Parses a subcontractor category tab (e.g. Paint_Tile).
 */
export function parseCategorySheet(sheetName, rows, phaseStatuses = {}, summarySection = null) {
  const contractors = [];
  if (!rows || rows.length <= 1) return contractors;

  const categoryName = sheetName.replace(/_/g, ' ').replace(/&/g, '&');

  let currentBlock = null;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    const colA = String(row[0] || '').trim();

    // A new phase block starts when Column A begins with an arrow or bullet indicator
    const isPhaseHeader = colA.startsWith('→') || colA.startsWith('—') || colA.startsWith('-');

    if (isPhaseHeader) {
      if (currentBlock) {
        contractors.push(finalizeBlock(currentBlock, phaseStatuses, summarySection?.phases?.[contractors.length] || null));
      }

      const phaseName = colA.replace(/^[→\-—\s]+/, '').trim();
      currentBlock = {
        category: categoryName,
        categorySheetName: sheetName,
        phase: phaseName,
        startRowIndex: r + 1,
        rows: []
      };
    }

    if (currentBlock) {
      row.rowNumber = r + 1;
      currentBlock.rows.push(row);
    }
  }

  if (currentBlock) {
    contractors.push(finalizeBlock(currentBlock, phaseStatuses, summarySection?.phases?.[contractors.length] || null));
  }

  return contractors;
}

/**
 * Main entry point to batch-fetch and parse all subcontractor and summary sheets.
 */
export async function fetchProjectDashboardData(accessToken, spreadsheetId) {
  const ranges = [
    'Summary_Dashboard!A1:E',
    'Site_Prep_&_Structure!A1:K',
    'Framing_&_Lumber!A1:K',
    'Mechanicals_&_Utilities!A1:K',
    'Interior_Finishes!A1:K',
    'Paint_Tile!A1:K',
    'House_Exterior_&_Yard!A1:K',
    'Project_Overhead_&_Bills!A1:K',
    'Paperwork_&_Permits!A1:K',
    'Interior_Hardware!A1:K'
  ];

  const queryParams = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');
  const url = `${GOOGLE_SHEETS_API_BASE}/${spreadsheetId}/values:batchGet?${queryParams}&valueRenderOption=FORMATTED_VALUE`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to fetch spreadsheet dashboard data: ${errText}`);
  }

  const data = await response.json();
  const valueRanges = data.valueRanges || [];

  let projectInfo = {};
  let subcontractorsList = [];
  const categorySummaries = [];
  const phaseStatuses = {};
  const summarySections = [];

  // First pass: Find Summary_Dashboard to parse project info and collect statuses
  for (let i = 0; i < valueRanges.length; i++) {
    const vRange = valueRanges[i];
    const rangeName = vRange.range || '';
    const rows = vRange.values || [];

    if (rangeName.includes('Summary_Dashboard')) {
      projectInfo = parseSummaryDashboard(rows);
      let currentSummarySection = null;
      
      // Collect statuses and metadata for each phase
      rows.forEach(row => {
        if (!row || row.length < 1) return;
        const colA = String(row[0] || '').trim();
        if (isSummarySectionHeader(row)) {
          currentSummarySection = {
            name: colA,
            phases: []
          };
          summarySections.push(currentSummarySection);
          return;
        }

        if (row.length < 2) return;
        const meta = createSummaryPhaseMeta(row);
        const cleanPhase = normalizeKey(colA);
        if (cleanPhase && !cleanPhase.includes('projecttrade') && !cleanPhase.includes('phase')) {
          phaseStatuses[cleanPhase] = meta;
          if (currentSummarySection) {
            currentSummarySection.phases.push(meta);
          }
        }
      });
    }
  }

  // Second pass: Parse all category sheets using the collected statuses
  let categorySheetIndex = 0;
  for (let i = 0; i < valueRanges.length; i++) {
    const vRange = valueRanges[i];
    const rangeName = vRange.range || '';
    const rows = vRange.values || [];

    if (!rangeName.includes('Summary_Dashboard')) {
      const sheetName = rangeName.split('!')[0].replace(/'/g, '');
      const summarySection = findSummarySectionForSheet(sheetName, summarySections);
      const parsedSubs = parseCategorySheet(sheetName, rows, phaseStatuses, summarySection);
      categorySheetIndex += 1;
      
      if (parsedSubs.length > 0) {
        subcontractorsList = [...subcontractorsList, ...parsedSubs];
        
        let catQuote = 0;
        let catPaid = 0;
        let catOwed = 0;
        let catMaterial = 0;
        let catLabor = 0;

        parsedSubs.forEach(s => {
          const quote = parseCurrency(s.originalQuote);
          const owed = parseCurrency(s.remainingBalance);
          
          // Phase totals must come from Summary_Dashboard only.
          const spentVal = s.totalSpent ? parseCurrency(s.totalSpent) : 0;
          const paid = spentVal;
          
          const material = parseCurrency(s.totalMaterial);
          const labor = parseCurrency(s.totalLabor);
          
          catQuote += quote;
          catPaid += paid;
          catOwed += owed;
          catMaterial += material;
          catLabor += labor;
        });

        categorySummaries.push({
          name: sheetName.replace(/_/g, ' ').replace(/&/g, '&'),
          sheetName: sheetName,
          totalQuote: catQuote,
          totalPaid: catPaid,
          totalOwed: catOwed,
          totalMaterial: catMaterial,
          totalLabor: catLabor,
          phasesCount: parsedSubs.length
        });
      }
    }
  }

  return {
    projectInfo,
    subcontractors: subcontractorsList,
    categories: categorySummaries
  };
}

/**
 * Overwrites the 'Issues' tab in Google Sheets with the current list of issues.
 * Creates the sheet tab if it doesn't exist.
 */
export async function syncIssuesToSheet(accessToken, spreadsheetId, issues) {
  const sheetName = 'Issues';
  
  // 1. Fetch spreadsheet metadata to check if the 'Issues' tab exists
  const metaUrl = `${GOOGLE_SHEETS_API_BASE}/${spreadsheetId}?fields=sheets.properties`;
  const metaResponse = await fetch(metaUrl, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!metaResponse.ok) {
    throw new Error(`Failed to fetch spreadsheet metadata: ${await metaResponse.text()}`);
  }
  const meta = await metaResponse.json();
  const sheets = meta.sheets || [];
  const issuesSheetExists = sheets.some(s => s.properties?.title === sheetName);
  
  // 2. Create the sheet if it doesn't exist
  if (!issuesSheetExists) {
    const createUrl = `${GOOGLE_SHEETS_API_BASE}/${spreadsheetId}:batchUpdate`;
    const createResponse = await fetch(createUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName
              }
            }
          }
        ]
      })
    });
    if (!createResponse.ok) {
      throw new Error(`Failed to create Issues sheet tab: ${await createResponse.text()}`);
    }
  }
  
  // 3. Clear old issues data (A1:Z1000) to avoid trailing rows
  const clearUrl = `${GOOGLE_SHEETS_API_BASE}/${spreadsheetId}/values/Issues!A1:Z1000:clear`;
  const clearResponse = await fetch(clearUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!clearResponse.ok) {
    throw new Error(`Failed to clear old Issues data: ${await clearResponse.text()}`);
  }
  
  // 4. Prep rows data
  const headers = [
    'ID',
    'Date Created',
    'Title',
    'Description',
    'Category',
    'Trade Phase',
    'Contractor Name',
    'Phone Number',
    'Priority',
    'Status',
    'Photo URL',
    'Floor Plan X',
    'Floor Plan Y',
    'Floor Plan Pin Image'
  ];
  
  const rows = [headers];
  (issues || []).forEach(issue => {
    rows.push([
      issue.id,
      issue.createdAt ? new Date(issue.createdAt).toLocaleDateString() : '',
      issue.title || '',
      issue.description || '',
      String(issue.category || '').replace(/_/g, ' '),
      issue.tradePhase || '',
      issue.contractorName || '',
      issue.phoneNumber || '',
      issue.priority || '',
      issue.status || '',
      issue.photoUrl || '',
      Number.isFinite(Number(issue.floorPlanX)) ? issue.floorPlanX : '',
      Number.isFinite(Number(issue.floorPlanY)) ? issue.floorPlanY : '',
      issue.floorPlanSnapshotUrl || ''
    ]);
  });
  
  // 5. Write the rows to the spreadsheet
  const writeUrl = `${GOOGLE_SHEETS_API_BASE}/${spreadsheetId}/values/Issues!A1?valueInputOption=USER_ENTERED`;
  const writeResponse = await fetch(writeUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      values: rows
    })
  });
  if (!writeResponse.ok) {
    throw new Error(`Failed to write Issues data: ${await writeResponse.text()}`);
  }
}

