import { parseCurrency } from '../../sheetsDataService.js';
import { loadStoredAppState } from '../../appStorage.js';

const GOOGLE_SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * Calculates string similarity between 0 and 1.
 */
function stringSimilarity(s1, s2) {
  if (!s1 || !s2) return 0;
  const a = s1.toLowerCase().trim();
  const b = s2.toLowerCase().trim();
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;

  // Simple token overlap
  const wordsA = a.split(/[\s,&/-]+/).filter(w => w.length > 2);
  const wordsB = b.split(/[\s,&/-]+/).filter(w => w.length > 2);
  let common = 0;
  for (const w of wordsA) {
    if (wordsB.some(wb => wb.includes(w) || w.includes(wb))) {
      common++;
    }
  }
  const total = Math.max(wordsA.length, wordsB.length);
  return total > 0 ? common / total : 0;
}

/**
 * Parses Drive file ID from a Google Sheets formula string.
 * Example: =HYPERLINK("https://drive.google.com/file/d/1a2b3c4d5e/view...", 450.00)
 */
export function extractDriveIdFromFormula(formula) {
  if (!formula || typeof formula !== 'string') return null;
  const match = formula.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([a-zA-Z0-9_-]+)/i);
  return match ? match[1] : null;
}

/**
 * LedgerSource provides a clean, single-point interface to all project financial data.
 */
export class LedgerSource {
  constructor(dashData = null, syncHistory = null, formulaHyperlinks = {}) {
    this.dashData = dashData || { projectInfo: {}, subcontractors: [], categories: [] };
    this.syncHistory = syncHistory || this.dashData.syncHistory || [];
    this.formulaHyperlinks = formulaHyperlinks || {};
  }

