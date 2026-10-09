import { ensureAppSubfolder, uploadFileToDrive } from './googleDrive.js';

function dataURLtoBlob(dataUrl) {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

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

export function buildHistoryLogs(metadata, { idPrefix, link }) {
  const dateLogged = new Date().toLocaleDateString();

  if (metadata.splits && metadata.splits.length > 0) {
    return metadata.splits.map((split, index) => ({
      id: `${idPrefix}_split_${index}`,
      dateLogged,
      dateTransaction: metadata.date,
      description: `[${split.lotNumber || metadata.lotNumber || 'N/A'}] ${split.description || metadata.description || ''}`,
      vendor: metadata.vendor,
      costCategory: split.costCategory || 'material',
      amount: split.amount,
      link,
      tradeCategory: split.tradeCategory || metadata.tradeCategory,
      tradePhase: split.tradePhase || metadata.tradePhase
    }));
  }

  return [{
    id: idPrefix,
    dateLogged,
    dateTransaction: metadata.date,
    description: `[${metadata.lotNumber || 'N/A'}] ${metadata.description || ''}`,
    vendor: metadata.vendor,
    costCategory: metadata.costCategory,
    amount: metadata.amount,
    link,
    tradeCategory: metadata.tradeCategory,
    tradePhase: metadata.tradePhase
  }];
}

function downloadPdf(pdfBlob, fileName) {
  const url = URL.createObjectURL(pdfBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

async function buildPdfBlob(item, generateDocumentPDF) {
  const { metadata, mainImageBase64, secondaryImageBase64 } = item;
  const images = [];
  if (mainImageBase64) images.push(mainImageBase64);
  if (secondaryImageBase64) images.push(secondaryImageBase64);

  if (mainImageBase64 && mainImageBase64.startsWith('data:application/pdf')) {
    return { pdfBlob: dataURLtoBlob(mainImageBase64), images };
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

export async function syncInvoiceDocument({
  item,
  googleToken,
  selectedFolder,
  projects
}) {
  const { generateDocumentPDF } = await import('./pdfGenerator.js');
  const { metadata } = item;
  const { pdfBlob, images } = await buildPdfBlob(item, generateDocumentPDF);

  const isOfflineMode = !googleToken || !selectedFolder;
  if (isOfflineMode) {
    downloadPdf(pdfBlob, buildInvoiceFileName(metadata));
    return {
      logs: buildHistoryLogs(metadata, { idPrefix: Date.now().toString(), link: null }),
      hasDriveUpload: false,
      successMessage: 'Document PDF generated and downloaded to device!'
    };
  }

  let mainUploadResult = null;

  if (metadata.splits && metadata.splits.length > 0) {
    for (const [splitIndex, split] of metadata.splits.entries()) {
      const splitAmount = parseFloat(split.amount) || 0;
      if (splitAmount <= 0) continue;

      const splitMetadata = {
        ...metadata,
        ...(item.id ? { receiptId: buildReceiptId(item.id, splitIndex) } : {}),
        amount: splitAmount,
        description: split.description || metadata.description,
        lotNumber: split.lotNumber || metadata.lotNumber,
        tradeCategory: split.tradeCategory || metadata.tradeCategory,
        tradePhase: split.tradePhase || metadata.tradePhase,
        costCategory: split.costCategory || metadata.costCategory,
        lineItems: Array.isArray(split.items) ? split.items : [],
        splits: null
      };
      const splitPdfBlob = await generateDocumentPDF(splitMetadata, images);
      const projectFolder = resolveSplitProjectFolder(projects, selectedFolder, split);
      if (projectFolder.unresolved || !projectFolder.folderId) {
        throw new Error(projectFolder.error || `Could not resolve lot "${split.lotNumber}".`);
      }
      const uploadsFolder = await ensureAppSubfolder(googleToken, projectFolder.folderId, 'Invoice Uploads');
      const splitFileName = buildInvoiceFileName({
        ...splitMetadata,
        lotNumber: projectFolder.lotName
      });

      const result = await uploadFileToDrive(
        googleToken,
        uploadsFolder,
        splitFileName,
        'application/pdf',
        splitPdfBlob,
        JSON.stringify(splitMetadata)
      );

      if (!mainUploadResult) {
        mainUploadResult = result;
      }
    }
  } else {
    const uploadsFolder = await ensureAppSubfolder(googleToken, selectedFolder.id, 'Invoice Uploads');
    mainUploadResult = await uploadFileToDrive(
      googleToken,
      uploadsFolder,
      buildInvoiceFileName(metadata),
      'application/pdf',
      pdfBlob,
      JSON.stringify(item.id ? { ...metadata, receiptId: buildReceiptId(item.id) } : metadata)
    );
  }

  if (!mainUploadResult) {
    throw new Error('No invoice splits had a valid amount to upload.');
  }

    return {
      logs: buildHistoryLogs(metadata, {
        idPrefix: mainUploadResult.id,
        link: mainUploadResult.webViewLink
      }),
      hasDriveUpload: true,
      successMessage: 'Document report PDF synced successfully!',
      driveFileId: mainUploadResult.id,
      webViewLink: mainUploadResult.webViewLink
    };
  }
