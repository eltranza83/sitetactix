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
