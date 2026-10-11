/**
 * Service to audit Google Spreadsheet structural integrity and column header health.
 */

export function auditSpreadsheetHealth(parsedData) {
  const warnings = [];

  if (!parsedData) {
    return { isHealthy: true, warnings: [] };
  }

  const { projectInfo, categories, subcontractors } = parsedData;

  // Check 1: Verify categories were parsed
  if (!categories || !Array.isArray(categories) || categories.length === 0) {
    warnings.push('No trade categories found in your Google Sheet.');
  }

  // Check 2: Verify subcontractors / phases were parsed
  if (!subcontractors || !Array.isArray(subcontractors) || subcontractors.length === 0) {
    warnings.push('No trade phases found in your Google Sheet.');
  } else {
    // Check if any subcontractors are missing key fields
    const missingPhaseCount = subcontractors.filter(s => !s.phase || String(s.phase).trim() === '').length;
    if (missingPhaseCount > 0) {
      warnings.push(`${missingPhaseCount} phase row(s) in your Google Sheet have blank or missing Phase descriptions.`);
    }
  }

  // Check 3: Verify the budget numbers
  if (projectInfo) {
    const grossBudget = parseFloat(String(projectInfo.budgetGross || 0).replace(/[^0-9.-]/g, '')) || 0;
    if (grossBudget === 0) {
      warnings.push("Budget for Build and Lot Cost are blank in the Sheet's Project Info tab. Fill them in (or edit the project in Settings) to see budget numbers.");
    }
  }

  return {
    isHealthy: warnings.length === 0,
    warnings
  };
}