  /**
   * Factory method to initialize LedgerSource with live sheet formulas and sync history.
   */
  static async create({ googleToken, spreadsheetId, currentDashboard }) {
    let dashData = currentDashboard || null;
    let syncHistory = [];
    const formulaHyperlinks = {};

    try {
      const appState = loadStoredAppState();
      syncHistory = Array.isArray(appState.history) ? appState.history : [];
    } catch {
      syncHistory = [];
    }

    if (googleToken && spreadsheetId) {
      try {
        const formulaRanges = [
          'Site_Prep_&_Structure!C1:D',
          'Framing_&_Lumber!C1:D',
          'Mechanicals_&_Utilities!C1:D',
          'Interior_Finishes!C1:D',
          'Paint_Tile!C1:D',
          'House_Exterior_&_Yard!C1:D',
          'Project_Overhead_&_Bills!C1:D',
          'Paperwork_&_Permits!C1:D',
          'Interior_Hardware!C1:D'
        ];
        const query = formulaRanges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');
        const url = `${GOOGLE_SHEETS_API_BASE}/${spreadsheetId}/values:batchGet?${query}&valueRenderOption=FORMULA`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${googleToken}` }
        });
        if (res.ok) {
          const data = await res.json();
          (data.valueRanges || []).forEach(vr => {
            const sheet = (vr.range || '').split('!')[0].replace(/'/g, '');
            (vr.values || []).forEach((row, idx) => {
              const rowNum = idx + 1;
              const cellC = String(row[0] || '');
              const cellD = String(row[1] || '');
              const idC = extractDriveIdFromFormula(cellC);
              const idD = extractDriveIdFromFormula(cellD);
              if (idC) formulaHyperlinks[`${sheet}_C${rowNum}`] = idC;
              if (idD) formulaHyperlinks[`${sheet}_D${rowNum}`] = idD;
            });
          });
        }
      } catch (err) {
        console.warn('[LedgerSource] Formula batchGet skipped:', err);
      }
    }

    return new LedgerSource(dashData, syncHistory, formulaHyperlinks);
  }

  getSummary() {
    const info = this.dashData.projectInfo || {};
    const subs = this.dashData.subcontractors || [];

    let totalMaterialNum = 0;
    let totalLaborNum = 0;
    let stillOwedNum = 0;

    subs.forEach(s => {
      totalMaterialNum += parseCurrency(s.totalMaterial);
      totalLaborNum += parseCurrency(s.totalLabor);
      stillOwedNum += parseCurrency(s.remainingBalance);
    });

    const hasInfoTotal = Boolean(info.totalSpent);
    const infoTotalNum = parseCurrency(info.totalSpent);
    const subTotalNum = totalMaterialNum + totalLaborNum;
    const totalSpentNum = hasInfoTotal ? infoTotalNum : subTotalNum;
    const projectedNum = totalSpentNum + stillOwedNum;

    const summary = {
      projectName: info.name || 'Active Project',
      budgetBuild: info.budgetBuild || '$0.00',
      budgetGross: info.budgetGross || '$0.00',
      totalSpent: `$${totalSpentNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      stillOwed: `$${stillOwedNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      projectedTotal: `$${projectedNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      cashOnHand: info.capitalBalance || '$0.00'
    };

    if (Math.abs(subTotalNum - totalSpentNum) < 0.01 && subTotalNum > 0) {
      summary.materialSpent = `$${totalMaterialNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      summary.laborSpent = `$${totalLaborNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    return summary;
  }

  getContractors(contractorQuery = '') {
    const subs = this.dashData.subcontractors || [];
    const query = String(contractorQuery || '').toLowerCase().trim();

    const allFormatted = subs.map(s => ({
      name: s.payee,
      phase: s.phase,
      category: s.category,
      quote: s.originalQuote || '$0.00',
      laborPaid: s.contractorPaid || s.totalLabor || '$0.00',
      stillOwed: s.remainingBalance || '$0.00',
      status: s.status || 'In Progress'
    }));

    if (!query) {
      return {
        matched: true,
        contractors: allFormatted
      };
    }

    // Exact or contains matching only (no code-side dictionary/heuristic gates)
    const exactOrContains = allFormatted.filter(c => {
      const name = String(c.name || '').toLowerCase();
      const phase = String(c.phase || '').toLowerCase();
      const cat = String(c.category || '').toLowerCase();
      return name.includes(query) || phase.includes(query) || cat.includes(query);
    });

    if (exactOrContains.length > 0) {
      return {
        matched: true,
        contractors: exactOrContains
      };
    }

    // No exact/contains match: return ALL contractors so the AI model resolves trade/name
    return {
      matched: false,
      contractors: allFormatted,
      allContractors: allFormatted,
      message: `No exact contractor match found for "${contractorQuery}". Here are all project contractors for you to identify the correct trade/contractor:`
    };
  }

  getSpending({ phase = '', category = '' } = {}) {
    const subs = this.dashData.subcontractors || [];
    const cats = this.dashData.categories || [];
    const pQ = String(phase || '').toLowerCase().trim();
    const cQ = String(category || '').toLowerCase().trim();

    if (pQ) {
      const matchingPhases = subs.filter(s => {
        const pName = String(s.phase || '').toLowerCase();
        return pName.includes(pQ) || stringSimilarity(pQ, pName) > 0.4;
      });

      return {
        byPhase: matchingPhases.map(s => ({
          phase: s.phase,
          category: s.category,
          contractor: s.payee,
          materialSpent: s.totalMaterial || '$0.00',
          laborSpent: s.totalLabor || '$0.00',
          totalSpent: s.totalSpent || '$0.00',
          quote: s.originalQuote || '$0.00',
          stillOwed: s.remainingBalance || '$0.00'
        }))
      };
    }

    if (cQ) {
      const matchingCats = cats.filter(c => {
        const cName = String(c.name || '').toLowerCase();
        return cName.includes(cQ) || stringSimilarity(cQ, cName) > 0.4;
      });

      return {
        byCategory: matchingCats.map(c => ({
          category: c.name,
          totalQuote: `$${(c.totalQuote || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          totalPaid: `$${(c.totalPaid || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          totalOwed: `$${(c.totalOwed || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          totalMaterial: `$${(c.totalMaterial || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          totalLabor: `$${(c.totalLabor || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
        }))
      };
    }

    // Default: summary of all categories
    return {
      allCategories: cats.map(c => ({
        category: c.name,
        totalSpent: `$${(c.totalPaid || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
        totalOwed: `$${(c.totalOwed || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
      }))
    };
  }

  getTransactions({ text = '', vendor = '', from = '', to = '', minAmount = null, maxAmount = null } = {}) {
    const subs = this.dashData.subcontractors || [];
    const allTx = [];

    // Collect transactions from sheet blocks
    subs.forEach(s => {
      (s.payments || []).forEach((p, idx) => {
        const matNum = parseCurrency(p.materialCost);
        const labNum = parseCurrency(p.laborCost);
        const totalNum = matNum > 0 ? matNum : (labNum > 0 ? labNum : 0);
        const rowNum = p.rowNumber || (idx + 2);
        const sheetKey = s.categorySheetName || (s.category ? s.category.replace(/\s+/g, '_') : '');
        const cellRefC = `${sheetKey}_C${rowNum}`;
        const cellRefD = `${sheetKey}_D${rowNum}`;
        const driveFileId = this.formulaHyperlinks[cellRefC] || this.formulaHyperlinks[cellRefD] || null;

        allTx.push({
          date: p.date || '',
          vendor: p.vendor || s.payee || 'Unknown',
          description: p.vendor || s.phase,
          amount: totalNum,
          formattedAmount: `$${totalNum.toFixed(2)}`,
          materialCost: p.materialCost || '$0.00',
          laborCost: p.laborCost || '$0.00',
          checkNumber: p.checkNumber || 'N/A',
          phase: s.phase,
          category: s.category,
          receiptLink: driveFileId ? `https://drive.google.com/file/d/${driveFileId}/view` : null,
          driveFileId: driveFileId,
          lineItems: []
        });
      });
    });

    // Merge or enrich with sync history
    this.syncHistory.forEach(h => {
      const existing = allTx.find(t => 
        (t.driveFileId && t.driveFileId === h.driveFileId) ||
        (t.date === h.dateTransaction && Math.abs(t.amount - Number(h.amount || 0)) < 0.05)
      );

      if (existing) {
        if (h.driveFileId) existing.driveFileId = h.driveFileId;
        if (h.link) existing.receiptLink = h.link;
        if (h.description) existing.description = h.description;
        if (Array.isArray(h.lineItems) && h.lineItems.length > 0) existing.lineItems = h.lineItems;
      } else {
        const amt = Number(h.amount || 0);
        allTx.push({
          date: h.dateTransaction || h.dateLogged || '',
          vendor: h.vendor || 'Unknown',
          description: h.description || '',
          amount: amt,
          formattedAmount: `$${amt.toFixed(2)}`,
          materialCost: h.costCategory === 'material' ? `$${amt.toFixed(2)}` : '$0.00',
          laborCost: h.costCategory === 'labor' ? `$${amt.toFixed(2)}` : '$0.00',
          checkNumber: h.checkNumber || 'N/A',
          phase: h.tradePhase || '',
          category: h.tradeCategory || '',
          receiptLink: h.link || (h.driveFileId ? `https://drive.google.com/file/d/${h.driveFileId}/view` : null),
          driveFileId: h.driveFileId || null,
          lineItems: Array.isArray(h.lineItems) ? h.lineItems : []
        });
      }
    });

    let results = allTx;

    // Filter by vendor (fuzzy match for speech slips)
    const vQ = String(vendor || '').toLowerCase().trim();
    if (vQ) {
      results = results.filter(tx => {
        const v = String(tx.vendor || '').toLowerCase();
        return v.includes(vQ) || stringSimilarity(vQ, v) >= 0.45;
      });
    }

    // Filter by search text
    const tQ = String(text || '').toLowerCase().trim();
    if (tQ) {
      const searchWords = tQ.split(/\s+/).filter(w => w.length > 2);
      results = results.filter(tx => {
        const target = `${tx.vendor} ${tx.description} ${tx.phase} ${JSON.stringify(tx.lineItems || [])}`.toLowerCase();
        return searchWords.some(w => target.includes(w));
      });
    }

    // Filter by date
    if (from) {
      results = results.filter(tx => tx.date >= from);
    }
    if (to) {
      results = results.filter(tx => tx.date <= to);
    }

    // Filter by amount
    if (typeof minAmount === 'number' && !isNaN(minAmount)) {
      results = results.filter(tx => tx.amount >= minAmount);
    }
    if (typeof maxAmount === 'number' && !isNaN(maxAmount)) {
      results = results.filter(tx => tx.amount <= maxAmount);
    }

    // Sort descending by date
    results.sort((a, b) => String(b.date).localeCompare(String(a.date)));

    return results.slice(0, 25);
  }
}
