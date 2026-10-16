import {
  ensureAppSubfolder,
  getDriveFileInfo,
  INVOICE_UPLOADS_FOLDER_NAME,
  moveFileInDrive,
  replaceDriveFile,
  trashDriveFile,
  uploadFileToDrive
} from './googleDrive.js';
import { getDraftUploads } from './invoiceSyncState.js';
import { dataUrlToBlob, downloadBlob } from './imageFiles.js';

export function buildInvoiceFileName(metadata) {
  const lot = (metadata.lotNumber || 'No_Lot').trim();
  const desc = (metadata.description || 'Expense').trim().substring(0, 30).trim();
  const category = (metadata.costCategory || 'material').trim().toLowerCase();
  const rawName = `${lot} - ${desc} - ${category}.pdf`;
  return rawName.replace(/[/\\:*?"<>|]/g, '_');
}

/** The Receipt ID written to the Sheet: the draft's id, plus the split number for a split receipt. */
export function buildReceiptId(draftId, splitIndex = null) {
  const base = String(draftId || '').trim();
  if (!base) return '';
  return splitIndex === null || splitIndex === undefined ? base : `${base}_split_${splitIndex}`;
}

/** The receipt details for one split, as it is saved (its own amount, phase, lot and items). */
export function buildSplitMetadata(metadata, split, draftId, splitIndex) {
  return {
    ...metadata,
    ...(draftId ? { receiptId: buildReceiptId(draftId, splitIndex) } : {}),
    amount: parseFloat(split.amount) || 0,
    description: split.description || metadata.description,
    lotNumber: split.lotNumber || metadata.lotNumber,
    tradeCategory: split.tradeCategory || metadata.tradeCategory,
    tradePhase: split.tradePhase || metadata.tradePhase,
    costCategory: split.costCategory || metadata.costCategory,
    lineItems: Array.isArray(split.items) ? split.items : [],
    splits: null
  };
}

/**
 * History entries for a synced receipt (one per split). With a draftId, each entry also carries the
 * Receipt ID of its Transactions row and when it was synced, so the app can check the row really landed.
 * With uploads (see syncInvoiceDocument), each split gets its own PDF link and project folder.
 */
export function buildHistoryLogs(metadata, { idPrefix, link, draftId = null, syncedAt = null, uploads = null }) {
  const dateLogged = new Date().toLocaleDateString();
  const checkFields = (splitIndex) => (draftId ? {
    draftId,
    receiptId: buildReceiptId(draftId, splitIndex),
    syncedAt: syncedAt || new Date().toISOString()
  } : {});
  const fileFields = (key) => {
    const upload = uploads?.[key];
    return upload?.fileId
      ? { fileId: upload.fileId, link: upload.link || null, ...(upload.folderId ? { folderId: upload.folderId } : {}) }
      : { fileId: idPrefix, link };
  };

  if (metadata.splits && metadata.splits.length > 0) {
    // A $0 split is not uploaded (see the sync loop), so it gets no History entry either
    return metadata.splits.map((split, index) => {
      const { fileId, ...file } = fileFields(String(index));
      return {
        id: `${fileId}_split_${index}`,
        dateLogged,
        dateTransaction: metadata.date,
        description: `[${split.lotNumber || metadata.lotNumber || 'N/A'}] ${split.description || metadata.description || ''}`,
        vendor: metadata.vendor,
        costCategory: split.costCategory || metadata.costCategory || 'material',
        amount: split.amount,
        ...file,
        tradeCategory: split.tradeCategory || metadata.tradeCategory,
        tradePhase: split.tradePhase || metadata.tradePhase,
        ...(draftId ? { lotName: split.lotNumber || metadata.lotNumber || '' } : {}),
        ...checkFields(index)
      };
    }).filter((_, index) => (parseFloat(metadata.splits[index].amount) || 0) > 0);
  }

  const { fileId, ...file } = fileFields('main');
  return [{
    id: fileId,
    dateLogged,
    dateTransaction: metadata.date,
    description: `[${metadata.lotNumber || 'N/A'}] ${metadata.description || ''}`,
    vendor: metadata.vendor,
    costCategory: metadata.costCategory,
    amount: metadata.amount,
    ...file,
    tradeCategory: metadata.tradeCategory,
    tradePhase: metadata.tradePhase,
    ...(draftId ? { lotName: metadata.lotNumber || '' } : {}),
    ...checkFields(null)
  }];
}

async function buildPdfBlob(item, generateDocumentPDF) {
  const { metadata, mainImageBase64, secondaryImageBase64 } = item;
  const images = [];
  if (mainImageBase64) images.push(mainImageBase64);
  if (secondaryImageBase64) images.push(secondaryImageBase64);

  if (mainImageBase64 && mainImageBase64.startsWith('data:application/pdf')) {
    return { pdfBlob: dataUrlToBlob(mainImageBase64, 'application/pdf'), images };
  }

  return {
    pdfBlob: await generateDocumentPDF(metadata, images),
    images
  };
}

export function toCanonicalLotId(rawLot) {
  if (!rawLot || typeof rawLot !== 'string') return null;
  const trimmed = rawLot.trim().toLowerCase();

  // Matches "Lot 3", "L. 3", "L.3", "L-3", "lot3", "Lot 3A"
  // STRICT BOUNDARY: Never matches "Lot 30" or "Lot 33"
  const match = trimmed.match(/^(?:lot|l\.?|l\b)[\s_-]*([0-9]+[a-z]?)$/i);
  if (match) {
    return `lot_${match[1].toLowerCase()}`;
  }

  return null;
}

export function resolveSplitProjectFolder(projects = [], selectedFolder = null, split = {}) {
  const rawLot = String(split?.lotNumber || '').trim();
  if (!rawLot) {
    return {
      folderId: null,
      lotName: null,
      unresolved: true,
      error: 'Missing lot number for split allocation.'
    };
  }

  const projectList = Array.isArray(projects) ? projects : [];

  // 1. Exact match (case-insensitive)
  const exactMatch = projectList.find(p => (p.name || '').trim().toLowerCase() === rawLot.toLowerCase());
  if (exactMatch) {
    return {
      folderId: exactMatch.folderId,
      lotName: exactMatch.name,
      unresolved: false
    };
  }

  // 2. Canonical lot matching (e.g. "Lot 3", "L. 3", "L.3", "L-3", "lot3")
  const targetCanonical = toCanonicalLotId(rawLot);
  if (targetCanonical) {
    const canonicalMatches = projectList.filter(p => toCanonicalLotId(p.name) === targetCanonical);
    if (canonicalMatches.length === 1) {
      return {
        folderId: canonicalMatches[0].folderId,
        lotName: canonicalMatches[0].name,
        unresolved: false
      };
    }
    if (canonicalMatches.length > 1) {
      return {
        folderId: null,
        lotName: rawLot,
        unresolved: true,
        error: `Ambiguous project resolution: multiple projects match "${rawLot}".`
      };
    }
  }

  // 3. Unresolved: DO NOT silently fall back to selectedFolder.id!
  return {
    folderId: null,
    lotName: rawLot,
    unresolved: true,
    error: `Could not resolve project lot "${rawLot}". Manual project selection required.`
  };
}

// Short fingerprint of what a receipt PDF was made from, so a retry only re-uploads after an edit
function contentSignature(description, images) {
  const text = `${description}|${images.map(image => String(image).length).join(',')}`;
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

/**
 * The files one receipt becomes in Drive: one per split with an amount (each in its own lot's folder),
 * or one for the whole receipt. Every split's lot is checked before anything is uploaded.
 */
function buildUploadUnits(item, selectedFolder, projects) {
  const { metadata } = item;
  if (metadata.splits && metadata.splits.length > 0) {
    const units = [];
    for (const [splitIndex, split] of metadata.splits.entries()) {
      if ((parseFloat(split.amount) || 0) <= 0) continue;
      const projectFolder = resolveSplitProjectFolder(projects, selectedFolder, split);
      if (projectFolder.unresolved || !projectFolder.folderId) {
        throw new Error(projectFolder.error || `Could not resolve lot "${split.lotNumber}".`);
      }
      const splitMetadata = buildSplitMetadata(metadata, split, item.id, splitIndex);
      units.push({
        key: String(splitIndex),
        metadata: splitMetadata,
        folderId: projectFolder.folderId,
        fileName: buildInvoiceFileName({ ...splitMetadata, lotNumber: projectFolder.lotName })
      });
    }
    if (units.length === 0) {
      throw new Error('No invoice splits had a valid amount to upload.');
    }
    return units;
  }

  return [{
    key: 'main',
    metadata: item.id ? { ...metadata, receiptId: buildReceiptId(item.id) } : metadata,
    folderId: selectedFolder.id,
    fileName: buildInvoiceFileName(metadata),
    isWholeReceipt: true
  }];
}

/**
 * Puts one receipt file in its lot's Invoice Uploads folder. A file from an earlier try is reused:
 * left alone once its Sheet row is written, otherwise refreshed in place when the draft was edited
 * (or moved when its lot changed). Only a missing file is uploaded again, so a retry never duplicates.
 */
async function putReceiptFile(googleToken, unit, previous, signature, makePdf) {
  const uploadsFolder = await ensureAppSubfolder(googleToken, unit.folderId, INVOICE_UPLOADS_FOLDER_NAME);
  const description = JSON.stringify(unit.metadata);

  if (previous?.fileId) {
    const info = await getDriveFileInfo(googleToken, previous.fileId);
    if (info && !info.trashed) {
      const kept = {
        fileId: previous.fileId,
        link: previous.link || `https://drive.google.com/file/d/${previous.fileId}/view?usp=drivesdk`,
        folderId: unit.folderId,
        signature
      };
      // Already in the Sheet: never touched again (the check after sync flags a later edit).
      // It stays with the lot it was written to, even if the split's lot was changed since.
      if (info.appProperties?.sheetRowWritten === 'true') {
        return { ...kept, folderId: previous.folderId || unit.folderId, signature: previous.signature || signature };
      }
      const parents = info.parents || [];
      const inPlace = parents.includes(uploadsFolder);
      if (inPlace && previous.signature === signature) return kept;
      if (!inPlace) {
        await moveFileInDrive(googleToken, previous.fileId, parents.join(','), uploadsFolder);
      }
      await replaceDriveFile(googleToken, previous.fileId, {
        fileName: unit.fileName,
        mimeType: 'application/pdf',
        fileBlob: await makePdf(),
        description
      });
      return kept;
    }
  }

  const result = await uploadFileToDrive(googleToken, uploadsFolder, unit.fileName, 'application/pdf', await makePdf(), description);
  return { fileId: result.id, link: result.webViewLink, folderId: unit.folderId, signature };
}

/** Removes a file left from a split that no longer exists (only while its Sheet row is not written). */
async function discardReceiptFile(googleToken, upload) {
  try {
    const info = await getDriveFileInfo(googleToken, upload.fileId);
    if (info && !info.trashed && info.appProperties?.sheetRowWritten !== 'true') {
      await trashDriveFile(googleToken, upload.fileId);
    }
  } catch (err) {
    console.warn('[invoiceUpload] Could not remove a file from a removed split:', err?.message || err);
  }
}

/**
 * A deleted draft's PDFs still waiting in Invoice Uploads would be added to the Sheet by the
 * next sync: remove them (files whose Sheet row is already written are kept).
 */
export async function discardDraftFiles(googleToken, draft) {
  for (const upload of Object.values(getDraftUploads(draft))) {
    if (upload?.fileId) await discardReceiptFile(googleToken, upload);
  }
}

/**
 * Uploads a draft's receipt PDFs to Drive (one per split). onUploaded(uploads) runs after every file,
 * so the draft keeps what already made it to Drive even when a later split fails.
 */
export async function syncInvoiceDocument({
  item,
  googleToken,
  selectedFolder,
  projects,
  onUploaded = null
}) {
  const { generateDocumentPDF } = await import('./pdfGenerator.js');
  const { metadata } = item;

  const isOfflineMode = !googleToken || !selectedFolder;
  if (isOfflineMode) {
    const { pdfBlob } = await buildPdfBlob(item, generateDocumentPDF);
    downloadBlob(pdfBlob, buildInvoiceFileName(metadata));
    return {
      logs: buildHistoryLogs(metadata, { idPrefix: Date.now().toString(), link: null }),
      hasDriveUpload: false,
      successMessage: 'Document PDF generated and downloaded to device!'
    };
  }

  const images = [item.mainImageBase64, item.secondaryImageBase64].filter(Boolean);
  const units = buildUploadUnits(item, selectedFolder, projects);
  const previous = getDraftUploads(item);
  const uploads = { ...previous };

  for (const unit of units) {
    const makePdf = unit.isWholeReceipt
      ? async () => (await buildPdfBlob(item, generateDocumentPDF)).pdfBlob
      : () => generateDocumentPDF(unit.metadata, images);
    const signature = contentSignature(JSON.stringify(unit.metadata), images);
    uploads[unit.key] = await putReceiptFile(googleToken, unit, previous[unit.key], signature, makePdf);
    onUploaded?.({ ...uploads });
  }

  const unitKeys = new Set(units.map(unit => unit.key));
  const removedKeys = Object.keys(uploads).filter(key => !unitKeys.has(key));
  for (const key of removedKeys) {
    if (uploads[key]?.fileId) await discardReceiptFile(googleToken, uploads[key]);
    delete uploads[key];
  }
  if (removedKeys.length > 0) onUploaded?.({ ...uploads });

  const first = uploads[units[0].key];
  return {
    logs: buildHistoryLogs(metadata, { draftId: item.id || null, uploads }),
    hasDriveUpload: true,
    successMessage: 'Document report PDF synced successfully!',
    uploads,
    driveFileId: first.fileId,
    webViewLink: first.link
  };
}
