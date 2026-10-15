import {
  ensureAppSubfolder,
  INVOICE_UPLOADS_FOLDER_NAME,
  ensureUnknownVendorsFolder,
  ensureVendorFolder,
  findSpreadsheetInFolder,
  isConfidentVendor,
  listFilesWithDescriptionInFolder,
  moveFileInDrive,
  tagDriveFileAppProperties
} from './googleDrive.js';
import { OLD_LAYOUT_MESSAGE } from './sheetsDataService.js';
import {
  SHEET_LAYOUT_V2,
  appendTransactionRows,
  buildTransactionRow,
  detectSheetLayout,
  fetchExistingReceiptIds,
  getReceiptId
} from './sheetV2.js';
import { growPhaseSections } from './phaseGrowth.js';

const GOOGLE_SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

async function handleFatalGoogleError(resOrErr) {
  if (!resOrErr) return;
  if (resOrErr.ok) return;

  const status = Number(resOrErr.status || resOrErr.code);
  let bodyText = '';

  if (typeof resOrErr.text === 'function') {
    bodyText = await resOrErr.text().catch(() => '');
  } else if (resOrErr.message) {
    bodyText = String(resOrErr.message);
  }

  const lower = bodyText.toLowerCase();

  if (status === 401 || lower.includes('unauthenticated') || lower.includes('invalid credentials') || lower.includes('session expired')) {
    const err = new Error('Google Drive session expired. Please sign in again.');
    err.status = 401;
    err.isFatalGoogleError = true;
    throw err;
  }

  if (status === 403) {
    const isScopeError = lower.includes('insufficientpermissions') ||
                         lower.includes('access_token_scope_insufficient') ||
                         lower.includes('insufficient scope') ||
                         lower.includes('invalid_grant');

    if (isScopeError) {
      const err = new Error('Google permissions required. Please sign in again.');
      err.status = 403;
      err.message = 'insufficientPermissions: Please sign in again.';
      err.isFatalGoogleError = true;
      throw err;
    }

    if (lower.includes('ratelimit') || lower.includes('userratelimitexceeded')) {
      const err = new Error('Google is busy, please try again in a minute.');
      err.status = 429;
      err.isFatalGoogleError = true;
      throw err;
    }

    const err = new Error(`Google Sheets access denied: ${bodyText || 'Spreadsheet not shared or permission denied'}`);
    err.status = 403;
    err.isFatalGoogleError = true;
    throw err;
  }

  if (status === 429 || lower.includes('ratelimit') || lower.includes('userratelimitexceeded')) {
    const err = new Error('Google is busy, please try again in a minute.');
    err.status = 429;
    err.isFatalGoogleError = true;
    throw err;
  }

  if (status >= 500) {
    const err = new Error(`Google service temporarily unavailable (${status}). Please try again in a moment.`);
    err.status = status;
    err.isFatalGoogleError = true;
    throw err;
  }
}

/**
 * Synchronizes uploaded invoice PDFs directly to the Google Spreadsheet using the active Google access token.
 */
