/**
 * The one place that reads and shows dollar amounts.
 */

/**
 * A number from a Sheet value or typed text ("$1,234.50" -> 1234.5); anything unreadable is 0.
 * Accounting negatives count as negative: "(45.10)" and "45.10-" -> -45.1.
 */
export function parseMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value ?? '').trim();
  const parsed = parseFloat(text.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(parsed)) return 0;
  const accountingNegative = /\([^()]*\d[^()]*\)/.test(text) || /^[^-]*\d[^-]*-$/.test(text);
  return accountingNegative ? -Math.abs(parsed) : parsed;
}

/**
 * Dollars for the screen: "$1,234.50", negatives as "-$500.00".
 * cents: 'always' (default) or 'auto' (drop ".00" on whole dollars: "$15,000", "$20.15").
 */
export function formatMoney(value, { cents = 'always' } = {}) {
  const totalCents = Math.round(parseMoney(value) * 100);
  const showCents = cents === 'always' || totalCents % 100 !== 0;
  const digits = showCents ? 2 : 0;
  const text = (Math.abs(totalCents) / 100).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${totalCents < 0 ? '-' : ''}$${text}`;
}
