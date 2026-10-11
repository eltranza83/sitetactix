/**
 * Fetches a project's Google Sheet for the in-app Dashboard.
 * Only the template layout (Project Info / Transactions / Contracts) is supported.
 */

import { SHEET_LAYOUT_V2, fetchSheetLayout, fetchV2DashboardData } from './sheetV2.js';

export const OLD_LAYOUT_MESSAGE = "This project's Google Sheet uses the old layout, which the app no longer reads. Create the project again from Settings > Create New Project so it gets a Sheet from the template.";

/**
 * Main entry point: reads Project Info, Transactions and Contracts and works out the Dashboard.
 */
export async function fetchProjectDashboardData(accessToken, spreadsheetId) {
  const layout = await fetchSheetLayout(accessToken, spreadsheetId);
  if (layout !== SHEET_LAYOUT_V2) {
    throw new Error(OLD_LAYOUT_MESSAGE);
  }
  return await fetchV2DashboardData(accessToken, spreadsheetId);
}
