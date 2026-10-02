import { authorizeFileId } from './drive.js';

/**
 * Money tools for Jarvis (read-only financial lookups).
 * All data queries go through LedgerSource.
 */

export async function get_project_summary(_args, context = {}) {
  const ledger = context.ledgerSource;
  if (!ledger) {
    return { ok: false, error: 'no_ledger', message: 'Financial ledger data is not available.' };
  }

  const summary = ledger.getSummary();
  return {
    ok: true,
    data: summary
  };
}

export async function get_contractor_balance(args = {}, context = {}) {
  const ledger = context.ledgerSource;
  if (!ledger) {
    return { ok: false, error: 'no_ledger', message: 'Financial ledger data is not available.' };
  }

  const result = ledger.getContractors(args.contractor);

  return {
    ok: true,
    exactMatch: result.matched,
    data: {
      contractors: result.contractors
    },
    message: result.message
  };
}

export async function get_spending(args = {}, context = {}) {
  const ledger = context.ledgerSource;
  if (!ledger) {
    return { ok: false, error: 'no_ledger', message: 'Financial ledger data is not available.' };
  }

  const result = ledger.getSpending({ phase: args.phase, category: args.category });
  return {
    ok: true,
    data: result
  };
}

export async function search_payments(args = {}, context = {}) {
  const ledger = context.ledgerSource;
  if (!ledger) {
    return { ok: false, error: 'no_ledger', message: 'Financial ledger data is not available.' };
  }

  const payments = ledger.getTransactions({
    text: args.text,
    vendor: args.vendor,
    from: args.from,
    to: args.to,
    minAmount: args.minAmount,
    maxAmount: args.maxAmount
  });

  for (const p of payments) {
    if (p.driveFileId) {
      authorizeFileId({ id: p.driveFileId, name: p.description || p.vendor, folderName: p.vendor, webViewLink: p.link });
    }
  }

  const data = { count: payments.length, payments };
  if (ledger.signInExpired) {
    data.receiptLinksUnavailable = true;
    data.note = 'Receipt links could not be loaded because the Google sign-in expired. If the user wants to open a receipt, tell them: "Your Google sign-in expired. Please sign in again."';
  }

  return {
    ok: true,
    data
  };
}