export async function syncUploadedInvoicesDirectly(accessToken, projectFolderId, linkedSpreadsheetId = null) {
  if (!accessToken) {
    throw new Error('Google authentication token is required for direct spreadsheet sync.');
  }
  if (!projectFolderId) {
    throw new Error('No project folder selected.');
  }

  // 1. Resolve the Uploads folder inside canonical 'App Folders' container
  // (synced files move to Vendors / Stores / [Vendor Name], see step 2 below)
  const uploadsFolderId = await ensureAppSubfolder(accessToken, projectFolderId, INVOICE_UPLOADS_FOLDER_NAME);

  // 2. Resolve Google Spreadsheet in the project folder
  // Use the project's linked Sheet; search the folder only when none is linked yet
  const spreadsheet = linkedSpreadsheetId
    ? { id: linkedSpreadsheetId }
    : await findSpreadsheetInFolder(accessToken, projectFolderId);
  if (!spreadsheet) {
    throw new Error('Could not find Google Spreadsheet in the selected project folder.');
  }
  const spreadsheetId = spreadsheet.id;

  // 3. List all files inside "Invoice Uploads"
  const pendingFiles = await listFilesWithDescriptionInFolder(accessToken, uploadsFolderId);
  const processableFiles = pendingFiles.filter((f) => {
    const mime = f.mimeType || '';
    return (mime === 'application/pdf' || mime.startsWith('image/')) && !mime.includes('spreadsheet');
  });

  if (processableFiles.length === 0) {
    return { ok: true, processedCount: 0, spreadsheetId, message: 'No new uploaded files found to sync.' };
  }

  // 4. Fetch full spreadsheet metadata to inspect sheet tab names
  const metaUrl = `${GOOGLE_SHEETS_API_BASE}/${spreadsheetId}?fields=sheets(properties(sheetId,title))`;
  const metaRes = await fetch(metaUrl, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!metaRes.ok) {
    await handleFatalGoogleError(metaRes);
    throw new Error(`Failed to fetch spreadsheet metadata: ${await metaRes.text().catch(() => '')}`);
  }
  const metaData = await metaRes.json();
  const sheetsList = metaData.sheets || [];
  // Only template Sheets are supported: stop before any file is touched, so receipts stay in Invoice Uploads
  if (detectSheetLayout(sheetsList.map(s => s.properties?.title)) !== SHEET_LAYOUT_V2) {
    throw new Error(OLD_LAYOUT_MESSAGE);
  }
  let existingReceiptIds;
  try {
    existingReceiptIds = await fetchExistingReceiptIds(accessToken, spreadsheetId);
  } catch (idsErr) {
    await handleFatalGoogleError(idsErr);
    throw idsErr;
  }

  let processedCount = 0;
  const failed = [];
  // Category tabs that got new Transactions rows (their phase sections may need more room)
  const categoriesWithNewRows = new Set();

  for (const file of processableFiles) {
    try {
      // Check tagging status: the sheetRowWritten tag protects the Sheet from duplicate rows
      const alreadyWritten = file.appProperties?.sheetRowWritten === 'true';

      let metadata = null;
      if (file.description && file.description.trim().startsWith('{')) {
        try {
          metadata = JSON.parse(file.description);
        } catch (err) {
          console.warn('Failed to parse JSON description for file:', file.name, err);
        }
      }

      if (!metadata) {
        failed.push({
          fileId: file.id,
          fileName: file.name,
          reason: 'File metadata is missing or corrupted.'
        });
        continue;
      }

      const vendor = metadata.vendor || metadata.contractorVendor || metadata.payee || metadata.contractor || '';
      const fileUrl = file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;

      // STEP 1: Add the Transactions row if not already written
      if (!alreadyWritten) {
        const tradeCat = metadata.tradeCategory || '';
        const tradePh = metadata.tradePhase || '';

        if (!tradeCat || !tradePh) {
          failed.push({
            fileId: file.id,
            fileName: file.name,
            reason: 'Invoice is missing trade category or phase.'
          });
          continue;
        }

        // Receipt ID makes the write safe to repeat: a receipt already in Transactions is never added twice
        const receiptId = getReceiptId(file, metadata);
        if (!existingReceiptIds.has(receiptId)) {
          const transactionRow = buildTransactionRow(metadata, { receiptId, fileUrl });
          const appendRes = await appendTransactionRows(accessToken, spreadsheetId, [transactionRow]);
          if (!appendRes.ok) {
            await handleFatalGoogleError(appendRes);
            const errText = await appendRes.text().catch(() => '');
            failed.push({
              fileId: file.id,
              fileName: file.name,
              reason: `Failed to add invoice row to Transactions: ${errText || appendRes.statusText}`
            });
            continue;
          }
          existingReceiptIds.add(receiptId);
          categoriesWithNewRows.add(transactionRow[3]);
        }

        // Tag file immediately after the row write succeeds to prevent duplicate rows
        try {
          const tagged = await tagDriveFileAppProperties(accessToken, file.id, {
            sheetRowWritten: 'true'
          });
          if (!tagged) {
            failed.push({
              fileId: file.id,
              fileName: file.name,
              reason: 'Invoice written to the Sheet, but file could not be tagged in Drive. Please move it manually to avoid duplicate entries.'
            });
            continue;
          }
        } catch (tagErr) {
          await handleFatalGoogleError(tagErr);
          failed.push({
            fileId: file.id,
            fileName: file.name,
            reason: `Invoice written to the Sheet, but tagging in Drive failed: ${tagErr.message}`
          });
          continue;
        }
      }

      // STEP 2: Move file to Vendors / Stores / [Vendor Name]
      let destinationFolderId = null;
      if (isConfidentVendor(vendor)) {
        try {
          destinationFolderId = await ensureVendorFolder(accessToken, projectFolderId, vendor.trim());
        } catch (vErr) {
          await handleFatalGoogleError(vErr);
          console.warn(`Failed to resolve vendor folder for "${vendor}", falling back to Unknown Vendors:`, vErr);
        }
      }

      if (!destinationFolderId) {
        try {
          destinationFolderId = await ensureUnknownVendorsFolder(accessToken, projectFolderId);
        } catch (uErr) {
          await handleFatalGoogleError(uErr);
        }
      }

      try {
        await moveFileInDrive(accessToken, file.id, uploadsFolderId, destinationFolderId);
        processedCount++;
      } catch (moveErr) {
        await handleFatalGoogleError(moveErr);
        failed.push({
          fileId: file.id,
          fileName: file.name,
          reason: `Invoice recorded in spreadsheet, but moving file to vendor folder failed: ${moveErr.message}`
        });
      }
    } catch (fileErr) {
      if (fileErr.isFatalGoogleError) {
        throw fileErr;
      }
      failed.push({
        fileId: file.id,
        fileName: file.name,
        reason: fileErr.message || 'Unexpected sync error'
      });
    }
  }

  // Give phase sections on the category tabs room for their receipts (never fails the sync)
  let phaseGrowth = null;
  let growthNote = null;
  if (categoriesWithNewRows.size > 0) {
    phaseGrowth = await growPhaseSections(accessToken, spreadsheetId, {
      tabs: sheetsList.map(s => s.properties || {}),
      categoryNames: [...categoriesWithNewRows]
    });
    if (phaseGrowth.errors.length > 0) {
      console.warn('[directSync] Phase sections could not grow:', phaseGrowth.errors);
      growthNote = 'Some phase sections in the Sheet could not add rows. If a phase shows a ⚠ warning, insert rows above its QUOTES row.';
    }
  }

  return { ok: true, processedCount, failed, phaseGrowth, growthNote, spreadsheetId };
}
