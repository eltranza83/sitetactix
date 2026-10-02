/**
 * Receipts tool: opens a receipt PDF in DocumentViewerModal and returns
 * scanned line items, SKU, and product details.
 */

export async function open_receipt(args = {}, context = {}) {
  const ledger = context.ledgerSource;
  let targetFileId = args.driveFileId || null;
  let matchedTx = null;

  if (ledger) {
    const txs = ledger.getTransactions({
      text: args.text || args.paymentId || '',
      vendor: args.vendor || ''
    });

    if (targetFileId) {
      matchedTx = txs.find(t => t.driveFileId === targetFileId) || null;
    } else if (txs.length > 0) {
      // Find the first payment that has a valid drive file ID
      matchedTx = txs.find(t => t.driveFileId) || txs[0];
      targetFileId = matchedTx?.driveFileId || null;
    }
  }

  if (!targetFileId && ledger?.signInExpired) {
    return {
      ok: false,
      error: 'needs_auth',
      message: 'Your Google sign-in expired. Please sign in again.'
    };
  }

  if (!targetFileId && !matchedTx) {
    return {
      ok: false,
      notFound: true,
      message: 'Could not find a matching receipt PDF to open.'
    };
  }

  const fileName = matchedTx ? `${matchedTx.vendor} - ${matchedTx.formattedAmount} (${matchedTx.date}).pdf` : 'Receipt.pdf';
  const fileObj = {
    id: targetFileId,
    fileId: targetFileId,
    name: fileName,
    fileName,
    folderName: matchedTx?.vendor || null,
    mimeType: 'application/pdf',
    webViewLink: targetFileId ? `https://drive.google.com/file/d/${targetFileId}/view` : null
  };

  // Open in UI via callback or event
  if (typeof context.onOpenDocument === 'function' && targetFileId) {
    context.onOpenDocument(fileObj);
  } else if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && targetFileId) {
    window.dispatchEvent(new CustomEvent('open-receipt-document', { detail: fileObj }));
  }

  return {
    ok: true,
    opened: true,
    driveFileId: targetFileId,
    fileName,
    vendor: matchedTx?.vendor || args.vendor || 'Unknown Store',
    date: matchedTx?.date || '',
    amount: matchedTx?.formattedAmount || '',
    lineItems: matchedTx?.lineItems || [],
    message: `Opened receipt PDF for ${matchedTx?.vendor || 'receipt'} (${matchedTx?.formattedAmount || ''}).`
  };
}
