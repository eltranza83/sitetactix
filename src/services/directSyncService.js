import {
  ensureAppSubfolder,
  ensureUnknownVendorsFolder,
  ensureVendorFolder,
  findSpreadsheetInFolder,
  isConfidentVendor,
  listFilesWithDescriptionInFolder,
  moveFileInDrive,
  tagDriveFileAppProperties
} from './googleDrive.js';
import { normalizeKey } from './sheetsDataService.js';

const GOOGLE_SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

async function handleFatalGoogleError(response) {
  if (!response || response.ok) return;
  const status = Number(response.status);

  if (status === 401) {
    const err = new Error('Google Drive session expired. Please sign in again.');
    err.status = 401;
    err.isFatalGoogleError = true;
    throw err;
  }

  if (status === 403) {
    const bodyText = await response.text().catch(() => '');
    const lower = bodyText.toLowerCase();
    const isScopeError = lower.includes('insufficientpermissions') ||
                         lower.includes('access_token_scope_insufficient') ||
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

  if (status === 429) {
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

function getPhaseAliases(value) {
  const normalized = normalizeKey(value);
  const aliases = [normalized];
  if (normalized === 'framinglumber') aliases.push('framinglumbertruss');
  if (normalized === 'framinglumbertruss') aliases.push('framinglumber');
  if (normalized === 'tile') aliases.push('tileflooring');
  if (normalized === 'tileflooring') aliases.push('tile');
  if (normalized === 'paint') aliases.push('paintfinishes');
  if (normalized === 'paintfinishes') aliases.push('paint');
  return aliases;
}

function isPhaseHeaderLabel(value) {
  const label = String(value || '').trim();
  return label.startsWith('→') || label.startsWith('—') || label.startsWith('-') || label.startsWith('â');
}

/**
 * Locates the exact row number (1-indexed) where a transaction for tradePhase should be written.
 * Guarantees that:
 * 1. The transaction stays strictly within the tradePhase block.
 * 2. It never writes over a subsequent phase header.
 * 3. It returns whether a row insertion (insertDimension) is required to avoid overflowing into the next phase.
 *
 * @param {Array<Array<string>>} rows - 2D array of sheet values (0-indexed).
 * @param {string} tradePhase - Target trade phase name (e.g. "Landscaping & Irrigation").
 * @returns {{ targetRowNumber: number, needsRowInsertion: boolean, insertAtIndex: number|null } | null}
 */
export function findTargetPhaseRow(rows, tradePhase) {
  if (!Array.isArray(rows) || !tradePhase) return null;

  // 1. Locate phase header row index
  let phaseHeaderRowIdx = -1;
  const targetPhaseAliases = getPhaseAliases(tradePhase);

  for (let r = 0; r < rows.length; r++) {
    const cellVal = rows[r]?.[0] || '';
    if (cellVal && isPhaseHeaderLabel(cellVal)) {
      const rowPhaseNorm = normalizeKey(cellVal);
      if (targetPhaseAliases.includes(rowPhaseNorm)) {
        phaseHeaderRowIdx = r;
        break;
      }
    }
  }

  if (phaseHeaderRowIdx === -1) {
    return null;
  }

  // 2. Locate the boundary where the next phase block starts (if any)
  let nextBlockHeaderRowIdx = null;
  for (let r = phaseHeaderRowIdx + 1; r < rows.length; r++) {
    const cellVal = rows[r]?.[0] || '';
    if (cellVal && isPhaseHeaderLabel(cellVal)) {
      nextBlockHeaderRowIdx = r;
      break;
    }
  }

  // 3. Scan inside this block for the first unoccupied row
  // A row is occupied if any transaction column (A..F) has non-empty text
  const scanLimit = nextBlockHeaderRowIdx !== null ? nextBlockHeaderRowIdx : rows.length;
  let emptySlotRowIdx = -1;
  let lastOccupiedRowIdx = phaseHeaderRowIdx;

  for (let r = phaseHeaderRowIdx + 1; r < scanLimit; r++) {
    const row = rows[r] || [];
    const hasData = Boolean(
      (row[0] || '').trim() || (row[1] || '').trim() || (row[2] || '').trim() ||
      (row[3] || '').trim() || (row[4] || '').trim() || (row[5] || '').trim()
    );
    if (hasData) {
      lastOccupiedRowIdx = r;
    } else if (emptySlotRowIdx === -1) {
      emptySlotRowIdx = r;
    }
  }

  // Case 1: An empty pre-allocated slot exists inside this block before the next phase
  if (emptySlotRowIdx !== -1) {
    return {
      targetRowNumber: emptySlotRowIdx + 1, // 1-indexed row for PUT range
      needsRowInsertion: false,
      insertAtIndex: null
    };
  }

  // Case 2: All existing slots inside this bounded block are occupied
  if (nextBlockHeaderRowIdx !== null) {
    // Next phase header exists immediately below!
    // Insert a new row before nextBlockHeaderRowIdx to expand the block safely
    return {
      targetRowNumber: nextBlockHeaderRowIdx + 1, // 1-indexed row after insertion
      needsRowInsertion: true,
      insertAtIndex: nextBlockHeaderRowIdx // 0-indexed row for insertDimension
    };
  }

  // Case 3: Last phase on the tab (no subsequent phase header)
  // Safely target the very next row after the last occupied row
  return {
    targetRowNumber: lastOccupiedRowIdx + 2, // 1-indexed
    needsRowInsertion: false,
    insertAtIndex: null
  };
}

/**
 * Synchronizes uploaded invoice PDFs directly to the Google Spreadsheet using the active Google access token.
 */
export async function syncUploadedInvoicesDirectly(accessToken, projectFolderId) {
  if (!accessToken) {
    throw new Error('Google authentication token is required for direct spreadsheet sync.');
  }
  if (!projectFolderId) {
    throw new Error('No project folder selected.');
  }

  // 1. Resolve Uploads and Archive folders inside canonical 'App Folders' container
  const uploadsFolderId = await ensureAppSubfolder(accessToken, projectFolderId, 'Invoice Uploads');
  await ensureAppSubfolder(accessToken, projectFolderId, 'Processed Invoices');

  // 2. Resolve Google Spreadsheet in the project folder
  const spreadsheet = await findSpreadsheetInFolder(accessToken, projectFolderId);
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
    return { ok: true, processedCount: 0, message: 'No new uploaded files found to sync.' };
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

  let processedCount = 0;
  const failed = [];

  for (const file of processableFiles) {
    try {
      // Check if file was already written to sheet in a previous run
      const alreadyWrittenToSheet = file.appProperties?.sheetRowWritten === 'true';

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

      if (!alreadyWrittenToSheet) {
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

        // Resolve matching sheet tab
        const cleanTargetCat = normalizeKey(tradeCat);
        let matchedSheetProp = null;

        for (const sheetObj of sheetsList) {
          const title = sheetObj.properties?.title || '';
          if (normalizeKey(title) === cleanTargetCat) {
            matchedSheetProp = sheetObj.properties;
            break;
          }
        }

        if (!matchedSheetProp) {
          failed.push({
            fileId: file.id,
            fileName: file.name,
            reason: `Sheet tab for category "${tradeCat}" was not found in spreadsheet.`
          });
          continue;
        }

        const sheetTitle = matchedSheetProp.title;

        // Check for master log tab ("New_Invoices")
        let newInvoicesSheetTitle = null;
        for (const sheetObj of sheetsList) {
          const title = sheetObj.properties?.title || '';
          const cleanTitle = normalizeKey(title);
          if (cleanTitle === 'newinvoices' || cleanTitle === 'masterlog' || cleanTitle === 'invoicelog') {
            newInvoicesSheetTitle = title;
            break;
          }
        }

        const fileUrl = file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;
        const costCat = String(metadata.costCategory || 'material').toLowerCase();
        const rawCost = typeof metadata.amount === 'number' 
          ? metadata.amount 
          : (typeof metadata.totalCost === 'number' 
            ? metadata.totalCost 
            : parseFloat(metadata.amount || metadata.totalCost || metadata.cost || metadata.price || metadata.total) || 0);

        const paymentDate = metadata.date || metadata.paymentDate || metadata.transactionDate || '';
        const checkNumber = metadata.checkNumber || metadata.checkNo || metadata.checkOrTrans || metadata.check || '';
        const taskDesc = metadata.description || metadata.desc || metadata.item || 'Scanned Invoice';

        if (newInvoicesSheetTitle) {
          try {
            const isLabor = costCat.includes('labor');
            const displayVal = rawCost > 0 ? rawCost : `"PDF"`;
            const masterMatVal = !isLabor ? `=HYPERLINK("${fileUrl}", ${displayVal})` : '';
            const masterLabVal = isLabor ? `=HYPERLINK("${fileUrl}", ${displayVal})` : '';

            const masterRow = [
              taskDesc,
              vendor,
              masterMatVal,
              masterLabVal,
              paymentDate,
              checkNumber
            ];
            const masterAppendUrl = `${GOOGLE_SHEETS_API_BASE}/${spreadsheetId}/values/'${encodeURIComponent(newInvoicesSheetTitle)}'!A1:F100:append?valueInputOption=USER_ENTERED`;
            await fetch(masterAppendUrl, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ values: [masterRow] })
            });
          } catch (err) {
            console.warn('Failed to append to New_Invoices tab:', err);
          }
        }

        // Fetch tab values to find target phase row
        const rangeUrl = `${GOOGLE_SHEETS_API_BASE}/${spreadsheetId}/values/'${encodeURIComponent(sheetTitle)}'!A1:Z100`;
        const rangeRes = await fetch(rangeUrl, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (!rangeRes.ok) {
          await handleFatalGoogleError(rangeRes);
          const errText = await rangeRes.text().catch(() => '');
          failed.push({
            fileId: file.id,
            fileName: file.name,
            reason: `Failed to read sheet tab "${sheetTitle}": ${errText || rangeRes.statusText}`
          });
          continue;
        }

        const rangeData = await rangeRes.json();
        const rows = rangeData.values || [];

        const isLabor = costCat.includes('labor');
        const displayVal = rawCost > 0 ? rawCost : `"PDF"`;
        const materialValue = !isLabor ? `=HYPERLINK("${fileUrl}", ${displayVal})` : '';
        const laborValue = isLabor ? `=HYPERLINK("${fileUrl}", ${displayVal})` : '';

        const rowValues = [
          taskDesc,
          vendor,
          materialValue,
          laborValue,
          paymentDate,
          checkNumber
        ];

        const phaseTarget = findTargetPhaseRow(rows, tradePh);
        if (!phaseTarget) {
          failed.push({
            fileId: file.id,
            fileName: file.name,
            reason: `Phase header "${tradePh}" not found in sheet "${sheetTitle}".`
          });
          continue;
        }

        // If bounded phase block was full, insert a new row to expand the block safely
        if (phaseTarget.needsRowInsertion && phaseTarget.insertAtIndex !== null) {
          const batchUrl = `${GOOGLE_SHEETS_API_BASE}/${spreadsheetId}:batchUpdate`;
          const insertRes = await fetch(batchUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              requests: [{
                insertDimension: {
                  range: {
                    sheetId: matchedSheetProp.sheetId,
                    dimension: 'ROWS',
                    startIndex: phaseTarget.insertAtIndex,
                    endIndex: phaseTarget.insertAtIndex + 1
                  },
                  inheritFromBefore: true
                }
              }]
            })
          });

          if (!insertRes.ok) {
            await handleFatalGoogleError(insertRes);
            const errText = await insertRes.text().catch(() => '');
            failed.push({
              fileId: file.id,
              fileName: file.name,
              reason: `Failed to insert row in sheet "${sheetTitle}": ${errText || insertRes.statusText}`
            });
            continue;
          }
        }

        // Always write via explicit PUT to A{row}:F{row} (Zero generic :append)
        const updateUrl = `${GOOGLE_SHEETS_API_BASE}/${spreadsheetId}/values/'${encodeURIComponent(sheetTitle)}'!A${phaseTarget.targetRowNumber}:F${phaseTarget.targetRowNumber}?valueInputOption=USER_ENTERED`;
        const updateRes = await fetch(updateUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ values: [rowValues] })
        });

        if (!updateRes.ok) {
          await handleFatalGoogleError(updateRes);
          const errText = await updateRes.text().catch(() => '');
          failed.push({
            fileId: file.id,
            fileName: file.name,
            reason: `Failed to write invoice row to "${sheetTitle}": ${errText || updateRes.statusText}`
          });
          continue;
        }

        // Tag file in Drive as written to prevent duplicates on retry
        const tagged = await tagDriveFileAppProperties(accessToken, file.id, { sheetRowWritten: 'true' });
        if (!tagged) {
          failed.push({
            fileId: file.id,
            fileName: file.name,
            reason: 'Invoice written to spreadsheet, but file could not be tagged in Drive. Please move it manually to avoid duplicate entries.'
          });
          continue;
        }
      }

      // Move file to Vendors / Stores / [Vendor Name] if vendor is confidently identified, else Unknown Vendors exception queue
      let destinationFolderId = null;
      if (isConfidentVendor(vendor)) {
        try {
          destinationFolderId = await ensureVendorFolder(accessToken, projectFolderId, vendor.trim());
        } catch (vErr) {
          console.warn(`Failed to resolve vendor folder for "${vendor}", falling back to Unknown Vendors:`, vErr);
        }
      }

      if (!destinationFolderId) {
        destinationFolderId = await ensureUnknownVendorsFolder(accessToken, projectFolderId);
      }

      try {
        await moveFileInDrive(accessToken, file.id, uploadsFolderId, destinationFolderId);
        processedCount++;
      } catch (moveErr) {
        await handleFatalGoogleError(moveErr?.response);
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

  return { ok: true, processedCount, failed };
}
