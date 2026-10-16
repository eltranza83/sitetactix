/**
 * Punch item status names shown on screen and in packets. The saved values never change
 * ('open', 'in_progress', 'resolved'), so older items keep working.
 * in_progress = the sub's fix photo was added with Mark Fixed and is waiting for the builder's check.
 */
export const ISSUE_STATUS_LABELS = {
  open: 'Open',
  in_progress: 'Fix submitted',
  resolved: 'Resolved'
};

export function issueStatusLabel(status) {
  return ISSUE_STATUS_LABELS[status] || ISSUE_STATUS_LABELS.open;
}

/** The text copied for a sub when sharing a punch item (dueDateLabel: the date as shown on the card). */
export function buildSubShareText(issue, dueDateLabel = '') {
  const { title, category, tradePhase, contractorName, dueDate, description, photoUrl } = issue || {};
  return [
    `SiteTactix Issue: ${title}`,
    `Category: ${category?.replace(/_/g, ' ') || 'General'}${tradePhase ? ` (${tradePhase})` : ''}`,
    contractorName ? `Assigned To: ${contractorName}` : null,
    dueDate ? `Target Due Date: ${dueDateLabel || dueDate}` : null,
    description ? `Details: ${description}` : null,
    photoUrl ? `Defect Photo: ${photoUrl}` : null,
    'Please text back a proof photo once completed for verification.'
  ].filter(Boolean).join('\n');
}
